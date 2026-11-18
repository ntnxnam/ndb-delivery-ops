/**
 * Team Overall Report Service — Phase 2 backend.
 * Uses shared jqlBuilder for JQL construction (product-agnostic, D1).
 */

const fs = require('fs');
const path = require('path');
const { getJira } = require('../utils/jiraClient');
const { getTeamById } = require('../utils/teamConfig');

function fallbackStripDone(baseFilter) {
  let out = String(baseFilter || '').replace(/\\s*AND\\s+statusCategory\\s*!=\\s*Done\\b/gi, '');
  out = out.replace(/\\s*AND\\s+statusCategory\\s+not\\s+in\\s*\\(\\s*Done\\s*\\)/gi, '');
  out = out.replace(/\\s{2,}/g, ' ').trim();
  return out;
}
function fallbackBuildTimeWindowJql(params, mode) {
  const base = params.baseFilter || '';
  const start = params.startDate;
  const end = params.endDate;
  const subtaskClause = params.includeSubtasks ? '' : ' AND issuetype not in (Sub-task)';
  let jql = '';
  if (mode === 'closed') {
    jql = `(${base}) AND statusCategory = Done AND resolved >= "${start}" AND resolved <= "${end}"${subtaskClause} ORDER BY resolved DESC`;
  } else if (mode === 'touched') {
    jql = `(${base}) AND ((updated >= "${start}" AND updated <= "${end}") OR (statusCategory = Done AND resolved >= "${start}" AND resolved <= "${end}"))${subtaskClause} ORDER BY updated DESC`;
  } else if (mode === 'worklogged') {
    jql = `(${base}) AND worklogDate >= "${start}" AND worklogDate <= "${end}"${subtaskClause} ORDER BY updated DESC`;
  } else {
    jql = `(${base}) AND statusCategory = Done AND resolved >= "${start}" AND resolved <= "${end}"${subtaskClause} ORDER BY resolved DESC`;
  }
  return { name: mode || 'closed', jql, params, warnings: [] };
}
async function getJqlBuilder() {
  try {
    const shared = require('@portfolio-delivery-ops/shared');
    if (shared && shared.jqlBuilder && typeof shared.jqlBuilder.stripDoneFromBaseFilter === 'function') {
      return {
        stripDoneFromBaseFilter: shared.jqlBuilder.stripDoneFromBaseFilter,
        buildTimeWindowJql: shared.jqlBuilder.buildTimeWindowJql || fallbackBuildTimeWindowJql,
      };
    }
    if (shared && typeof shared.stripDoneFromBaseFilter === 'function') {
      return {
        stripDoneFromBaseFilter: shared.stripDoneFromBaseFilter,
        buildTimeWindowJql: fallbackBuildTimeWindowJql,
      };
    }
  } catch (e) {
    // shared not available (Jest CJS) — use fallback
  }
  return {
    stripDoneFromBaseFilter: fallbackStripDone,
    buildTimeWindowJql: fallbackBuildTimeWindowJql,
  };
}

function getTeamConfig(teamId) {
  const t = getTeamById(teamId);
  if (!t) return null;
  const baseFilter = t.baseFilter || '';
  if (!baseFilter) return null;
  return {
    id: t.id || teamId,
    displayName: t.displayName || t.name || t.id || teamId,
    baseFilter,
    companionDisciplines: Array.isArray(t.companionDisciplines) ? t.companionDisciplines : [],
    homeProjects: Array.isArray(t.homeProjects) ? t.homeProjects : [],
  };
}

