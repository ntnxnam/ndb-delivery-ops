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
const { extractTextFieldValue } = require('../utils/adfText');
const { getSprintsForBoard, resolveSprintState } = require('../utils/sprintCache');
const { resolveTeam } = require('../utils/jiraRouteHelpers');

const RELEASE_ITEMS_CONFIG = {
  MAX_RESULTS_PER_BATCH: 100,
  MAX_TOTAL_RESULTS: 500,
  MAX_FETCH_TIME_MS: 75000,
  AXIOS_TIMEOUT_MS: 60000,
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

async function fetchReleaseItemsFromJira(jql, jiraToken, httpsAgent, requestId) {
  let allIssues = [];
  let startAt = 0;
  let hasMore = true;
  const fetchStartTime = Date.now();

  while (hasMore && allIssues.length < RELEASE_ITEMS_CONFIG.MAX_TOTAL_RESULTS) {
    if (Date.now() - fetchStartTime > RELEASE_ITEMS_CONFIG.MAX_FETCH_TIME_MS) {
      break;
    }
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
    if (!response?.data?.issues) break;
    allIssues = allIssues.concat(response.data.issues);
    const total = response.data.total || allIssues.length;
    startAt += response.data.issues.length;
    hasMore = allIssues.length < total
      && response.data.issues.length === RELEASE_ITEMS_CONFIG.MAX_RESULTS_PER_BATCH;
  }
  return allIssues;
}

async function processReleaseItems(allIssues, jiraToken, httpsAgent, requestId, boardId = null) {
  let sprintMap = new Map();
  if (boardId) {
    try {
      sprintMap = await getSprintsForBoard(boardId, jiraToken, httpsAgent);
    } catch (_e) {
      sprintMap = new Map();
    }
  }

  return allIssues.map((issue) => {
    const riskIndicator = formatRiskIndicator(issue.fields.customfield_23560);
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

async function fetchAllItemsAcrossVersions(jiraToken, { fixVersions } = {}) {
  if (!fixVersions || !Array.isArray(fixVersions) || fixVersions.length === 0) {
    const err = new Error('At least one fixVersion is required');
    err.statusCode = 400;
    throw err;
  }
  const httpsAgent = createHttpsAgent();
  const allItems = [];
  const { team } = resolveTeam(null);
  for (const fixVersion of fixVersions) {
    const versionLabel = fixVersion.toLowerCase();
    const escapedVersionLabel = versionLabel.replace(/\./g, '\\.');
    const extensionLabelPattern = `${escapedVersionLabel}-.*-code-complete-extention-recieved`;
    const jql = `project = ERA AND (fixVersion = "${fixVersion}" OR labels = "${versionLabel}-long-term-funded" OR labels ~ "${extensionLabelPattern}") AND issuetype IN (Feature, Initiative) ORDER BY key ASC`;
    const issues = await fetchReleaseItemsFromJira(jql, jiraToken, httpsAgent, `release-items-${fixVersion}`);
    const mapped = await processReleaseItems(issues, jiraToken, httpsAgent, `release-items-${fixVersion}`, team?.boardId);
    allItems.push(...mapped);
  }
  return { allItems: sortByRiskIndicator([...allItems]) };
}

module.exports = {
  fetchAllItemsAcrossVersions,
  _internals: {
    fetchReleaseItemsFromJira,
    processReleaseItems,
    RELEASE_ITEMS_CONFIG,
    getCached,
    setCached,
  },
};

