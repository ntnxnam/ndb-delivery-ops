/**
 * /api/release-dataset/* — exposes the shared releaseDataset surface
 * (Phase 3 port from data_layer.py) to the client.
 *
 * For now this is a thin synopsis endpoint that returns the 5-bucket
 * Engineering Payload composition per D36 + comprehensive-jql-and-metrics.mdc.
 * No cache yet — counts are cheap (5 + 1 sidecar + 1 union JQL via
 * jiraConnector.searchCount, each a maxResults=0 call).
 *
 * D1 inputs (projectKey, labelPrefix, productPrefix, sprintCalendar) all
 * come from ProductService — never hardcoded.
 *
 * Implemented endpoints:
 *   POST /sync             → run syncReleaseDataset (SSE progress stream)
 *   GET  /sync-status      → disk meta + live fixVersions from listFixVersionsForTeam
 *   DELETE /cache          → wipe bundle or full cache (mode=bundle|full)
 *
 * Planned:
 *   - /api/release-dataset/sprint-velocity  → Dev / QA-Ver / QA-Test per sprint
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { apiLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware, extractToken } = require('../middleware/auth/jira');
const { getFieldId } = require('../utils/jiraFieldsConfig');
const syncLocking = require('../utils/syncLocking');
const syncScheduler = require('../jobs/syncScheduler');
const { wrapTeamScope, isUnreleasedVersion } = require('../utils/teamScope');
const { fetchLivePerRelease, listLiveFixVersions, tokenFromReq } = require('../services/releaseLiveDatasetService');

// Path to the human-curated release-gate config. Owned by RM/TPMs and
// updated via /release-config in-app — the same file the legacy
// milestoneProcessor reads. We accept its presence as authoritative;
// when an entry for a release is missing the endpoint returns an empty
// timeline rather than 404.
const RELEASE_GATE_CONFIG_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'releaseVersionsEmailConfig.json'
);

function loadReleaseGateConfig() {
  try {
    const raw = fs.readFileSync(RELEASE_GATE_CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.releaseGateDates) {
      return parsed.releaseGateDates;
    }
    return {};
  } catch (e) {
    console.warn(
      '[release-dataset] could not read releaseVersionsEmailConfig.json:',
      e?.message || e
    );
    return {};
  }
}

// Explicit absolute path to the productService config, so the singleton
// is bound regardless of where the server is started from. This is the
// canonical location of teamBoardConfig.json in this monorepo.
const PRODUCT_CONFIG_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'teamBoardConfig.json'
);
const RELEASE_DATASET_CACHE_DIR = path.resolve(
  __dirname,
  '..', '..', '..', '..', 'shared', '.cache', 'release-dataset'
);

const auth = [apiLimiter, validateJiraTokenMiddleware];
const SYNC_LOCK_TTL_MS = 10 * 60 * 1000;

// Lazy-import the ESM shared package (one-shot, cached) — mirrors
// dateMover.js so we have one consistent loading pattern across routes.
let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    // In Jest/CJS tests we need require() so jest.mock() can intercept.
    if (process.env.NODE_ENV === 'test') {
      _sharedPromise = Promise.resolve(require('@portfolio-delivery-ops/shared'));
    } else {
      _sharedPromise = import('@portfolio-delivery-ops/shared');
    }
  }
  return _sharedPromise;
}

function buildCache(productId, shared) {
  const { ReleaseDatasetCache } = shared;
  return new ReleaseDatasetCache({
    cacheDir: RELEASE_DATASET_CACHE_DIR,
    productId,
  });
}

/** Non-empty cached payload for a release, or null when the trunk is empty/missing. */
function loadCachedReleaseTickets(cache, release) {
  if (!release) return null;
  const loaded = cache.loadReleaseLenient(release);
  const tickets = loaded?.tickets;
  return Array.isArray(tickets) && tickets.length > 0 ? tickets : null;
}

function acquireLockOrThrow(lockKey, owner) {
  const lock = syncLocking.acquire(lockKey, {
    ttlMs: SYNC_LOCK_TTL_MS,
    owner,
  });
  if (!lock.ok) {
    const remainingSec = Math.ceil((lock.remainingMs || 0) / 1000);
    throw new Error(`A sync is already running for this release. Try again in ${remainingSec}s.`);
  }
}

function classifySyncFailure(error) {
  const message = error?.message || '';
  const status = error?.response?.status || null;
  const isRateLimited = status === 429 || /429|rate limit/i.test(message);
  const isTimeout = /timeout|timed out|ETIMEDOUT/i.test(message);
  return {
    message,
    status,
    isRateLimited,
    isTimeout,
  };
}

/**
 * SSE comment pings so nginx proxy_read_timeout does not kill a quiet
 * ScriptRunner wait. Clients ignore comment lines (`: ping`).
 */
function startSseHeartbeat(res, intervalMs = 15000) {
  const id = setInterval(() => {
    if (res.writableEnded) {
      clearInterval(id);
      return;
    }
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(id);
    }
  }, intervalMs);
  return () => clearInterval(id);
}

// Human-readable labels + ordering for the synopsis component cards.
// Keep ordering identical to PAYLOAD_BUCKET_KEYS (parents-first) so the
// cards on the page read in the same logical order as the dedup.
const COMPONENT_LABELS = {
  top_level_projects:         'Top-Level Projects',
  epics_of_projects:          'Epics of Projects',
  work_toward_project:        'Work Toward Projects',
  standalone_epics:           'Standalone Epics',
  work_toward_standalone_epic:'Work Toward Standalone Epics',
  direct_tickets:             'Direct Release Tickets',
};

const SIDECAR_LABELS = {
  deferred: 'Deferred',
};

/**
 * GET /api/release-dataset/releases?productId=ndb
 *
 * Cache-status endpoint for the Unified Data Layer.
 * Returns only what is already present on disk (no JIRA calls).
 */
router.get('/releases', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    const shared = await getShared();
    const { getProductService } = shared;
    const productService = getProductService(PRODUCT_CONFIG_PATH);

    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return res.status(400).json({
        success: false,
        error: `Unknown productId '${productId}': ${e.message}`,
      });
    }

    const cache = buildCache(productId, shared);
    const cacheInfo = cache.getCachedReleasesInfo({
      projectKey: product.projectKey,
      labelPrefix: productService.getLabelPrefix(productId),
    });

    const synced = Object.entries(cacheInfo)
      .filter(([, meta]) => meta.loadableStrict)
      .map(([release]) => release)
      .sort();

    return res.json({
      success: true,
      data: {
        productId,
        synced,
        meta: cacheInfo,
      },
    });
  } catch (e) {
    console.error('[release-dataset] /releases error:', e?.message || e);
    return res.status(500).json({
      success: false,
      error: e?.message || 'Failed to load cached releases',
    });
  }
});

/**
 * GET /api/release-dataset/per-release/:release?productId=
 *
 * Live fetchReleaseData wrapped with the team's baseFilter.
 */
router.get('/per-release/:release', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    const release = (req.params.release || '').toString().trim();
    if (!productId) {
      return res.status(400).json({
        success: false,
        error: 'productId query parameter is required',
      });
    }
    const data = await fetchLivePerRelease({
      productId,
      release,
      jiraToken: tokenFromReq(req),
      writeThrough: false,
    });
    return res.json({
      success: true,
      data,
    });
  } catch (e) {
    console.error('[release-dataset] /per-release error:', e?.message || e);
    const status = e.statusCode || e.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e.publicError || e.message || 'Failed to load live release dataset',
    });
  }
});

/**
 * GET /api/release-dataset/synopsis?productId=ndb&release=NDB-2.11
 *
 * Returns the per-bucket counts + JQL + click-through URLs for the
 * Engineering Payload composition.
 */
