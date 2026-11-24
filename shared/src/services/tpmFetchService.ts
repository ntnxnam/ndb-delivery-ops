/**
 * tpmFetchService — generic phase fetch (D1, D10, D40).
 *
 * Reads kpiConfig.json, filters by lifecyclePhase, builds JQL via
 * shared helpers and executes via jiraConnector (Bearer PAT only).
 * No hard-coded KPI names — new KPIs appear automatically when tagged.
 */

import type { JiraConnector } from '../connectors/jiraConnector.js';
import type { Env } from '../connectors/env.js';
import { validateScope } from './tpmScope.js';
import type { TpmScope, TpmFetchResult, TpmKpiResult, TpmLifecyclePhase, TpmPhaseSkillId, TpmKpiConfig } from '../types/tpm.js';

export interface KpiConfigShape {
  teams: Record<string, TpmKpiConfig[]>;
  standardKpis?: TpmKpiConfig[];
}

export interface FetchPhaseOptions {
  lifecyclePhase: TpmLifecyclePhase;
  skillId: TpmPhaseSkillId;
  scope: TpmScope;
  jira: JiraConnector;
  env: Env;
  kpiConfig: KpiConfigShape;
  // timeoutMs reserved — forwarded to searchCount when wired
}

function esc(v: string): string {
  return v.replace(/"/g, '\\"');
}

function normalizeTypeToIssuetype(jql: string): { jql: string; warned: boolean } {
  const next = jql.replace(/\btype\s*=/gi, 'issuetype=');
  return { jql: next, warned: next !== jql };
}

function getTeamKpis(kpiConfig: KpiConfigShape, teamId?: string): TpmKpiConfig[] {
  const teams = kpiConfig.teams || {};
  const standardKpis = (kpiConfig as any).standardKpis as TpmKpiConfig[] | undefined;
  const tid = (teamId || '').toLowerCase();
  // If caller passed raw config without merging, merge here for D1 parity with server
  if (tid && teams[tid]) {
    if (Array.isArray(standardKpis) && standardKpis.length && !teams[tid].some((k) => standardKpis.some((s) => s.id === k.id))) {
      return [...standardKpis, ...teams[tid]];
    }
    return teams[tid];
  }
  if (tid) return Array.isArray(standardKpis) ? [...standardKpis] : [];
  const first = Object.values(teams).find((arr) => Array.isArray(arr) && arr.length > 0);
  if (first) {
    if (Array.isArray(standardKpis) && standardKpis.length && !first.some((k) => standardKpis.some((s) => s.id === k.id))) return [...standardKpis, ...first];
    return first;
  }
  return Array.isArray(standardKpis) ? [...standardKpis] : [];
}

function getReleaseBaseFilter(releaseVersion?: string): string | null {
  if (!releaseVersion) return null;
  const v = releaseVersion.trim();
  if (!v) return null;
  // Product-agnostic default — matches server/utils/jiraRouteHelpers.getDefaultReleaseBaseFilter
  return `filter=${esc(v)}-All`;
}

function buildJiraUrl(jiraBaseUrl: string, jql: string): string {
  return `${jiraBaseUrl.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

/**
 * Build release-scoped KPI JQL.
 * When releaseVersion is present, composes: <releaseBaseFilter> AND (<kpiBaseQuery>) AND status != Closed
 * Otherwise returns normalized KPI baseQuery alone.
 * Mirrors apps/delivery-ops/server/services/kpiService.buildReleaseKpiCombinedJql but
 * without filter-resolution (filter= stays literal for JIRA to resolve).
 */
export function buildTpmKpiJql(releaseVersion: string | undefined, kpiBaseQuery: string): { jql: string; warnings: string[] } {
  const warnings: string[] = [];
  const trimmed = (kpiBaseQuery || '').trim();
  if (!trimmed) return { jql: '', warnings };
  const { jql: normalized, warned } = normalizeTypeToIssuetype(trimmed);
  if (warned) warnings.push('Normalized type= to issuetype= in KPI baseQuery');
  const releaseFilter = getReleaseBaseFilter(releaseVersion);
  if (!releaseFilter) return { jql: normalized, warnings };
  // Keep filter= literal — JIRA resolves saved filters server-side
  const kpiPart = /^filter\s*=\s*.+$/i.test(normalized) ? normalized : `(${normalized})`;
  const jql = `${releaseFilter} AND ${kpiPart} AND status != Closed`;
  return { jql, warnings };
}

export function filterKpisByPhase(kpis: TpmKpiConfig[], lifecyclePhase: TpmLifecyclePhase): TpmKpiConfig[] {
  return (kpis || []).filter((k) => k.lifecyclePhase === lifecyclePhase);
}

export async function fetchPhaseKpis(opts: FetchPhaseOptions): Promise<TpmFetchResult> {
  const { lifecyclePhase, skillId, scope, jira, env, kpiConfig } = opts;
  const scopeErr = validateScope(scope);
  if (scopeErr) {
    throw new Error(`Invalid scope: ${scopeErr}`);
  }
  const asOf = new Date().toISOString();
  const jiraBaseUrl = env.jiraBaseUrl;
  const teamId = scope.kind === 'org' ? scope.teamIds[0] ?? scope.orgId : (scope as { teamId: string }).teamId;
  const releaseVersion = scope.kind === 'release' ? scope.releaseVersion : undefined;

  const allKpis = getTeamKpis(kpiConfig, teamId);
  const matching = filterKpisByPhase(allKpis, lifecyclePhase);

  const results = await Promise.all(
    matching.map(async (kpi): Promise<TpmKpiResult> => {
      const rawQuery = kpi.jqlOverride ?? kpi.baseQuery;
      const { jql, warnings } = buildTpmKpiJql(releaseVersion, rawQuery);
      if (!jql) {
        return {
          kpiId: kpi.id,
          kpiName: kpi.name,
          jql: '',
          count: 0,
          jiraUrl: '',
          capturedAt: new Date().toISOString(),
          warnings,
          error: 'Empty JQL — baseQuery missing',
        };
      }
      const jiraUrl = buildJiraUrl(jiraBaseUrl, jql);
      try {
        const capturedAt = new Date().toISOString();
        const count = await jira.searchCount(jql);
        return { kpiId: kpi.id, kpiName: kpi.name, jql, count, jiraUrl, capturedAt, warnings: warnings.length ? warnings : undefined };
      } catch (e: unknown) {
        const errMsg = e instanceof Error ? e.message : String(e);
        return { kpiId: kpi.id, kpiName: kpi.name, jql, count: 0, jiraUrl, capturedAt: new Date().toISOString(), warnings: warnings.length ? warnings : undefined, error: errMsg };
      }
    }),
  );

  return {
    skillId,
    lifecyclePhase,
    scope,
    asOf,
    kpis: results,
    totalKpis: matching.length,
    jiraBaseUrl,
  } as unknown as TpmFetchResult;
}

// Convenience for postRelease
export function fetchPostReleaseKpis(opts: Omit<FetchPhaseOptions, 'lifecyclePhase' | 'skillId'>): Promise<TpmFetchResult> {
  return fetchPhaseKpis({ ...opts, lifecyclePhase: 'postRelease', skillId: 'tpm-post-release' });
}
