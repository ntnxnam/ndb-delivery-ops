/**
 * /api/release-dataset/sync* — sync lifecycle endpoints for the centralized
 * dataset cache (Phase A of the centralised-data-fetching vertical slice).
 *
 * Three endpoints:
 *   GET  /api/release-dataset/sync-status   — isSyncing flag + bundleMeta
 *   POST /api/release-dataset/sync          — trigger sync, streams SSE progress
 *   GET  /api/release-dataset/bundle        — strict-load bundle from disk
 *
 * Split from releaseDataset.js (1 400+ lines) per minimal-architecture.mdc.
 * All D1 inputs (projectKey, labelPrefix, etc.) come from ProductService.
 *
 * SSE note: progress is streamed as newline-delimited JSON (Content-Type:
 * text/event-stream).  The client MUST use fetch() + ReadableStream rather
 * than EventSource because EventSource does not support custom headers and
 * the JIRA Bearer token must travel in the Authorization header.
 */

const express = require('express');
const path = require('path');
const router = express.Router();
const { apiLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware, extractToken } = require('../middleware/auth/jira');

const PRODUCT_CONFIG_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'teamBoardConfig.json'
);

const auth = [apiLimiter, validateJiraTokenMiddleware];

// Lazy-import the ESM shared package (one-shot, cached).
let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    _sharedPromise = import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

// Module-level sync state — tracks whether a sync is currently running and
// which productId it is for.  In a multi-worker setup this would move to
// Redis; for the current single-process Express server this is sufficient.
const _syncState = {
  isSyncing: false,
  productId: null,
  startedAt: null,
};

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a ReleaseDatasetCache instance for the given productId.
 * Uses the same cache-dir convention as the existing smoke scripts:
 *   <monorepo-root>/shared/.cache/release-dataset/
 * (ReleaseDatasetCache appends <productId> internally.)
 */
function buildCache(productId, shared) {
  const { ReleaseDatasetCache } = shared;
  const cacheDir = path.resolve(
    __dirname,
    '..', '..', '..', '..', 'shared', '.cache', 'release-dataset'
  );
  return new ReleaseDatasetCache({ cacheDir, productId });
}

/**
 * Fetch the list of releases for a product from the JIRA release-versions API.
 *
 * Includes a version when it is non-archived AND matches EITHER:
 *   - name starts with `productPrefix` (e.g. "NDB-")
 *   - name is in `activeVersionNames` (exact match, e.g. "master", "Era Future")
 *
 * Returns an empty array on failure (sync can still run; it will just have no
 * releases to process, and the caller should surface an error upstream).
 */
async function fetchReleasesForProduct(jira, projectKey, productPrefix, activeVersionNames = []) {
  try {
    const versions = await jira.getProjectVersions(projectKey);
    const activeSet = new Set(activeVersionNames);

    const all = (versions || [])
      .filter((v) => !v.archived)
      .map((v) => v.name)
      .filter(Boolean);

    const filtered = all.filter((name) => {
      if (productPrefix && name.startsWith(productPrefix)) return true;
      if (activeSet.has(name)) return true;
      return false;
    });

    console.log(
      `[releaseSync] ${projectKey}: ${all.length} non-archived versions → ` +
      `${filtered.length} matching prefix "${productPrefix ?? '(none)'}"` +
      (activeVersionNames.length
        ? ` or pinned names [${activeVersionNames.join(', ')}]`
        : '')
    );
    return filtered;
  } catch (e) {
    console.warn(`[releaseSync] fetchReleasesForProduct failed for ${projectKey}:`, e?.message);
    return [];
  }
}

/**
 * Write one SSE data line.  Keeps the stream alive between events by flushing.
 */
function sseWrite(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

// ─── GET /sync-status ─────────────────────────────────────────────────────────

/**
 * Returns:
 *   {
 *     isSyncing: boolean,
 *     productId: string | null,   // productId currently syncing (if any)
 *     startedAt: string | null,   // ISO timestamp sync started
 *     bundleMeta: {               // null when no bundle on disk
 *       lastSyncIso: string,
 *       numTickets: number,
 *       numReleases: number,
 *       releases: string[],
 *       schemaVersion: string
 *     } | null
 *   }
 */
router.get('/sync-status', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || 'ndb').toString();

    const shared = await getShared();
    const cache = buildCache(productId, shared);

    let bundleMeta = null;
    try {
      const { meta } = cache.loadBundleLenient();
      if (meta) {
        bundleMeta = {
          lastSyncIso: meta.lastSyncIso ?? null,
          numTickets: meta.numTickets ?? null,
          numReleases: meta.numReleases ?? null,
          releases: [], // bundle.meta.json doesn't store the releases list; load from bundle if needed
          schemaVersion: meta.schema ?? null,
        };
      }
    } catch (_e) {
      // No bundle on disk is a valid state; return null bundleMeta.
    }

    return res.json({
      success: true,
      data: {
        isSyncing: _syncState.isSyncing && _syncState.productId === productId,
        productId: _syncState.isSyncing ? _syncState.productId : null,
        startedAt: _syncState.isSyncing ? _syncState.startedAt : null,
        bundleMeta,
      },
    });
  } catch (e) {
    console.error('[releaseSync] /sync-status error:', e?.message || e);
    return res.status(500).json({ success: false, error: e?.message || 'sync-status failed' });
  }
});

