const { JIRA_API_V2 } = require('../config/api');
const { getJira } = require('../utils/jiraClient');
const { loadKpiConfigSync, getKpisForTeam } = require('../utils/teamConfig');
const { getReleaseBaseFilter, upstreamStatus } = require('../utils/jiraRouteHelpers');
const { buildWorkItemsJql, buildWorkItemsUrl, buildAllTicketsUrl, isValidProjectKey } = require('@portfolio-delivery-ops/shared');
const logger = require('../utils/logger');

const KPI_LIST_MAX_RESULTS = 200;

async function resolveKpiJql(baseQuery, cleanToken, _httpsAgent) {
  const trimmed = (baseQuery || '').trim();
  if (!trimmed) return null;
  const filterMatch = trimmed.match(/^filter\s*=\s*(.+)$/i);
  if (filterMatch) {
    const filterVal = filterMatch[1].trim();
    const jira = await getJira(cleanToken);
    if (/^\d+$/.test(filterVal)) {
      const filterUrl = JIRA_API_V2.FILTER ? JIRA_API_V2.FILTER(filterVal) : `${JIRA_API_V2.BASE_URL}/rest/api/2/filter/${filterVal}`;
      const filterRes = await jira.get(filterUrl, { timeout: 15000 });
      if (filterRes.data && filterRes.data.jql) return filterRes.data.jql;
      return trimmed;
    }
    const favouriteUrl = `${JIRA_API_V2.BASE_URL}/rest/api/2/filter/favourite`;
    const tryFavouriteOnly = async () => {
      const favRes = await jira.get(favouriteUrl, { timeout: 15000 });
      const favList = Array.isArray(favRes.data) ? favRes.data : [];
      const fromFav = favList.find((f) => f.name && String(f.name).trim() === filterVal);
      return fromFav && fromFav.jql ? fromFav.jql : null;
    };
    try {
      const searchUrl = `${JIRA_API_V2.BASE_URL}/rest/api/2/filter/search?filterName=${encodeURIComponent(filterVal)}&maxResults=50`;
      const listRes = await jira.get(searchUrl, { timeout: 15000 });
      const filters = Array.isArray(listRes.data?.values)
        ? listRes.data.values
        : Array.isArray(listRes.data?.results)
          ? listRes.data.results
          : Array.isArray(listRes.data)
            ? listRes.data
            : [];
      const byName = filters.find((f) => f.name && String(f.name).trim() === filterVal);
      if (byName && byName.jql) return byName.jql;
      const byId = filters.find((f) => String(f.id) === filterVal);
      if (byId && byId.jql) return byId.jql;
      const byNamePartial = filters.find((f) => f.name && String(f.name).trim().toLowerCase() === filterVal.toLowerCase());
      if (byNamePartial && byNamePartial.jql) return byNamePartial.jql;
      const fromFavJql = await tryFavouriteOnly();
      if (fromFavJql) return fromFavJql;
    } catch (e) {
      if (e?.response?.status === 404) {
        const fromFavJql = await tryFavouriteOnly();
        if (fromFavJql) return fromFavJql;
      }
    }
    return trimmed;
  }
  return trimmed.replace(/\btype\s*=/gi, 'issuetype=');
}

async function buildKpiCombinedJql(teamId, kpiBaseQuery, cleanToken, httpsAgent) {
  const kpiJql = await resolveKpiJql(kpiBaseQuery, cleanToken, httpsAgent);
  if (!kpiJql) return null;
  const { getTeamBaseFilter } = require('../utils/teamConfig');
  const teamBaseFilter = getTeamBaseFilter(teamId);
  if (!teamBaseFilter) return kpiJql;
  return `(${teamBaseFilter}) AND (${kpiJql})`;
}

function deriveDeferredLabel(releaseVersion) {
  return `${(releaseVersion || '').toLowerCase()}-deferred`;
}

function appendDeferredExclusion(jql, releaseVersion) {
  const label = deriveDeferredLabel(releaseVersion);
  return `${jql} AND (labels is EMPTY OR labels != "${label}")`;
}

async function buildReleaseKpiCombinedJql(releaseVersion, kpiBaseQuery, cleanToken, httpsAgent, teamId = null) {
  const trimmedKpi = (kpiBaseQuery || '').trim();
  if (!trimmedKpi) return null;
  const releaseBaseFilter = getReleaseBaseFilter(releaseVersion, teamId);
  if (!releaseBaseFilter) {
    return resolveKpiJql(kpiBaseQuery, cleanToken, httpsAgent);
  }
  const kpiPart = trimmedKpi.match(/^filter\s*=\s*.+$/i)
    ? trimmedKpi
    : `(${trimmedKpi.replace(/\btype\s*=/gi, 'issuetype=')})`;
  return `${releaseBaseFilter.trim()} and ${kpiPart} and status != Closed`;
}

