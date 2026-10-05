const fs = require('fs');
const path = require('path');
const {
  formatRiskIndicator,
  sortByRiskIndicator,
} = require('./jiraService');
const { searchPages, wrapJiraError } = require('../utils/jiraClient');
const { extractUserName, extractAssigneeName } = require('./userService');
const { getCached, setCached } = require('../utils/simpleCache');
const { extractTextFieldValue } = require('../utils/adfText');
const { getSprintsForBoard, resolveSprintState } = require('../utils/sprintCache');
const { resolveRequestedTeam } = require('../utils/jiraRouteHelpers');
const { getTeamBaseFilter, getTeamSosBaseFilter } = require('../utils/teamConfig');
const { wrapTeamScope } = require('../utils/teamScope');
const { getPrimaryComponentField, parsePrimaryComponent } = require('../utils/primaryComponent');

const PRIMARY_COMPONENT_FIELD = getPrimaryComponentField();

const RELEASE_DATASET_CACHE_DIR = path.resolve(
  __dirname, '..', '..', '..', '..', 'shared', '.cache', 'release-dataset'
);
const RELEASE_GATE_CONFIG_PATH = path.resolve(
  __dirname, '..', 'config', 'releaseVersionsEmailConfig.json'
);

// Lazy ESM import — mirrors releaseDataset.js pattern
let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    _sharedPromise = process.env.NODE_ENV === 'test'
      ? Promise.resolve(require('@portfolio-delivery-ops/shared'))
      : import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

const RELEASE_ITEMS_CONFIG = {
  MAX_RESULTS_PER_BATCH: 100,
  MAX_TOTAL_RESULTS: 500,
  MAX_FETCH_TIME_MS: 75000,
  AXIOS_TIMEOUT_MS: 60000,
  FIELDS_LIST: [
    'key', 'summary', 'status', 'priority', 'assignee', 'issuetype',
    'fixVersions', 'labels', 'customfield_10360', 'customfield_10860',
    'customfield_27764', 'customfield_11065', 'customfield_11260',
    'customfield_11067', 'customfield_13861',
    'customfield_11068', 'customfield_35863', 'customfield_35864',
    'customfield_14463', 'customfield_31460', 'customfield_14464',
    'customfield_14465', 'customfield_23073', 'customfield_45660',
    'customfield_23560', 'customfield_38460', PRIMARY_COMPONENT_FIELD, 'components',
  ].join(','),
};

async function fetchReleaseItemsFromJira(jql, jiraToken, _httpsAgent, _requestId) {
  return searchPages(jiraToken, jql, RELEASE_ITEMS_CONFIG.FIELDS_LIST, {
    pageSize: RELEASE_ITEMS_CONFIG.MAX_RESULTS_PER_BATCH,
    maxTotal: RELEASE_ITEMS_CONFIG.MAX_TOTAL_RESULTS,
    timeoutMs: RELEASE_ITEMS_CONFIG.AXIOS_TIMEOUT_MS,
    delayMs: 0,
    maxTimeMs: RELEASE_ITEMS_CONFIG.MAX_FETCH_TIME_MS,
  });
}

