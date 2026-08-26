const axios = require('axios');
const { JIRA_API_V2 } = require('../config/api');
const { retryJiraCall, createHttpsAgent } = require('./jiraService');
const { getSprintsForBoard, classifySprintIssue, getAddedToSprintAt } = require('../utils/sprintCache');
const { runWithConcurrency } = require('../utils/concurrency');
const { buildSprintReportJql } = require('../utils/jiraQueryUtils');
const { loadKpiConfigSync, getKpisForTeam, getTeamById, loadTeamBoardConfig } = require('../utils/teamConfig');
const { fetchAllChangelogHistories } = require('../utils/changelogPagination');
const logger = require('../utils/logger');
const { getSprintMetrics } = require('../../../../shared/src/domain/sprintMetrics.cjs');

const SPRINT_TRENDS_SPRINT_CONCURRENCY = 3;
const SPRINT_TRENDS_CHANGELOG_CONCURRENCY = 5;
const SPRINT_REPORT_BY_RANGE_MAX_SPRINTS = 20;
const SPRINT_REPORT_BY_RANGE_MAX_DAYS = 365 * 2;

function getTeam(teamId) {
  const config = loadTeamBoardConfig();
  const team = getTeamById(teamId) || getTeamById(config.defaultTeamId) || (config.teams || [])[0];
  return { team, effectiveTeamId: (team && team.id) || teamId || config.defaultTeamId };
}

function boardConfig() {
  return loadTeamBoardConfig() || {};
}

function mapIssue(issue, storyPointsFieldId, extra = {}) {
  let storyPoints = 0;
  if (storyPointsFieldId && issue.fields && issue.fields[storyPointsFieldId] != null) {
    const raw = issue.fields[storyPointsFieldId];
    if (typeof raw === 'number' && !Number.isNaN(raw)) storyPoints = raw;
    else if (raw && typeof raw === 'object' && typeof raw.value === 'number' && !Number.isNaN(raw.value)) storyPoints = raw.value;
  }
  return {
    key: issue.key,
    summary: issue.fields?.summary || '',
    status: issue.fields?.status?.name || '',
    resolution: issue.fields?.resolution?.name || null,
    issuetype: issue.fields?.issuetype?.name || '',
    priority: issue.fields?.priority?.name || '',
    assignee: issue.fields?.assignee?.displayName || null,
    classification: classifySprintIssue(issue),
    storyPoints,
    ...extra
  };
}

async function fetchAllIssues({ token, jql, fieldsList, timeout = 30000 }) {
  const httpsAgent = createHttpsAgent();
  let allIssues = [];
  let startAt = 0;
  const maxResults = 100;
  let hasMore = true;
  while (hasMore) {
    const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      httpsAgent,
      timeout,
      params: { jql, fields: fieldsList, maxResults, startAt }
    }));
    const issues = response.data?.issues || [];
    const total = response.data?.total ?? 0;
    allIssues = allIssues.concat(issues);
    startAt = allIssues.length;
    hasMore = allIssues.length < total && issues.length === maxResults;
    if (hasMore) await new Promise((r) => setTimeout(r, 200));
  }
  return allIssues;
}

async function getSprintList({ token, teamId, state }) {
  const { team } = getTeam(teamId);
  const boardId = team ? team.boardId : null;
  if (!boardId) {
    const err = new Error('Team has no board configured');
    err.statusCode = 400;
    throw err;
  }
  const sprintMap = await getSprintsForBoard(boardId, token, createHttpsAgent(), state);
  return Array.from(sprintMap.entries()).map(([id, info]) => ({
    id,
    name: info.name,
    state: info.state,
    startDate: info.startDate || null,
    endDate: info.endDate || null,
    completeDate: info.completeDate || null
  })).sort((a, b) => (new Date(b.endDate || 0).getTime() - new Date(a.endDate || 0).getTime()));
}

