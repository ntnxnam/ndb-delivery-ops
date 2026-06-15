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
 *   GET  /sync-status      → bundle metadata from disk (no JIRA calls)
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

// Lazy-import the ESM shared package (one-shot, cached) — mirrors
// dateMover.js so we have one consistent loading pattern across routes.
let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    _sharedPromise = import('@portfolio-delivery-ops/shared');
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
    const productId = (req.query.productId || 'ndb').toString();
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
 * GET /api/release-dataset/per-release/:release?productId=ndb
 *
 * Per-release cache read endpoint. Disk-only, no JiraConnector.
 */
router.get('/per-release/:release', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || 'ndb').toString();
    const release = (req.params.release || '').toString().trim();
    if (!release) {
      return res.status(400).json({
        success: false,
        error: 'release path parameter is required',
      });
    }

    const shared = await getShared();
    const cache = buildCache(productId, shared);
    const { tickets, meta } = cache.loadReleaseLenient(release);
    if (!Array.isArray(tickets) || tickets.length === 0) {
      return res.status(404).json({
        success: false,
        reason: 'not_cached',
        error: `No cached per-release dataset found for '${release}'`,
      });
    }

    return res.json({
      success: true,
      data: {
        release,
        tickets,
        meta: meta || null,
      },
    });
  } catch (e) {
    console.error('[release-dataset] /per-release error:', e?.message || e);
    return res.status(500).json({
      success: false,
      error: e?.message || 'Failed to load cached release dataset',
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
    const productId = (req.query.productId || 'ndb').toString();
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

    // Component bucket queries (5) — JQL only, no project scoping yet.
    const bucketJql = getComponentQueries(release);

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
      { key: 'deferred', label: SIDECAR_LABELS.deferred, jql: deferredJql },
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
      jql: `${releasePayloadJql} AND (${group.filter})`,
    }));

    const allEntries = [
      ...componentEntries,
      ...sidecarEntries,
      { key: 'engineering_payload', label: 'Total Release Payload (deduped)', jql: releasePayloadJql },
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
 * Returns 3-stream sprint velocity (Dev / QA-Verification / QA-Test-Tasks)
 * for the most recent N sprints, scoped to a product + optional release.
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
    const productId = (req.query.productId || 'ndb').toString();
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

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const sprints = await computeRecentSprintVelocity(jira, {
      projectKey: product.projectKey,
      release,
      sprintCalendar,
      sprintsBack,
    });

    return res.json({
      success: true,
      data: {
        productId,
        release: release || null,
        projectKey: product.projectKey,
        sprintCalendar,
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
 * Landing-forecast MVP — first fusion of the Streamlit chatbot-app's
 * `landing_forecast.py` marquee feature into the React app. Returns a
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
    const productId = (req.query.productId || 'ndb').toString();
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

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const forecast = await computeLandingForecast({
      jira,
      projectKey: product.projectKey,
      release,
      sprintCalendar,
      plannedGaIso,
    });

    return res.json({
      success: true,
      data: {
        productId,
        release,
        projectKey: product.projectKey,
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
    const productId = (req.query.productId || 'ndb').toString();
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
 * /project-breakdown — Staged per-fixVersion traversal for three-tier grouping:
 * 1) TIER 1: Top-level Projects (Feature/Initiative/X-FEAT/Capability) with fixVersion
 * 2) For each project: TIER 2 Epics (child epics via Parent Link)
 * 3) For each epic: Count work items (non-portfolio, non-epic, not Feature/Initiative)
 * 4) THEN: Standalone Epics (no Parent Link) and their work items
 * 5) THEN: Standalone Tickets (no Epic Link)
 *
 * Per staged traversal plan from user guidance.
 * Used for the Project Breakdown Matrix component.
 */
router.get('/project-breakdown', auth, async (req, res) => {
  req.setTimeout(120000);
  res.setTimeout(120000);
  try {
    const productId = (req.query.productId || 'ndb').toString();
    const release = (req.query.release || '').toString().trim();
    console.log('[project-breakdown] Request: productId=', productId, 'release=', release);
    
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
    const { JiraConnector, getProductService, loadEnv } = shared;

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
    
    // parentLink (customfield_20363) — fetched in Stage 2 so each child epic can be
    // mapped back to its parent project.  In Classic Jira, epic.fields.parent.key
    // is NOT the portfolio parent (it's only set for sub-tasks); the portfolio
    // relationship lives exclusively in customfield_20363.
    // componentReportService.js confirms this field is available in this Jira instance.
    const parentLinkField = getFieldId('parentLink');
    const parentLinkFields = parentLinkField ? [parentLinkField] : [];

    const searchOpts = { perPageTimeoutMs: 30000 };

    // Base fields used by most stages.
    const fieldsList = `key,issuetype,summary,parent,status`;
    // Stage 2 additionally needs parentLink to map each child epic back to its
    // parent project — `parent.key` is unreliable for Epics in Classic Jira.
    const stage2FieldsList = parentLinkField
      ? `${fieldsList},${parentLinkField}`
      : fieldsList;

    // Constants
    const PROJECT_TYPES = ['Feature', 'Initiative', 'X-FEAT', 'Capability'];
    const DONE_STATUSES = ['Fixed', 'Done', 'Resolved', 'Complete', 'Closed'];
    const TO_VERIFY_STATUSES = ['In Review', 'Testing', 'Ready for Testing'];
    
    const classifyGroupKey = (issueType) => {
      if (['Feature', 'Initiative', 'Epic', 'X-FEAT', 'Capability'].includes(issueType)) return 'Project Hierarchy';
      if (issueType === 'Bug') return 'Bug';
      if (issueType === 'Improvement') return 'Improvement';
      if (['Task', 'Unit Test'].includes(issueType)) return 'Dev Code';
      if (issueType === 'Test') return 'Test';
      return 'Everything Else';
    };

    const ensureGroupBucket = (groupMap, groupKey) => {
      if (!groupMap[groupKey]) {
        groupMap[groupKey] = { label: groupKey, outstanding: 0, toVerify: 0, closed: 0, total: 0 };
      }
      return groupMap[groupKey];
    };

    const countIssue = (bucket, status) => {
      bucket.total++;
      if (DONE_STATUSES.includes(status)) bucket.closed++;
      else if (TO_VERIFY_STATUSES.includes(status)) bucket.toVerify++;
      else bucket.outstanding++;
    };

    const readLinkKey = (fields, candidateFields) => {
      for (const field of candidateFields) {
        const raw = fields?.[field];
        if (!raw) continue;
        if (typeof raw === 'string' && raw.trim()) return raw.trim();
        if (raw?.key) return raw.key;
      }
      return null;
    };

    // =========================================================================
    // STAGE 1: Fetch TOP-LEVEL PROJECTS (Features/Initiatives/X-FEAT/Capability)
    // =========================================================================
    console.log('[project-breakdown] STAGE 1: Fetching top-level projects...');
    const topLevelJql = `fixVersion = "${release}" AND issuetype in (Feature, Initiative, X-FEAT, Capability) AND status not in (Cancelled, Backlog)`;
    console.log('[project-breakdown] STAGE 1 JQL:', topLevelJql);
    const topLevelProjects = await jira.searchAll(
      topLevelJql,
      fieldsList,
      searchOpts
    ) || [];
    console.log(`[project-breakdown] STAGE 1: Found ${topLevelProjects.length} top-level projects`);

    // Index by key
    const topLevelByKey = new Map(topLevelProjects.map(p => [p.key, p]));

    // =========================================================================
    // STAGE 2: For each project, fetch CHILD EPICS (via Parent Link)
    // =========================================================================
    console.log('[project-breakdown] STAGE 2: Fetching child epics for each project...');
    const epicsByProjectKey = {};
    for (const project of topLevelProjects) {
      epicsByProjectKey[project.key] = [];
    }

    // Batch: find all epics with a parent link to any top-level project
    const topLevelKeys = topLevelProjects.map(p => p.key).join(',');
    if (topLevelKeys.length > 0) {
      // Find epics where Parent Link (portfolio hierarchy) points to top-level projects
      const parentEpicsJql = `issuetype = Epic AND "Parent Link" in (${topLevelKeys})`;
      console.log('[project-breakdown] STAGE 2 JQL:', parentEpicsJql);
      const childEpics = await jira.searchAll(parentEpicsJql, stage2FieldsList, searchOpts) || [];
      console.log(`[project-breakdown] STAGE 2: Found ${childEpics.length} child epics`);

      // Map epics to their parent projects using parentLink (customfield_20363).
      // In Classic Jira, epic.fields.parent.key is only set for sub-tasks, not for
      // the portfolio parent. customfield_20363 is the reliable source here.
      let mappedEpics = 0;
      for (const epic of childEpics) {
        const parentKey = epic.fields?.parent?.key || readLinkKey(epic.fields, parentLinkFields);
        if (parentKey && epicsByProjectKey[parentKey]) {
          epicsByProjectKey[parentKey].push(epic);
          mappedEpics++;
        }
      }
      console.log(`[project-breakdown] STAGE 2: Mapped ${mappedEpics}/${childEpics.length} epics to projects`);
    }

    // =========================================================================
    // STAGE 3: Per-project — fetch work items directly via each project's epics
    // =========================================================================
    // Classic Jira does not populate `parent.key` for work items under epics
    // (that field is only for sub-tasks). By querying per-project using that
    // project's own epic keys, we avoid any attribution mapping entirely —
    // every returned item belongs to the project we queried for.
    // Run in parallel batches of 5 to respect Jira rate limits.
    console.log('[project-breakdown] STAGE 3: Fetching work items per project...');
    const workItemsByProjectKey = {};
    for (const project of topLevelProjects) {
      workItemsByProjectKey[project.key] = [];
    }

    const STAGE3_BATCH = 5;
    let stage3Total = 0;
    for (let i = 0; i < topLevelProjects.length; i += STAGE3_BATCH) {
      const batch = topLevelProjects.slice(i, i + STAGE3_BATCH);
      await Promise.all(batch.map(async (project) => {
        const epicKeys = (epicsByProjectKey[project.key] || []).map(e => e.key);
        if (epicKeys.length === 0) return;
        const jql = `issueFunction in issuesInEpics("key in (${epicKeys.join(',')})") AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability)`;
        const items = await jira.searchAll(jql, `key,issuetype,status`, searchOpts) || [];
        workItemsByProjectKey[project.key] = items;
        stage3Total += items.length;
      }));
    }
    console.log(`[project-breakdown] STAGE 3: Found ${stage3Total} total work items across ${topLevelProjects.length} projects`);

    // =========================================================================
    // STAGE 4: Fetch STANDALONE EPICS (no parent link)
    // =========================================================================
    console.log('[project-breakdown] STAGE 4: Fetching standalone epics...');
    const standaloneEpicsJql = `issuetype = Epic AND fixVersion = "${release}" AND "Parent Link" is EMPTY AND status not in (Cancelled, Backlog)`;
    console.log('[project-breakdown] STAGE 4 JQL:', standaloneEpicsJql);
    const standaloneEpics = await jira.searchAll(standaloneEpicsJql, `key,summary`, searchOpts) || [];
    console.log(`[project-breakdown] STAGE 4: Found ${standaloneEpics.length} standalone epics`);

    // =========================================================================
    // STAGE 5: Per-epic — fetch work items for each standalone epic directly
    // =========================================================================
    // Same rationale as Stage 3: query per-epic so attribution is implicit.
    console.log('[project-breakdown] STAGE 5: Fetching work items per standalone epic...');
    const workItemsByStandaloneEpicKey = {};
    for (const epic of standaloneEpics) {
      workItemsByStandaloneEpicKey[epic.key] = [];
    }

    const STAGE5_BATCH = 5;
    let stage5Total = 0;
    for (let i = 0; i < standaloneEpics.length; i += STAGE5_BATCH) {
      const batch = standaloneEpics.slice(i, i + STAGE5_BATCH);
      await Promise.all(batch.map(async (epic) => {
        const jql = `issueFunction in issuesInEpics("key = ${epic.key}") AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability)`;
        const items = await jira.searchAll(jql, `key,issuetype,status`, searchOpts) || [];
        workItemsByStandaloneEpicKey[epic.key] = items;
        stage5Total += items.length;
      }));
    }
    console.log(`[project-breakdown] STAGE 5: Found ${stage5Total} total work items across ${standaloneEpics.length} standalone epics`);

    // =========================================================================
    // STAGE 6: Fetch STANDALONE TICKETS (no epic link)
    // =========================================================================
    console.log('[project-breakdown] STAGE 6: Fetching standalone tickets...');
    // Use the JIRA field name "Epic Link" (not a customfield ID) — always valid.
    const standaloneTicketsJql = `fixVersion = "${release}" AND issuetype not in (Feature, Initiative, Epic, X-FEAT, Capability) AND "Epic Link" is EMPTY AND status not in (Cancelled, Backlog)`;
    const standaloneTickets = await jira.searchAll(
      standaloneTicketsJql,
      `key,issuetype,status`,
      searchOpts
    ) || [];
    console.log(`[project-breakdown] STAGE 6: Found ${standaloneTickets.length} standalone tickets`);

    // =========================================================================
    // AGGREGATE: Build three-tier response
    // =========================================================================
    console.log('[project-breakdown] AGGREGATE: Building response structures...');

    // TIER 1: Projects with aggregated work items
    const projects = [];
    for (const project of topLevelProjects) {
      const projectGroups = {};
      const workItems = workItemsByProjectKey[project.key] || [];
      for (const item of workItems) {
        const groupKey = classifyGroupKey(item.fields?.issuetype?.name || 'Unknown');
        const bucket = ensureGroupBucket(projectGroups, groupKey);
        const status = item.fields?.status?.name || 'Unknown';
        countIssue(bucket, status);
      }
      projects.push({
        projectKey: project.key,
        projectName: project.fields?.summary || project.key,
        issueTypeGroups: Object.values(projectGroups),
      });
    }

    // TIER 2: Standalone Epics with aggregated work items
    const standaloneEpicsList = [];
    for (const epic of standaloneEpics) {
      const epicGroups = {};
      const workItems = workItemsByStandaloneEpicKey[epic.key] || [];
      
      for (const item of workItems) {
        const groupKey = classifyGroupKey(item.fields?.issuetype?.name || 'Unknown');
        const bucket = ensureGroupBucket(epicGroups, groupKey);
        const status = item.fields?.status?.name || 'Unknown';
        countIssue(bucket, status);
      }

      standaloneEpicsList.push({
        projectKey: epic.key,
        projectName: epic.fields?.summary || epic.key,
        issueTypeGroups: Object.values(epicGroups),
      });
    }

    // TIER 3: Standalone Tickets (direct counts)
    const standaloneTicketGroups = {};
    for (const ticket of standaloneTickets) {
      const groupKey = classifyGroupKey(ticket.fields?.issuetype?.name || 'Unknown');
      const bucket = ensureGroupBucket(standaloneTicketGroups, groupKey);
      const status = ticket.fields?.status?.name || 'Unknown';
      countIssue(bucket, status);
    }
    const standaloneTicketsResult = {
      projectKey: 'standalone-tickets',
      projectName: 'Standalone Tickets (no epic)',
      issueTypeGroups: Object.values(standaloneTicketGroups),
    };

    console.log(
      '[project-breakdown] COMPLETE:',
      projects.length, 'projects |',
      standaloneEpicsList.length, 'standalone epics |',
      standaloneTickets.length, 'standalone tickets'
    );

    return res
      .set('Cache-Control', 'no-cache, no-store, must-revalidate')
      .set('Pragma', 'no-cache')
      .set('Expires', '0')
      .set('ETag', '')
      .json({
        success: true,
        data: {
          productId,
          release,
          projects,
          standaloneEpics: standaloneEpicsList,
          standaloneTickets: standaloneTicketsResult,
        },
      });
  } catch (e) {
    console.error('[release-dataset] /project-breakdown error:', e?.response?.data || e?.message || e);
    const status = e?.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: e?.response?.data?.errorMessages?.[0] || e?.message || 'Project breakdown failed',
    });
  }
});

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
    const productId = (req.query.productId || 'ndb').toString();
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
    const productId = (req.query.productId || 'ndb').toString().trim();
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
    const productId = (req.query.productId || 'ndb').toString().trim();
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

    const options = {
      release,
      projectKeys: [product.projectKey, featureProjectKey],
      companionDisciplines,
      labelPrefix: productService.getLabelPrefix(productId),
      releasePrefix: productService.getReleasePrefix(productId),
    };

    // Run parent count and release-level gate checks in parallel so cards
    // populate as soon as bootstrap loads (~2s) instead of waiting for the
    // per-project detail call (~6s).
    const [totalParentCount, gateData] = await Promise.all([
      jira.searchCount(
        `fixVersion = "${release}" AND issuetype in (Feature, Initiative, X-FEAT, Capability) AND status not in (Cancelled, Backlog)`
      ),
      runRetroGateChecks(gateTimeline, options, jira).catch(() => null),
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
    const productId = (req.query.productId || 'ndb').toString().trim();
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

    const data = await getRetroProjectsPage(jira, {
      release,
      coreProjectKey: product.projectKey,
      featureProjectKey,
      page,
      limit,
      labelPrefix: productService.getLabelPrefix(productId),
      releasePrefix: productService.getReleasePrefix(productId),
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
    const productId = (req.query.productId || 'ndb').toString().trim();
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

    const gateConfig = loadReleaseGateConfig();
    const versionConfig = gateConfig[release] || null;
    const gateTimeline = parseReleaseGateTimeline(release, { versionConfig });
    const options = {
      release,
      projectKeys: [product.projectKey, featureProjectKey],
      companionDisciplines,
      labelPrefix: productService.getLabelPrefix(productId),
      releasePrefix: productService.getReleasePrefix(productId),
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
 * Returns the current bundle metadata from disk (no JIRA calls).
 * Used by TeamDatasetContext on mount to decide whether a sync is needed.
 */
router.get('/sync-status', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || 'ndb').toString();
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

    // Tag each cached release as active / past / future using gate config.
    const gateConfig = loadReleaseGateConfig();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const activeVersionNames = productService.getActiveVersionNames(productId);
    const releaseStates = {};
    for (const rel of cachedReleases) {
      const cfg = gateConfig[rel];
      if (cfg?.ecDate && cfg?.gaDate) {
        const ec = new Date(cfg.ecDate);
        const ga = new Date(cfg.gaDate);
        if (today < ec) releaseStates[rel] = 'future';
        else if (today > ga) releaseStates[rel] = 'past';
        else releaseStates[rel] = 'active';
      } else {
        // No gate config → long-running catch-all versions stay "active",
        // everything else is treated as past (already shipped).
        releaseStates[rel] = activeVersionNames.includes(rel) ? 'active' : 'past';
      }
    }

    return res.json({
      success: true,
      data: {
        productId,
        bundleMeta: bundleMeta || null,
        hasBundleOnDisk: bundleMeta !== null,
        cachedReleases,
        releaseStates,
        isSyncInProgress: cache.isSyncInProgress(),
      },
    });
  } catch (e) {
    console.error('[release-dataset] /sync-status error:', e?.message || e);
    return res.status(500).json({ success: false, error: e?.message || 'Failed to read sync status' });
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
    const productId = (req.query.productId || 'ndb').toString();
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
  const productId = (req.query.productId || 'ndb').toString();
  const rawForce = (req.query.forceReleases || '').toString().trim();
  const forceReleasesInput = rawForce ? rawForce.split(',').map((r) => r.trim()).filter(Boolean) : [];
  const forceAll = req.query.forceAll === 'true';
  const skipChangelog = req.query.skipChangelog === 'true';

  // Set SSE headers before any async work so the client gets the stream header
  // even if an error throws immediately.
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
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
    const guardCache = new ReleaseDatasetCache({ cacheDir: RELEASE_DATASET_CACHE_DIR, productId });
    if (guardCache.isSyncInProgress()) {
      return sendError('A sync is already in progress for this product. Wait for it to finish or refresh the page.');
    }

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
    const sprintCalendar = productService.getSprintCalendar(productId);

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    const cache = new ReleaseDatasetCache({ cacheDir: RELEASE_DATASET_CACHE_DIR, productId });

    // ── Build the full release list dynamically from JIRA ──────────────────
    // Fetch ALL versions for this product's JIRA project so we can sync
    // historical + active + future releases in one pass.  We include:
    //   1. Any non-archived version whose name starts with releasePrefix
    //      ("NDB-") — covers NDB-2.8 through NDB-3.x, released or not.
    //   2. Special long-running fixVersions ("master", "Era Future") that
    //      act as catch-all buckets for work not yet committed to a release.
    // The gate config is kept for active/past/future tagging (see done event)
    // but no longer gates WHAT gets synced.
    let allProjectVersions;
    try {
      allProjectVersions = await jira.getProjectVersions(projectKey);
    } catch (vErr) {
      return sendError(`Failed to fetch JIRA version list: ${vErr?.message || vErr}`);
    }

    const activeVersionNames = productService.getActiveVersionNames(productId);
    // e.g. ["master", "Era Future"]

    const jiraReleases = allProjectVersions
      .filter((v) => !v.archived && v.name.startsWith(productPrefix))
      .map((v) => v.name);

    const releasesToSync = Array.from(
      new Set([...jiraReleases, ...activeVersionNames, ...forceReleasesInput])
    ).sort();

    if (releasesToSync.length === 0) {
      return sendError('No JIRA versions found matching the release prefix and no forceReleases specified');
    }

    // forceAll=true bypasses the per-release cache for every release in the
    // computed list.  This is the "start fresh" path after a data-model change.
    const forceReleases = forceAll ? [...releasesToSync] : forceReleasesInput;

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

    // Pre-announce every release so the client chip grid pre-populates as
    // "queued" before any per-release work begins.  Without this the chips
    // stay empty for the entire first-release fetch window.
    for (const rel of releasesToSync) {
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
      onProgress: (event) => sendEvent(event),
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
    const msg = e?.message || 'Sync failed with an unexpected error';
    console.error('[release-dataset] /sync error:', e?.message || e);
    sendEvent({ type: 'error', release: '_global', status: 'error', detail: msg });
  } finally {
    if (!res.writableEnded) res.end();
  }
});

module.exports = router;
