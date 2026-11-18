/**
 * TCMS Service - Fetches Quality Index (QI) and test metrics for Jira features.
 *
 * Uses GET /api/v1/quality_index with milestone and feats parameters
 * to get per-feature QI data with team and component breakdowns.
 *
 * API base: https://tcms.eng.nutanix.com
 * Concurrency: max 5 parallel TCMS calls to avoid rate-limiting.
 */

const axios = require('axios');
const { tcmsCache } = require('../utils/simpleCache');

const TCMS_API_BASE = 'https://tcms.eng.nutanix.com';
const TCMS_QI_PATH = '/api/v1/quality_index';
const TCMS_MILESTONE_AGG = '/api-readonly/v1/milestone_all_test_cases/aggregate';
const TCMS_MILESTONE_TOTAL = '/api-readonly/v1/milestone_all_test_cases/aggregate/total';
const CONCURRENCY_LIMIT = 5;
const TCMS_TIMEOUT_MS = 15000; // Reduced from 30s to 15s

async function fetchMilestoneMetrics(featKey, milestone, timeFilter = 'all') {
  try {
    const filters = JSON.stringify({ $and: [{ 'test_case.metadata.requirements': featKey }, { 'test_case.deprecated': false }] });
    const resp = await axios.get(`${TCMS_API_BASE}/api/v1/milestone_all_test_cases/aggregate/metrics`, {
      params: { aggregation_field: 'test_case.metadata.requirements', time_filter: timeFilter, target_milestone: milestone, feat_type: 'all', filters },
      timeout: TCMS_TIMEOUT_MS,
    });
    const row = resp.data?.data?.[0];
    if (!row) return null;
    return {
      qi: row.average_total_op_success_percentage ?? row.average_run_op_success_percentage ?? null,
      total: row.total ?? null,
      run: row.run ?? null,
      passed: row.passed ?? null,
      failed: row.failed ?? null,
      manual: { qi: row.average_manual_op_success_percentage ?? null, run: row.manual_run ?? null, passed: row.manual_passed ?? null, failed: row.manual_failed ?? null, rate: row.manual_passed_percentage ?? null },
      automation: { qi: row.average_automation_op_success_percentage ?? null, run: row.automation_run ?? null, passed: row.automation_passed ?? null, failed: row.automation_failed ?? null, rate: row.automation_passed_percentage ?? null },
      raw: row,
    };
  } catch (e) {
    return null;
  }
}

async function fetchMilestoneCount(featKey, milestone) {
  try {
    const body = [{ $match: { $and: [{ target_milestone: milestone }, { 'test_case.metadata.requirements': featKey }, { 'test_case.deprecated': false }] } }];
    const resp = await axios.post(`${TCMS_API_BASE}${TCMS_MILESTONE_TOTAL}`, body, { timeout: TCMS_TIMEOUT_MS, headers: { 'Content-Type': 'application/json' } });
    if (resp.data && typeof resp.data.total === 'number') {
      return { total: resp.data.total, qi: null };
    }
    return null;
  } catch (e) {
    return null;
  }
}

/**
 * Build the TCMS UI link for a given feature key and release version.
 * Example: https://tcms.eng.nutanix.com/#/testcases/NDB/2.11/qcow2?search=[{"field":"Requirements","op":"$eq","value":["FEAT-16363"]}]
 *
 * @param {string} featKey    - e.g. "FEAT-16363"
 * @param {string} fixVersion - e.g. "NDB-2.11"
 */
function buildTcmsQueryUrl(featKey, fixVersion) {
  const versionNum = fixVersion.replace(/^NDB-/i, '');
  const search = encodeURIComponent(JSON.stringify([
    { field: 'Requirements', op: '$eq', value: [featKey] }
  ]));
  return `${TCMS_API_BASE}/#/testcases/NDB/${versionNum}/qcow2?search=${search}&tab=package_type&type=All`;
}

/**
 * Call TCMS quality_index API for a feature key on a given milestone.
 * Returns { qi, teams, feats } or null on error.
 *
 * Response format:
 * {
 *   "date": "2026-05-06",
 *   "QI": 78,
 *   "teams": [{"name": "ndb-2.11/FUNCTIONAL", "QI": 82}],
 *   "feats": [{"name": "FEAT-30989", "QI": 93}]
 * }
 *
 * @param {string} featKey  - Jira feature key, e.g. "FEAT-16363"
 * @param {string} milestone - TCMS milestone name, e.g. "master" or "NDB-2.11"
 */
