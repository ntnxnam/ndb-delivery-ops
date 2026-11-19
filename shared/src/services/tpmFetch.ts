/**
 * tpmFetch — generic KPI fetch by lifecyclePhase (D1, D3, D10).
 *
 * Every phase skill (postRelease / execution / release / overall) is a
 * thin wrapper that calls this with its phase string. No phase owns
 * its own JQL builder; the mapping lives in kpiConfig.json.
 *
 * Flow:
 *   1. Load kpiConfig teams[teamId], filter by lifecyclePhase === phase.
 *   2. For each KPI, build JQL: (<releaseBaseFilter>) AND (<kpiBaseQuery>)
 *      with resolution buckets (open/done) — mirrors kpiService
 *      buildReleaseKpiResolutionJql but without server require() paths.
 *   3. Execute via jiraConnector.searchCount (Bearer PAT — D40).
 *   4. Return TpmFetchResult with cited[] (jql + ts) for every claim.
 */

import type { TpmScope, TpmFetchInput, TpmFetchResult } from '../types/tpm.js';
import { scopeLabel } from './tpmScope.js';
import type { JiraConnector } from '../connectors/jiraConnector.js';

export type KpiConfigEntry = {
  id: string;
  name: string;
  baseQuery: string;
  displayType?: string;
  order?: number;
  lifecyclePhase?: string;
  excludeDeferred?: boolean;
  isSuperImportant?: boolean;
  releaseScoped?: boolean;
};

export type KpiConfig = {
  teams: Record<string, KpiConfigEntry[]>;
};

export type TpmFetchDeps = {
  jiraConnector: Pick<JiraConnector, 'searchCount' | 'get'> & { searchCount: (jql: string) => Promise<number> };
  kpiConfig: KpiConfig;
  jiraBaseUrl: string;
  /** Resolve release base filter — e.g. `filter=NDB-2.12-All`. Defaults to `filter=<version>-All`. */
  getReleaseBaseFilter?: (releaseVersion: string, teamId?: string | null) => string | null;
  skillName: string;
  lifecyclePhase: string;
};

function defaultReleaseBaseFilter(releaseVersion: string): string | null {
  const v = (releaseVersion || '').trim();
  return v ? `filter=${v}-All` : null;
}

function buildKpiJql(
  releaseBaseFilter: string | null,
  kpiBaseQuery: string,
  bucket: 'total' | 'open' | 'done',
  jqlExtra: string | null,
): string {
  const trimmed = kpiBaseQuery.trim();
  // Keep saved-filter refs as-is; otherwise parenthesise and normalise type=
  const kpiPart = /^filter\s*=\s*.+/i.test(trimmed)
    ? trimmed
    : `(${trimmed.replace(/\btype\s*=/gi, 'issuetype=')})`;

  let base = releaseBaseFilter ? `${releaseBaseFilter} and ${kpiPart}` : `(${kpiPart})`;
  if (jqlExtra) base = `(${base}) AND (${jqlExtra})`;

  if (bucket === 'open') return `${base} and status not in (Resolved, Closed)`;
  if (bucket === 'done') return `${base} and status in (Resolved, Closed) and resolution is not EMPTY`;
  return base; // total
}

function jiraSearchUrl(jiraBaseUrl: string, jql: string): string {
  return `${jiraBaseUrl.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

export async function fetchByPhase(
  input: TpmFetchInput,
  deps: TpmFetchDeps,
): Promise<TpmFetchResult> {
  const { scope, jqlExtra } = input;
  const { jiraConnector, kpiConfig, jiraBaseUrl, skillName, lifecyclePhase } = deps;
  const getReleaseBaseFilter = deps.getReleaseBaseFilter ?? defaultReleaseBaseFilter;
  const ts = new Date().toISOString();

  const teamId = scope.kind === 'org'
    ? (scope.teamIds[0] ?? scope.orgId)
    : (scope as { teamId: string }).teamId;

  const allKpis = kpiConfig.teams?.[teamId] ?? kpiConfig.teams?.[teamId.toLowerCase()] ?? [];
  // lifecyclePhase is optional in config — only filter when tag exists;
  // KPIs without a tag are ignored for phase fetches (prevents leaking
  // unclassified KPIs into a phase bucket).
  const phaseKpis = allKpis.filter((k) => k.lifecyclePhase === lifecyclePhase);

  if (phaseKpis.length === 0) {
    return {
      skill: skillName,
      scope,
      totals: { total: 0, open: 0, done: 0 },
      links: { jiraSearchUrl: jiraSearchUrl(jiraBaseUrl, ''), combinedJql: '' },
      cited: [],
      warnings: [`No KPIs tagged lifecyclePhase="${lifecyclePhase}" for team "${teamId}"`],
    };
  }

  const releaseVersion = scope.kind === 'release' ? scope.releaseVersion : null;
  const releaseBaseFilter = releaseVersion ? getReleaseBaseFilter(releaseVersion, teamId) : null;

  const cited: { jql: string; ts: string }[] = [];
  const kpiBreakdown: { kpiId: string; kpiName: string; total: number; open: number; done: number; jql: string }[] = [];
  const warnings: string[] = [];

  let totalsTotal = 0;
  let totalsOpen = 0;
  let totalsDone = 0;

  for (const kpi of phaseKpis) {
    const baseQuery = (kpi.baseQuery || '').trim();
    if (!baseQuery) {
      warnings.push(`KPI ${kpi.id} (${kpi.name}): empty baseQuery — skipped`);
      continue;
    }
    try {
      const totalJql = buildKpiJql(releaseBaseFilter, baseQuery, 'total', jqlExtra ?? null);
      const openJql = buildKpiJql(releaseBaseFilter, baseQuery, 'open', jqlExtra ?? null);
      const doneJql = buildKpiJql(releaseBaseFilter, baseQuery, 'done', jqlExtra ?? null);

      const [total, open, done] = await Promise.all([
        jiraConnector.searchCount(totalJql),
        jiraConnector.searchCount(openJql),
        jiraConnector.searchCount(doneJql),
      ]);

      totalsTotal += total ?? 0;
      totalsOpen += open ?? 0;
      totalsDone += done ?? 0;

      kpiBreakdown.push({ kpiId: kpi.id, kpiName: kpi.name, total: total ?? 0, open: open ?? 0, done: done ?? 0, jql: totalJql });
      cited.push({ jql: totalJql, ts }, { jql: openJql, ts }, { jql: doneJql, ts });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`KPI ${kpi.id} (${kpi.name}): ${msg}`);
    }
  }

  // Combined JQL for the primary link: OR of all phase KPI total JQLs
  const combinedJql = kpiBreakdown.length
    ? kpiBreakdown.map((k) => `(${k.jql})`).join(' OR ')
    : '';

  return {
    skill: skillName,
    scope,
    totals: { total: totalsTotal, open: totalsOpen, done: totalsDone },
    kpiBreakdown,
    links: {
      jiraSearchUrl: combinedJql ? jiraSearchUrl(jiraBaseUrl, combinedJql) : jiraSearchUrl(jiraBaseUrl, ''),
      combinedJql,
    },
    cited,
    warnings: warnings.length ? warnings : undefined,
  };
}

/** Convenience wrapper for the `release` phase — skill name is `tpm-at-release`. */
export function fetchAtRelease(
  input: TpmFetchInput,
  deps: Omit<TpmFetchDeps, 'skillName' | 'lifecyclePhase'>,
): Promise<TpmFetchResult> {
  return fetchByPhase(input, { ...deps, skillName: 'tpm-at-release', lifecyclePhase: 'release' });
}
