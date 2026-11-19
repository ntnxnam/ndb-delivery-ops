/**
 * TPM shared types — single source for all 6 weaves.
 * D1 product-agnostic: teamId/orgId/releaseVersion are opaque strings.
 * Fetch is read-only; only tpm-report sends (D26).
 */

export type RoleLens = 'ic' | 'team_lead' | 'rm' | 'tpm' | 'director' | 'srdir_vp';

export type TpmScope =
  | { kind: 'me'; teamId: string; principal: string }
  | { kind: 'release'; releaseVersion: string; teamId: string }
  | { kind: 'team'; teamId: string }
  | { kind: 'org'; orgId: string; teamIds: string[] };

export type TpmFetchInput = {
  scope: TpmScope;
  jqlExtra?: string | null;
};

export type TpmFetchResult = {
  skill: string;
  scope: TpmScope;
  totals: { total: number; open: number; done: number; overdue?: number; pastDue?: number };
  byAssignee?: { assignee: string; count: number; overdue?: number }[];
  hygieneBreakdown?: { type: string; count: number }[];
  trend?: { weekDelta: number };
  links: { jiraSearchUrl: string; combinedJql: string };
  cited: { jql: string; ts: string }[];
  rag?: 'green' | 'amber' | 'red';
  warnings?: string[];
  /** Per-KPI breakdown when lifecyclePhase yields multiple KPIs */
  kpiBreakdown?: { kpiId: string; kpiName: string; total: number; open: number; done: number; jql: string }[];
};

export type TpmReportMode = 'my-focus' | 'release' | 'digest' | 'rollup';

export type TpmKpiConfig = {
  id: string;
  name: string;
  baseQuery: string;
  jqlOverride?: string;
  lifecyclePhase: string;
};

export type TpmKpiResult = {
  kpiId: string;
  kpiName: string;
  jql: string;
  count: number;
  jiraUrl: string;
  capturedAt: string;
  warnings?: string[];
  error?: string;
};

export type TpmLifecyclePhase = 'postRelease' | 'execution' | 'atRelease' | 'overall' | string;
export type TpmPhaseSkillId = 'tpm-post-release' | 'tpm-execution' | 'tpm-at-release' | 'tpm-overall' | string;

export type TpmSchedule = {
  id: string;
  skill: 'tpm-post-release' | 'tpm-execution' | 'tpm-at-release' | 'tpm-overall' | 'tpm-report';
  mode?: TpmReportMode;
  scope: TpmScope;
  cron: string;
  tz: string;
  enabled: boolean;
  recipientsPolicy: { to: 'assignee-or-qa'; cc: 'manager'; overrides?: string[] };
  deferralRule: { startAfter: 'promotionGate'; releaseVersionRef: 'live' };
  lastRun?: string;
  nextRun?: string;
  createdBy?: string;
};

export const TPM_PHASE_SKILLS = [
  'tpm-post-release',
  'tpm-execution',
  'tpm-at-release',
  'tpm-overall',
] as const;

export const TPM_SCHEDULABLE_SKILLS = [...TPM_PHASE_SKILLS, 'tpm-report'] as const;