async function fetchFeatureMetrics(featKey, milestone) {
  const cacheKey = `${featKey}:${milestone}`;
  
  // Check cache first
  const cached = tcmsCache.get(cacheKey);
  if (cached) {
    console.log(`[tcmsService] Cache hit for ${cacheKey}`);
    return cached;
  }

  try {
    console.log(`[tcmsService] Fetching TCMS data for ${cacheKey}`);
    const response = await axios.get(`${TCMS_API_BASE}${TCMS_QI_PATH}`, {
      params: {
        milestone: milestone,
        feats: featKey
      },
      timeout: TCMS_TIMEOUT_MS
    });

    const data = response.data;
    if (!data) {
      console.warn(`[tcmsService] No data returned for ${featKey}@${milestone}`);
      return null;
    }

    // Extract feature-specific QI from feats array
    let featureQI = null;
    if (data.feats && Array.isArray(data.feats)) {
      const feat = data.feats.find(f => f.name === featKey);
      featureQI = feat ? feat.QI : null;
    }

    // Use feature-specific QI if available, otherwise fall back to overall QI
    const qi = featureQI !== null ? featureQI : data.QI;
    if (qi != null || (data.teams && data.teams.length)) {
      const result = {
        qi: qi,
        total: data.total ?? null,
        passed: null,
        failed: null,
        components: data.teams || [],
        date: data.date,
        overallQI: data.QI,
        featureQI: featureQI
      };
      tcmsCache.set(cacheKey, result);
      return result;
    }
    // quality_index has no entry -> fallback to milestone+requirements metrics (milestone_all_test_cases/aggregate/metrics)
    const m = await fetchMilestoneMetrics(featKey, milestone, 'all');
    if (m) {
      const result = { qi: m.qi, total: m.total, run: m.run, passed: m.passed, failed: m.failed, manual: m.manual, automation: m.automation, raw: m.raw, date: data.date || null, overallQI: null, featureQI: null };
      tcmsCache.set(cacheKey, result);
      return result;
    }
    const fallback = await fetchMilestoneCount(featKey, milestone);
    if (fallback && fallback.total != null) {
      const result = { qi: null, total: fallback.total, passed: null, failed: null, components: [], date: data.date || null, overallQI: null, featureQI: null };
      tcmsCache.set(cacheKey, result);
      return result;
    }
    tcmsCache.set(cacheKey, null, 60000);
    return null;
  } catch (err) {
    const m = await fetchMilestoneMetrics(featKey, milestone, 'all');
    if (m) {
      const result = { qi: m.qi, total: m.total, run: m.run, passed: m.passed, failed: m.failed, manual: m.manual, automation: m.automation, raw: m.raw, date: null, overallQI: null, featureQI: null };
      tcmsCache.set(cacheKey, result);
      return result;
    }
    const fallback = await fetchMilestoneCount(featKey, milestone);
    if (fallback && fallback.total != null) {
      const result = { qi: null, total: fallback.total, passed: null, failed: null, components: [], date: null, overallQI: null, featureQI: null };
      tcmsCache.set(cacheKey, result);
      return result;
    }
    const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');
    const errorMsg = isTimeout ? 'Request timeout' : (err?.response?.data || err.message);
    console.warn(`[tcmsService] fetchFeatureMetrics failed for ${featKey}@${milestone}:`, errorMsg);
    tcmsCache.set(cacheKey, null, 60000);
    return null;
  }
}

/**
 * Enrich a single item with TCMS data.
 * - Attaches item.tcmsQueryUrl (constructed URL)
 * - Attaches item.tcmsQI = { master, branch? }
 *
 * @param {object}  item       - Jira item with at least { key }
 * @param {string}  fixVersion - e.g. "NDB-2.11"
 * @param {boolean} isLongTerm - if true, only fetch master (branch doesn't exist for long-term)
 */