async function processReleaseItems(allIssues, jiraToken, httpsAgent, requestId, boardId = null) {
  let sprintMap = new Map();
  if (boardId) {
    try {
      sprintMap = await getSprintsForBoard(boardId, jiraToken, null);
    } catch (_e) {
      sprintMap = new Map();
    }
  }

  return allIssues.map((issue) => {
    // Extract the risk indicator value properly for SoS page compatibility
    const rawRiskIndicator = issue.fields.customfield_23560;
    const riskIndicator = rawRiskIndicator?.value || rawRiskIndicator;
    
    const sprintInfo = boardId
      ? resolveSprintState(issue.fields.customfield_10360, sprintMap)
      : { state: null, name: null };
    return {
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      priority: issue.fields.priority?.name || 'N/A',
      fixVersions: issue.fields.fixVersions?.map((fv) => fv.name).join(', ') || 'N/A',
      labels: issue.fields.labels || [],
      labelsString: issue.fields.labels?.join(', ') || 'N/A',
      assignee: extractAssigneeName(issue.fields.assignee, issue.key),
      issuetype: issue.fields.issuetype?.name || null,
      sprintState: sprintInfo.state,
      sprintName: sprintInfo.name,
      customfield_10860: extractUserName(issue.fields.customfield_10860, issue.key, 'qaContact'),
      customfield_27764: extractUserName(issue.fields.customfield_27764, issue.key, 'tpmOwner'),
      customfield_11065: extractUserName(issue.fields.customfield_11065, issue.key, 'testLead'),
      customfield_11260: extractUserName(issue.fields.customfield_11260, issue.key, 'pmOwner'),
      customfield_11067: issue.fields.customfield_11067,
      customfield_13861: issue.fields.customfield_13861,
      customfield_11068: issue.fields.customfield_11068,
      customfield_35863: issue.fields.customfield_35863,
      customfield_35864: issue.fields.customfield_35864,
      customfield_14463: issue.fields.customfield_14463,
      customfield_31460: issue.fields.customfield_31460,
      customfield_14464: issue.fields.customfield_14464,
      customfield_14465: issue.fields.customfield_14465,
      customfield_23073: issue.fields.customfield_23073,
      customfield_45660: issue.fields.customfield_45660,
      customfield_23560: riskIndicator,
      customfield_38460: extractTextFieldValue(issue.fields?.customfield_38460),
      // Expose as { parent, child } so the UI can filter on either level.
      primaryComponent: parsePrimaryComponent(issue.fields[PRIMARY_COMPONENT_FIELD]),
      // Standard JIRA components field — array of component names
      components: (issue.fields.components || []).map((c) => c.name).filter(Boolean),
    };
  });
}

/**
 * Map a cached dataset ticket (human-readable keys) to the same shape
 * that processReleaseItems produces from a live JIRA response.
 */
function mapCachedTicketToItem(t) {
  const labels = Array.isArray(t['Labels'])
    ? t['Labels']
    : (t['Labels'] ? String(t['Labels']).split(',').map((l) => l.trim()).filter(Boolean) : []);
  return {
    key: t['Issue Key'],
    summary: t['Summary'],
    status: t['Status'],
    priority: t['Priority'] || 'N/A',
    fixVersions: t['All Fix Versions'] || t['Fix Version'] || 'N/A',
    labels,
    labelsString: labels.join(', ') || 'N/A',
    assignee: t['Assignee'] || null,
    issuetype: t['Issue Type'] || null,
    sprintState: null,
    sprintName: t['Sprint Name'] || null,
    customfield_10860: t['QA Contact'] || null,
    customfield_27764: t['TPM Owner'] || null,
    customfield_11065: t['Test Lead'] || null,
    customfield_11260: t['PM Owner'] || null,
    customfield_11067: t['CC Date'] || null,
    customfield_13861: t['FS/DS Done Date'] || null,
    customfield_11068: t['Test Plan Date'] || null,
    customfield_35863: t['CG Date'] || null,
    customfield_35864: t['PG Date'] || null,
    customfield_14463: t['Requirements Link'] || null,
    customfield_31460: t['TCMS Link'] || null,
    customfield_14464: t['Design Doc Link'] || null,
    customfield_14465: t['Test Plan Link'] || null,
    customfield_23073: t['Status Update'] || null,
    customfield_45660: t['Status Update Date'] || null,
    customfield_23560: t['Risk Indicator'] || null,
    customfield_38460: t['Executive Status Update'] || null,
  };
}

/**
 * Try to load Feature/Initiative items for a single release from the
 * on-disk dataset cache.  Returns null if the cache is cold or unusable.
 */
async function loadItemsFromCache(fixVersion, productId) {
  if (!fixVersion || !productId) return null;
  try {
    const shared = await getShared();
    const { ReleaseDatasetCache } = shared;
    const cache = new ReleaseDatasetCache({ cacheDir: RELEASE_DATASET_CACHE_DIR, productId });
    const { tickets } = cache.loadReleaseLenient(fixVersion);
    if (!Array.isArray(tickets) || tickets.length === 0) return null;

    const versionLabel = fixVersion.toLowerCase();
    const items = tickets
      .filter((t) => {
        const type = (t['Issue Type'] || '').toLowerCase();
        if (type !== 'feature' && type !== 'initiative') return false;
        if ((t['Status'] || '').toLowerCase() === 'cancelled') return false;
        // Include tickets whose fixVersion matches OR carry the long-term-funded label
        const fv = (t['All Fix Versions'] || t['Fix Version'] || '').toLowerCase();
        const lbls = Array.isArray(t['Labels'])
          ? t['Labels'].join(' ').toLowerCase()
          : String(t['Labels'] || '').toLowerCase();
        return fv.includes(versionLabel) || lbls.includes(`${versionLabel}-long-term-funded`);
      })
      .map(mapCachedTicketToItem);

    console.log(`[releaseItemsDataService] Cache hit for ${fixVersion}: ${items.length} Feature/Initiative items`);
    return items;
  } catch (err) {
    console.warn(`[releaseItemsDataService] Cache read failed for ${fixVersion}:`, err.message);
    return null;
  }
}

