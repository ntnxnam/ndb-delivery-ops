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
 * Future expansion (tracked in next vertical-slice step):
 *   - /api/release-dataset/sync             → run syncReleaseDataset with cache
 *   - /api/release-dataset/sprint-velocity  → Dev / QA-Ver / QA-Test per sprint
 *   - /api/release-dataset/outstanding      → open work + assignee/age
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();
const { apiLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware, extractToken } = require('../middleware/auth/jira');

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

// Human-readable labels + ordering for the synopsis component cards.
// Keep ordering identical to PAYLOAD_BUCKET_KEYS (parents-first) so the
// cards on the page read in the same logical order as the dedup.
const COMPONENT_LABELS = {
  top_level_projects: 'Top-Level Projects',
  work_toward_project: 'Work Toward Projects',
  standalone_epics: 'Standalone Epics',
  work_toward_standalone_epic: 'Work Toward Standalone Epics',
  direct_tickets: 'Direct Release Tickets',
};

const SIDECAR_LABELS = {
  deferred: 'Deferred',
};

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

    // For each bucket, prepend project scope so the count is restricted
    // to the engineering project (matches D36 "Engineering Payload"
    // semantics — TPM/PM/TECHPUBS tickets carrying the same fixVersion
    // are NOT in the count here).
    const scoped = (jql) => `project = ${projectKey} AND (${jql})`;

    // Run all counts in parallel — they're independent maxResults=0 calls.
    const componentEntries = PAYLOAD_BUCKET_KEYS.map((key) => ({
      key,
      label: COMPONENT_LABELS[key] || key,
      jql: scoped(bucketJql[key]),
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

module.exports = router;