async function fetchMergedMetrics(featKey, milestone, timeFilter = 'all') {
  const [qiRes, mRes] = await Promise.allSettled([fetchFeatureMetrics(featKey, milestone), fetchMilestoneMetrics(featKey, milestone, timeFilter)]);
  const qi = qiRes.status === 'fulfilled' ? qiRes.value : null;
  const m = mRes.status === 'fulfilled' ? mRes.value : null;
  if (!qi && !m) return null;
  // For time-filtered windows (e.g. Last 4 weeks) don't fall back to overall QI — show empty if no recent runs
  if (timeFilter !== 'all' && !m) return null;
  // Merge: prefer metrics manual/automation/run, fall back to qi (only for Overall window)
  return {
    qi: m?.qi ?? qi?.qi ?? null,
    total: m?.total ?? qi?.total ?? null,
    run: m?.run ?? null,
    passed: m?.passed ?? null,
    failed: m?.failed ?? null,
    manual: m?.manual ?? (qi ? { qi: qi.qi, run: null, passed: null, failed: null, rate: qi.qi } : null),
    automation: m?.automation ?? (qi ? { qi: qi.qi, run: null, passed: null, failed: null, rate: qi.qi } : null),
    date: qi?.date ?? null,
    overallQI: qi?.overallQI ?? null,
    featureQI: qi?.featureQI ?? null,
  };
}

async function enrichItemWithQuality(item, fixVersion, isLongTerm = false) {
  try {
    item.tcmsQueryUrl = buildTcmsQueryUrl(item.key, fixVersion);
    const branchMilestone = fixVersion;
    const [masterAll, masterLast3, branchAll, branchLast3] = await Promise.all([
      fetchMergedMetrics(item.key, 'NDB-master', 'all'),
      fetchMergedMetrics(item.key, 'NDB-master', 'Last 4 Week'),
      isLongTerm ? null : fetchMergedMetrics(item.key, branchMilestone, 'all'),
      isLongTerm ? null : fetchMergedMetrics(item.key, branchMilestone, 'Last 4 Week'),
    ]);
    // TODO(TCMS): functional/system currently share same source metrics until TCMS provides category-filtered aggregates.
    // When TCMS exposes test_category filter, split fetchMergedMetrics into functionalMetrics vs systemMetrics here.
    const toTable = (m) => m ? { functional: { manual: m.manual, automation: m.automation }, system: { manual: m.manual, automation: m.automation } } : null;
    const toLast3Table = toTable;
    item.tcmsQuality = {
      releaseOverall: branchAll ? toTable(branchAll) : null,
      releaseLast3Weeks: branchLast3 ? toLast3Table(branchLast3) : null,
      masterOverall: masterAll ? toTable(masterAll) : null,
      masterLast3Weeks: masterLast3 ? toLast3Table(masterLast3) : null,
    };
    item.tcmsQI = { master: masterAll, branch: branchAll };
  } catch (err) {
    console.warn(`[tcmsService] enrichItemWithQuality failed for ${item.key}:`, err.message);
    item.tcmsQueryUrl = buildTcmsQueryUrl(item.key, fixVersion);
    item.tcmsQuality = null;
    item.tcmsQI = null;
  }
  return item;
}

async function enrichItemWithTCMS(item, fixVersion, isLongTerm = false) {
  return enrichItemWithQuality(item, fixVersion, isLongTerm);
}

/**
 * Process an array of items with concurrency control.
 */
async function enrichWithConcurrency(items, enrichFn, limit = CONCURRENCY_LIMIT) {
  const results = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const settled = await Promise.allSettled(batch.map(item => enrichFn(item)));
    settled.forEach((result, idx) => {
      if (result.status === 'rejected') {
        console.warn(`[tcmsService] Batch item ${batch[idx]?.key} failed:`, result.reason?.message);
      } else {
        results.push(result.value);
      }
    });
  }
  return results;
}

/**
 * Enrich commit items (master + branch QI).
 * @param {object[]} items
 * @param {string}   fixVersion
 */
async function enrichCommitItemsWithQI(items, fixVersion) {
  return enrichWithConcurrency(items, item => enrichItemWithTCMS(item, fixVersion, false));
}

/**
 * Enrich long-term funded items (master QI only).
 * @param {object[]} items
 * @param {string}   fixVersion
 */
async function enrichLongTermItemsWithQI(items, fixVersion) {
  return enrichWithConcurrency(items, item => enrichItemWithTCMS(item, fixVersion, true));
}

module.exports = {
  buildTcmsQueryUrl,
  fetchFeatureMetrics,
  enrichItemWithTCMS,
  enrichItemWithQuality,
  enrichCommitItemsWithQI,
  enrichLongTermItemsWithQI
};
