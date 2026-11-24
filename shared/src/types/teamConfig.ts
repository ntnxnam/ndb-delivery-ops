/**
 * Team config types (product-agnostic, D1, D5).
 * Source of truth: shared/config/teamBoardConfig.json (schema v2).
 * No hardcoded product/team strings — all derived from config.
 */

export type TeamId = string;

export interface TeamSprintCalendar {
  s1StartIso: string;
  sprintDays: number;
}

export interface TeamCompanionDiscipline {
  projectKey: string;
  label: string;
  hardGate: string;
}

export interface TeamNotificationEmails {
  exec: string;
  techLeads: string;
  managers: string;
}

export interface TeamTcmsConfig {
  projectSegment: string;
  baseUrl: string;
}

export interface TeamQaEnvConfig {
  devUrl: string;
  qaUrl?: string;
  prodUrl?: string;
}

export interface TeamBrandingConfig {
  displayName: string;
  shortName?: string;
}

export interface TeamConfig {
  id: TeamId;
  name: string;
  displayName?: string;
  projectKey: string;
  homeProjects: string[];
  baseFilter: string;
  base_jql?: string;
  is_shared_project?: boolean;
  custom_project_key?: string | null;
  components?: string[];
  leader_outlook_dls?: string[];
  contacts?: Record<string, { entries: string[]; isDL: boolean }>;
  releasePrefixes: string[];
  releaseRegexes: string[];
  labelPrefix: string;
  labels: {
    notPor: string;
    ew?: string;
    train?: string;
    [key: string]: string | undefined;
  };
  sprintCalendar: TeamSprintCalendar;
  boardId: number;
  companionDisciplines: TeamCompanionDiscipline[];
  notificationEmails: TeamNotificationEmails;
  tcms: TeamTcmsConfig;
  qaEnv: TeamQaEnvConfig;
  branding: TeamBrandingConfig;
  defaultRelease: string;
  storyPointsField: string;
  featureComponents?: Record<string, string[]>;
  activeVersionNames?: string[];
}

export interface TeamBoardConfig {
  teams: TeamConfig[];
  defaultTeamId: TeamId;
}