function mapIssues(response) {
  return (response.data.issues || []).map((issue) => {
    const f = issue.fields || {};
    return {
      key: issue.key,
      summary: (f.summary != null ? f.summary : '') || '',
      priority: (f.priority && f.priority.name) ? f.priority.name : '',
      assignee: (f.assignee && f.assignee.displayName) ? f.assignee.displayName : '',
      status: (f.status && f.status.name) ? f.status.name : ''
    };
  });
}

async function executeKpiQuery({ token, jql, displayType }) {
  const jira = await getJira(token);
  if (displayType === 'count') {
    const total = await jira.searchCount(jql);
    return { total: total != null ? total : 0, combinedJql: jql };
  }

  const fieldsList = 'key,summary,priority,assignee,status';
  const response = await jira.get(JIRA_API_V2.SEARCH, {
    timeout: 20000,
    params: { jql, fields: fieldsList, maxResults: KPI_LIST_MAX_RESULTS }
  });
  return { issues: mapIssues(response), total: response.data.total, combinedJql: jql };
}

function getTeamKpis(teamId) {
  const teams = loadKpiConfigSync();
  return getKpisForTeam(teams, teamId);
}

async function getKpiResult({ token, teamId, kpiId }) {
  const { kpis, normalizedTeamId } = getTeamKpis(teamId);
  if (!kpis) return { error: 'TEAM_KPIS_NOT_FOUND' };
  const kpi = kpis.find((k) => k.id === kpiId);
  if (!kpi) return { error: 'KPI_NOT_FOUND' };
  const baseQuery = (kpi.baseQuery || '').trim();
  if (!baseQuery) return { error: 'KPI_NO_BASE_QUERY' };
  const jql = await buildKpiCombinedJql(normalizedTeamId, baseQuery, token, null);
  if (!jql) return { error: 'KPI_JQL_UNRESOLVED' };
  return executeKpiQuery({ token, jql, displayType: kpi.displayType === 'list' ? 'list' : 'count' });
}

async function getKpiResultBatch({ token, teamId }) {
  const { kpis, normalizedTeamId } = getTeamKpis(teamId);
  if (!kpis || kpis.length === 0) return {};
  const results = {};
  for (const kpi of kpis) {
    const baseQuery = (kpi.baseQuery || '').trim();
    if (!baseQuery) {
      results[kpi.id] = { error: 'No base query' };
      continue;
    }
    try {
      const jql = await buildKpiCombinedJql(normalizedTeamId, baseQuery, token, null);
      if (!jql) {
        results[kpi.id] = { error: 'Could not resolve query' };
        continue;
      }
      results[kpi.id] = await executeKpiQuery({ token, jql, displayType: kpi.displayType === 'list' ? 'list' : 'count' });
    } catch (err) {
      const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'Query failed';
      results[kpi.id] = { error: message };
    }
  }
  return results;
}

async function getReleaseKpiResult({ token, releaseVersion, teamId, kpiId }) {
  const { kpis, normalizedTeamId } = getTeamKpis(teamId);
  if (!kpis) return { error: 'TEAM_KPIS_NOT_FOUND' };
  const kpi = kpis.find((k) => k.id === kpiId);
  if (!kpi) return { error: 'KPI_NOT_FOUND' };
  const baseQuery = (kpi.baseQuery || '').trim();
  if (!baseQuery) return { error: 'KPI_NO_BASE_QUERY' };
  let jql = await buildReleaseKpiCombinedJql(releaseVersion, baseQuery, token, null, normalizedTeamId);
  if (!jql) return { error: 'KPI_JQL_UNRESOLVED' };
  if (kpi.excludeDeferred) {
    jql = appendDeferredExclusion(jql, releaseVersion);
  }
  return executeKpiQuery({ token, jql, displayType: kpi.displayType === 'list' ? 'list' : 'count' });
}

