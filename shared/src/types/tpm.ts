/**
 * TPM agent types — shared contracts for all 6 lighthouse skills.
 *
 * D16 orchestrator-workers, D44 tenancy (lighthouse product pack).
 * These types are product-agnostic (D1) and citation-first (D10).
 * No hard-coded project keys — team context arrives via TpmScope.
 */

export type TpmScopeKind = 'release' | 'sprint' | 'team' | 'overall';

export interface TpmScope {
  /** Scope discriminator */
  kind: TpmScopeKind;
  /** Release version e.g. "NDB-2.12" — required when kind === 'release' */
  releaseVersion?: string;
  /** Team identifier from teamBoardConfig / kpiConfig (lowercased) */
  teamId?: string;
  /** Product identifier — defaults to env.defaultProductId when omitted (D1) */
  productId?: string;
  /** Optional sprint id for sprint-scoped fetches */
  sprintId?: string | number;
}

export type TpmPhaseSkillId =
  | 'tpm-post-release'
  | 'tpm-execution'
  | 'tpm-release'
  | 'tpm-overall';

export type TpmReportMode = 'weekly' | 'exec' | 'tpm-report';

export const TPM_PHASE_SKILLS: readonly TpmPhaseSkillId[] = [
  'tpm-post-release',
  'tpm-execution',
  'tpm-release',
  'tpm-overall',
] as const;

export const TPM_SCHEDULABLE_SKILLS: readonly TpmPhaseSkillId[] = [
  'tpm-post-release',
  'tpm-execution',
  'tpm-release',
  'tpm-overall',
] as const;

export type TpmLifecyclePhase = 'postRelease' | 'execution' | 'release' | 'overall';

/** Single KPI definition as stored in kpiConfig.json — extended with lifecyclePhase */
export interface TpmKpiConfig {
  id: string;
  name: string;
  baseQuery: string;
  displayType?: string;
  order?: number;
  /** Lifecycle phase tag — drives generic phase fetch (no code change to add a KPI) */
  lifecyclePhase?: TpmLifecyclePhase;
  /** Optional explicit JQL override; when absent baseQuery is used */
  jqlOverride?: string;
}

export interface TpmKpiResult {
  kpiId: string;
  kpiName: string;
  /** JQL executed (after release scoping + normalisation) */
  jql: string;
  /** JIRA count (maxResults=0 total) */
  count: number;
  /** Verifiable JIRA browse URL */
  jiraUrl: string;
  /** ISO-8601 timestamp of the JIRA call */
  capturedAt: string;
  /** Warnings e.g. type= normalised */
  warnings?: string[];
  /** Error when JQL execution failed — keeps partial results usable */
  error?: string;
}

export interface TpmFetchResult {
  skillId: TpmPhaseSkillId;
  lifecyclePhase: TpmLifecyclePhase;
  scope: TpmScope;
  /** ISO-8601 when fetch started */
  asOf: string;
  /** One entry per KPI matching the phase tag (order = kpiConfig order) */
  kpis: TpmKpiResult[];
  /** Total KPIs matching phase (for drift detection) */
  totalKpis: number;
  /** JIRA base URL used for links */
  jiraBaseUrl: string;
}

export interface TpmFetchOptions {
  scope: TpmScope;
  /** Override timeout per JQL (ms) */
  timeoutMs?: number;
}