async function getProjectComponents({ token, teamId }) {
  const { team } = getTeam(teamId);
  const projectKey = team ? team.projectKey : null;
  if (!projectKey) {
    const err = new Error('Team has no project key');
    err.statusCode = 400;
    throw err;
  }
  const projectUrl = JIRA_API_V2.PROJECT ? JIRA_API_V2.PROJECT(projectKey) : `${JIRA_API_V2.BASE_URL}/rest/api/2/project/${projectKey}`;
  const response = await retryJiraCall(() => axios.get(projectUrl, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    httpsAgent: createHttpsAgent(),
    timeout: 15000
  }));
  const components = (response.data && response.data.components) || [];
  return components.map((c) => ({ id: c.id, name: c.name || '' })).filter((c) => c.name !== undefined);
}

async function buildSprintReport({ token, teamId, sprintId }) {
  const { team, effectiveTeamId } = getTeam(teamId);
  const boardId = team ? team.boardId : null;
  if (!boardId) throw Object.assign(new Error('Team has no board configured'), { statusCode: 400 });
  const sprintFieldId = boardConfig().sprintFieldId;
  if (!sprintFieldId) throw Object.assign(new Error('sprintFieldId is not configured in boardConfig().json'), { statusCode: 500 });
  const sprintMap = await getSprintsForBoard(boardId, token, createHttpsAgent());
  const sprintInfo = sprintMap.get(Number(sprintId));
  if (!sprintInfo) throw Object.assign(new Error(`Sprint ${sprintId} not found for this board.`), { statusCode: 400 });

  const storyPointsFieldId = boardConfig().storyPointsFieldId || null;
  const jql = buildSprintReportJql(sprintId, effectiveTeamId);
  const fieldsList = `key,summary,status,resolution,resolutiondate,issuetype,priority,assignee,${sprintFieldId}${storyPointsFieldId ? `,${storyPointsFieldId}` : ''}`;
  const allIssues = await fetchAllIssues({ token, jql, fieldsList });

  let inProgress = 0; let pendingQA = 0; let completedInSprint = 0;
  const issuesWithClassification = allIssues.map((issue) => {
    const mapped = mapIssue(issue, storyPointsFieldId);
    if (mapped.classification === 'inProgress') inProgress++;
    else if (mapped.classification === 'pendingQA') pendingQA++;
    else if (mapped.classification === 'completedInSprint') completedInSprint++;
    return mapped;
  });

  const addedAfterStartJql = `issueFunction in addedAfterSprintStart("${boardId}", "${sprintInfo.name}")`;
  const removedFromSprintJql = `issueFunction in removedAfterSprintStart("${boardId}", "${sprintInfo.name}")`;
  let addedAfterStart = 0;
  let removedFromSprint = 0;
  try {
    const [addedRes, removedRes] = await Promise.all([
      retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        httpsAgent: createHttpsAgent(),
        timeout: 6000,
        params: { jql: addedAfterStartJql, fields: 'key', maxResults: 1, startAt: 0 }
      })),
      retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        httpsAgent: createHttpsAgent(),
        timeout: 6000,
        params: { jql: removedFromSprintJql, fields: 'key', maxResults: 1, startAt: 0 }
      }))
    ]);
    addedAfterStart = addedRes.data?.total ?? 0;
    removedFromSprint = removedRes.data?.total ?? 0;
  } catch (_) {}

  const totalInSprint = allIssues.length;
  const metrics = getSprintMetrics({ totalInSprint, addedAfterStart, inProgress, pendingQA, completedInSprint, removedFromSprint });
  const pendingQAStatusName = boardConfig().pendingQAStatusName || 'Resolved';
  const jqlByMetric = {
    totalInSprint: jql,
    addedAfterStart: addedAfterStartJql,
    removedFromSprint: removedFromSprintJql,
    open: `(${jql}) AND statusCategory = To Do`,
    inProgress: `(${jql}) AND statusCategory = "In Progress"`,
    pendingQA: `(${jql}) AND status = "${pendingQAStatusName}"`,
    completedInSprint: `issueFunction in completeInSprint("${boardId}", "${sprintInfo.name}")`
  };
  const byStatus = {};
  issuesWithClassification.forEach((iss) => { byStatus[iss.status || 'Unknown'] = (byStatus[iss.status || 'Unknown'] || 0) + 1; });
  return {
    success: true,
    jql,
    jqlByMetric,
    jiraBaseUrl: JIRA_API_V2.BASE_URL,
    storyPointsFieldId: storyPointsFieldId || null,
    sprint: { id: Number(sprintId), name: sprintInfo.name, state: sprintInfo.state, startDate: sprintInfo.startDate || null, endDate: sprintInfo.endDate || sprintInfo.completeDate || null },
    metrics,
    byStatus,
    issues: issuesWithClassification,
    note: removedFromSprint === 0 ? 'Removed-from-sprint count requires issues no longer in sprint; currently reported as 0. See docs for limitation.' : undefined
  };
}

