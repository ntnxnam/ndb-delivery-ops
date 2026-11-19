/**
 * tpmExecutionService — execution-phase fetch for TPM Agent (Skill 2 of 6).
 *
 * Wraps tpmKpiService with phase='execution'. Fetches every KPI tagged
 * `lifecyclePhase: execution` for the given scope:
 *   - P0 (priority Blocker - P0) / P1 (Critical - P1) — any open dev/test work
 *   - E-W projects (labels ndb-ew/global-ew/nutanix-ew) — releaseScoped via releaseBaseFilter (D36)
 *   - Any future KPI tagged that phase — zero code change to include
 *
 * Product-agnostic (D1): teamId/releaseVersion are opaque strings, no hard-coded
 * project keys. JIRA reads via jiraConnector Bearer PAT only (D40). Every count
 * cites its JQL + timestamp (D10).
 */

import type { TpmScope, TpmFetchResult } from '../types/tpm.js';
import type { JiraConnector } from '../connectors/jiraConnector.js';
import type { Env } from '../connectors/env.js';
import {
  fetchKpisForPhase,
  type KpiTeamsMap,
  type TeamBoardConfig,
  type KpiFetchDetail,
} from './tpmKpiService.js';

export const TPM_EXECUTION_PHASE = 'execution' as const;

export interface FetchExecutionOptions {
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

export interface FetchExecutionReturn {
  details: KpiFetchDetail[];
  result: TpmFetchResult;
}

/**
 * Fetch all execution-phase KPIs for the given scope.
 *
 * Generic: filters kpiConfig by lifecyclePhase === 'execution' — adding a new
 * KPI with that tag auto-includes it on the next fetch without code change.
 * E-W and any releaseScoped KPI uses releaseBaseFilter when scope is release.
 */
export async function fetchExecutionKpis(
  opts: FetchExecutionOptions,
): Promise<FetchExecutionReturn> {
  return fetchKpisForPhase({
    phase: TPM_EXECUTION_PHASE,
    scope: opts.scope,
    jiraConnector: opts.jiraConnector,
    env: opts.env,
    jqlExtra: opts.jqlExtra ?? null,
    kpiConfig: opts.kpiConfig,
    teamConfig: opts.teamConfig,
    kpiConfigPath: opts.kpiConfigPath,
    teamConfigPath: opts.teamConfigPath,
    columnsConfig: opts.columnsConfig,
  });
}

// Re-export generic helpers for consumers that need phase-parametric access
export { fetchKpisForPhase } from './tpmKpiService.js';
export type { KpiFetchDetail, KpiEntry, KpiTeamsMap, TeamBoardConfig } from './tpmKpiService.js';
