/**
 * Shared report types for past-release and team-overall reports.
 * Product-agnostic (D1): no hardcoded product/version strings.
 */

export type PeriodType = 'quarter' | 'year' | 'custom';
export type InclusionMode = 'closed' | 'touched' | 'worklogged';
export type GroupBy = 'issuetype' | 'status' | 'priority' | 'assignee' | 'project';

export interface JqlBuilderParams {
  /** Team base filter as stored in teamBoardConfig.json (e.g. 'filter=NDB-All-Base-Filter') */
  baseFilter: string;
  /** ISO date YYYY-MM-DD inclusive start */
  startDate: string;
  /** ISO date YYYY-MM-DD inclusive end */
  endDate: string;
  /** Whether to include sub-tasks */
  includeSubtasks?: boolean;
  /** For release-scoped JQL */
  releaseVersion?: string;
  /** Label prefix for POR filter (e.g. 'ndb'); defaults to 'ndb' */
  labelPrefix?: string;
  /** KPI base query from kpiConfig.json */
  kpiBaseQuery?: string;
}

export interface JqlBuildResult {
  name: string;
  jql: string;
  params: JqlBuilderParams;
  warnings: string[];
}

export interface TeamOverallReportParams {
  teamId: string;
  periodType: PeriodType;
  startDate: string;
  endDate: string;
  inclusionMode: InclusionMode;
  groupBy: GroupBy;
  includeSubtasks: boolean;
  summarizeWithNAI: boolean;
  forceRefresh: boolean;
}

export interface JiraIssueLite {
  key: string;
  summary: string;
  issuetype: string;
  status: string;
  priority: string;
  assignee: string | null;
  created: string;
  updated: string;
  resolved: string | null;
  storyPoints: number | null;
  fixVersion: string[];
  integratedVersion: string[]; // cf11360
  parentKey: string | null;
  url: string;
}

export interface TeamOverallReportDTO {
  meta: {
    teamId: string;
    teamDisplayName: string;
    baseFilter: string;
    jqlExecuted: string;
    period: { type: PeriodType; label: string; start: string; end: string };
    inclusionMode: InclusionMode;
    groupBy: GroupBy;
    generatedAt: string;
    generatedBy: string;
    issueCount: number;
    isCached: boolean;
  };
  kpis: {
    totalIssues: number;
    totalStoryPoints: number;
    byStatus: Record<string, number>;
    avgCycleTimeDays: number | null;
    throughputPerWeek: number;
  };
  aggregation: {
    groups: Array<{
      key: string;
      label: string;
      count: number;
      percentage: number;
      storyPoints: number;
      issues: JiraIssueLite[];
      avgCycleTimeDays: number | null;
    }>;
    totalGroups: number;
  };
  timeline: {
    buckets: Array<{ date: string; closedCount: number; createdCount: number }>;
  };
  naiSummaries?: Array<{
    groupKey: string;
    summary: string;
    themes: string[];
    model: string;
  }>;
  issuesSample: JiraIssueLite[];
}