async function buildSprintReportByRange({ token, teamId, startDate, endDate, componentNames }) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() > end.getTime()) {
    throw Object.assign(new Error('Invalid startDate or endDate.'), { statusCode: 400 });
  }
  const daysDiff = Math.round((end - start) / (24 * 60 * 60 * 1000));
  if (daysDiff > SPRINT_REPORT_BY_RANGE_MAX_DAYS) {
    throw Object.assign(new Error(`Date range must not exceed ${SPRINT_REPORT_BY_RANGE_MAX_DAYS / 365} years.`), { statusCode: 400 });
  }
  const { team, effectiveTeamId } = getTeam(teamId);
  if (!team?.boardId) throw Object.assign(new Error('Team has no board configured'), { statusCode: 400 });
  const sprintFieldId = boardConfig().sprintFieldId;
  if (!sprintFieldId) throw Object.assign(new Error('sprintFieldId is not configured in boardConfig().json'), { statusCode: 500 });
  const storyPointsFieldId = boardConfig().storyPointsFieldId || null;
  const fieldsList = `key,summary,status,resolution,resolutiondate,issuetype,priority,assignee,components,created,${sprintFieldId}${storyPointsFieldId ? `,${storyPointsFieldId}` : ''}`;
  const compNames = (Array.isArray(componentNames) ? componentNames.filter(Boolean) : []).slice(0, 5);
  const sprintMap = await getSprintsForBoard(team.boardId, token, createHttpsAgent(), 'closed');
  const rangeStart = start.getTime();
  const rangeEnd = end.getTime();
  const overlapping = Array.from(sprintMap.entries())
    .filter(([, info]) => {
      const sStart = info.startDate ? new Date(info.startDate).getTime() : 0;
      const sEnd = (info.endDate || info.completeDate) ? new Date(info.endDate || info.completeDate).getTime() : 0;
      return sEnd >= rangeStart && sStart <= rangeEnd;
    })
    .map(([id, info]) => ({ id, ...info }))
    .sort((a, b) => new Date(a.endDate || a.completeDate || 0).getTime() - new Date(b.endDate || b.completeDate || 0).getTime())
    .slice(0, SPRINT_REPORT_BY_RANGE_MAX_SPRINTS);

  const reports = [];
  const aggregatedIssues = [];
  for (const sprintInfo of overlapping) {
    const jql = buildSprintReportJql(sprintInfo.id, effectiveTeamId, { componentNames: compNames });
    const allIssues = await fetchAllIssues({ token, jql, fieldsList, timeout: 6000 });
    let inProgress = 0; let pendingQA = 0; let completedInSprint = 0;
    const issuesWithClassification = allIssues.map((issue) => {
      const mapped = mapIssue(issue, storyPointsFieldId, {
        sprintId: sprintInfo.id,
        sprintName: sprintInfo.name,
        components: (issue.fields?.components || []).map((c) => c.name).filter(Boolean),
        created: issue.fields?.created || null,
        resolutiondate: issue.fields?.resolutiondate || null
      });
      if (mapped.classification === 'inProgress') inProgress++;
      else if (mapped.classification === 'pendingQA') pendingQA++;
      else if (mapped.classification === 'completedInSprint') completedInSprint++;
      return mapped;
    });
    const addedAfterStartJql = `issueFunction in addedAfterSprintStart("${team.boardId}", "${(sprintInfo.name || '').replace(/"/g, '\\"')}")`;
    const removedFromSprintJql = `issueFunction in removedAfterSprintStart("${team.boardId}", "${(sprintInfo.name || '').replace(/"/g, '\\"')}")`;
    let addedAfterStart = 0; let removedFromSprint = 0;
    try {
      const [addedRes, removedRes] = await Promise.all([
        retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, httpsAgent: createHttpsAgent(), timeout: 6000, params: { jql: addedAfterStartJql, fields: 'key', maxResults: 1, startAt: 0 } })),
        retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' }, httpsAgent: createHttpsAgent(), timeout: 6000, params: { jql: removedFromSprintJql, fields: 'key', maxResults: 1, startAt: 0 } }))
      ]);
      addedAfterStart = addedRes.data?.total ?? 0;
      removedFromSprint = removedRes.data?.total ?? 0;
    } catch (_) {}
    const metrics = getSprintMetrics({ totalInSprint: allIssues.length, addedAfterStart, inProgress, pendingQA, completedInSprint, removedFromSprint });
    const pendingQAStatusName = boardConfig().pendingQAStatusName || 'Resolved';
    reports.push({
      sprintId: sprintInfo.id,
      sprintName: sprintInfo.name,
      startDate: sprintInfo.startDate || null,
      endDate: sprintInfo.endDate || sprintInfo.completeDate || null,
      metrics,
      issues: issuesWithClassification,
      jqlByMetric: {
        totalInSprint: jql,
        addedAfterStart: addedAfterStartJql,
        removedFromSprint: removedFromSprintJql,
        open: `(${jql}) AND statusCategory = To Do`,
        inProgress: `(${jql}) AND statusCategory = "In Progress"`,
        pendingQA: `(${jql}) AND status = "${pendingQAStatusName}"`,
        completedInSprint: `issueFunction in completeInSprint("${team.boardId}", "${(sprintInfo.name || '').replace(/"/g, '\\"')}")`
      }
    });
    aggregatedIssues.push(...issuesWithClassification);
  }
  return {
    success: true,
    sprints: overlapping.map((s) => ({ id: s.id, name: s.name, state: s.state, startDate: s.startDate || null, endDate: s.endDate || s.completeDate || null })),
    reports,
    jiraBaseUrl: JIRA_API_V2.BASE_URL,
    aggregatedIssues
  };
}

