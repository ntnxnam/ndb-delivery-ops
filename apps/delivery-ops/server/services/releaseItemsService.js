/**
 * Release-items service: read-only orchestration for the heavy
 * release-items endpoints that power the Release Versions tab.
 *
 * Functions in this module:
 *   - fetchAllItemsAcrossVersions  — multi-version flat list with risk-sort
 *                                    (powers /release-items)
 *   - getCommitItems               — committed items for one fixVersion with
 *                                    sprint enrichment, cached
 *                                    (powers /release-items-commit)
 *   - getLongTermItems             — long-term funded items for one fixVersion,
 *                                    cached (powers /release-items-long-term)
 *
 * The two single-version endpoints share heavy plumbing — JIRA paginated
 * fetch, field projection, sprint enrichment — which lives in the internal
 * helpers `fetchReleaseItemsFromJira` and `processReleaseItems`. They were
 * previously defined inline in server/routes/jira/index.js and are now
 * collocated with their callers in this service.
 *
 * Error contract: on partial failure (JIRA timeout / rate limit mid-fetch),
 * functions throw an Error with `partialItems` attached so the route layer
 * can return HTTP 200 + { success: false, partial: true, data: { items } }.
 * This preserves the "show what we have" UX the UI relies on.
 *
 * Extracted from server/routes/jira/index.js during Phase 2b.1c.
 */

const axios = require('axios');
const { JIRA_API_V2 } = require('../config/api');
const {
  createHttpsAgent,
  retryJiraCall,
  jiraHeaders,
  formatRiskIndicator,
  sortByRiskIndicator,
} = require('./jiraService');
const { extractUserName, extractAssigneeName } = require('./userService');
const { getCached, setCached } = require('../utils/simpleCache');
const { buildCommitItemsJQL, buildLongTermItemsJQL } = require('../utils/jiraQueryUtils');
const { extractTextFieldValue } = require('../utils/adfText');
const { getSprintsForBoard, resolveSprintState } = require('../utils/sprintCache');
const { resolveTeam } = require('../utils/jiraRouteHelpers');

// Performance limits to prevent timeouts. Kept in sync with the original
// RELEASE_ITEMS_CONFIG in jira/index.js; future tuning lives here.
const RELEASE_ITEMS_CONFIG = {
  MAX_RESULTS_PER_BATCH: 100,
  MAX_TOTAL_RESULTS: 500,
  MAX_FETCH_TIME_MS: 75000, // 75 seconds across all pages
  AXIOS_TIMEOUT_MS: 60000,  // 60 seconds per individual call
  FIELDS_LIST: [
    'key', 'summary', 'status', 'priority', 'assignee', 'issuetype',
    'fixVersions', 'labels', 'customfield_10360', 'customfield_10860',
    'customfield_27764', 'customfield_11067', 'customfield_13861',
    'customfield_11068', 'customfield_35863', 'customfield_35864',
    'customfield_14463', 'customfield_31460', 'customfield_14464',
    'customfield_14465', 'customfield_23073', 'customfield_45660',
    'customfield_23560', 'customfield_38460',
  ].join(','),
};

/**
 * Paginated JIRA search, capped by RELEASE_ITEMS_CONFIG limits. Returns the
 * accumulated issues; on per-page failure inside retryJiraCall the function
 * throws (caller decides whether to surface partial results).
 */
async function fetchReleaseItemsFromJira(jql, jiraToken, httpsAgent, requestId) {
  let allIssues = [];
  let startAt = 0;
  let hasMore = true;
  const fetchStartTime = Date.now();

  while (hasMore && allIssues.length < RELEASE_ITEMS_CONFIG.MAX_TOTAL_RESULTS) {
    if (Date.now() - fetchStartTime > RELEASE_ITEMS_CONFIG.MAX_FETCH_TIME_MS) {
      console.warn(`[${requestId}] Fetch timeout reached after ${RELEASE_ITEMS_CONFIG.MAX_FETCH_TIME_MS / 1000}s, returning partial results`);
      break;
    }

    console.log(`[${requestId}] Fetching batch ${Math.floor(startAt / RELEASE_ITEMS_CONFIG.MAX_RESULTS_PER_BATCH) + 1}: startAt=${startAt}, current total=${allIssues.length}`);

    const response = await retryJiraCall(() => axios.get(
      JIRA_API_V2.SEARCH,
      {
        headers: jiraHeaders(jiraToken),
        httpsAgent,
        timeout: RELEASE_ITEMS_CONFIG.AXIOS_TIMEOUT_MS,
        params: {
          jql,
          fields: RELEASE_ITEMS_CONFIG.FIELDS_LIST,
          maxResults: RELEASE_ITEMS_CONFIG.MAX_RESULTS_PER_BATCH,
          startAt,
        },
      }
    ));

    if (response.data && response.data.issues) {
      allIssues = [...allIssues, ...response.data.issues];
      const total = response.data.total || allIssues.length;
      startAt += response.data.issues.length;
      hasMore = allIssues.length < total
        && response.data.issues.length === RELEASE_ITEMS_CONFIG.MAX_RESULTS_PER_BATCH;
      console.log(`[${requestId}] Fetched ${response.data.issues.length} issues, total: ${allIssues.length}/${total}`);
    } else {
      hasMore = false;
    }
  }

  return allIssues;
}