async function getReleaseKpiResultBatch({ token, releaseVersion, teamId }) {
  const { kpis } = getTeamKpis(teamId);
  if (!kpis || kpis.length === 0) return {};
  const results = {};
  for (const kpi of kpis) {
    const baseQuery = (kpi.baseQuery || '').trim();
    if (!baseQuery) {
      results[kpi.id] = { error: 'No base query' };
      continue;
    }
    try {
      let jql = await buildReleaseKpiCombinedJql(releaseVersion, baseQuery, token, null, teamId);
      if (!jql) {
        results[kpi.id] = { error: 'Could not resolve query (check release base filter)' };
        continue;
      }
      if (kpi.excludeDeferred) {
        jql = appendDeferredExclusion(jql, releaseVersion);
      }
      results[kpi.id] = await executeKpiQuery({ token, jql, displayType: kpi.displayType === 'list' ? 'list' : 'count' });
    } catch (err) {
      const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'Query failed';
      results[kpi.id] = { error: message };
    }
  }
  return results;
}

function categorizeStatus(status) {
  switch (status) {
    case 'Done':
    case 'Closed':
      return 'Done';
    case 'Resolved':
      return 'To Be Verified';
    case 'In Progress':
    case 'Development':
    case 'Code Review':
    case 'In Review':
    case 'Testing':
    case 'QA':
    case 'UAT':
    case 'Pending Merge':
      return 'In Progress';
    case 'To Do':
    case 'Open':
    case 'Backlog':
    case 'New':
    case 'Ready':
    case 'Ready for Development':
    case 'Selected for Development':
      return 'To Do';
    case 'Blocked':
    case 'On Hold':
    case 'Need Info':
    case 'Needs Info':
    case 'Waiting':
    case 'Waiting for Information':
    case 'Pending':
      return 'Blocked';
    default:
      return 'Other';
  }
}

function groupBreakdownByProject(issues, projectKeys, excludedTypes) {
  const projectBreakdowns = {};
  projectKeys.forEach((key) => {
    projectBreakdowns[key] = { breakdown: {}, totalFiltered: 0 };
  });
  issues.forEach((issue) => {
    const issueType = issue.fields?.issuetype?.name || 'Unknown';
    const status = issue.fields?.status?.name || 'Unknown';
    const issueKey = issue.key;
    if (excludedTypes.includes(issueType)) return;
    const parentProjects = [];
    if (projectKeys.includes(issueKey)) parentProjects.push(issueKey);
    const parentLink = issue.fields?.['Parent Link']?.key;
    if (parentLink && projectKeys.includes(parentLink)) parentProjects.push(parentLink);
    const featId = issue.fields?.['FEAT ID'];
    if (featId && projectKeys.includes(featId)) parentProjects.push(featId);
    const featNumber = issue.fields?.['FEAT Number'];
    if (featNumber && projectKeys.includes(featNumber)) parentProjects.push(featNumber);
    if (parentProjects.length === 0) return;
    parentProjects.forEach((projectKey) => {
      const projectBreakdown = projectBreakdowns[projectKey];
      if (!projectBreakdown.breakdown[issueType]) {
        projectBreakdown.breakdown[issueType] = { total: 0, statuses: {} };
      }
      projectBreakdown.breakdown[issueType].total++;
      projectBreakdown.totalFiltered++;
      if (!projectBreakdown.breakdown[issueType].statuses[status]) {
        projectBreakdown.breakdown[issueType].statuses[status] = 0;
      }
      projectBreakdown.breakdown[issueType].statuses[status]++;
    });
  });
  return projectBreakdowns;
}

