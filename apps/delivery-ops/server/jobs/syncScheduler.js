const path = require('path');
const syncLocking = require('../utils/syncLocking');
const { isUnreleasedVersion } = require('../utils/teamScope');

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
const DEFAULT_INTERVAL_MS = 15 * 60 * 1000;
const RELEASE_LOCK_TTL_MS = 10 * 60 * 1000;

let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    if (process.env.NODE_ENV === 'test') {
      _sharedPromise = Promise.resolve(require('@portfolio-delivery-ops/shared'));
    } else {
      _sharedPromise = import('@portfolio-delivery-ops/shared');
    }
  }
  return _sharedPromise;
}

function getSchedulerProducts() {
  const raw = (process.env.RELEASE_DATASET_SCHEDULER_PRODUCTS || 'ndb').trim();
  return raw.split(',').map((v) => v.trim()).filter(Boolean);
}

function getIntervalMs() {
  const parsed = Number(process.env.RELEASE_DATASET_SCHEDULER_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed < 60000) {
    return DEFAULT_INTERVAL_MS;
  }
  return parsed;
}

function isEnabled() {
  const raw = (process.env.RELEASE_DATASET_SCHEDULER_ENABLED || '').trim().toLowerCase();
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return process.env.NODE_ENV === 'production';
}

class SyncScheduler {
  constructor() {
    this.timer = null;
    this.intervalMs = getIntervalMs();
    this.running = false;
    this.lastRunAtIso = null;
    this.lastSuccessAtIso = null;
    this.lastError = null;
    this.nextRunAtIso = null;
  }

  async runForProduct(productId, runReason = 'scheduled') {
    const lockKey = `product:${productId}:full-sync`;
    const lock = syncLocking.acquire(lockKey, {
      ttlMs: RELEASE_LOCK_TTL_MS,
      owner: `scheduler:${runReason}`,
    });
    if (!lock.ok) {
      return {
        success: false,
        skipped: true,
        reason: `sync in progress (${Math.ceil(lock.remainingMs / 1000)}s remaining)`,
      };
    }

    try {
      const jiraPat = process.env.RELEASE_DATASET_SYNC_PAT || process.env.JIRA_PAT || '';
      if (!jiraPat) {
        return { success: false, skipped: true, reason: 'JIRA_PAT is not configured' };
      }

      const shared = await getShared();
      const {
        JiraConnector,
        loadEnv,
        getProductService,
        ReleaseDatasetCache,
        syncReleaseDataset,
      } = shared;

      const productService = getProductService(PRODUCT_CONFIG_PATH);
      const product = productService.getProduct(productId);
      const projectKey = product.projectKey;
      const labelPrefix = productService.getLabelPrefix(productId);
      const productPrefix = productService.getReleasePrefix(productId);
      const sprintCalendar = productService.getSprintCalendar(productId);

      const env = { ...loadEnv({ requirePat: false }), jiraPat };
      const jira = new JiraConnector(env);
      const cache = new ReleaseDatasetCache({ cacheDir: RELEASE_DATASET_CACHE_DIR, productId });

      const allProjectVersions = await jira.getProjectVersions(projectKey);
      const jiraReleases = allProjectVersions
        .filter(isUnreleasedVersion)
        .map((v) => v.name);
      const releasesToSync = Array.from(new Set(jiraReleases)).sort();
      if (!releasesToSync.length) {
        return { success: false, skipped: true, reason: 'no releases found to sync' };
      }

      const gateConfig = this.loadReleaseGateConfig();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const jiraVersionMap = Object.fromEntries(allProjectVersions.map((v) => [v.name, v]));
      const releaseStates = {};
      for (const rel of releasesToSync) {
        const cfg = gateConfig[rel];
        const isReleased = jiraVersionMap[rel]?.released ?? false;
        if (cfg?.ecDate && cfg?.gaDate) {
          const ec = new Date(cfg.ecDate);
          const ga = new Date(cfg.gaDate);
          releaseStates[rel] = today < ec ? 'future' : today > ga || isReleased ? 'past' : 'active';
        } else {
          releaseStates[rel] = isReleased ? 'past' : 'future';
        }
      }

      const forceReleases = releasesToSync.filter((r) => releaseStates[r] !== 'past');
      const result = await syncReleaseDataset(jira, releasesToSync, {
        cache,
        projectKey,
        labelPrefix,
        productPrefix,
        sprintCalendar,
        forceReleases,
        skipChangelog: false,
        includeLongTermFunded: true,
        changelogConcurrency: 1,
        fetchOptions: { concurrency: 1 },
        onProgress: () => {},
        baseFilter: product.baseFilter,
      });

      return {
        success: true,
        result: {
          releases: result.releases?.length || 0,
          changelogEnriched: result.changelogEnriched || 0,
          gateHistoryEnriched: result.gateHistoryEnriched || 0,
        },
      };
    } finally {
      syncLocking.release(lockKey);
    }
  }

  loadReleaseGateConfig() {
    const fs = require('fs');
    const releaseConfigPath = path.resolve(
      __dirname,
      '..',
      'config',
      'releaseVersionsEmailConfig.json'
    );
    try {
      const raw = fs.readFileSync(releaseConfigPath, 'utf8');
      const parsed = JSON.parse(raw);
      return parsed?.releaseGateDates || {};
    } catch (_e) {
      return {};
    }
  }

  async runNow(runReason = 'manual') {
    if (this.running) {
      return { success: false, skipped: true, reason: 'scheduler is already running' };
    }
    this.running = true;
    this.lastRunAtIso = new Date().toISOString();
    this.lastError = null;

    const products = getSchedulerProducts();
    const results = {};

    try {
      for (const productId of products) {
        // Sequential run keeps Jira call pressure predictable.
        results[productId] = await this.runForProduct(productId, runReason);
      }
      const allGood = Object.values(results).every((r) => r?.success || r?.skipped);
      if (allGood) this.lastSuccessAtIso = new Date().toISOString();
      const hasError = Object.values(results).some((r) => r && !r.success && !r.skipped);
      if (hasError) {
        this.lastError = 'One or more product syncs failed';
      }
      return { success: !hasError, results };
    } catch (e) {
      this.lastError = e?.message || 'scheduler run failed';
      return { success: false, error: this.lastError, results };
    } finally {
      this.running = false;
      if (this.timer) {
        this.nextRunAtIso = new Date(Date.now() + this.intervalMs).toISOString();
      }
    }
  }

  start() {
    if (!isEnabled()) {
      console.info('[syncScheduler] disabled');
      return;
    }
    if (this.timer) return;

    this.intervalMs = getIntervalMs();
    this.nextRunAtIso = new Date(Date.now() + this.intervalMs).toISOString();
    this.timer = setInterval(() => {
      this.runNow('scheduled').catch((e) => {
        this.lastError = e?.message || 'scheduler run failed';
      });
    }, this.intervalMs);
    console.info(`[syncScheduler] started interval=${this.intervalMs}ms products=${getSchedulerProducts().join(',')}`);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.nextRunAtIso = null;
  }

  getStatus() {
    return {
      enabled: isEnabled(),
      running: this.running,
      intervalMs: this.intervalMs,
      lastRunAtIso: this.lastRunAtIso,
      lastSuccessAtIso: this.lastSuccessAtIso,
      lastError: this.lastError,
      nextRunAtIso: this.nextRunAtIso,
      products: getSchedulerProducts(),
    };
  }
}

module.exports = new SyncScheduler();
