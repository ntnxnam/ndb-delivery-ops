/**
 * Team Overall Report Service — Phase 2 backend.
 * Uses shared jqlBuilder for JQL construction (product-agnostic, D1).
 */

const fs = require('fs');
const path = require('path');
const { getJira } = require('../utils/jiraClient');
const { getTeamBaseFilter } = require('../utils/teamConfig');
const { stripDoneFromBaseFilter } = require('../utils/jiraRouteHelpers');

let _sharedPromise = null;
function getShared() {
  if (!_sharedPromise) {
    _sharedPromise = import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

const TEAM_CONFIG_PATH = path.join(__dirname, '../config/teamBoardConfig.json');

function getTeamConfig(teamId) {
  try {
    const cfg = JSON.parse(fs.readFileSync(TEAM_CONFIG_PATH, 'utf8'));
    const teams = Array.isArray(cfg.teams) ? cfg.teams : [];
    return teams.find(t => String(t.id).toLowerCase() === String(teamId).toLowerCase()) || null;
  } catch (e) {
    return null;
  }
}

function resolveDateRange(params) {
  const { periodType, quarter, year, startDate, endDate } = params;
  if (periodType === 'quarter') {
    const [y, q] = String(quarter).split('-Q');
    const yy = parseInt(y, 10);
    const qq = parseInt(q, 10);
    const startMonth = (qq - 1) * 3;
    const start = new Date(yy, startMonth, 1);
    const end = new Date(yy, startMonth + 3, 0);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (periodType === 'year') {
    const yy = parseInt(year, 10);
    return { start: `${yy}-01-01`, end: `${yy}-12-31` };
  }
  return { start: startDate, end: endDate };
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
    const batch = res.data.issues || [];
    issues.push(...batch);
    if (batch.length < pageSize) break;
    startAt += pageSize;
  }
  return issues.slice(0, maxTotal);
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
    const groupKey = typeof key === 'object' ? key.name || key.value || 'Unknown' : String(key);
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
    throw new Error(`Team not found: ${input.teamId}`);
  }
  const baseFilter = team.baseFilter || '';
  const dateRange = resolveDateRange(input);
  const shared = await getShared();
  const { jqlBuilder } = shared;
  const mode = input.inclusionMode || 'closed';
  const jqlResult = jqlBuilder.buildTimeWindowJql({ baseFilter, startDate: dateRange.start, endDate: dateRange.end, includeSubtasks: input.includeSubtasks || false }, mode);
  const jql = jqlResult.jql;
  const issues = await fetchIssues(jql, token, 2000);
  const agg = aggregate(issues, input.groupBy || 'issuetype');
  const totalIssues = issues.length;
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
    issuesSample: issues.slice(0, 100).map(issue => ({
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
    })),
  };
  return dto;
}

module.exports = {
  generate,
  resolveDateRange,
  getTeamConfig,
  aggregate,
};