async function getIssueBreakdown({ token, jiraKey, jiraKeys }) {
  const projectKeys = jiraKey ? [jiraKey] : (jiraKeys || []);
  const isBulkRequest = jiraKeys && jiraKeys.length > 1;
  if (projectKeys.length === 0) {
    const error = new Error('jiraKey or jiraKeys is required');
    error.statusCode = 400;
    throw error;
  }
  const invalidKeys = projectKeys.filter((key) => !isValidProjectKey(key));
  if (invalidKeys.length > 0) {
    const error = new Error(`Invalid project key format: ${invalidKeys.join(', ')}. Expected format: LETTERS-NUMBERS (e.g., FEAT-1001)`);
    error.statusCode = 400;
    throw error;
  }

  const jira = await getJira(token);
  const jqlQuery = buildWorkItemsJql(projectKeys, { includeLinkedIssues: true });
  logger.jira.fetch(isBulkRequest ? `BULK[${projectKeys.join(',')}]` : projectKeys[0], 'FETCH_ISSUE_BREAKDOWN', `Fetching issue breakdown for ${isBulkRequest ? 'bulk' : 'single'} JIRA ${isBulkRequest ? 'tickets' : 'ticket'}`);
  let issues = [];
  try {
    const response = await jira.get(JIRA_API_V2.SEARCH, {
      timeout: 30000,
      params: { jql: jqlQuery, fields: 'key,summary,status,issuetype,parent', maxResults: 1000 }
    });
    issues = response.data.issues || [];
  } catch (error) {
    if (error.response) {
      const wrapped = new Error(`Failed to fetch issue breakdown: ${error.response.data.errorMessages?.join(', ') || error.response.statusText}`);
      wrapped.statusCode = upstreamStatus(error.response.status);
      throw wrapped;
    }
    throw error;
  }

  if (isBulkRequest) {
    const projectBreakdowns = groupBreakdownByProject(issues, projectKeys, []);
    const bulkResults = {};
    Object.entries(projectBreakdowns).forEach(([projectKey, projectData]) => {
      const { breakdown, totalFiltered } = projectData;
      const formattedBreakdown = Object.entries(breakdown).map(([type, data]) => {
        const statusCategories = { Done: {}, 'To Be Verified': {}, 'In Progress': {}, 'To Do': {}, Blocked: {}, Other: {} };
        Object.entries(data.statuses).forEach(([status, count]) => {
          const category = categorizeStatus(status);
          statusCategories[category][status] = count;
        });
        return { type, total: data.total, statusCategories };
      }).sort((a, b) => b.total - a.total);
      let totalDone = 0; let totalToBeVerified = 0; let totalInProgress = 0; let totalToDo = 0; let totalBlocked = 0; let totalOther = 0;
      formattedBreakdown.forEach(({ statusCategories }) => {
        Object.values(statusCategories.Done).forEach((count) => { totalDone += count; });
        Object.values(statusCategories['To Be Verified']).forEach((count) => { totalToBeVerified += count; });
        Object.values(statusCategories['In Progress']).forEach((count) => { totalInProgress += count; });
        Object.values(statusCategories['To Do']).forEach((count) => { totalToDo += count; });
        Object.values(statusCategories.Blocked).forEach((count) => { totalBlocked += count; });
        Object.values(statusCategories.Other).forEach((count) => { totalOther += count; });
      });
      const overallStats = {
        done: totalDone,
        toBeVerified: totalToBeVerified,
        inProgress: totalInProgress,
        toDo: totalToDo,
        blocked: totalBlocked,
        other: totalOther,
        completionRate: totalFiltered > 0 ? (((totalDone + totalToBeVerified) / totalFiltered) * 100).toFixed(1) : '0.0'
      };
      bulkResults[projectKey] = {
        success: true,
        total: totalFiltered,
        breakdown: formattedBreakdown,
        overallStats,
        jiraSearchUrl: buildWorkItemsUrl(projectKey, { jiraBaseUrl: JIRA_API_V2.BASE_URL, openOnly: true, includeLinkedIssues: true })
      };
    });
    logger.jira.issueBreakdown(`BULK[${projectKeys.join(',')}]`, issues.length, bulkResults);
    return { success: true, isBulk: true, results: bulkResults, totalIssuesProcessed: issues.length };
  }

  const ticketsData = issues.map((issue) => ({
    key: issue.key,
    issueType: issue.fields?.issuetype?.name || 'Unknown',
    status: issue.fields?.status?.name || 'Unknown',
    summary: issue.fields?.summary || ''
  }));
  logger.jira.issueBreakdown(projectKeys[0], issues.length, 'Raw tickets returned for client processing');
  return {
    success: true,
    total: issues.length,
    tickets: ticketsData,
    jiraSearchUrl: buildAllTicketsUrl(projectKeys[0], { jiraBaseUrl: JIRA_API_V2.BASE_URL, openOnly: false, includeLinkedIssues: true }),
    outstandingUrl: buildWorkItemsUrl(projectKeys[0], { jiraBaseUrl: JIRA_API_V2.BASE_URL, openOnly: true, includeLinkedIssues: true }),
    clientProcessing: true
  };
}

module.exports = {
  KPI_LIST_MAX_RESULTS,
  resolveKpiJql,
  buildKpiCombinedJql,
  deriveDeferredLabel,
  appendDeferredExclusion,
  buildReleaseKpiCombinedJql,
  getKpiResult,
  getKpiResultBatch,
  getReleaseKpiResult,
  getReleaseKpiResultBatch,
  categorizeStatus,
  groupBreakdownByProject,
  getIssueBreakdown
};