router.get('/synopsis', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    const release = (req.query.release || '').toString().trim();
    if (!release) {
      return res
        .status(400)
        .json({ success: false, error: 'release query parameter is required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const shared = await getShared();
    const {
      JiraConnector,
      loadEnv,
      getProductService,
      getComponentQueries,
      buildEngineeringPayloadJql,
      buildReleasePayloadJql,
      getDeferredQuery,
      PAYLOAD_BUCKET_KEYS,
    } = shared;

    // D1: every input comes from productService. Pass the explicit
    // config path so the singleton can't bind to the wrong location
    // when the server is started from a non-monorepo-root cwd.
    const productService = getProductService(PRODUCT_CONFIG_PATH);
    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return res
        .status(400)
        .json({ success: false, error: `Unknown productId '${productId}': ${e.message}` });
    }
    const projectKey = product.projectKey;
    const labelPrefix = productService.getLabelPrefix(productId);

    // requirePat:false — the user's PAT comes in via the Authorization
    // header (extractToken above), not from process env. loadEnv() should
    // not gate this route on JIRA_PAT being set at boot.
    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const teamFilter = product.baseFilter || '';
    const scoped = (jql) => wrapTeamScope(teamFilter, jql);

    // Component bucket queries (5) — click-through JQL wrapped with baseFilter.
    const bucketJql = getComponentQueries(release, false, teamFilter);

    // Sidecars — deferred label only. Wishlist is intentionally excluded
    // from the Release Brief synopsis (UX call: it muddied the payload
    // story without driving a decision). The shared `getWishlistQuery`
    // helper is still available for other consumers via the shared package.
    const deferredJql = getDeferredQuery(release, { labelPrefix });

    // Engineering Payload union (D36) — the deduped grand total.
    // Per D36, this should be the 5-bucket union with NO project filter,
    // capturing tickets from any contributing project (ERA, FEAT, TECHPUBS, etc.)
    const releasePayloadJql = buildReleasePayloadJql(release);

    // Run all counts in parallel — they're independent maxResults=0 calls.
    const componentEntries = PAYLOAD_BUCKET_KEYS.map((key) => ({
      key,
      label: COMPONENT_LABELS[key] || key,
      jql: bucketJql[key],
    }));
    const sidecarEntries = [
      { key: 'deferred', label: SIDECAR_LABELS.deferred, jql: scoped(deferredJql) },
    ];
    
    // Issue type group breakdown — 6 groups per issue-type-grouping.mdc
    const issueTypeGroups = [
      {
        key: 'issue_group_project_hierarchy',
        label: 'Project Hierarchy',
        filter: 'issueType in (Feature, Initiative, Epic, X-FEAT, Capability)',
      },
      { key: 'issue_group_bug', label: 'Bug', filter: 'issueType = Bug' },
      { key: 'issue_group_improvement', label: 'Improvement', filter: 'issueType = Improvement' },
      { key: 'issue_group_dev_code', label: 'Dev Code', filter: 'issueType in (Task, "Unit Test")' },
      { key: 'issue_group_test', label: 'Test', filter: 'issueType = Test' },
      {
        key: 'issue_group_everything_else',
        label: 'Everything Else',
        filter: 'issueType not in (Feature, Initiative, Epic, X-FEAT, Capability, Bug, Improvement, Task, "Unit Test", Test)',
      },
    ];
    const issueTypeGroupEntries = issueTypeGroups.map((group) => ({
      key: group.key,
      label: group.label,
      jql: scoped(`${releasePayloadJql} AND (${group.filter})`),
    }));

    const allEntries = [
      ...componentEntries,
      ...sidecarEntries,
      { key: 'engineering_payload', label: 'Total Release Payload (deduped)', jql: scoped(releasePayloadJql) },
      ...issueTypeGroupEntries,
    ];

    const counts = await Promise.all(
      allEntries.map(async (entry) => {
        try {
          const total = await jira.searchCount(entry.jql);
          return { ...entry, count: total, error: null };
        } catch (e) {
          return { ...entry, count: null, error: e?.message || 'Search failed' };
        }
      })
    );

    // Split results back into shape the client expects.
    const componentResults = counts.slice(0, componentEntries.length);
    const sidecarResults = counts.slice(
      componentEntries.length,
      componentEntries.length + sidecarEntries.length
    );
    const totalIdx = componentEntries.length + sidecarEntries.length;
    const total = counts[totalIdx];
    const issueTypeGroupResults = counts.slice(totalIdx + 1);

    return res.json({
      success: true,
      data: {
        productId,
        release,
        projectKey,
        labelPrefix,
        total,
        components: componentResults,
        sidecars: sidecarResults,
        issueTypeGroups: issueTypeGroupResults,
        // Sum of raw bucket counts — for reference; this is intentionally
        // not the same as the deduped total above. Showing both makes the
        // dedup story legible to a reader.
        rawComponentSum: componentResults.reduce(
          (acc, c) => (typeof c.count === 'number' ? acc + c.count : acc),
          0
        ),
      },
    });
  } catch (e) {
    console.error('[release-dataset] /synopsis error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Synopsis failed',
    });
  }
});

/**
 * GET /api/release-dataset/velocity?productId=ndb&release=NDB-2.11&sprintsBack=3
 *
 * 3-stream sprint velocity (Dev / QA-Verification / QA-Test-Tasks).
 * Cache-first on the release-dataset trunk when `release` is set and
 * tickets exist; otherwise live JIRA `searchCount`. Whole-team velocity
 * (no `release`) is always live — the trunk is per-release.
 *
 * Per `sprint-velocity-types.mdc`. Powers the Sprint Velocity panel on
 * the Release Brief.
 *
 * Response shape:
 *   {
 *     productId, release, projectKey, sprintCalendar,
 *     sprints: [
 *       {
 *         sprintNumber, sprintLabel, window: {startIso, endIso}, isCurrent,
 *         dev:            { count, jql, error? },
 *         qaVerification: { count, adjustedCount, jql, error? },
 *         qaTestTasks:    { count, jql, error? }
 *       },
 *       ... most recent first
 *     ]
 *   }
 */
router.get('/velocity', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    const release = (req.query.release || '').toString().trim() || undefined;
    const sprintsBack = Math.max(
      1,
      Math.min(12, Number.parseInt(req.query.sprintsBack, 10) || 3)
    );

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const shared = await getShared();
    const {
      JiraConnector,
      loadEnv,
      getProductService,
      computeRecentSprintVelocity,
      computeRecentSprintVelocityFromTickets,
    } = shared;

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return res
        .status(400)
        .json({ success: false, error: `Unknown productId '${productId}': ${e.message}` });
    }
    let sprintCalendar;
    try {
      sprintCalendar = productService.getSprintCalendar(productId);
    } catch (e) {
      return res
        .status(400)
        .json({ success: false, error: e.message });
    }

    const cachedTickets = loadCachedReleaseTickets(
      buildCache(productId, shared),
      release
    );
    let source = 'live';
    let sprints;
    if (cachedTickets) {
      source = 'cache';
      sprints = computeRecentSprintVelocityFromTickets({
        tickets: cachedTickets,
        projectKey: product.projectKey,
        release,
        sprintCalendar,
        sprintsBack,
      });
    } else {
      const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
      const jira = new JiraConnector(env);
      sprints = await computeRecentSprintVelocity(jira, {
        projectKey: product.projectKey,
        release,
        sprintCalendar,
        sprintsBack,
      });
    }

    return res.json({
      success: true,
      data: {
        productId,
        release: release || null,
        projectKey: product.projectKey,
        sprintCalendar,
        source,
        sprints,
      },
    });
  } catch (e) {
    console.error('[release-dataset] /velocity error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Velocity computation failed',
    });
  }
});

/**
 * GET /api/release-dataset/forecast?productId=ndb&release=NDB-2.11&plannedGaIso=YYYY-MM-DD
 *
 * Landing-forecast MVP. Cache-first on the release-dataset trunk;
 * live JIRA `searchCount` only when the trunk is empty. Returns a
 * predicted GA date, gap to plan, verdict (on_time / slipping / at_risk),
 * confidence, and a one-line VP-friendly explanation.
 *
 * `plannedGaIso` is optional; without it the response sets verdict to
 * 'unknown' (correct, not 'on_time' by default — matches Streamlit).
 *
 * See STREAMLIT_PARITY.md for what's intentionally deferred (curve-based
 * forecast, phase-aware inflow projection, baseline comparison cards).
 */
router.get('/forecast', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    const release = (req.query.release || '').toString().trim();
    const plannedGaIso = (req.query.plannedGaIso || '').toString().trim() || null;
    if (!release) {
      return res
        .status(400)
        .json({ success: false, error: 'release query parameter is required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const shared = await getShared();
    const {
      JiraConnector,
      loadEnv,
      getProductService,
      computeLandingForecast,
      computeLandingForecastFromTickets,
    } = shared;

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return res
        .status(400)
        .json({ success: false, error: `Unknown productId '${productId}': ${e.message}` });
    }
    let sprintCalendar;
    try {
      sprintCalendar = productService.getSprintCalendar(productId);
    } catch (e) {
      return res.status(400).json({ success: false, error: e.message });
    }

    const cachedTickets = loadCachedReleaseTickets(
      buildCache(productId, shared),
      release
    );
    let source = 'live';
    let forecast;
    if (cachedTickets) {
      source = 'cache';
      forecast = computeLandingForecastFromTickets({
        tickets: cachedTickets,
        projectKey: product.projectKey,
        release,
        labelPrefix: productService.getLabelPrefix(productId),
        sprintCalendar,
        plannedGaIso,
      });
    } else {
      const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
      const jira = new JiraConnector(env);
      forecast = await computeLandingForecast({
        jira,
        projectKey: product.projectKey,
        release,
        sprintCalendar,
        plannedGaIso,
      });
    }

    return res.json({
      success: true,
      data: {
        productId,
        release,
        projectKey: product.projectKey,
        source,
        forecast,
      },
    });
  } catch (e) {
    console.error('[release-dataset] /forecast error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Forecast failed',
    });
  }
});