/**
 * Normalize raw JIRA issues into the flat item shape the UI consumes:
 * assignee resolved to display name, sprint state resolved against the
 * board's sprint map (if a boardId is given), risk indicator normalized,
 * customfield projections preserved.
 */
async function processReleaseItems(allIssues, jiraToken, httpsAgent, requestId, boardId = null) {
  let sprintMap = new Map();
  if (boardId) {
    try {
      sprintMap = await getSprintsForBoard(boardId, jiraToken, httpsAgent);
    } catch (e) {
      console.warn(`[${requestId}] Sprint fetch failed for board ${boardId}:`, e.message);
    }
  }

  return allIssues.map(issue => {
    const riskIndicator = formatRiskIndicator(issue.fields.customfield_23560);
    const sprintInfo = boardId
      ? resolveSprintState(issue.fields.customfield_10360, sprintMap)
      : { state: null, name: null };
    return {
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name,
      priority: issue.fields.priority?.name || 'N/A',
      fixVersions: issue.fields.fixVersions?.map(fv => fv.name).join(', ') || 'N/A',
      labels: issue.fields.labels || [],
      labelsString: issue.fields.labels?.join(', ') || 'N/A',
      assignee: extractAssigneeName(issue.fields.assignee, issue.key),
      issuetype: issue.fields.issuetype?.name || null,
      sprintState: sprintInfo.state,
      sprintName: sprintInfo.name,
      customfield_10860: extractUserName(issue.fields.customfield_10860, issue.key, 'qaContact'),
      customfield_27764: extractUserName(issue.fields.customfield_27764, issue.key, 'tpmOwner'),
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
    };
  });
}

/**
 * Build a "partial items" projection from raw issues already fetched before
 * the error. Used by callers that want to return whatever data we managed
 * to read rather than failing the whole request.
 */
function partialItemsFromIssues(allIssues) {
  if (!Array.isArray(allIssues) || allIssues.length === 0) return [];
  return allIssues.map(issue => ({
    key: issue.key,
    summary: issue.fields?.summary || 'Unable to load summary',
    status: issue.fields?.status?.name || 'Unknown',
  }));
}

function resolveDefaultTeam() {
  const { team } = resolveTeam(null);
  return { team, boardId: team ? team.boardId : null };
}

/**
 * Multi-version flat-list item fetch used by /release-items.
 * Loops fixVersions sequentially with a 1-sec inter-version delay to avoid
 * upstream rate-limit spikes. Per-version errors are logged but do not abort
 * the batch unless they are explicit 429 / rate-limit signals.
 *
 * @param {string} jiraToken
 * @param {{ fixVersions: string[] }} input
 * @returns {Promise<{ allItems: object[] }>}
 */