function resolveDateRange(params) {
  const { periodType, quarter, year, startDate, endDate } = params;
  if (periodType === 'quarter' && quarter) {
    const [y, q] = String(quarter).split('-Q');
    const yy = parseInt(y, 10);
    const qq = parseInt(q, 10);
    if (isNaN(yy) || isNaN(qq) || qq < 1 || qq > 4) {
      const err = new Error('Invalid time value'); err.statusCode = 400; throw err;
    }
    const startMonth = (qq - 1) * 3;
    const start = new Date(Date.UTC(yy, startMonth, 1));
    const end = new Date(Date.UTC(yy, startMonth + 3, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (periodType === 'year' && year) {
    const yy = parseInt(year, 10);
    if (isNaN(yy)) {
      const err = new Error('Invalid time value'); err.statusCode = 400; throw err;
    }
    return { start: `${yy}-01-01`, end: `${yy}-12-31` };
  }
  if (periodType === 'custom' && startDate && endDate) {
    return { start: startDate, end: endDate };
  }
  const err = new Error('Invalid time value'); err.statusCode = 400; throw err;
}

async function fetchIssues(jql, token, maxTotal = 2000) {
  const jira = await getJira(token);
  const issues = [];
  let startAt = 0;
  const pageSize = 100;
  while (issues.length < maxTotal) {
    const res = await jira.get('/rest/api/2/search', {
      params: { jql, fields: 'key,summary,issuetype,status,priority,assignee,created,updated,resolved,storyPoints,fixVersions,components,labels,project', startAt, maxResults: pageSize },
      timeout: 30000,
    });
    const batch = (res && res.data && res.data.issues) || [];
    issues.push(...batch);
    if (batch.length < pageSize) break;
    startAt += pageSize;
    if (res && res.data && res.data.total && issues.length >= res.data.total) break;
  }
  return issues.slice(0, maxTotal);
}

async function fetchCompanionIssues(companions, dateRange, token, mode, includeSubtasks, maxTotal = 2000) {
  if (!Array.isArray(companions) || companions.length === 0) return [];
  const keys = companions.map(c => c.projectKey || c).filter(Boolean);
  if (keys.length === 0) return [];
  const projectClause = keys.length === 1 ? `project = ${keys[0]}` : `project in (${keys.join(', ')})`;
  const subtaskClause = includeSubtasks ? '' : ' AND issuetype not in (Sub-task)';
  let jql = '';
  if (mode === 'closed') {
    jql = `${projectClause} AND statusCategory = Done AND resolved >= "${dateRange.start}" AND resolved <= "${dateRange.end}"${subtaskClause} ORDER BY resolved DESC`;
  } else if (mode === 'touched') {
    jql = `${projectClause} AND ((updated >= "${dateRange.start}" AND updated <= "${dateRange.end}") OR (statusCategory = Done AND resolved >= "${dateRange.start}" AND resolved <= "${dateRange.end}"))${subtaskClause} ORDER BY updated DESC`;
  } else if (mode === 'worklogged') {
    jql = `${projectClause} AND worklogDate >= "${dateRange.start}" AND worklogDate <= "${dateRange.end}"${subtaskClause} ORDER BY updated DESC`;
  } else {
    jql = `${projectClause} AND statusCategory = Done AND resolved >= "${dateRange.start}" AND resolved <= "${dateRange.end}"${subtaskClause} ORDER BY resolved DESC`;
  }
  const issues = await fetchIssues(jql, token, maxTotal);
  for (const issue of issues) {
    const pk = issue.fields && issue.fields.project && issue.fields.project.key;
    issue._sourceProject = pk || 'unknown';
  }
  return issues;
}

function aggregate(issues, groupBy) {
  const groups = {};
  let totalStoryPoints = 0;
  let totalCycleDays = 0;
  let cycleCount = 0;
  const byStatus = {};
  for (const issue of issues) {
    const f = issue.fields || {};
    const key = f[groupBy] || (f.issuetype && f.issuetype.name) || 'Unknown';
    const groupKey = typeof key === 'object' ? (key.name || key.displayName || key.value || 'Unknown') : String(key);
    if (!groups[groupKey]) {
      groups[groupKey] = { key: groupKey, label: groupKey, count: 0, storyPoints: 0, cycleDays: 0, cycleCount: 0 };
    }
    groups[groupKey].count++;
    const sp = f.storyPoints || f.customfield_10016 || f.customfield_10026;
    if (sp != null) {
      const num = parseFloat(sp);
      if (!isNaN(num)) {
        groups[groupKey].storyPoints += num;
        totalStoryPoints += num;
      }
    }
    const status = f.status && f.status.name;
    if (status) {
      byStatus[status] = (byStatus[status] || 0) + 1;
    }
    if (f.created && f.resolved) {
      const created = new Date(f.created);
      const resolved = new Date(f.resolved);
      const days = (resolved - created) / (1000 * 60 * 60 * 24);
      if (days >= 0) {
        groups[groupKey].cycleDays += days;
        groups[groupKey].cycleCount++;
        totalCycleDays += days;
        cycleCount++;
      }
    }
  }
  const total = issues.length;
  const groupArray = Object.values(groups).map(g => ({
    key: g.key,
    label: g.label,
    count: g.count,
    percentage: total > 0 ? Math.round((g.count / total) * 100) : 0,
    storyPoints: g.storyPoints,
    issues: [],
    avgCycleTimeDays: g.cycleCount > 0 ? Math.round(g.cycleDays / g.cycleCount) : null,
  })).sort((a, b) => b.count - a.count);
  return {
    groups: groupArray,
    totalGroups: groupArray.length,
    totalStoryPoints,
    byStatus,
    avgCycleTimeDays: cycleCount > 0 ? Math.round(totalCycleDays / cycleCount) : null,
  };
}

async function generate(input, token) {
  const team = getTeamConfig(input.teamId);
  if (!team) {
    const err = new Error(`Team not found: ${input.teamId}`);
    err.statusCode = 400;
    throw err;
  }
  const baseFilter = team.baseFilter || '';
  const jqlBuilder = await getJqlBuilder();
  const reportBaseFilter = jqlBuilder.stripDoneFromBaseFilter(baseFilter);
  const dateRange = resolveDateRange(input);
  const mode = input.inclusionMode || 'closed';
  const key = cacheKeyFor(input);

  if (!input.forceRefresh) {
    const cached = getCached(key);
    if (cached) {
      const dto = cloneDto(cached);
      if (dto.meta) dto.meta.isCached = true;
      if (input.username && dto.meta) dto.meta.generatedBy = input.username;
      return dto;
    }
  }

  const jqlResult = jqlBuilder.buildTimeWindowJql({ baseFilter: reportBaseFilter, startDate: dateRange.start, endDate: dateRange.end, includeSubtasks: input.includeSubtasks || false }, mode);
  const jql = (jqlResult && jqlResult.jql) || '';
  const primaryIssues = await fetchIssues(jql, token, 2000);

  const includeCompanions = input.includeCompanions !== false && input.multiProject !== false;
  let companionIssues = [];
  if (includeCompanions && Array.isArray(team.companionDisciplines) && team.companionDisciplines.length > 0) {
    companionIssues = await fetchCompanionIssues(team.companionDisciplines, dateRange, token, mode, input.includeSubtasks || false, 2000);
  }

  const allIssues = [...primaryIssues, ...companionIssues];
  for (const issue of primaryIssues) {
    if (!issue._sourceProject) {
      const pk = issue.fields && issue.fields.project && issue.fields.project.key;
      issue._sourceProject = pk || team.id;
    }
  }

  const agg = aggregate(allIssues, input.groupBy || 'issuetype');
  const totalIssues = allIssues.length;
  const throughputPerWeek = totalIssues > 0 ? Math.round((totalIssues / 7) * 100) / 100 : 0;
  const dto = {
    meta: {
      teamId: input.teamId,
      teamDisplayName: team.displayName || team.name || team.id,
      baseFilter,
      jqlExecuted: jql,
      period: { type: input.periodType, label: `${input.periodType} ${dateRange.start} to ${dateRange.end}`, start: dateRange.start, end: dateRange.end },
      inclusionMode: mode,
      groupBy: input.groupBy || 'issuetype',
      generatedAt: new Date().toISOString(),
      generatedBy: input.username || 'unknown',
      issueCount: totalIssues,
      isCached: false,
      jiraBaseUrl: 'https://jira.nutanix.com',
      companionProjects: (team.companionDisciplines || []).map(d => d.projectKey || d),
      primaryIssueCount: primaryIssues.length,
      companionIssueCount: companionIssues.length,
      multiProjectEnabled: includeCompanions,
    },
    kpis: {
      totalIssues,
      totalStoryPoints: agg.totalStoryPoints,
      byStatus: agg.byStatus,
      avgCycleTimeDays: agg.avgCycleTimeDays,
      throughputPerWeek,
    },
    aggregation: {
      groups: agg.groups,
      totalGroups: agg.totalGroups,
    },
    timeline: {
      buckets: [],
    },
    issuesSample: allIssues.slice(0, 100).map(issue => ({
      key: issue.key,
      summary: issue.fields?.summary || '',
      issuetype: issue.fields?.issuetype?.name || 'Unknown',
      status: issue.fields?.status?.name || 'Unknown',
      priority: issue.fields?.priority?.name || 'Unknown',
      assignee: issue.fields?.assignee?.displayName || null,
      created: issue.fields?.created || '',
      updated: issue.fields?.updated || '',
      resolved: issue.fields?.resolved || null,
      storyPoints: issue.fields?.storyPoints || issue.fields?.customfield_10016 || issue.fields?.customfield_10026 || null,
      fixVersion: (issue.fields?.fixVersions || []).map(v => v.name),
      integratedVersion: (issue.fields?.customfield_11360 || []).map(v => v.name || v),
      parentKey: issue.fields?.parent?.key || null,
      url: `https://jira.nutanix.com/browse/${issue.key}`,
      sourceProject: issue._sourceProject || null,
    })),
  };
  if (input.summarizeWithNAI !== false) {
    dto.naiSummaries = [];
  }
  setCached(key, dto);
  return dto;
}

const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map();

function cacheKeyFor(input) {
  const keyObj = {
    teamId: input.teamId,
    periodType: input.periodType,
    quarter: input.quarter,
    year: input.year,
    startDate: input.startDate,
    endDate: input.endDate,
    inclusionMode: input.inclusionMode,
    groupBy: input.groupBy,
    includeSubtasks: input.includeSubtasks,
    summarizeWithNAI: input.summarizeWithNAI,
    includeCompanions: input.includeCompanions,
    multiProject: input.multiProject,
  };
  return JSON.stringify(keyObj);
}

function getCached(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    _cache.delete(key);
    return null;
  }
  return entry.value;
}

function setCached(key, value) {
  _cache.set(key, { value, expires: Date.now() + CACHE_TTL_MS });
}

function invalidateCache(key) {
  if (key) _cache.delete(key);
  else _cache.clear();
}

function clearCache() {
  _cache.clear();
}

function cloneDto(dto) {
  return JSON.parse(JSON.stringify(dto));
}

module.exports = {
  generate,
  resolveDateRange,
  getTeamConfig,
  aggregate,
  fetchIssues,
  fetchCompanionIssues,
  invalidateCache,
  clearCache,
  getCached,
  setCached,
  _cache,
  cacheKeyFor,
  CACHE_TTL_MS,
  getJqlBuilder,
};