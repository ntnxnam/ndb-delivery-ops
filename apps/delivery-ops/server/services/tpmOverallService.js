/**
 * tpmOverallService — generic fetch for lifecyclePhase === 'overall'
 * SLA, CVE, deferral and any future KPI tagged that phase.
 * D1 product-agnostic: teamId/releaseVersion are opaque, no hard-coded project keys.
 * D40 Bearer PAT only via kpiService → jiraConnector.
 * D10 citation-first: every count cites JQL + timestamp.
 */
const { JIRA_API_V2 } = require('../config/api');
const { loadKpiConfigSync, getKpisForTeam } = require('../utils/teamConfig');
const kpiService = require('./kpiService');

function scopeTeamId(scope) {
  if (!scope) return null;
  if (scope.kind === 'org') return null;
  return scope.teamId || null;
}

function buildJiraSearchUrl(jql) {
  const base = (JIRA_API_V2 && JIRA_API_V2.BASE_URL) || process.env.JIRA_BASE_URL || 'https://jira.nutanix.com';
  return `${base.replace(/\/$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

async function getOverallKpis({ scope, token, jqlExtra = null }) {
  const teamId = scopeTeamId(scope);
  if (!teamId) {
    // org scope without single team — no single team KPIs to filter; return empty with warning
    return {
      skill: 'tpm-overall',
      scope,
      totals: { total: 0, open: 0, done: 0 },
      links: { jiraSearchUrl: buildJiraSearchUrl(''), combinedJql: '' },
      cited: [],
      warnings: ['Org scope requires team-level fan-out via tpm-report; no direct overall KPIs'],
    };
  }

  const teams = loadKpiConfigSync();
  const { kpis, normalizedTeamId } = getKpisForTeam(teams, teamId);
  if (!kpis) {
    return {
      skill: 'tpm-overall',
      scope,
      totals: { total: 0, open: 0, done: 0 },
      links: { jiraSearchUrl: buildJiraSearchUrl(''), combinedJql: '' },
      cited: [],
      warnings: [`No KPIs configured for team ${teamId}`],
    };
  }

  const overallKpis = kpis.filter((k) => k.lifecyclePhase === 'overall');
  if (overallKpis.length === 0) {
    return {
      skill: 'tpm-overall',
      scope,
      totals: { total: 0, open: 0, done: 0 },
      links: { jiraSearchUrl: buildJiraSearchUrl(''), combinedJql: '' },
      cited: [],
      warnings: [`No KPIs tagged overall for team ${teamId}`],
    };
  }

  const isRelease = scope && scope.kind === 'release' && scope.releaseVersion;
  const Cited = [];
  const warnings = [];
  let totalSum = 0;
  let openSum = 0;
  let combinedJqls = [];

  for (const kpi of overallKpis) {
    const baseQuery = (kpi.baseQuery || '').trim();
    if (!baseQuery) {
      warnings.push(`KPI ${kpi.id} skipped: empty baseQuery`);
      continue;
    }
    let jql;
    try {
      if (isRelease) {
        jql = await kpiService.buildReleaseKpiCombinedJql(scope.releaseVersion, baseQuery, token, null, normalizedTeamId);
        if (!jql) {
          warnings.push(`KPI ${kpi.id} skipped: could not build JQL`);
          continue;
        }
        const extra = (jqlExtra || '').trim();
        if (extra) jql = `(${jql}) AND (${extra})`;
        if (kpi.excludeDeferred) jql = kpiService.appendDeferredExclusion(jql, scope.releaseVersion);
      } else {
        jql = await kpiService.buildKpiCombinedJql(normalizedTeamId, baseQuery, token, null);
        if (!jql) {
          warnings.push(`KPI ${kpi.id} skipped: could not build JQL`);
          continue;
        }
        const extra = (jqlExtra || '').trim();
        if (extra) jql = `(${jql}) AND (${extra})`;
      }
    } catch (e) {
      warnings.push(`KPI ${kpi.id} skipped: ${e.message || 'JQL build failed'}`);
      continue;
    }
    combinedJqls.push(jql);
    try {
      const res = await kpiService.executeKpiQuery({ token, jql, displayType: kpi.displayType === 'list' ? 'list' : 'count' });
      const cnt = res.total != null ? res.total : 0;
      totalSum += cnt;
      openSum += cnt;
      const ts = new Date().toISOString();
      Cited.push({ jql, ts });
    } catch (e) {
      warnings.push(`KPI ${kpi.id} query failed: ${e.message || 'unknown'}`);
    }
  }

  const combinedJql = combinedJqls.join(' OR ');
  const result = {
    skill: 'tpm-overall',
    scope,
    totals: { total: totalSum, open: openSum, done: 0 },
    links: {
      jiraSearchUrl: combinedJql ? buildJiraSearchUrl(combinedJql) : buildJiraSearchUrl(''),
      combinedJql,
    },
    cited: Cited,
  };
  if (warnings.length) result.warnings = warnings;
  return result;
}

module.exports = { getOverallKpis, scopeTeamId };