async function fetchAllItemsAcrossVersions(jiraToken, { fixVersions } = {}) {
  if (!fixVersions || !Array.isArray(fixVersions) || fixVersions.length === 0) {
    const err = new Error('At least one fixVersion is required');
    err.statusCode = 400;
    throw err;
  }
  const httpsAgent = createHttpsAgent();
  const allItems = [];

  for (let i = 0; i < fixVersions.length; i++) {
    const fixVersion = fixVersions[i];
    if (i > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    const versionLabel = fixVersion.toLowerCase();
    const escapedVersionLabel = versionLabel.replace(/\./g, '\\.');
    const extensionLabelPattern = `${escapedVersionLabel}-.*-code-complete-extention-recieved`;
    const allItemsJql = `project = ERA AND (fixVersion = "${fixVersion}" OR labels = "${versionLabel}-long-term-funded" OR labels ~ "${extensionLabelPattern}") AND issuetype IN (Feature, Initiative) ORDER BY key ASC`;

    try {
      let allIssues = [];
      let startAt = 0;
      const maxResults = 1000;
      let total = 0;
      let hasMore = true;

      while (hasMore) {
        const allItemsResponse = await retryJiraCall(() => axios.get(
          JIRA_API_V2.SEARCH,
          {
            headers: jiraHeaders(jiraToken),
            httpsAgent,
            timeout: 6000,
            params: {
              jql: allItemsJql,
              fields: 'key,summary,status,priority,fixVersions,labels,assignee,customfield_11067,customfield_13861,customfield_11068,customfield_35863,customfield_35864,customfield_14463,customfield_31460,customfield_14464,customfield_14465,customfield_23073,customfield_45660,customfield_23560,customfield_27764,customfield_10860,customfield_38460',
              maxResults,
              startAt,
            },
          }
        ));

        if (allItemsResponse.data && allItemsResponse.data.issues) {
          allIssues = [...allIssues, ...allItemsResponse.data.issues];
          total = allItemsResponse.data.total || allIssues.length;
          startAt += allItemsResponse.data.issues.length;
          hasMore = allIssues.length < total
            && allItemsResponse.data.issues.length === maxResults;
          if (hasMore) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        } else {
          hasMore = false;
        }
      }

      for (const issue of allIssues) {
        const issueFixVersions = issue.fields.fixVersions?.map(fv => fv.name) || [];
        const issueLabels = issue.fields.labels || [];
        // NOTE: customfield_23560 is kept RAW here (sortByRiskIndicator handles
        // both shapes); the single-version endpoints format it via processReleaseItems.
        // Preserved verbatim from the legacy /release-items handler.
        allItems.push({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status?.name,
          fixVersions: issueFixVersions.join(', ') || 'N/A',
          labels: issueLabels,
          labelsString: issueLabels.join(', ') || 'N/A',
          assignee: extractUserName(issue.fields.assignee, issue.key, 'assignee'),
          customfield_10860: extractUserName(issue.fields.customfield_10860, issue.key, 'qaContact'),
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
          customfield_23560: issue.fields.customfield_23560,
          customfield_27764: extractUserName(issue.fields.customfield_27764, issue.key, 'tpmOwner'),
          customfield_38460: extractTextFieldValue(issue.fields?.customfield_38460),
        });
      }
    } catch (apiError) {
      console.error(`Error fetching items for ${fixVersion}:`, apiError.message);
      if (apiError.response?.status === 429 || apiError.message?.includes('rate limit')) {
        throw apiError; // surface to caller
      }
      // Continue with next version on other errors
    }
  }

  return { allItems: sortByRiskIndicator([...allItems]) };
}

/**
 * Commit items for a single fixVersion. Cached under key 'commit-items'.
 * Throws an Error with `partialItems` attached on partial failure.
 *
 * @param {string} jiraToken
 * @param {{ fixVersion: string, username?: string }} input
 * @returns {Promise<{ items: object[], cached: boolean }>}
 */
async function getCommitItems(jiraToken, { fixVersion, username }) {
  if (!fixVersion) {
    const err = new Error('fixVersion is required');
    err.statusCode = 400;
    throw err;
  }

  const cacheKey = 'commit-items';
  const cacheParams = { fixVersion, username };
  const cachedResult = getCached(cacheKey, cacheParams);
  if (cachedResult) {
    return { items: cachedResult, cached: true };
  }

  const requestId = `commit-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[${requestId}] Starting release-items-commit fixVersion=${fixVersion}`);

  const httpsAgent = createHttpsAgent();
  const { team, boardId } = resolveDefaultTeam();
  const jql = buildCommitItemsJQL(fixVersion, team);
  console.log(`[${requestId}] Built JQL query: ${jql}`);

  let allIssues = [];
  try {
    allIssues = await fetchReleaseItemsFromJira(jql, jiraToken, httpsAgent, requestId);
    const items = await processReleaseItems(allIssues, jiraToken, httpsAgent, requestId, boardId);
    console.log(`[${requestId}] Successfully processed ${items.length} items`);
    setCached(cacheKey, cacheParams, items);
    return { items, cached: false };
  } catch (error) {
    error.requestId = requestId;
    error.partialItems = partialItemsFromIssues(allIssues);
    throw error;
  }
}

/**
 * Long-term funded items for a single fixVersion. Cached under key 'longterm-items'.
 * Throws an Error with `partialItems` attached on partial failure.
 *
 * @param {string} jiraToken
 * @param {{ fixVersion: string, username?: string }} input
 * @returns {Promise<{ items: object[], cached: boolean }>}
 */
async function getLongTermItems(jiraToken, { fixVersion, username }) {
  if (!fixVersion) {
    const err = new Error('fixVersion is required');
    err.statusCode = 400;
    throw err;
  }

  const cacheKey = 'longterm-items';
  const cacheParams = { fixVersion, username };
  const cachedResult = getCached(cacheKey, cacheParams);
  if (cachedResult) {
    return { items: cachedResult, cached: true };
  }

  const requestId = `longterm-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  console.log(`[${requestId}] Starting release-items-long-term fixVersion=${fixVersion}`);

  const httpsAgent = createHttpsAgent();
  const { team, boardId } = resolveDefaultTeam();
  const jql = buildLongTermItemsJQL(fixVersion, team);
  console.log(`[${requestId}] Built JQL query: ${jql}`);

  let allIssues = [];
  try {
    allIssues = await fetchReleaseItemsFromJira(jql, jiraToken, httpsAgent, requestId);
    const items = await processReleaseItems(allIssues, jiraToken, httpsAgent, requestId, boardId);
    setCached(cacheKey, cacheParams, items);
    return { items, cached: false };
  } catch (error) {
    error.requestId = requestId;
    error.partialItems = partialItemsFromIssues(allIssues);
    throw error;
  }
}

module.exports = {
  fetchAllItemsAcrossVersions,
  getCommitItems,
  getLongTermItems,
  // Re-export internals so 2b.1d (history / TCMS) can share them without
  // duplicating the heavy paginated fetch + field projection.
  _internals: {
    fetchReleaseItemsFromJira,
    processReleaseItems,
    partialItemsFromIssues,
    RELEASE_ITEMS_CONFIG,
  },
};