/**
 * GET /api/release-dataset/gates?release=NDB-2.11
 *
 * Returns the chronological gate timeline (EC + CC + CG + PG + GA) for
 * a release, sourced from the human-curated
 * `releaseVersionsEmailConfig.json`. No JIRA round-trip — pure config
 * read, so this endpoint is cheap and doesn't need a PAT… but we still
 * gate it on `auth` so anonymous traffic doesn't pull internal dates.
 *
 * First fusion step for STREAMLIT_PARITY.md row "Gantt gate chips":
 * gives the Release Brief page (and later the legacy Gantt) a single
 * normalised feed of gate events.
 *
 * Response shape:
 *   {
 *     release, totalGates,
 *     gates:        [{ kind, label, iso, color, style, source, past }, ...],
 *     nextByKind:   { EC?, CC?, CG?, PG?, GA? },
 *     nextOverall:  { ... } | null
 *   }
 */
router.get('/gates', auth, async (req, res) => {
  try {
    const release = (req.query.release || '').toString().trim();
    if (!release) {
      return res
        .status(400)
        .json({ success: false, error: 'release query parameter is required' });
    }

    const shared = await getShared();
    const { parseReleaseGateTimeline } = shared;

    const gateConfig = loadReleaseGateConfig();
    const versionConfig = gateConfig[release] || null;

    const timeline = parseReleaseGateTimeline(release, { versionConfig });

    return res.json({
      success: true,
      data: {
        release: timeline.release,
        totalGates: timeline.gates.length,
        gates: timeline.gates,
        nextByKind: timeline.nextByKind,
        nextOverall: timeline.nextOverall,
        configured: versionConfig !== null,
      },
    });
  } catch (e) {
    console.error('[release-dataset] /gates error:', e?.message || e);
    return res.status(500).json({
      success: false,
      error: e?.message || 'Gate timeline failed',
    });
  }
});

/**
 * GET /api/release-dataset/outstanding?productId=ndb&release=NDB-2.11
 *
 * Returns the 5-tile Outstanding & Deferred composition. Tiles, JQL
 * semantics, and label pattern were approved 2026-05-20 — see
 * `shared/src/services/outstandingService.ts` for the spec.
 *
 * Response shape:
 *   {
 *     productId, release, projectKey, labelPrefix,
 *     tiles: [
 *       { key, label, caption, count, jql, wrapped, error }
 *     ]
 *   }
 *
 * No cache yet — 5 parallel `searchCount` (maxResults=0) calls; cheap
 * enough that the page-level skeleton mask is sufficient cover.
 */
router.get('/outstanding', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    const release = (req.query.release || '').toString().trim();
    if (!release) {
      return res
        .status(400)
        .json({ success: false, error: 'release query parameter is required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const shared = await getShared();
    const {
      JiraConnector,
      loadEnv,
      getProductService,
      computeOutstandingCounts,
    } = shared;

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return res
        .status(400)
        .json({ success: false, error: `Unknown productId '${productId}': ${e.message}` });
    }
    const projectKey = product.projectKey;
    const labelPrefix = productService.getLabelPrefix(productId);

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const tiles = await computeOutstandingCounts(jira, {
      release,
      projectKey,
      labelPrefix,
    });

    return res.json({
      success: true,
      data: {
        productId,
        release,
        projectKey,
        labelPrefix,
        tiles,
      },
    });
  } catch (e) {
    console.error('[release-dataset] /outstanding error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Outstanding computation failed',
    });
  }
});

/**
 * /project-status — Builds the per-project issue-type-group breakdown
 * matrix. Cache-first: reads the on-disk release bundle when present;
 * when the bundle is empty (no sync has run) it falls back to a live
 * per-release JIRA fetch scoped by the team baseFilter, so the endpoint
 * NEVER dead-ends on "run a sync first". Derivation is pure in-memory in
 * both cases.
 *
 * Response shape (identical to old /project-breakdown so the client
 * needs no changes):
 *   { success, data: { productId, release, projects, standaloneEpics,
 *                      standaloneTickets, _source: 'bundle' | 'live' } }
 */