// ─── POST /sync ───────────────────────────────────────────────────────────────

/**
 * Triggers syncReleaseDataset and streams progress as SSE.
 *
 * Query params:
 *   productId     string   default 'ndb'
 *   forceReleases string   comma-separated list to force-refetch (optional)
 *   skipChangelog boolean  skip changelog enrichment (faster, for dev)
 *
 * The client must use fetch() + ReadableStream to consume this endpoint —
 * EventSource cannot carry the Authorization header.
 *
 * SSE event shapes:
 *   { type: 'progress', release, status, detail }
 *   { type: 'done', releases: string[], numTickets: number, errors: Record<string, string> }
 *   { type: 'error', message: string }
 */
router.post('/sync', auth, async (req, res) => {
  const productId = (req.query.productId || req.body?.productId || 'ndb').toString();

  // Guard: only one sync at a time per server process.
  if (_syncState.isSyncing) {
    return res.status(409).json({
      success: false,
      error: `A sync is already running for product '${_syncState.productId}'. Wait for it to complete.`,
    });
  }

  const userJiraPat = extractToken(req);
  if (!userJiraPat) {
    return res.status(401).json({ success: false, error: 'JIRA Bearer token required' });
  }

  // SSE headers — must be set before any writes.
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering
  res.flushHeaders();

  _syncState.isSyncing = true;
  _syncState.productId = productId;
  _syncState.startedAt = new Date().toISOString();

  try {
    const shared = await getShared();
    const {
      JiraConnector,
      loadEnv,
      getProductService,
      syncReleaseDataset,
    } = shared;

    const productService = getProductService(PRODUCT_CONFIG_PATH);
    let product;
    try {
      product = productService.getProduct(productId);
    } catch (e) {
      sseWrite(res, { type: 'error', message: `Unknown productId '${productId}': ${e.message}` });
      return res.end();
    }

    const projectKey = product.projectKey;
    const labelPrefix = productService.getLabelPrefix(productId);
    const productPrefix = productService.getReleasePrefix
      ? productService.getReleasePrefix(productId)
      : productId.toUpperCase();
    const activeVersionNames = productService.getActiveVersionNames
      ? productService.getActiveVersionNames(productId)
      : [];
    let sprintCalendar;
    try {
      sprintCalendar = productService.getSprintCalendar(productId);
    } catch (e) {
      sseWrite(res, { type: 'error', message: `Sprint calendar unavailable: ${e.message}` });
      return res.end();
    }

    const env = { ...loadEnv({ requirePat: false }), jiraPat: userJiraPat };
    const jira = new JiraConnector(env);

    // Determine which releases to sync.
    const forceReleasesParam = (req.query.forceReleases || req.body?.forceReleases || '').toString();
    const forceReleases = forceReleasesParam
      ? forceReleasesParam.split(',').map((r) => r.trim()).filter(Boolean)
      : [];

    const skipChangelog = req.query.skipChangelog === 'true' || req.body?.skipChangelog === true;

    // Fetch release list from JIRA so we know what to process.
    sseWrite(res, { type: 'progress', release: '__meta__', status: 'fetching', detail: 'Fetching release list from JIRA…' });
    const releases = await fetchReleasesForProduct(jira, projectKey, productPrefix, activeVersionNames);

    if (releases.length === 0) {
      sseWrite(res, {
        type: 'error',
        message: `No releases found for project ${projectKey} with prefix "${productPrefix}". ` +
          `Check the product config or try with forceReleases set explicitly.`,
      });
      return res.end();
    }

    sseWrite(res, {
      type: 'progress',
      release: '__meta__',
      status: 'fetching',
      detail: `Found ${releases.length} releases (${productPrefix}*). Starting sync — this may take several minutes…`,
    });

    const cache = buildCache(productId, shared);

    const result = await syncReleaseDataset(jira, releases, {
      cache,
      projectKey,
      labelPrefix,
      productPrefix,
      sprintCalendar,
      forceReleases,
      skipChangelog,
      onProgress: (event) => {
        sseWrite(res, { type: 'progress', ...event });
      },
    });

    sseWrite(res, {
      type: 'done',
      releases: result.releases,
      numTickets: result.processed?.length ?? 0,
      errors: result.errors,
      changelogEnriched: result.changelogEnriched,
    });
  } catch (e) {
    console.error('[releaseSync] /sync error:', e?.message || e);
    try {
      sseWrite(res, { type: 'error', message: e?.message || 'Sync failed' });
    } catch (_) {
      // Response may already be closed if client disconnected.
    }
  } finally {
    _syncState.isSyncing = false;
    _syncState.productId = null;
    _syncState.startedAt = null;
    res.end();
  }
});