async function getFields({ token, search }) {
  const response = await axios.get(JIRA_API_V2.FIELD, {
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
    httpsAgent: createHttpsAgent(),
    timeout: 15000
  });
  let fields = response.data || [];
  const query = (search || '').toLowerCase();
  if (query) {
    fields = fields.filter((f) => f.name?.toLowerCase().includes(query) || f.id?.toLowerCase().includes(query));
  }
  return fields.map((f) => ({ id: f.id, name: f.name, custom: f.custom, type: f.schema?.type }));
}

async function getSprintKpiBreakdown({ token, teamId, sprintId, sprintName }) {
  if (!sprintId || !sprintName) throw Object.assign(new Error('sprintId and sprintName are required'), { statusCode: 400 });
  const { team, effectiveTeamId } = getTeam(teamId);
  if (!team?.boardId) throw Object.assign(new Error('Team has no boardId configured'), { statusCode: 400 });
  const { kpis } = getKpisForTeam(loadKpiConfigSync(), effectiveTeamId);
  if (!kpis || kpis.length === 0) return { success: true, kpiBreakdown: [], note: 'No KPIs configured for this team.' };
  const pendingQAStatusName = boardConfig().pendingQAStatusName || 'Resolved';
  const completedStatusName = boardConfig().completedStatusName || 'Closed';
  const sprintBaseFilter = team.sprintBaseFilter || team.baseFilter || '';
  const trueSprint = sprintBaseFilter ? `(${sprintBaseFilter}) AND sprint in ("${sprintName}")` : `sprint in ("${sprintName}")`;
  const kpiTasks = kpis.map((kpi) => async () => {
    const kpiJql = `(${trueSprint}) AND (${kpi.baseQuery})`;
    const allIssues = await fetchAllIssues({ token, jql: kpiJql, fieldsList: 'key,status,issuetype', timeout: 25000 });
    let completed = 0; let pendingQA = 0; let inProgress = 0;
    const byType = {};
    allIssues.forEach((issue) => {
      const cls = classifySprintIssue(issue);
      if (cls === 'completedInSprint') completed++;
      else if (cls === 'pendingQA') pendingQA++;
      else inProgress++;
      const typeName = issue.fields?.issuetype?.name || 'Unknown';
      byType[typeName] = (byType[typeName] || 0) + 1;
    });
    return {
      kpiName: kpi.name,
      completed,
      pendingQA,
      inProgress,
      total: allIssues.length,
      byType,
      jqlByStatus: {
        all: kpiJql,
        completed: `(${trueSprint}) AND (${kpi.baseQuery}) AND status = "${completedStatusName}"`,
        pendingQA: `(${trueSprint}) AND (${kpi.baseQuery}) AND status = "${pendingQAStatusName}"`,
        inProgress: `(${trueSprint}) AND (${kpi.baseQuery}) AND statusCategory != Done`
      }
    };
  });
  const kpiBreakdown = await runWithConcurrency(kpiTasks, 1);
  return { success: true, kpiBreakdown, sprintName, jiraBaseUrl: JIRA_API_V2.BASE_URL };
}