/** Release names that are not real SoS versions (catch-all JIRA versions). */
function isVersionedRelease(name) {
  return typeof name === 'string' && /\d/.test(name);
}

function listConfiguredReleaseNames() {
  try {
    const raw = JSON.parse(fs.readFileSync(RELEASE_GATE_CONFIG_PATH, 'utf8'));
    return Object.keys(raw.releaseGateDates || {}).filter(isVersionedRelease);
  } catch (_e) {
    return [];
  }
}

function listCachedReleaseNames(productId) {
  if (!productId) return [];
  const dir = path.join(RELEASE_DATASET_CACHE_DIR, productId, 'per_release');
  if (!fs.existsSync(dir)) return [];
  const onDisk = fs.readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.meta.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .filter(isVersionedRelease);
  const configured = listConfiguredReleaseNames();
  if (configured.length === 0) return onDisk;
  const allow = new Set(configured);
  return onDisk.filter((name) => allow.has(name));
}

function readBundleLastSyncIso(productId) {
  if (!productId) return null;
  try {
    const metaPath = path.join(RELEASE_DATASET_CACHE_DIR, productId, 'bundle.meta.json');
    const raw = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return raw.lastSyncIso || null;
  } catch (_e) {
    return null;
  }
}

function isRateLimitError(err) {
  return err?.statusCode === 429 || err?.response?.status === 429 || /rate limit/i.test(err?.message || '');
}

/**
 * Load Feature/Initiative rows for every versioned release present in the
 * on-disk dataset cache. No JIRA calls.
 */
async function loadSosItemsFromCache(productId) {
  if (!productId) {
    return { byVersion: {}, lastSyncIso: null, itemCount: 0 };
  }
  const byVersion = {};
  const releases = listCachedReleaseNames(productId);
  for (const release of releases) {
    const items = await loadItemsFromCache(release, productId);
    if (items && items.length > 0) {
      byVersion[release] = sortByRiskIndicator(items);
    }
  }
  return {
    byVersion,
    lastSyncIso: readBundleLastSyncIso(productId),
    itemCount: Object.values(byVersion).reduce((n, items) => n + items.length, 0),
  };
}

function groupItemsByVersion(items) {
  const byVersion = {};
  for (const item of items) {
    const raw = item.fixVersions || item.fixVersion || '';
    const versions = raw && raw !== 'N/A'
      ? raw.split(',').map((v) => v.trim()).filter(Boolean)
      : ['Unversioned'];

    for (const v of versions) {
      if (!byVersion[v]) byVersion[v] = [];
      byVersion[v].push(item);
    }
  }
  for (const v of Object.keys(byVersion)) {
    byVersion[v] = sortByRiskIndicator(byVersion[v]);
  }
  return byVersion;
}

function requireSosFilter(teamId) {
  const raw = getTeamSosBaseFilter(teamId) || getTeamBaseFilter(teamId);
  if (!raw) {
    const err = new Error(
      `Team "${teamId || 'unknown'}" has no sosBaseFilter or baseFilter in Admin. Set the team base filter, then Fetch again.`
    );
    err.statusCode = 400;
    err.publicError = 'Team has no base filter';
    throw err;
  }
  return raw;
}

async function fetchSosItemsFromJira(teamId, jiraToken, httpsAgent) {
  const { resolveKpiJql } = require('./kpiService');
  const sosFilter = requireSosFilter(teamId);
  const resolvedFilter = await resolveKpiJql(sosFilter, jiraToken, httpsAgent);
  const jql = wrapTeamScope(resolvedFilter, 'issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY fixVersion ASC, key ASC');
  const issues = await fetchReleaseItemsFromJira(jql, jiraToken, httpsAgent, 'sos-items-all');
  const items = await processReleaseItems(issues, jiraToken, httpsAgent, 'sos-items-all');
  return {
    byVersion: groupItemsByVersion(items),
    usedFallbackFilter: false,
  };
}

