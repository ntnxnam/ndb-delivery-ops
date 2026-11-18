/**
 * jqlBuilder — app-wide, product-agnostic JQL construction (D1, D3, D10).
 *
 * Single source of truth for every JQL string used by reports, KPIs, Gantt,
 * and MCP tools. No hardcoded product/version strings; all team/version/field
 * references come from config or caller params.
 *
 * Consumers: lighthouse/app routes, lighthouse/mcp tools, agent-pack skills.
 */

import { JqlBuilderParams, JqlBuildResult } from '../types/reports.js';

const DEFAULT_LABEL_PREFIX = 'ndb';

function esc(v: string): string {  return v.replace(/"/g, '\\"');
}

function warn(params: JqlBuilderParams, msg: string, out: JqlBuildResult): void {
  out.warnings.push(msg);
}

/** Strip `statusCategory!=Done` / `statusCategory != Done` / `statusCategory not in (Done)` from a base filter for report use. */
export function stripDoneFromBaseFilter(baseFilter: string): string {
  let out = baseFilter.replace(/\s*AND\s+statusCategory\s*!=\s*Done\b/gi, '');
  out = out.replace(/\s*AND\s+statusCategory\s+not\s+in\s*\(\s*Done\s*\)/gi, '');
  // collapse any double spaces left by mid-filter removal
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}

/** Build JQL for tickets resolved (closed) in a time window. */
export function buildClosedJql(params: JqlBuilderParams): JqlBuildResult {
  const out: JqlBuildResult = { name: 'closed', jql: '', params, warnings: [] };
  const base = params.baseFilter || '';
  const start = params.startDate;
  const end = params.endDate;
  const subtaskClause = params.includeSubtasks ? '' : ' AND issuetype not in (Sub-task)';
  const jql = `(${base}) AND statusCategory = Done AND resolved >= "${esc(start)}" AND resolved <= "${esc(end)}"${subtaskClause} ORDER BY resolved DESC`;
  out.jql = jql;
  return out;
}

/** Build JQL for tickets touched (updated) or closed in a time window. */
export function buildTouchedJql(params: JqlBuilderParams): JqlBuildResult {
  const out: JqlBuildResult = { name: 'touched', jql: '', params, warnings: [] };
  const base = params.baseFilter || '';
  const start = params.startDate;
  const end = params.endDate;
  const subtaskClause = params.includeSubtasks ? '' : ' AND issuetype not in (Sub-task)';
  const jql = `(${base}) AND ((updated >= "${esc(start)}" AND updated <= "${esc(end)}") OR (statusCategory = Done AND resolved >= "${esc(start)}" AND resolved <= "${esc(end)}"))${subtaskClause} ORDER BY updated DESC`;
  out.jql = jql;
  return out;
}

/** Build JQL for tickets with work logged in a time window (requires Tempo/Jira worklog). */
export function buildWorkloggedJql(params: JqlBuilderParams): JqlBuildResult {
  const out: JqlBuildResult = { name: 'worklogged', jql: '', params, warnings: [] };
  const base = params.baseFilter || '';
  const start = params.startDate;
  const end = params.endDate;
  const subtaskClause = params.includeSubtasks ? '' : ' AND issuetype not in (Sub-task)';
  const jql = `(${base}) AND worklogDate >= "${esc(start)}" AND worklogDate <= "${esc(end)}"${subtaskClause} ORDER BY updated DESC`;
  out.jql = jql;
  return out;
}

/** Build JQL for all issues in a time window based on inclusion mode. */
export function buildTimeWindowJql(params: JqlBuilderParams, mode: 'closed' | 'touched' | 'worklogged'): JqlBuildResult {
  switch (mode) {
    case 'closed':
      return buildClosedJql(params);
    case 'touched':
      return buildTouchedJql(params);
    case 'worklogged':
      return buildWorkloggedJql(params);
    default:
      return buildClosedJql(params);
  }
}

/** Build JQL for Feature count for a release. */
export function buildReleaseFeatureJql(releaseVersion: string): JqlBuildResult {
  const out: JqlBuildResult = { name: 'release-feature', jql: '', params: { baseFilter: '', startDate: '', endDate: '', releaseVersion }, warnings: [] };
  const jql = `fixVersion = "${esc(releaseVersion)}" AND issuetype = Feature`;
  out.jql = jql;
  return out;
}

/** Build JQL for Initiative count for a release. */
export function buildReleaseInitiativeJql(releaseVersion: string): JqlBuildResult {
  const out: JqlBuildResult = { name: 'release-initiative', jql: '', params: { baseFilter: '', startDate: '', endDate: '', releaseVersion }, warnings: [] };
  const jql = `fixVersion = "${esc(releaseVersion)}" AND issuetype = Initiative`;
  out.jql = jql;
  return out;
}

/** Build JQL for commit set (Feature+Initiative, not Cancelled). */
export function buildReleaseCommitJql(releaseVersion: string, labelPrefix = DEFAULT_LABEL_PREFIX): JqlBuildResult {
  const out: JqlBuildResult = { name: 'release-commit', jql: '', params: { baseFilter: '', startDate: '', endDate: '', releaseVersion, labelPrefix }, warnings: [] };
  const jql = `fixVersion = "${esc(releaseVersion)}" AND issuetype in (Feature, Initiative) AND status != Cancelled AND labels not in ("${esc(labelPrefix)}-not-por")`;
  out.jql = jql;
  return out;
}

/** Build JQL for commit set without POR filter. */
export function buildReleaseCommitTotalJql(releaseVersion: string): JqlBuildResult {
  const out: JqlBuildResult = { name: 'release-commit-total', jql: '', params: { baseFilter: '', startDate: '', endDate: '', releaseVersion }, warnings: [] };
  const jql = `fixVersion = "${esc(releaseVersion)}" AND issuetype in (Feature, Initiative) AND status != Cancelled`;
  out.jql = jql;
  return out;
}

/** Build JQL for KPI closed count for a release + KPI baseQuery. */
export function buildKpiClosedJql(releaseVersion: string, kpiBaseQuery: string, labelPrefix = DEFAULT_LABEL_PREFIX): JqlBuildResult {
  const out: JqlBuildResult = { name: 'kpi-closed', jql: '', params: { baseFilter: '', startDate: '', endDate: '', releaseVersion, kpiBaseQuery, labelPrefix }, warnings: [] };
  // Normalize type= -> issuetype=
  const normalized = kpiBaseQuery.replace(/\btype\s*=/gi, 'issuetype=');
  if (normalized !== kpiBaseQuery) {
    out.warnings.push('Normalized type= to issuetype= in KPI baseQuery');
  }
  const jql = `filter="${esc(releaseVersion)}-All" AND (${normalized}) AND status = Closed AND ("Integrated Version" = "${esc(releaseVersion)}" OR fixVersion = "${esc(releaseVersion)}")`;
  out.jql = jql;
  return out;
}

/** Build JQL for NAI feature summary fetch (all Feature/Initiative for a release). */
export function buildFeatureSummaryJql(releaseVersion: string): JqlBuildResult {
  const out: JqlBuildResult = { name: 'feature-summary', jql: '', params: { baseFilter: '', startDate: '', endDate: '', releaseVersion }, warnings: [] };
  const jql = `filter="${esc(releaseVersion)}-All" AND issuetype in (Feature, Initiative) AND ("Integrated Version" = "${esc(releaseVersion)}" OR fixVersion = "${esc(releaseVersion)}")`;
  out.jql = jql;
  return out;
}

/** Build JQL for Feature count for a release (canonical). */
export function buildFeatureCountJql(releaseVersion: string): JqlBuildResult {
  return buildReleaseFeatureJql(releaseVersion);
}

/** Build JQL for Initiative count for a release (canonical). */
export function buildInitiativeCountJql(releaseVersion: string): JqlBuildResult {
  return buildReleaseInitiativeJql(releaseVersion);
}

/** Build multiple JQLs for a team-overall report request. */
export function buildTeamOverallJqls(params: JqlBuilderParams, mode: 'closed' | 'touched' | 'worklogged', includeSubtasks = false): JqlBuildResult[] {
  const results: JqlBuildResult[] = [];
  const base = params.baseFilter || '';
  if (!base) {
    const r: JqlBuildResult = { name: 'error', jql: '', params, warnings: ['baseFilter is required'] };
    return [r];
  }
  const reportBase = stripDoneFromBaseFilter(base);
  const timeParams = { ...params, baseFilter: reportBase, includeSubtasks };
  results.push(buildTimeWindowJql(timeParams, mode));
  return results;
}

export const jqlBuilder = {
  stripDoneFromBaseFilter,
  buildClosedJql,
  buildTouchedJql,
  buildWorkloggedJql,
  buildTimeWindowJql,
  buildReleaseFeatureJql,
  buildReleaseInitiativeJql,
  buildReleaseCommitJql,
  buildReleaseCommitTotalJql,
  buildKpiClosedJql,
  buildFeatureSummaryJql,
  buildFeatureCountJql,
  buildInitiativeCountJql,
  buildTeamOverallJqls,
};

export default jqlBuilder;