router.get('/project-status', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    const release = (req.query.release || '').toString().trim();

    if (!release) {
      return res.status(400).json({ success: false, error: 'release query parameter is required' });
    }

    const shared = await getShared();
    const cache = buildCache(productId, shared);
    const loaded = cache.loadReleaseLenient(release);
    let tickets = Array.isArray(loaded?.tickets) ? loaded.tickets : [];
    let source = 'bundle';
    let bundleSyncedAt = loaded?.meta?.syncedAt ?? null;

    // Empty disk is NOT a dead end. Fall back to a live per-release fetch
    // (same path as GET /per-release), scoped by the team baseFilter. We
    // never tell the user to "run a sync first".
    if (tickets.length === 0) {
      const live = await fetchLivePerRelease({
        productId,
        release,
        jiraToken: tokenFromReq(req),
        writeThrough: false,
      });
      tickets = Array.isArray(live?.tickets) ? live.tickets : [];
      source = 'live';
      bundleSyncedAt = null;
    }

    // ── Constants matching the old live endpoint ──────────────────────────
    const FEAT_TYPES = new Set(['Feature', 'Initiative', 'X-FEAT', 'Capability']);
    const EPIC_TYPE = 'Epic';
    const DONE_STATUSES = new Set(['Fixed', 'Done', 'Resolved', 'Complete', 'Closed']);
    const TO_VERIFY_STATUSES = new Set(['In Review', 'Testing', 'Ready for Testing']);
    const GROUP_LABELS = ['Project Hierarchy', 'Bug', 'Improvement', 'Dev Code', 'Test', 'Everything Else'];

    const classify = (issueType) => {
      if (FEAT_TYPES.has(issueType) || issueType === EPIC_TYPE) return 'Project Hierarchy';
      if (issueType === 'Bug') return 'Bug';
      if (issueType === 'Improvement') return 'Improvement';
      if (issueType === 'Task' || issueType === 'Unit Test') return 'Dev Code';
      if (issueType === 'Test') return 'Test';
      return 'Everything Else';
    };

    const emptyGroup = (label) => ({ label, outstanding: 0, toVerify: 0, closed: 0, total: 0 });

    const countInto = (bucket, ticket) => {
      bucket.total++;
      const status = ticket['Status'] || '';
      if (DONE_STATUSES.has(status)) {
        if (ticket['Is QA Verification']) bucket.toVerify++;
        else bucket.closed++;
      } else if (TO_VERIFY_STATUSES.has(status)) {
        bucket.toVerify++;
      } else {
        bucket.outstanding++;
      }
    };

    const makeGroupsMap = () => {
      const m = {};
      for (const l of GROUP_LABELS) m[l] = emptyGroup(l);
      return m;
    };

    // ── Build lookup maps from bundle ─────────────────────────────────────
    // epicToFeat: epicKey → featKey (via Portfolio Parent Key)
    const epicToFeat = new Map();
    for (const t of tickets) {
      if (t['Issue Type'] === EPIC_TYPE && t['Portfolio Parent Key']) {
        epicToFeat.set(t['Issue Key'], t['Portfolio Parent Key']);
      }
    }

    // ── TIER 1: Top-level projects (FEAT/Initiative/X-FEAT/Capability
    //           tagged in top_level_projects bucket) ──────────────────────
    const featTickets = tickets.filter(
      (t) => FEAT_TYPES.has(t['Issue Type']) &&
             typeof t['Components'] === 'string' &&
             t['Components'].includes('top_level_projects')
    );

    const projects = featTickets.map((feat) => {
      const featKey = feat['Issue Key'];
      const groupsMap = makeGroupsMap();

      for (const t of tickets) {
        if (FEAT_TYPES.has(t['Issue Type']) || t['Issue Type'] === EPIC_TYPE) continue;

        // Resolve child → FEAT via Epic Link → Portfolio Parent Key
        let resolvedFeat = null;
        if (t['Epic Link Key']) {
          resolvedFeat = epicToFeat.get(t['Epic Link Key']) || null;
        }
        if (!resolvedFeat && t['Portfolio Parent Key']) {
          resolvedFeat = t['Portfolio Parent Key'];
        }

        if (resolvedFeat !== featKey) continue;

        const g = classify(t['Issue Type']);
        countInto(groupsMap[g], t);
      }

      const issueTypeGroups = GROUP_LABELS.map((l) => groupsMap[l]);
      const allChildren = issueTypeGroups.reduce((s, g) => s + g.total, 0);
      return {
        projectKey: featKey,
        projectName: feat['Summary'] || featKey,
        issueType: feat['Issue Type'],
        plannedCcDate: feat['CC Date'] ?? null,
        total: allChildren,
        outstanding: issueTypeGroups.reduce((s, g) => s + g.outstanding, 0),
        closed: issueTypeGroups.reduce((s, g) => s + g.closed, 0),
        issueTypeGroups,
      };
    });

    // ── TIER 2: Standalone Epics (no Portfolio Parent Key) ────────────────
    // Exclude closed/done/cancelled epics — they no longer need tracking.
    const standaloneEpicTickets = tickets.filter(
      (t) => t['Issue Type'] === EPIC_TYPE && !t['Portfolio Parent Key'] &&
             typeof t['Components'] === 'string' &&
             t['Components'].includes('standalone_epics') &&
             !DONE_STATUSES.has(t['Status'] || '') &&
             (t['Status'] || '').toLowerCase() !== 'cancelled'
    );

    const standaloneEpics = standaloneEpicTickets.map((epic) => {
      const epicKey = epic['Issue Key'];
      const groupsMap = makeGroupsMap();

      for (const t of tickets) {
        if (FEAT_TYPES.has(t['Issue Type']) || t['Issue Type'] === EPIC_TYPE) continue;
        if (t['Epic Link Key'] !== epicKey) continue;

        const g = classify(t['Issue Type']);
        countInto(groupsMap[g], t);
      }

      const issueTypeGroups = GROUP_LABELS.map((l) => groupsMap[l]);
      return {
        projectKey: epicKey,
        projectName: epic['Summary'] || epicKey,
        issueTypeGroups,
        status: epic['Status'] || '',
      };
    });

    // ── TIER 3: Standalone Tickets (direct_tickets bucket) ───────────────
    const standaloneTicketItems = tickets.filter(
      (t) => typeof t['Components'] === 'string' &&
             t['Components'].includes('direct_tickets')
    );

    const standaloneGroupsMap = makeGroupsMap();
    for (const t of standaloneTicketItems) {
      countInto(standaloneGroupsMap[classify(t['Issue Type'])], t);
    }
    const standaloneTickets = {
      projectKey: 'standalone-tickets',
      projectName: 'Standalone Tickets (no epic)',
      issueTypeGroups: GROUP_LABELS.map((l) => standaloneGroupsMap[l]),
    };

    // Tier-level outstanding by bucket tag when parent-link attribution is empty.
    const hasTag = (t, tag) =>
      typeof t['Components'] === 'string' &&
      t['Components'].split(',').some((x) => x.trim() === tag);

    const countByTag = (tag) => {
      const groupsMap = makeGroupsMap();
      for (const t of tickets) {
        if (!hasTag(t, tag)) continue;
        if (FEAT_TYPES.has(t['Issue Type']) || t['Issue Type'] === EPIC_TYPE) continue;
        countInto(groupsMap[classify(t['Issue Type'])], t);
      }
      return GROUP_LABELS.map((l) => groupsMap[l]);
    };

    const sumOpen = (groups) =>
      (groups || []).reduce((s, g) => s + (g.outstanding || 0) + (g.toVerify || 0), 0);

    const featByTag = countByTag('work_toward_project');
    const standaloneByTag = countByTag('work_toward_standalone_epic');
    const projectsOpen = projects.reduce((s, p) => s + sumOpen(p.issueTypeGroups), 0);
    const standaloneOpen = standaloneEpics.reduce((s, e) => s + sumOpen(e.issueTypeGroups), 0);

    const rollup = (rows) => {
      const totals = makeGroupsMap();
      for (const row of rows) {
        for (const g of row.issueTypeGroups || []) {
          totals[g.label].outstanding += g.outstanding || 0;
          totals[g.label].toVerify += g.toVerify || 0;
          totals[g.label].closed += g.closed || 0;
          totals[g.label].total += g.total || 0;
        }
      }
      return GROUP_LABELS.map((l) => totals[l]);
    };

    const tierOutstanding = {
      feat: projectsOpen > 0 ? rollup(projects) : featByTag,
      standalone: standaloneOpen > 0 ? rollup(standaloneEpics) : standaloneByTag,
      direct: standaloneTickets.issueTypeGroups,
      _source: {
        feat: projectsOpen > 0 ? 'parent-link' : 'work_toward_project-tag',
        standalone: standaloneOpen > 0 ? 'parent-link' : 'work_toward_standalone_epic-tag',
        direct: 'direct_tickets-tag',
      },
    };

    // Click-through JQL for Outstanding-by-type chart (payload buckets, not
    // bare fixVersion). Client ANDs issuetype + open-status filter.
    let tierJql = { feat: null, standalone: null, direct: null };
    try {
      const { getComponentQueries } = shared;
      if (typeof getComponentQueries === 'function') {
        const buckets = getComponentQueries(release, false);
        tierJql = {
          feat: buckets.work_toward_project || null,
          standalone: buckets.work_toward_standalone_epic || null,
          direct: buckets.direct_tickets || null,
        };
      }
    } catch (jqlErr) {
      console.warn('[release-dataset] /project-status tierJql build failed:', jqlErr.message);
    }

    return res
      .set('Cache-Control', 'no-cache, no-store, must-revalidate')
      .set('Pragma', 'no-cache')
      .set('Expires', '0')
      .json({
        success: true,
        data: {
          productId,
          release,
          projects,
          standaloneEpics,
          standaloneTickets,
          tierOutstanding,
          tierJql,
          _source: source,
          _bundleSyncedAt: bundleSyncedAt,
        },
      });
  } catch (e) {
    console.error('[release-dataset] /project-status error:', e?.message || e);
    const status = e.statusCode || e.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e.publicError || e?.message || 'Project status computation failed',
    });
  }
});

/**
 * /project-breakdown — deprecated alias; forwards to /project-status.
 * Kept for back-compat with stale callers. Remove after next release.
 * @deprecated use /project-status
 */
router.get('/project-breakdown', auth, (req, res) => {
  const qs = new URLSearchParams(req.query).toString();
  return res.redirect(307, `/api/release-dataset/project-status${qs ? `?${qs}` : ''}`);
});

// (old 6-stage live-JIRA project-breakdown implementation removed 2026-06-16)
// Replaced by bundle-backed /project-status above. Full history in git.

// ── burndown helpers ─────────────────────────────────────────────────────────

/**
 * Return the ISO date (YYYY-MM-DD) of the Monday for the week that contains `d`.
 * All arithmetic in UTC to avoid DST edge cases.
 */
function mondayOfWeek(d) {
  const date = new Date(d);
  if (isNaN(date.getTime())) return null;
  const dow = date.getUTCDay(); // 0=Sun … 6=Sat
  const daysBack = dow === 0 ? 6 : dow - 1;
  const monday = new Date(date);
  monday.setUTCDate(date.getUTCDate() - daysBack);
  monday.setUTCHours(0, 0, 0, 0);
  return monday.toISOString().slice(0, 10);
}

/** Build a human-readable "Jun W2" label from a Monday ISO string. */
function buildWeekLabel(mondayIso) {
  if (!mondayIso) return '';
  const d = new Date(mondayIso + 'T00:00:00Z');
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const weekOfMonth = Math.ceil(d.getUTCDate() / 7);
  return `${month} W${weekOfMonth}`;
}

/**
 * Bucket JIRA issues into weekly created-vs-resolved slots.
 *
 * Returns an array of `weeks` items, oldest first, each shaped:
 *   { weekStart: "YYYY-MM-DD", weekLabel: "Jun W2", created: N, resolved: N }
 */
function buildWeeklyBuckets(issues, weeks) {
  // Monday of the current (UTC) week
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  const dow = now.getUTCDay();
  const currentMonday = new Date(now);
  currentMonday.setUTCDate(now.getUTCDate() - (dow === 0 ? 6 : dow - 1));

  // Build ordered bucket map: mondayIso → bucket
  const orderedKeys = [];
  const buckets = {};
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(currentMonday);
    d.setUTCDate(currentMonday.getUTCDate() - i * 7);
    const key = d.toISOString().slice(0, 10);
    orderedKeys.push(key);
    buckets[key] = { weekStart: key, weekLabel: buildWeekLabel(key), created: 0, resolved: 0 };
  }

  // Oldest week boundary (ms) — ignore anything before this
  const windowStartMs = new Date(orderedKeys[0] + 'T00:00:00Z').getTime();

  for (const issue of issues) {
    const createdStr = issue.fields?.created;
    const resolvedStr = issue.fields?.resolutiondate;

    if (createdStr) {
      const ms = new Date(createdStr).getTime();
      if (!isNaN(ms) && ms >= windowStartMs) {
        const key = mondayOfWeek(createdStr);
        if (key && buckets[key]) buckets[key].created++;
      }
    }

    if (resolvedStr) {
      const ms = new Date(resolvedStr).getTime();
      if (!isNaN(ms) && ms >= windowStartMs) {
        const key = mondayOfWeek(resolvedStr);
        if (key && buckets[key]) buckets[key].resolved++;
      }
    }
  }

  return orderedKeys.map((k) => buckets[k]);
}

// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/release-dataset/burndown?productId=ndb&release=NDB-2.11&weeks=52
 *
 * Week-on-week Created vs Resolved ticket counts for the engineering payload
 * of a release — designed for the burn-down graph on the Release Brief page.
 *
 * The endpoint fetches ALL tickets in the payload (created + resolutiondate
 * fields only) and buckets them server-side into Monday-aligned ISO weeks.
 *
 * Response shape:
 *   {
 *     productId, release, projectKey, weeks,
 *     totalFetched: number,
 *     weeklyData: [
 *       { weekStart: "YYYY-MM-DD", weekLabel: "Jun W2", created: N, resolved: N },
 *       ...  // `weeks` entries, oldest first
 *     ],
 *     jqlBase: "..."    // base JQL used — for client JIRA click-through links
 *   }
 */
router.get('/burndown', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    const release = (req.query.release || '').toString().trim();
    const weeks = Math.max(4, Math.min(104, Number.parseInt(req.query.weeks, 10) || 52));

    if (!release) {
      return res
        .status(400)
        .json({ success: false, error: 'release query parameter is required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const shared = await getShared();
    const { JiraConnector, loadEnv, getProductService, buildReleasePayloadJql } = shared;

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return res
        .status(400)
        .json({ success: false, error: `Unknown productId '${productId}': ${e.message}` });
    }

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    // The full engineering payload JQL (5-bucket union per D36).
    // We do NOT add a date filter in JQL because portfolioChildrenOf / issuesInEpics
    // don't compose cleanly with date range clauses.  Fetch all and bucket server-side.
    const jqlBase = buildReleasePayloadJql(release);

    console.log(`[release-dataset] /burndown fetching payload for ${release} (${weeks}w window)`);

    const issues = await jira.searchAll(jqlBase, 'created,resolutiondate', {
      pageSize: 1000,
      perPageDelayMs: 100,
      maxIssues: 30000,
    });

    console.log(`[release-dataset] /burndown: ${issues.length} tickets fetched for ${release}`);

    const weeklyData = buildWeeklyBuckets(issues, weeks);

    return res.json({
      success: true,
      data: {
        productId,
        release,
        projectKey: product.projectKey,
        weeks,
        totalFetched: issues.length,
        weeklyData,
        jqlBase,
      },
    });
  } catch (e) {
    console.error('[release-dataset] /burndown error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Burndown failed',
    });
  }
});

/**
 * GET /api/release-dataset/retrospective?release=NDB-2.11&productId=ndb&topN=10
 *
 * Gate-behavior retrospective (legacy aggregate endpoint).
 * NOTE: kept as fallback while phased endpoints roll out:
 *   /retrospective/bootstrap
 *   /retrospective/projects
 *   /retrospective/project/:key
 *
 * Gate-behavior retrospective:
 * - CCM/CG/PG/GA checks
 * - project-level naughty ranking
 * - companion-discipline readiness stream
 */
