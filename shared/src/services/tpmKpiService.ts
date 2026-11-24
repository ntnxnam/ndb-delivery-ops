/**
 * tpmKpiService — generic KPI fetch engine for all TPM phase skills.
 *
 * Reads kpiConfig.json, filters by lifecyclePhase, builds scoped JQL,
 * executes via jiraConnector (Bearer PAT only — D40), and returns
 * citation-ready counts per D10. No hard-coded product strings — D1.
 *
 * Every phase weave (postRelease, execution, release, overall) calls
 * this service with its phase tag. A new KPI tagged with any of those
 * phases is picked up on the next fetch without code change.
 *
 * E-W and any KPI with `releaseScoped: true` uses releaseBaseFilter
 * (fixVersion scoping per D36) when scope.kind === 'release'.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TpmScope, TpmFetchResult } from '../types/tpm.js';
import type { JiraConnector } from '../connectors/jiraConnector.js';
import type { Env } from '../connectors/env.js';

// ---------------------------------------------------------------------------
// Types for kpiConfig.json (mirrors apps/delivery-ops/server/config shape)
// ---------------------------------------------------------------------------

export interface KpiEntry {
  id: string;
  name: string;
  baseQuery: string;
  displayType: string;
  order: number;
  lifecyclePhase?: string;
  isSuperImportant?: boolean;
  releaseScoped?: boolean;
  excludeDeferred?: boolean;
}

export type KpiTeamsMap = Record<string, KpiEntry[]>;

export interface TeamBoardEntry {
  id: string;
  name: string;
  baseFilter?: string;
  releasePrefix?: string;
  [k: string]: unknown;
}

export interface TeamBoardConfig {
  teams: TeamBoardEntry[];
  defaultTeamId?: string | null;
}

// ---------------------------------------------------------------------------
// Config loading — file-system aware, injectable for tests / MCP
// ---------------------------------------------------------------------------

function defaultKpiConfigPath(): string {
  // shared/src/services/ → ../../.. → repo root → apps/delivery-ops/server/config
  const here = dirname(fileURLToPath(import.meta.url));
  // When running from dist, here is dist/services; when from src, it is src/services.
  // Try both relative layouts.
  const candidates = [
    join(here, '..', '..', '..', 'apps', 'delivery-ops', 'server', 'config', 'kpiConfig.json'),
    join(here, '..', '..', 'apps', 'delivery-ops', 'server', 'config', 'kpiConfig.json'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

function defaultTeamConfigPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, '..', '..', '..', 'apps', 'delivery-ops', 'server', 'config', 'teamBoardConfig.json'),
    join(here, '..', '..', 'apps', 'delivery-ops', 'server', 'config', 'teamBoardConfig.json'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0];
}

export function loadKpiConfig(kpiConfigPath?: string): KpiTeamsMap {
  const p = kpiConfigPath ?? defaultKpiConfigPath();
  if (!existsSync(p)) return {};
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as { teams?: Record<string, KpiEntry[]>; standardKpis?: KpiEntry[] };
    if (!parsed.teams || typeof parsed.teams !== 'object') return {};
    const standardKpis = Array.isArray((parsed as any).standardKpis) ? (parsed as any).standardKpis as KpiEntry[] : [];
    const out: KpiTeamsMap = {};
    for (const [tid, arr] of Object.entries(parsed.teams)) {
      const key = tid.trim().toLowerCase();
      const teamKpis = Array.isArray(arr) ? arr : [];
      out[key] = [...standardKpis, ...teamKpis];
    }
    // Backfill board-only teams (e.g. prism-infra with empty KPI array) so they still get standard KPIs
    try {
      const teamRaw = readFileSync(defaultTeamConfigPath(), 'utf8');
      const teamParsed = JSON.parse(teamRaw) as TeamBoardConfig;
      for (const t of teamParsed.teams ?? []) {
        const nid = (t.id || '').trim().toLowerCase();
        if (nid && !out[nid]) out[nid] = [...standardKpis];
      }
    } catch {}
    return out;
  } catch {
    return {};
  }
}

export function loadTeamBoardConfig(teamConfigPath?: string): TeamBoardConfig {
  const p = teamConfigPath ?? defaultTeamConfigPath();
  if (!existsSync(p)) return { teams: [] };
  try {
    const raw = readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw) as TeamBoardConfig;
    return {
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
      defaultTeamId: parsed.defaultTeamId ?? null,
    };
  } catch {
    return { teams: [] };
  }
}

// ---------------------------------------------------------------------------
// KPI filtering — the generic core: any phase tag auto-includes
// ---------------------------------------------------------------------------

export function filterKpisByPhase(kpis: KpiEntry[], phase: string): KpiEntry[] {
  return kpis.filter((k) => k.lifecyclePhase === phase);
}

export function getKpisForTeamAndPhase(
  teamsMap: KpiTeamsMap,
  teamId: string,
  phase: string,
): { kpis: KpiEntry[]; normalizedTeamId: string } {
  const normalizedTeamId = teamId.trim().toLowerCase();
  const all = teamsMap[normalizedTeamId];
  if (!Array.isArray(all)) return { kpis: [], normalizedTeamId };
  const filtered = filterKpisByPhase(all, phase);
  return { kpis: filtered.sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999)), normalizedTeamId };
}

// ---------------------------------------------------------------------------
// JQL helpers — product-agnostic (D1), no hard-coded project keys
// ---------------------------------------------------------------------------

function getTeamBaseFilter(teamConfig: TeamBoardConfig, teamId: string): string | null {
  const nid = teamId.trim().toLowerCase();
  const team = teamConfig.teams.find((t) => t.id.trim().toLowerCase() === nid);
  if (!team || !team.baseFilter) return null;
  const v = String(team.baseFilter).trim();
  return v || null;
}

function getReleasePrefix(teamConfig: TeamBoardConfig, teamId: string): string | null {
  const nid = teamId.trim().toLowerCase();
  const team = teamConfig.teams.find((t) => t.id.trim().toLowerCase() === nid);
  if (!team || !team.releasePrefix) return null;
  const v = String(team.releasePrefix).trim();
  return v || null;
}

/**
 * Release base filter: `filter=<version>-All` convention.
 * Reads releaseVersionsColumnsConfig overrides when available.
 */