// ─── GET /bundle ──────────────────────────────────────────────────────────────

/**
 * Strict-load the processed bundle from disk cache.
 * Returns 404 when no bundle exists yet (user needs to run /sync first).
 *
 * Response (success):
 *   {
 *     success: true,
 *     data: {
 *       tickets: ProcessedTicketWithDerived[],
 *       releases: string[],
 *       meta: BundleCacheMeta
 *     }
 *   }
 */
router.get('/bundle', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || 'ndb').toString();

    const shared = await getShared();
    const { CACHE_SCHEMA } = shared;
    const cache = buildCache(productId, shared);

    const { payload, meta } = cache.loadBundleLenient();

    if (!payload || !payload.processed) {
      return res.status(404).json({
        success: false,
        error: 'No bundle found on disk. Run POST /api/release-dataset/sync first.',
      });
    }

    // Reject bundles built with an older schema — the ticket shape has changed
    // (e.g. Summary, CC Date, Parent Key were added in v2-node-2026-06).
    // Returning 404 causes TeamDatasetContext to set bundle=null so pages
    // fall back to live JIRA API calls while the user re-syncs.
    if (CACHE_SCHEMA && meta?.schema && meta.schema !== CACHE_SCHEMA) {
      return res.status(404).json({
        success: false,
        error: `Bundle schema mismatch (disk: ${meta.schema}, expected: ${CACHE_SCHEMA}). Re-sync required.`,
        schemaMismatch: true,
        diskSchema: meta.schema,
        expectedSchema: CACHE_SCHEMA,
      });
    }

    return res.json({
      success: true,
      data: {
        tickets: payload.processed ?? [],
        releases: payload.releases ?? [],
        meta: {
          lastSyncIso: meta?.lastSyncIso ?? null,
          numTickets: payload.processed?.length ?? 0,
          numReleases: payload.releases?.length ?? 0,
          releases: payload.releases ?? [],
          schemaVersion: meta?.schema ?? null,
        },
      },
    });
  } catch (e) {
    console.error('[releaseSync] /bundle error:', e?.message || e);
    return res.status(500).json({ success: false, error: e?.message || 'bundle load failed' });
  }
});

// ─── DELETE /cache ────────────────────────────────────────────────────────────

/**
 * Wipes the on-disk dataset cache for a product so the next sync starts fresh.
 *
 * Query params:
 *   productId   string   default 'ndb'
 *   mode        string   'bundle' (default) | 'full'
 *
 * mode=bundle  — removes only bundle.json + bundle.meta.json.
 *                Per-release caches are kept so the next sync can reuse them.
 * mode=full    — removes bundle + ALL per-release caches + any stale sync lock.
 *                The next sync re-fetches every release from JIRA.
 *
 * Returns 409 if a sync is actively running (refuses to delete mid-sync).
 *
 * Response:
 *   { success: true, mode, cleared: { bundle: bool, releases: number, lock: bool } }
 */
router.delete('/cache', auth, async (req, res) => {
  try {
    const productId = (req.query.productId || 'ndb').toString();
    const mode = (req.query.mode || 'bundle').toString();

    if (_syncState.isSyncing && _syncState.productId === productId) {
      return res.status(409).json({
        success: false,
        error: `Cannot reset cache while a sync is running for '${productId}'. Wait for it to finish first.`,
      });
    }

    const shared = await getShared();
    const cache = buildCache(productId, shared);

    let releasesCleared = 0;
    let lockCleared = false;

    if (mode === 'full') {
      // Count how many per-release files exist before wiping.
      const { existsSync, readdirSync } = await import('node:fs');
      if (existsSync(cache.perReleaseDir)) {
        releasesCleared = readdirSync(cache.perReleaseDir).filter(
          (f) => f.endsWith('.json')
        ).length;
      }
      cache.clearRelease(); // wipes all per-release files

      // Remove stale sync lock if present.
      if (cache.isSyncInProgress()) {
        cache.releaseSyncLock();
        lockCleared = true;
      } else {
        // Force-remove even if not "in progress" (may be a very old stale file).
        const { existsSync: fsExists, unlinkSync } = await import('node:fs');
        if (fsExists(cache.syncLockPath)) {
          try { unlinkSync(cache.syncLockPath); lockCleared = true; } catch (_) {}
        }
      }
    }

    cache.clearBundle();

    console.log(
      `[releaseSync] cache reset: productId=${productId} mode=${mode}` +
      ` releasesCleared=${releasesCleared} lockCleared=${lockCleared}`
    );

    return res.json({
      success: true,
      data: {
        mode,
        cleared: {
          bundle: true,
          releases: releasesCleared,
          lock: lockCleared,
        },
      },
    });
  } catch (e) {
    console.error('[releaseSync] /cache DELETE error:', e?.message || e);
    return res.status(500).json({ success: false, error: e?.message || 'cache reset failed' });
  }
});

module.exports = router;