router.get('/retrospective', auth, async (req, res) => {
  const t0 = Date.now();
  try {
    const release = (req.query.release || '').toString().trim();
    const productId = (req.query.productId || '').toString().trim();
    const topN = Math.max(1, Math.min(50, Number.parseInt(req.query.topN, 10) || 10));

    if (!release) {
      return res
        .status(400)
        .json({ success: false, error: 'release query parameter is required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const shared = await getShared();
    const {
      JiraConnector,
      loadEnv,
      getProductService,
      parseReleaseGateTimeline,
      runRetroGateChecks,
      runNaughtyList,
    } = shared;

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return res
        .status(400)
        .json({ success: false, error: `Unknown productId '${productId}': ${e.message}` });
    }

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const gateConfig = loadReleaseGateConfig();
    const versionConfig = gateConfig[release] || null;
    const gateTimeline = parseReleaseGateTimeline(release, { versionConfig });

    const featureProjectKey = productService.getFeatureProjectKey(productId);
    const companionDisciplines = productService.getCompanionDisciplines(productId);
    const options = {
      release,
      projectKeys: [product.projectKey, featureProjectKey],
      companionDisciplines,
      labelPrefix: productService.getLabelPrefix(productId),
      releasePrefix: productService.getReleasePrefix(productId),
      topN,
    };

    // Parent roots for naughty ranking:
    // 1) FEAT Features tagged to this fixVersion
    // 2) ERA Initiatives tagged to this fixVersion
    const tParents = Date.now();
    const featureParents = await jira.searchAll(
      `project = ${featureProjectKey} AND issueType = Feature AND fixVersion = "${release}"`,
      'key,summary',
      { maxIssues: 5000 }
    );
    const initiativeParents = await jira.searchAll(
      `project = ${product.projectKey} AND issueType = Initiative AND fixVersion = "${release}"`,
      'key,summary',
      { maxIssues: 5000 }
    );
    const parentFetchMs = Date.now() - tParents;

    const parentProjects = [
      ...featureParents.map((i) => ({
        key: i.key,
        summary: i.fields?.summary || i.key,
        parentType: 'Feature',
      })),
      ...initiativeParents.map((i) => ({
        key: i.key,
        summary: i.fields?.summary || i.key,
        parentType: 'Initiative',
      })),
    ];

    const tChecks = Date.now();
    const [gateData, naughtyList] = await Promise.all([
      runRetroGateChecks(gateTimeline, options, jira),
      runNaughtyList(gateTimeline, options, parentProjects, jira),
    ]);
    const checksMs = Date.now() - tChecks;
    const totalMs = Date.now() - t0;
    console.info(
      `[release-dataset] /retrospective release=${release} parent_fetch_ms=${parentFetchMs} checks_ms=${checksMs} total_ms=${totalMs}`
    );

    return res.json({
      success: true,
      data: {
        productId,
        release,
        gateTimeline,
        gateChecks: gateData.checks,
        companionReadiness: gateData.companionReadiness,
        pgToGa: gateData.pgToGa,
        naughtyList,
        timings: {
          parentFetchMs,
          checksMs,
          totalMs,
        },
      },
    });
  } catch (e) {
    console.error('[release-dataset] /retrospective error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Retrospective failed',
    });
  }
});

/**
 * GET /api/release-dataset/retrospective/bootstrap?release=NDB-2.11&productId=ndb
 * Fast-stage bootstrap for retrospective page first paint.
 */
router.get('/retrospective/bootstrap', auth, async (req, res) => {
  const t0 = Date.now();
  try {
    const release = (req.query.release || '').toString().trim();
    const productId = (req.query.productId || '').toString().trim();
    if (!release) {
      return res.status(400).json({ success: false, error: 'release query parameter is required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const shared = await getShared();
    const {
      JiraConnector,
      loadEnv,
      getProductService,
      parseReleaseGateTimeline,
      getRetroBootstrap,
      runRetroGateChecks,
    } = shared;

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    const product = productService.getProduct(productId);
    const featureProjectKey = productService.getFeatureProjectKey(productId);
    const companionDisciplines = productService.getCompanionDisciplines(productId);

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const gateConfig = loadReleaseGateConfig();
    const versionConfig = gateConfig[release] || null;
    const gateTimeline = parseReleaseGateTimeline(release, { versionConfig });

    const releasePrefix = productService.getReleasePrefix(productId);
    // Catch-all planning buckets (e.g. "Era Future", "master") don't have real
    // gate contracts, so gate checks and label-anchored queries are meaningless.
    const isCatchAll = !release.toUpperCase().startsWith(releasePrefix.toUpperCase());

    const options = {
      release,
      projectKeys: [product.projectKey, featureProjectKey],
      companionDisciplines,
      labelPrefix: productService.getLabelPrefix(productId),
      releasePrefix,
    };

    // Run parent count and release-level gate checks in parallel so cards
    // populate as soon as bootstrap loads (~2s) instead of waiting for the
    // per-project detail call (~6s).
    // Skip gate checks for catch-all versions — they have no gate dates.
    const [totalParentCount, gateData] = await Promise.all([
      jira.searchCount(
        `fixVersion = "${release}" AND issuetype in (Feature, Initiative, X-FEAT, Capability) AND status not in (Cancelled, Backlog)`
      ),
      isCatchAll ? Promise.resolve(null) : runRetroGateChecks(gateTimeline, options, jira).catch(() => null),
    ]);

    const data = getRetroBootstrap(gateTimeline, totalParentCount, options);
    const totalMs = Date.now() - t0;
    console.info(
      `[release-dataset] /retrospective/bootstrap release=${release} parentCount=${data.parentCount} timing_ms=${totalMs}`
    );

    return res.json({
      success: true,
      data: {
        ...data,
        gateChecks: gateData?.checks ?? null,
        pgToGa: gateData?.pgToGa ?? null,
        timingMs: totalMs,
      },
    });
  } catch (e) {
    console.error('[release-dataset] /retrospective/bootstrap error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Retrospective bootstrap failed',
    });
  }
});

/**
 * GET /api/release-dataset/retrospective/projects?release=NDB-2.11&productId=ndb&page=1&limit=10
 * Medium-stage paged parent list with declared vs actual code complete.
 */
router.get('/retrospective/projects', auth, async (req, res) => {
  const t0 = Date.now();
  try {
    const release = (req.query.release || '').toString().trim();
    const productId = (req.query.productId || '').toString().trim();
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.max(1, Math.min(50, Number.parseInt(req.query.limit, 10) || 10));
    if (!release) {
      return res.status(400).json({ success: false, error: 'release query parameter is required' });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const shared = await getShared();
    const { JiraConnector, loadEnv, getProductService, getRetroProjectsPage, parseReleaseGateTimeline, resolveGateDates } = shared;
    const productService = getProductService(PRODUCT_CONFIG_PATH);
    const product = productService.getProduct(productId);
    const featureProjectKey = productService.getFeatureProjectKey(productId);

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    // Resolve gate dates so the projects page can compute "missed gate" counts correctly.
    const gateConfig = loadReleaseGateConfig();
    const versionConfig = gateConfig[release] || null;
    const gateTimeline = parseReleaseGateTimeline(release, { versionConfig });
    const gateDates = resolveGateDates(gateTimeline);

    const releasePrefix = productService.getReleasePrefix(productId);
    const isCatchAll = !release.toUpperCase().startsWith(releasePrefix.toUpperCase());
    if (isCatchAll) {
      return res.json({ success: true, data: { projects: [], total: 0, page, limit, timingMs: Date.now() - t0 } });
    }

    const data = await getRetroProjectsPage(jira, {
      release,
      coreProjectKey: product.projectKey,
      featureProjectKey,
      page,
      limit,
      labelPrefix: productService.getLabelPrefix(productId),
      releasePrefix,
      ccmDate: gateDates.ccmDate || undefined,
      cgDate: gateDates.cgDate || undefined,
      pgDate: gateDates.pgDate || undefined,
    });
    const totalMs = Date.now() - t0;
    console.info(
      `[release-dataset] /retrospective/projects release=${release} page=${page} limit=${limit} rows=${data.projects.length} timing_ms=${totalMs}`
    );

    return res.json({ success: true, data: { ...data, timingMs: totalMs } });
  } catch (e) {
    console.error('[release-dataset] /retrospective/projects error:', {
      message: e?.message,
      stack: e?.stack,
      type: e?.constructor?.name,
      fullError: String(e),
    });
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Retrospective projects failed',
    });
  }
});

/**
 * GET /api/release-dataset/retrospective/project/:key?release=NDB-2.11&productId=ndb
 * Deep on-demand per-parent detail checks.
 */
router.get('/retrospective/project/:key', auth, async (req, res) => {
  const t0 = Date.now();
  try {
    const release = (req.query.release || '').toString().trim();
    const productId = (req.query.productId || '').toString().trim();
    const parentKey = (req.params.key || '').toString().trim();
    const parentType = (req.query.parentType || 'Other').toString();
    const parentSummary = (req.query.parentSummary || parentKey).toString();

    if (!release || !parentKey) {
      return res.status(400).json({
        success: false,
        error: 'release query parameter and :key are required',
      });
    }

    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const shared = await getShared();
    const {
      JiraConnector,
      loadEnv,
      getProductService,
      parseReleaseGateTimeline,
      getRetroProjectDetail,
    } = shared;
    const productService = getProductService(PRODUCT_CONFIG_PATH);
    const product = productService.getProduct(productId);
    const featureProjectKey = productService.getFeatureProjectKey(productId);
    const companionDisciplines = productService.getCompanionDisciplines(productId);

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const releasePrefix = productService.getReleasePrefix(productId);
    const isCatchAll = !release.toUpperCase().startsWith(releasePrefix.toUpperCase());
    if (isCatchAll) {
      return res.json({ success: true, data: null, reason: 'catch-all version has no gate contracts' });
    }

    const gateConfig = loadReleaseGateConfig();
    const versionConfig = gateConfig[release] || null;
    const gateTimeline = parseReleaseGateTimeline(release, { versionConfig });
    const options = {
      release,
      projectKeys: [product.projectKey, featureProjectKey],
      companionDisciplines,
      labelPrefix: productService.getLabelPrefix(productId),
      releasePrefix,
    };

    const data = await getRetroProjectDetail(
      gateTimeline,
      options,
      {
        key: parentKey,
        summary: parentSummary,
        parentType,
      },
      jira
    );
    const totalMs = Date.now() - t0;
    console.info(
      `[release-dataset] /retrospective/project release=${release} key=${parentKey} timing_ms=${totalMs}`
    );

    return res.json({ success: true, data: { ...data, timingMs: totalMs } });
  } catch (e) {
    console.error('[release-dataset] /retrospective/project error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Retrospective project detail failed',
    });
  }
});

// ── Sync endpoints ────────────────────────────────────────────────────────────

/**
 * GET /api/release-dataset/sync-status?productId=ndb
 *
 * Returns disk bundle metadata plus live fixVersion names
 * (`listFixVersionsForTeam`). Pages do not wait on this endpoint.
 */
router.get('/sync-status', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    if (!productId) {
      return res.status(400).json({ success: false, error: 'productId query parameter is required' });
    }
    const shared = await getShared();
    const { getProductService, ReleaseDatasetCache } = shared;
    const productService = getProductService(PRODUCT_CONFIG_PATH);

    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return res.status(400).json({ success: false, error: `Unknown productId '${productId}': ${e.message}` });
    }

    const cache = new ReleaseDatasetCache({ cacheDir: RELEASE_DATASET_CACHE_DIR, productId });
    const { meta: bundleMeta } = cache.loadBundleLenient();

    // Get the list of releases we have on disk (reads only .meta.json files — fast).
    const projectKey = product.projectKey;
    const labelPrefix = productService.getLabelPrefix(productId);
    const cachedReleasesInfo = cache.getCachedReleasesInfo({ projectKey, labelPrefix });
    const cachedReleases = Object.keys(cachedReleasesInfo);

    let liveVersions = [];
    try {
      liveVersions = await listLiveFixVersions({
        productId,
        jiraToken: tokenFromReq(req),
      });
    } catch (e) {
      console.warn('[release-dataset] /sync-status live versions skipped:', e.message);
    }
    const liveByName = new Map((liveVersions || []).map((v) => [v.name, v]));
    const liveNames = [...liveByName.keys()];
    const gridReleases = [...new Set([...liveNames, ...cachedReleases])];

    // Tag each cached release as active / past / future using gate config.
    const gateConfig = loadReleaseGateConfig();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeVersionNames = productService.getActiveVersionNames(productId);
    const releaseStates = {};
    for (const rel of gridReleases) {
      const cfg = gateConfig[rel];
      if (cfg?.ecDate && cfg?.gaDate) {
        const ec = new Date(cfg.ecDate);
        const ga = new Date(cfg.gaDate);
        if (today < ec) releaseStates[rel] = 'future';
        else if (today > ga) releaseStates[rel] = 'past';
        else releaseStates[rel] = 'active';
      } else if (liveByName.get(rel)?.released === true) {
        releaseStates[rel] = 'past';
      } else {
        releaseStates[rel] = activeVersionNames.includes(rel) || liveByName.has(rel) ? 'active' : 'past';
      }
    }

    // Lean per-release metadata for the SyncHub UI (tick/refresh icons).
    // Include per-bucket counts from the meta file so the 7-column table
    // can show per-cell freshness without reading all ticket data.
    const releaseMeta = {};
    for (const rel of gridReleases) {
      const info = cachedReleasesInfo[rel];
      releaseMeta[rel] = info
        ? {
          fetchedAtIso: info.fetchedAtIso || null,
          ticketCount: info.ticketCount ?? null,
          loadableStrict: info.loadableStrict,
          schemaDiff: info.schemaDiff,
          jqlDiff: info.jqlDiff,
          buckets: info.buckets ?? null,
        }
        : { fetchedAtIso: null, ticketCount: null, buckets: null };
    }

    return res.json({
      success: true,
      data: {
        productId,
        bundleMeta: bundleMeta || null,
        hasBundleOnDisk: bundleMeta !== null,
        cachedReleases: gridReleases,
        releaseStates,
        releaseMeta,
        isSyncInProgress: cache.isSyncInProgress(),
        scheduler: syncScheduler.getStatus(),
      },
    });
  } catch (e) {
    console.error('[release-dataset] /sync-status error:', e?.message || e);
    return res.status(500).json({ success: false, error: e?.message || 'Failed to read sync status' });
  }
});