/**
 * SoS Feature/Initiative payload. Live JIRA first; disk cache only as
 * a 429 fallback so a rate-limit does not blank the page.
 *
 * @param {object} opts
 * @param {string} opts.teamId
 * @param {string} opts.jiraToken
 * @param {object} opts.httpsAgent
 * @param {boolean} [opts.forceLive=true]
 */
async function fetchSosItems({ teamId, jiraToken, httpsAgent } = {}) {
  if (!teamId) {
    const err = new Error('Select a team to load SoS items.');
    err.statusCode = 400;
    err.publicError = 'Team not selected';
    throw err;
  }
  const productId = String(teamId).toLowerCase();
  const cached = await loadSosItemsFromCache(productId);

  try {
    const live = await fetchSosItemsFromJira(teamId, jiraToken, httpsAgent);
    return {
      ...live,
      source: 'jira',
      lastSyncIso: new Date().toISOString(),
      degraded: false,
    };
  } catch (err) {
    if (cached.itemCount > 0 && isRateLimitError(err)) {
      console.warn(`[sos-items] JIRA rate-limited; falling back to cache (${cached.itemCount} items)`);
      return {
        byVersion: cached.byVersion,
        source: 'cache',
        usedFallbackFilter: false,
        lastSyncIso: cached.lastSyncIso,
        degraded: true,
      };
    }
    if (isRateLimitError(err) && !err.statusCode) err.statusCode = 429;
    throw err;
  }
}

async function fetchAllItemsAcrossVersions(jiraToken, { fixVersions, teamId } = {}) {
  if (!fixVersions || !Array.isArray(fixVersions) || fixVersions.length === 0) {
    const err = new Error('At least one fixVersion is required');
    err.statusCode = 400;
    throw err;
  }
  const { effectiveTeamId, team } = resolveRequestedTeam(teamId);
  if (!effectiveTeamId || !team) {
    const err = new Error('Select a team to load release items.');
    err.statusCode = 400;
    err.publicError = 'Team not selected';
    throw err;
  }
  const baseFilter = getTeamBaseFilter(effectiveTeamId);
  if (!baseFilter) {
    const err = new Error(
      `Team "${effectiveTeamId}" has no baseFilter in Admin. Set the team base filter, then Fetch again.`
    );
    err.statusCode = 400;
    err.publicError = 'Team has no base filter';
    throw err;
  }

  const labelPrefix = String(team.labelPrefix || effectiveTeamId || '').toLowerCase();
  const allItems = [];

  try {
    for (const fixVersion of fixVersions) {
      const lower = String(fixVersion).toLowerCase();
      const suffix = labelPrefix && lower.startsWith(`${labelPrefix}-`)
        ? lower.slice(labelPrefix.length + 1)
        : lower;
      const collapsed = suffix.replace(/\s+/g, '-');
      const longTermLabel = labelPrefix
        ? `${labelPrefix}-${collapsed}-long-term-funded`
        : `${collapsed}-long-term-funded`;
      const inner = `(fixVersion = "${fixVersion}" OR labels = "${longTermLabel}") AND issuetype IN (Feature, Initiative) AND status != Cancelled ORDER BY key ASC`;
      const jql = wrapTeamScope(baseFilter, inner);
      const issues = await fetchReleaseItemsFromJira(jql, jiraToken, null, `release-items-${fixVersion}`);
      const mapped = await processReleaseItems(issues, jiraToken, null, `release-items-${fixVersion}`, team?.boardId);
      allItems.push(...mapped);
    }
  } catch (err) {
    if (err.statusCode) throw err;
    throw wrapJiraError(err, 'Failed to fetch release items');
  }

  return { allItems: sortByRiskIndicator([...allItems]) };
}

module.exports = {
  fetchAllItemsAcrossVersions,
  fetchSosItems,
  loadSosItemsFromCache,
  _internals: {
    fetchReleaseItemsFromJira,
    processReleaseItems,
    RELEASE_ITEMS_CONFIG,
    getCached,
    setCached,
    isVersionedRelease,
    listCachedReleaseNames,
    groupItemsByVersion,
  },
};