async function getSprintReportTrends({ token, teamId, sprintIds }) {
  const ids = Array.isArray(sprintIds) ? sprintIds.filter((x) => x != null) : [];
  if (ids.length === 0) throw Object.assign(new Error('sprintIds array is required'), { statusCode: 400 });
  const { team, effectiveTeamId } = getTeam(teamId);
  const boardId = team ? team.boardId : null;
  const sprintFieldId = boardConfig().sprintFieldId;
  if (!boardId || !sprintFieldId) throw Object.assign(new Error('Team boardId/sprintFieldId not configured'), { statusCode: 400 });
  const sprintMap = await getSprintsForBoard(boardId, token, createHttpsAgent());
  const maxChangelogForTrends = 15;
  const trendTasks = ids.map((sprintId) => async () => {
    const sprintInfo = sprintMap.get(Number(sprintId));
    if (!sprintInfo) return { sprintId: Number(sprintId), sprintName: null, metrics: null, error: 'Sprint not found' };
    const jql = buildSprintReportJql(sprintId, effectiveTeamId);
    const fieldsList = `key,summary,status,resolution,resolutiondate,issuetype,priority,assignee,${sprintFieldId}`;
    const allIssues = await fetchAllIssues({ token, jql, fieldsList, timeout: 6000 });
    let completedInSprint = 0; let pendingQA = 0; let inProgress = 0;
    allIssues.forEach((issue) => {
      const c = classifySprintIssue(issue);
      if (c === 'completedInSprint') completedInSprint++;
      else if (c === 'pendingQA') pendingQA++;
      else inProgress++;
    });
    const issuesForChangelog = allIssues.slice(0, maxChangelogForTrends);
    const changelogTasks = issuesForChangelog.map((issue) => async () => {
      try {
        const { histories } = await fetchAllChangelogHistories(JIRA_API_V2.BASE_URL, issue.key, issue.id, token, createHttpsAgent(), retryJiraCall, logger, null);
        const addedAt = getAddedToSprintAt(histories, sprintId, sprintFieldId);
        return (addedAt && sprintInfo.startDate && new Date(addedAt).getTime() > new Date(sprintInfo.startDate).getTime()) ? 1 : 0;
      } catch (_) {
        return 0;
      }
    });
    const addedCounts = await runWithConcurrency(changelogTasks, SPRINT_TRENDS_CHANGELOG_CONCURRENCY);
    const addedAfterStart = addedCounts.reduce((a, b) => a + b, 0);
    const total = allIssues.length;
    const plannedIssues = total - addedAfterStart;
    return {
      sprintId: Number(sprintId),
      sprintName: sprintInfo.name,
      metrics: {
        totalInSprint: total,
        addedAfterStart,
        removedFromSprint: 0,
        completedInSprint,
        pendingQA,
        inProgress,
        completionRate: total > 0 ? Math.round((completedInSprint / total) * 100) : 0,
        scopeCreepRate: plannedIssues > 0 ? Math.round((addedAfterStart / plannedIssues) * 100) : 0
      }
    };
  });
  const trends = await runWithConcurrency(trendTasks, SPRINT_TRENDS_SPRINT_CONCURRENCY);
  return { success: true, trends };
}

module.exports = {
  getSprintList,
  getProjectComponents,
  buildSprintReport,
  buildSprintReportByRange,
  getFields,
  getSprintKpiBreakdown,
  getSprintReportTrends,
  getSprintMetrics
};