/**
 * POST /api/release-dataset/refresh-now?productId=ndb
 *
 * Triggers a scheduler-backed immediate sync for the configured products.
 * Returns JSON (no SSE) for pages that need a "refresh now" action.
 */
router.post('/refresh-now', auth, async (_req, res) => {
  try {
    const result = await syncScheduler.runNow('manual-refresh');
    if (!result.success) {
      return res.status(503).json({
        success: false,
        error: result.error || result.reason || 'Refresh failed',
        data: result.results || null,
      });
    }
    return res.json({
      success: true,
      data: result.results || {},
      scheduler: syncScheduler.getStatus(),
    });
  } catch (e) {
    return res.status(500).json({
      success: false,
      error: e?.message || 'Refresh failed',
    });
  }
});

/**
 * POST /api/release-dataset/backfill-meta?productId=ndb
 *
 * One-time migration: for every cached per-release file whose .meta.json
 * is missing the `buckets` field, read the ticket data from disk, count
 * tickets by their Components/bucket tag, and persist the counts back into
 * the meta file.  No JIRA API calls — purely a disk operation.
 *
 * This fixes the SyncHub "Past Releases" table showing `—` in all 6
 * bucket columns for releases that were synced before per-bucket metadata
 * tracking was introduced.
 *
 * Response shape:
 *   { success, data: { productId, processed: [{ release, buckets }], skipped: string[] } }
 */
router.post('/backfill-meta', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();

    const PAYLOAD_BUCKET_KEYS = [
      'top_level_projects',
      'epics_of_projects',
      'work_toward_project',
      'standalone_epics',
      'work_toward_standalone_epic',
      'direct_tickets',
    ];

    const perReleaseDir = path.join(RELEASE_DATASET_CACHE_DIR, productId, 'per_release');

    let entries;
    try {
      entries = fs.readdirSync(perReleaseDir);
    } catch (e) {
      return res.status(404).json({
        success: false,
        error: `No per-release cache directory found for productId '${productId}'. Run a sync first.`,
      });
    }

    // Find all releases that have a .json file (ticket data) and a .meta.json file.
    const releaseNames = entries
      .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))
      .map((f) => f.slice(0, -5)); // strip .json

    const processed = [];
    const skipped = [];

    for (const release of releaseNames) {
      const metaPath = path.join(perReleaseDir, `${release}.meta.json`);
      const dataPath = path.join(perReleaseDir, `${release}.json`);

      // Skip if meta file doesn't exist.
      if (!fs.existsSync(metaPath)) {
        skipped.push(release);
        continue;
      }

      let meta;
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      } catch (e) {
        skipped.push(release);
        continue;
      }

      // Already has bucket breakdown — skip unless forced.
      if (meta.buckets && typeof meta.buckets === 'object' && Object.keys(meta.buckets).length > 0) {
        skipped.push(release);
        continue;
      }

      // Load ticket data and count by bucket (Components field).
      let tickets;
      try {
        const raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
        tickets = Array.isArray(raw) ? raw : (raw.tickets || []);
      } catch (e) {
        skipped.push(release);
        continue;
      }

      const counts = {};
      for (const ticket of tickets) {
        const comps = (ticket['Components'] || '').split(',');
        for (const comp of comps) {
          const b = comp.trim();
          if (b) counts[b] = (counts[b] || 0) + 1;
        }
      }

      // Build the buckets map for the 6 payload buckets only.
      const fetchedAtIso = meta.fetchedAtIso || new Date().toISOString();
      const buckets = {};
      for (const key of PAYLOAD_BUCKET_KEYS) {
        buckets[key] = {
          count: counts[key] ?? 0,
          fetchedAtIso,
        };
      }

      const updatedMeta = { ...meta, buckets };
      try {
        fs.writeFileSync(metaPath, JSON.stringify(updatedMeta, null, 2), 'utf8');
      } catch (e) {
        skipped.push(release);
        continue;
      }

      processed.push({ release, buckets });
      console.info(`[release-dataset] backfill-meta: ${release} — wrote bucket counts`);
    }

    return res.json({
      success: true,
      data: { productId, processed, skipped },
    });
  } catch (e) {
    console.error('[release-dataset] /backfill-meta error:', e?.message || e);
    return res.status(500).json({ success: false, error: e?.message || 'Backfill failed' });
  }
});

/**
 * DELETE /api/release-dataset/cache?productId=ndb&mode=bundle|full
 *
 * Wipes the on-disk cache for the active product.
 *   mode=bundle — removes bundle.json only; per-release caches survive
 *   mode=full   — removes everything including per-release caches + stale lock
 */
router.delete('/cache', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || '').toString();
    const mode = (req.query.mode || 'bundle').toString();
    if (mode !== 'bundle' && mode !== 'full') {
      return res.status(400).json({ success: false, error: "mode must be 'bundle' or 'full'" });
    }

    const shared = await getShared();
    const { ReleaseDatasetCache } = shared;
    const cache = new ReleaseDatasetCache({ cacheDir: RELEASE_DATASET_CACHE_DIR, productId });

    if (mode === 'full') {
      cache.clearRelease();  // wipes all per-release files
      cache.clearBundle();
      console.info(`[release-dataset] cache cleared (full) for productId=${productId}`);
    } else {
      cache.clearBundle();
      console.info(`[release-dataset] bundle cleared for productId=${productId}`);
    }

    return res.json({ success: true, data: { productId, cleared: mode } });
  } catch (e) {
    console.error('[release-dataset] DELETE /cache error:', e?.message || e);
    return res.status(500).json({ success: false, error: e?.message || 'Failed to clear cache' });
  }
});

/**
 * POST /api/release-dataset/sync?productId=ndb&forceReleases=NDB-2.11,NDB-2.10&skipChangelog=true
 *
 * Runs syncReleaseDataset and streams progress events via SSE.
 *
 * SSE format (one JSON object per line, prefixed with "data: "):
 *   data: { "release": "NDB-2.11", "status": "fetching", "detail": "..." }
 *   data: { "release": "NDB-2.11", "status": "done",     "detail": "1234 tickets" }
 *   data: { "type": "complete", "releases": [...], "errors": {...}, "changelogEnriched": N }
 *
 * Uses fetch + ReadableStream on the client (EventSource cannot carry auth headers).
 */