function getReleaseBaseFilter(
  teamConfig: TeamBoardConfig,
  releaseVersion: string,
  teamId: string,
  columnsConfig?: Record<string, string>,
): string | null {
  // Check override map first
  if (columnsConfig && columnsConfig[releaseVersion]) {
    const override = String(columnsConfig[releaseVersion]).trim();
    if (override && override !== 'filter=0') return override;
  }
  // Default convention: filter=<version>-All
  const trimmed = releaseVersion.trim();
  if (!trimmed) return null;
  return `filter=${trimmed}-All`;
}

function isFilterQuery(baseQuery: string): boolean {
  return /^filter\s*=/i.test(baseQuery.trim());
}

function normalizeKpiJql(jql: string): string {
  // Do not touch JQL that is a raw filter reference like `filter=123`; its
  // target JQL is opaque and may legitimately contain filter-local syntax.
  if (isFilterQuery(jql)) return jql;
  return jql.replace(/\btype\s*=/gi, 'issuetype=');
}

// ---------------------------------------------------------------------------
// Saved-filter resolution via jiraConnector (D40 — Bearer PAT)
// ---------------------------------------------------------------------------

async function resolveFilterJql(
  jiraConnector: JiraConnector,
  filterRef: string,
): Promise<string | null> {
  const trimmed = filterRef.trim();
  const m = trimmed.match(/^filter\s*=\s*(.+)$/i);
  if (!m) return trimmed;
  const filterVal = m[1].trim();
  // Numeric filter ID — direct JQL fetch
  if (/^\d+$/.test(filterVal)) {
    try {
      const res = await jiraConnector.get<{ jql?: string }>(`/rest/api/2/filter/${filterVal}`);
      if (res.data?.jql) return res.data.jql;
    } catch {
      // fall through to return raw
    }
    return trimmed;
  }
  // Named filter — search by name
  try {
    const searchRes = await jiraConnector.get<{
      values?: Array<{ id: string; name: string; jql?: string }>;
      results?: Array<{ id: string; name: string; jql?: string }>;
    }>(`/rest/api/2/filter/search`, {
      params: { filterName: filterVal, maxResults: 50 },
    });
    const list: Array<{ id: string; name: string; jql?: string }> =
      (searchRes.data as { values?: unknown[] }).values as unknown as Array<{ id: string; name: string; jql?: string }> ??
      (searchRes.data as { results?: unknown[] }).results as unknown as Array<{ id: string; name: string; jql?: string }> ??
      (Array.isArray(searchRes.data) ? (searchRes.data as Array<{ id: string; name: string; jql?: string }>) : []);
    if (Array.isArray(list)) {
      const byName = list.find((f) => f.name && String(f.name).trim() === filterVal);
      if (byName?.jql) return byName.jql;
      const byId = list.find((f) => String(f.id) === filterVal);
      if (byId?.jql) return byId.jql;
      const byNameCi = list.find((f) => f.name && String(f.name).trim().toLowerCase() === filterVal.toLowerCase());
      if (byNameCi?.jql) return byNameCi.jql;
    }
    // Fallback: favourites
    try {
      const favRes = await jiraConnector.get<Array<{ name: string; jql?: string }>>(
        `/rest/api/2/filter/favourite`,
      );
      const favList = Array.isArray(favRes.data) ? favRes.data : [];
      const fromFav = favList.find((f) => f.name && String(f.name).trim() === filterVal);
      if (fromFav?.jql) return fromFav.jql;
    } catch {
      // ignore
    }
  } catch {
    // search endpoint may not exist on all DC versions — return raw
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Scoped JQL builder — D36 release payload vs D1 team base
// ---------------------------------------------------------------------------

export interface BuildJqlOptions {
  scope: TpmScope;
  kpi: KpiEntry;
  teamConfig: TeamBoardConfig;
  jiraConnector: JiraConnector;
  jqlExtra?: string | null;
  columnsConfig?: Record<string, string>;
}

export async function buildScopedJql(opts: BuildJqlOptions): Promise<string | null> {
  const { scope, kpi, teamConfig, jiraConnector, jqlExtra, columnsConfig } = opts;
  const baseQuery = (kpi.baseQuery || '').trim();
  if (!baseQuery) return null;

  // Release scope
  if (scope.kind === 'release') {
    // E-W / releaseScoped KPIs use releaseBaseFilter (fixVersion scoping per D36)
    if (kpi.releaseScoped) {
      const releaseBaseFilter = getReleaseBaseFilter(teamConfig, scope.releaseVersion, scope.teamId, columnsConfig);
      if (!releaseBaseFilter) {
        // No release filter available — resolve KPI JQL bare
        const resolvedRaw = await resolveFilterJql(jiraConnector, baseQuery);
        if (!resolvedRaw) return null;
        const resolved = normalizeKpiJql(resolvedRaw);
        let jql = `(${resolved})`;
        if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
        return `${jql} AND status != Closed`;
      }
      const kpiPart = isFilterQuery(baseQuery) ? `(${baseQuery})` : `(${baseQuery.replace(/\btype\s*=/gi, 'issuetype=')})`;
      let jql = `${releaseBaseFilter.trim()} AND ${kpiPart} AND status != Closed`;
      if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
      return jql;
    }
    // Regular KPIs in release scope: also use releaseBaseFilter for accurate per-release slicing
    const releaseBaseFilter = getReleaseBaseFilter(teamConfig, scope.releaseVersion, scope.teamId, columnsConfig);
    if (releaseBaseFilter) {
      const kpiPart = isFilterQuery(baseQuery) ? `(${baseQuery})` : `(${baseQuery.replace(/\btype\s*=/gi, 'issuetype=')})`;
      let jql = `${releaseBaseFilter.trim()} AND ${kpiPart} AND status != Closed`;
      if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
      return jql;
    }
    // No release filter — fall back to team base
    const teamBaseFilter = getTeamBaseFilter(teamConfig, scope.teamId);
    const resolvedRaw = await resolveFilterJql(jiraConnector, baseQuery);
    if (!resolvedRaw) return null;
    const resolved = normalizeKpiJql(resolvedRaw);
    if (teamBaseFilter) {
      let jql = `(${teamBaseFilter}) AND (${resolved})`;
      if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
      return jql;
    }
    let jql = `(${resolved})`;
    if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
    return jql;
  }

  // Team scope
  if (scope.kind === 'team') {
    const teamBaseFilter = getTeamBaseFilter(teamConfig, scope.teamId);
    const resolvedRaw = await resolveFilterJql(jiraConnector, baseQuery);
    if (!resolvedRaw) return null;
    const resolved = normalizeKpiJql(resolvedRaw);
    if (teamBaseFilter) {
      let jql = `(${teamBaseFilter}) AND (${resolved})`;
      if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
      return jql;
    }
    let jql = `(${resolved})`;
    if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
    return jql;
  }

  // Me scope — team + assignee
  if (scope.kind === 'me') {
    const teamBaseFilter = getTeamBaseFilter(teamConfig, scope.teamId);
    const resolvedRaw = await resolveFilterJql(jiraConnector, baseQuery);
    if (!resolvedRaw) return null;
    const resolved = normalizeKpiJql(resolvedRaw);
    const assigneeClause = `assignee = "${scope.principal}"`;
    if (teamBaseFilter) {
      let jql = `(${teamBaseFilter}) AND (${resolved}) AND ${assigneeClause}`;
      if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
      return jql;
    }
    let jql = `(${resolved}) AND ${assigneeClause}`;
    if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
    return jql;
  }

  // Org scope — fan-out is handled by fetchKpisForPhase (OR across team base filters)
  // For single-JQL callers, return bare KPI JQL with jqlExtra
  if (scope.kind === 'org') {
    const resolvedRaw = await resolveFilterJql(jiraConnector, baseQuery);
    if (!resolvedRaw) return null;
    const resolved = normalizeKpiJql(resolvedRaw);
    let jql = `(${resolved})`;
    if (jqlExtra?.trim()) jql = `(${jql}) AND (${jqlExtra.trim()})`;
    return jql;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main fetch — generic across any lifecyclePhase
// ---------------------------------------------------------------------------

export interface FetchKpisForPhaseOptions {
  phase: string;
  scope: TpmScope;
  jiraConnector: JiraConnector;
  env: Env;
  jqlExtra?: string | null;
  kpiConfig?: KpiTeamsMap;
  teamConfig?: TeamBoardConfig;
  kpiConfigPath?: string;
  teamConfigPath?: string;
  columnsConfig?: Record<string, string>;
}

export interface KpiFetchDetail {
  kpiId: string;
  kpiName: string;
  jql: string;
  count: number;
  error?: string;
}

export async function fetchKpisForPhase(
  opts: FetchKpisForPhaseOptions,
): Promise<{ details: KpiFetchDetail[]; result: TpmFetchResult }> {
  const {
    phase,
    scope,
    jiraConnector,
    env,
    jqlExtra,
    kpiConfigPath,
    teamConfigPath,
    columnsConfig,
  } = opts;

  // Resolve config — injected or from disk
  const teamsMap = opts.kpiConfig ?? loadKpiConfig(kpiConfigPath);
  const teamConfig = opts.teamConfig ?? loadTeamBoardConfig(teamConfigPath);

  // Determine which team(s) to query based on scope kind
  let teamIds: string[] = [];
  if (scope.kind === 'release' || scope.kind === 'team' || scope.kind === 'me') {
    teamIds = [scope.teamId];
  } else if (scope.kind === 'org') {
    teamIds = scope.teamIds;
  }

  const details: KpiFetchDetail[] = [];
  const cited: { jql: string; ts: string }[] = [];
  const allJqls: string[] = [];
  const warnings: string[] = [];
  let totalOpen = 0;
  let totalCount = 0;

  for (const teamId of teamIds) {
    const { kpis } = getKpisForTeamAndPhase(teamsMap, teamId, phase);

    for (const kpi of kpis) {
      try {
        const jql = await buildScopedJql({
          scope: scope.kind === 'org' ? { kind: 'team', teamId } as TpmScope : scope,
          kpi,
          teamConfig,
          jiraConnector,
          jqlExtra: jqlExtra ?? null,
          columnsConfig,
        });
        if (!jql) {
          warnings.push(`Skipped KPI "${kpi.name}" (${kpi.id}): could not build JQL`);
          continue;
        }
        const count = await jiraConnector.searchCount(jql);
        details.push({ kpiId: kpi.id, kpiName: kpi.name, jql, count });
        allJqls.push(jql);
        cited.push({ jql, ts: new Date().toISOString() });
        totalOpen += count;
        totalCount += count;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        warnings.push(`KPI "${kpi.name}" (${kpi.id}): ${msg}`);
        details.push({ kpiId: kpi.id, kpiName: kpi.name, jql: '', count: 0, error: msg });
      }
    }
  }

  // Handle org scope with no teamIds — still try default team
  if (teamIds.length === 0) {
    warnings.push('No team IDs in scope — no KPIs fetched');
  }

  const combinedJql = allJqls.length > 0 ? allJqls.join(' OR ') : '';
  const jiraSearchUrl = combinedJql
    ? `${env.jiraBaseUrl}/issues/?jql=${encodeURIComponent(combinedJql)}`
    : `${env.jiraBaseUrl}/issues/`;

  const result: TpmFetchResult = {
    skill: `tpm-${phase}`,
    scope,
    totals: { total: totalCount, open: totalCount, done: 0 },
    links: { jiraSearchUrl, combinedJql },
    cited,
  };
  if (warnings.length > 0) result.warnings = warnings;
  // Minimal RAG for execution phase: green if no open execution blockers
  if (phase === 'execution') {
    result.rag = totalOpen === 0 ? 'green' : totalOpen <= 5 ? 'amber' : 'red';
  }

  return { details, result };
}
