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
const CONCURRENCY_LIMIT = 5;
const TCMS_TIMEOUT_MS = 15000; // Reduced from 30s to 15s

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

    const result = {
      qi: qi,
      total: null, // Not provided by new API
      passed: null, // Not provided by new API  
      failed: null, // Not provided by new API
      components: data.teams || [], // Teams serve as component breakdown
      date: data.date,
      overallQI: data.QI,
      featureQI: featureQI
    };

    // Cache successful result
    tcmsCache.set(cacheKey, result);
    return result;
  } catch (err) {
    const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');
    const errorMsg = isTimeout ? 'Request timeout' : (err?.response?.data || err.message);
    console.warn(`[tcmsService] fetchFeatureMetrics failed for ${featKey}@${milestone}:`, errorMsg);
    
    // Cache null result for failed requests to prevent immediate retries
    tcmsCache.set(cacheKey, null, 60000); // Cache for 1 minute only
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
async function enrichItemWithTCMS(item, fixVersion, isLongTerm = false) {
  try {
    item.tcmsQueryUrl = buildTcmsQueryUrl(item.key, fixVersion);

    // Keep the full milestone name for the API (e.g. "NDB-2.11")
    const branchMilestone = fixVersion;

    const [masterResult, branchResult] = await Promise.allSettled([
      fetchFeatureMetrics(item.key, 'master'),
      isLongTerm ? Promise.resolve(null) : fetchFeatureMetrics(item.key, branchMilestone)
    ]);

    const master = masterResult.status === 'fulfilled' ? masterResult.value : null;
    const branch = branchResult.status === 'fulfilled' ? branchResult.value : null;

    item.tcmsQI = {
      master: master || null,
      branch: (!isLongTerm && branch) ? branch : null
    };
  } catch (err) {
    console.warn(`[tcmsService] enrichItemWithTCMS failed for ${item.key}:`, err.message);
    item.tcmsQueryUrl = buildTcmsQueryUrl(item.key, fixVersion);
    item.tcmsQI = null;
  }
  return item;
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
  enrichCommitItemsWithQI,
  enrichLongTermItemsWithQI
};