router.post('/sync', auth, async (req, res) => {
  const t0 = Date.now();
  const productId = (req.query.productId || '').toString();
  const rawForce = (req.query.forceReleases || '').toString().trim();
  const forceReleasesInput = rawForce ? rawForce.split(',').map((r) => r.trim()).filter(Boolean) : [];
  const forceAll = req.query.forceAll === 'true';
  const skipChangelog = req.query.skipChangelog === 'true';

  // Set SSE headers before any async work so the client gets the stream header
  // even if an error throws immediately.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  function sendEvent(obj) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    }
  }

  function sendError(msg) {
    sendEvent({ type: 'error', message: msg });
    if (!res.writableEnded) res.end();
  }
  const acquiredLocks = [];
  const stopHeartbeat = startSseHeartbeat(res);

  try {
    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return sendError('JIRA Bearer token required in Authorization header');
    }

    // Immediate acknowledgement so the UI knows the server is alive while
    // the expensive getProjectVersions() call runs below.
    sendEvent({ type: 'preflight', message: 'Authenticated — fetching JIRA release list…' });

    const shared = await getShared();
    const {
      JiraConnector, loadEnv,
      getProductService, ReleaseDatasetCache,
      syncReleaseDataset,
    } = shared;

    // Guard against concurrent syncs (same product). If one is already in
    // progress (fresh lock < 120s old) surface a friendly message rather
    // than running two syncs in parallel.
    const lockKey = `product:${productId}:full-sync`;
    acquireLockOrThrow(lockKey, 'api-sync');
    acquiredLocks.push(lockKey);

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return sendError(`Unknown productId '${productId}': ${e.message}`);
    }

    const projectKey = product.projectKey;
    const labelPrefix = productService.getLabelPrefix(productId);
    const productPrefix = productService.getReleasePrefix(productId);
    let sprintCalendar;
    try {
      sprintCalendar = productService.getSprintCalendar(productId);
    } catch (e) {
      return sendError(e?.message || 'Sprint calendar is not configured for this team');
    }

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const cache = new ReleaseDatasetCache({ cacheDir: RELEASE_DATASET_CACHE_DIR, productId });

    // Unreleased versions on the team's primary JIRA project (NDB → ERA).
    // Same rule as POST /api/jira/release-versions. No prefix/glob matching.
    let allProjectVersions;
    try {
      allProjectVersions = await jira.getProjectVersions(projectKey);
    } catch (vErr) {
      return sendError(`Failed to fetch JIRA version list: ${vErr?.message || vErr}`);
    }

    const jiraReleases = allProjectVersions
      .filter(isUnreleasedVersion)
      .map((v) => v.name);

    const releasesToSync = Array.from(
      new Set([...jiraReleases, ...forceReleasesInput])
    ).sort();

    if (releasesToSync.length === 0) {
      return sendError('No JIRA versions found matching the release prefix and no forceReleases specified');
    }

    // Build release-status map so the client can tag active / past / future.
    // Active = EC date ≤ today ≤ GA date (from gate config).
    // Past   = JIRA version released=true OR today > GA date.
    // Future = no gate config entry AND JIRA version released=false.
    const gateConfig = loadReleaseGateConfig();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const jiraVersionMap = Object.fromEntries(
      allProjectVersions.map((v) => [v.name, v])
    );
    const releaseStates = {};
    for (const rel of releasesToSync) {
      const cfg = gateConfig[rel];
      const jiraV = jiraVersionMap[rel];
      const isReleased = jiraV?.released ?? false;
      let state;
      if (cfg?.ecDate && cfg?.gaDate) {
        const ec = new Date(cfg.ecDate);
        const ga = new Date(cfg.gaDate);
        if (today < ec) state = 'future';
        else if (today > ga || isReleased) state = 'past';
        else state = 'active';
      } else {
        state = isReleased ? 'past' : 'future';
      }
      releaseStates[rel] = state;
    }

    // forceAll=true bypasses the cache for every CURRENT (non-past) release.
    // Past releases are excluded from a full sync — too expensive, and the
    // data rarely changes. Use cell sync (POST /sync/bucket) for targeted
    // past-release refreshes.
    const forceReleases = forceAll
      ? releasesToSync.filter((r) => releaseStates[r] !== 'past')
      : forceReleasesInput;

    for (const rel of forceReleases) {
      const releaseLockKey = `product:${productId}:release:${rel}`;
      acquireLockOrThrow(releaseLockKey, 'api-sync');
      acquiredLocks.push(releaseLockKey);
    }

    const activeCount = Object.values(releaseStates).filter((s) => s === 'active').length;
    const pastCount   = Object.values(releaseStates).filter((s) => s === 'past').length;
    const futureCount = Object.values(releaseStates).filter((s) => s === 'future').length;

    sendEvent({
      type: 'start',
      releases: releasesToSync,
      releaseStates,
      forceReleases,
      skipChangelog,
      message: `Starting sync for ${releasesToSync.length} releases (${activeCount} active, ${pastCount} past, ${futureCount} future)`,
    });

    // Pre-announce only the releases that will actually run (force list).
    // Queuing every release made the UI paint every row as syncing during
    // a single-release refresh.
    for (const rel of forceReleases) {
      sendEvent({ release: rel, status: 'queued', detail: releaseStates[rel] });
    }

    const result = await syncReleaseDataset(jira, releasesToSync, {
      cache,
      projectKey,
      labelPrefix,
      productPrefix,
      sprintCalendar,
      forceReleases,
      skipChangelog,
      includeLongTermFunded: true,
      changelogConcurrency: 1,
      fetchOptions: { concurrency: 1 },
      onProgress: (event) => sendEvent(event),
      baseFilter: product.baseFilter,
    });

    const timingMs = Date.now() - t0;
    // 'done' type matches SyncHubPage's log renderer shape (numTickets + releases).
    sendEvent({
      type: 'done',
      releases: result.releases,
      releaseStates,
      numTickets: result.processed?.length ?? 0,
      errors: result.errors,
      changelogEnriched: result.changelogEnriched,
      gateHistoryEnriched: result.gateHistoryEnriched ?? 0,
      timingMs,
      message: `Sync complete — ${result.releases.length} releases (${activeCount} active, ${pastCount} past, ${futureCount} future), ${result.changelogEnriched} changelog + ${result.gateHistoryEnriched ?? 0} gate-history enrichments in ${(timingMs / 1000).toFixed(1)}s`,
    });

    console.info(
      `[release-dataset] /sync complete productId=${productId} releases=${result.releases.length} ` +
      `changelog=${result.changelogEnriched} gate_history=${result.gateHistoryEnriched ?? 0} timing_ms=${timingMs}`
    );
  } catch (e) {
    const failure = classifySyncFailure(e);
    const base = failure.message || 'Sync failed with an unexpected error';
    const detail = failure.isRateLimited
      ? `${base}. Jira rate limit hit (429). Retry in 1-2 minutes.`
      : failure.isTimeout
        ? `${base}. Sync timed out; try a release-level or bucket sync.`
        : base;
    console.error('[release-dataset] /sync error:', {
      message: failure.message || e?.message || String(e),
      status: failure.status,
      isRateLimited: failure.isRateLimited,
      isTimeout: failure.isTimeout,
    });
    sendEvent({ type: 'error', release: '_global', status: 'error', detail });
  } finally {
    stopHeartbeat();
    syncLocking.releaseMany(acquiredLocks);
    if (!res.writableEnded) res.end();
  }
});

/**
 * POST /api/release-dataset/sync/bucket?productId=ndb&release=NDB-2.11&bucket=top_level_projects
 *
 * Cell-level sync: re-fetch a single bucket's JQL for one release and
 * merge the fresh tickets into the existing per-release cache.
 *
 * Allowed for both current AND past releases — the cell granularity
 * keeps the cost contained. Full-release sync of past releases is blocked
 * at the UI and in POST /sync (forceAll excludes past releases).
 *
 * Streams SSE progress like POST /sync.
 *
 * Valid bucket names (per PAYLOAD_BUCKET_KEYS + moved_out):
 *   top_level_projects, epics_of_projects, work_toward_project,
 *   standalone_epics, work_toward_standalone_epic, direct_tickets,
 *   moved_out
 */
router.post('/sync/bucket', auth, async (req, res) => {
  const t0 = Date.now();
  const productId = (req.query.productId || '').toString();
  const release = (req.query.release || '').toString().trim();
  const bucketName = (req.query.bucket || '').toString().trim();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Transfer-Encoding', 'chunked');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  function sendEvent(obj) {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }
  function sendError(msg) {
    sendEvent({ type: 'error', message: msg });
    if (!res.writableEnded) res.end();
  }
  const acquiredLocks = [];
  const stopHeartbeat = startSseHeartbeat(res);

  try {
    if (!release) return sendError('release query parameter is required');
    if (!bucketName) return sendError('bucket query parameter is required');

    const userJiraPat = extractToken(req);
    if (!userJiraPat) return sendError('JIRA Bearer token required in Authorization header');

    sendEvent({ type: 'preflight', release, bucket: bucketName, message: `Cell sync: ${release} / ${bucketName}` });

    const shared = await getShared();
    const { JiraConnector, loadEnv, getProductService, ReleaseDatasetCache, syncReleaseBucket } = shared;

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      return sendError(`Unknown productId '${productId}': ${e.message}`);
    }

    const projectKey = product.projectKey;
    const labelPrefix = productService.getLabelPrefix(productId);
    const productPrefix = productService.getReleasePrefix(productId);
    let sprintCalendar;
    try {
      sprintCalendar = productService.getSprintCalendar(productId);
    } catch (e) {
      return sendError(e?.message || 'Sprint calendar is not configured for this team');
    }

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);
    const cache = new ReleaseDatasetCache({ cacheDir: RELEASE_DATASET_CACHE_DIR, productId });

    const releaseLockKey = `product:${productId}:release:${release}`;
    acquireLockOrThrow(releaseLockKey, 'api-cell-sync');
    acquiredLocks.push(releaseLockKey);

    const result = await syncReleaseBucket(jira, release, bucketName, {
      cache,
      projectKey,
      labelPrefix,
      productPrefix,
      sprintCalendar,
      onProgress: (event) => sendEvent(event),
      baseFilter: product.baseFilter,
    });

    const timingMs = Date.now() - t0;
    sendEvent({
      type: 'done',
      release,
      bucket: bucketName,
      count: result.count,
      error: result.error || null,
      timingMs,
      message: result.error
        ? `Cell sync error: ${result.error}`
        : `Cell sync complete — ${result.count} tickets in ${(timingMs / 1000).toFixed(1)}s`,
    });

    console.info(
      `[release-dataset] /sync/bucket release=${release} bucket=${bucketName} count=${result.count} timing_ms=${timingMs}`
    );
  } catch (e) {
    const failure = classifySyncFailure(e);
    const base = failure.message || 'Cell sync failed';
    const detail = failure.isRateLimited
      ? `${base}. Jira rate limit hit (429); retry in a minute.`
      : base;
    console.error('[release-dataset] /sync/bucket error:', {
      message: failure.message || e?.message || String(e),
      status: failure.status,
      isRateLimited: failure.isRateLimited,
    });
    sendEvent({ type: 'error', release, bucket: bucketName, detail });
  } finally {
    stopHeartbeat();
    syncLocking.releaseMany(acquiredLocks);
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
