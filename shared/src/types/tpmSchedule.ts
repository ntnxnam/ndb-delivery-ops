/**
 * TPM Schedule types — Skill 6 of 6 (tpm-schedule).
 */

export const TPM_PHASE_SKILLS = [
  'tpm-execution-fetch',
  'tpm-at-release-fetch',
  'tpm-post-release-fetch',
  'tpm-report-compose',
  'tpm-schedule',
] as const;

export type TpmPhaseSkill = (typeof TPM_PHASE_SKILLS)[number];

export const TPM_SCHEDULABLE_SKILLS: TpmPhaseSkill[] = [
  'tpm-execution-fetch',
  'tpm-at-release-fetch',
  'tpm-post-release-fetch',
  'tpm-report-compose',
];

export interface TpmScope {
  productId: string;
  release: string;
  teamId?: string;
}

export interface TpmScheduleRecurrence {
  cron?: string;
  dayOfWeek?: number;
  hour?: number;
  minute?: number;
  tz?: string;
}

export interface TpmSchedule {
  id: string;
  name: string;
  skill: TpmPhaseSkill;
  tpmScope: TpmScope;
  schedule: TpmScheduleRecurrence;
  tz: string;
  enabled: boolean;
  deferAfterPg?: boolean;
  to: string;
  cc?: string;
  createdBy: string;
  createdAt: string;
  lastRun?: string | null;
  nextRun?: string | null;
  lastStatus?: 'success' | 'error' | 'skipped';
  lastError?: string;
}
