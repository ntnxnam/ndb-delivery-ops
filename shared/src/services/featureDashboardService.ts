import type { JiraIssue } from '../connectors/jiraConnector.js';

export interface FeatureListItem {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  assignee: string | null;
  /** Feature Code Complete date (ISO day), when fetched for the overview Gantt. */
  ccDate?: string | null;
  /** Feature Commit Gate date (ISO day). */
  cgDate?: string | null;
  /** Feature Promotion Gate date (ISO day). */
  pgDate?: string | null;
  /** Risk Indicator value (Green / Yellow / Red). */
  risk?: string | null;
}

export interface FeatureOverviewGates {
  ec: string | null;
  cc: string | null;
  cg: string | null;
  pg: string | null;
  ga: string | null;
}

export interface FeatureDashboardIssue {
  key: string;
  summary: string;
  issueType: string;
  status: string;
  assignee: string | null;
  created: string | null;
  resolved: string | null;
  updated: string | null;
  priority: string | null;
  labels: string[];
  epicLink: string | null;
}

// Canonical list of JIRA fields to fetch for every feature dashboard issue.
// Add new fields here when adding new widgets — one place, not scattered.
export const FEATURE_DASHBOARD_FIELDS = [
  'summary', 'issuetype', 'status', 'assignee', 'priority',
  'created', 'updated', 'resolutiondate',
  'labels',            // bug-by-phase analytics
  'customfield_20363', // Parent Link — hierarchy grouping (Bug/Task/Story → Epic)
  'issuelinks',
] as const;

export interface FeatureFlowPoint {
  day: string;
  created: number;
  resolved: number;
  open: number;
}

export interface FeatureKpiTile {
  key: string;
  label: string;
  /** Outstanding (open/active) count — drives severity and the primary number shown. */
  count: number;
  /** Total count including closed/done — shown as secondary "of N" when it differs from count. */
  total?: number;
  jql: string;
  /** JQL for the total (all statuses) clickthrough — only set when total differs from count. */
  totalJql?: string;
  severity: 'green' | 'amber' | 'red' | 'grey';
}

export interface StatusUpdateSection {
  id: string;
  title: string;
  value: string;
}

const DONE_STATUSES = new Set(['done', 'resolved', 'closed', 'complete', 'fixed']);
const TEST_TYPES = new Set(['test', 'unit test']);

const STATUS_UPDATE_HEADERS = [
  '1. Requirements',
  '2. UX',
  '3. Tech Design',
  '4. Milestones / Project Plan',
  '5. Test Plan',
  '6. Reach out to DBE',
  '7. Coding',
  '7a. Dev Testing',
  '8. Testing',
  '8a. Manual Testing',
  '8b. Automation',
  '8c. Framework Changes',
  '8d. Integration Testing',
  '8e. System Testing',
  '8f. Longevity & Performance',
  '9. Telemetry',
  '10. FMEA',
  '11. Threat Modelling',
  '12. RBAC',
  '13. Backward Compatibility',
  '14. CPBR (Control Plane Backward/Forward Compatibility Review)',
  '15. APIs Auditing',
  '16. Compliance',
  '16a. ACP',
  '16b. Legal',
  '16c. a11y',
  '16d. TechPubs',
  '16e. Serviceability',
  '17. Security',
  '17a. Security Review',
  '17b. Pen Testing',
  '18. Bug Fixing',
  '19. Commit Gate Readiness',
  '20. Promotion Gate Readiness',
] as const;

export function buildFeatureListJql(release: string): string {
  return `fixVersion = "${release}" AND issuetype in (Feature, Initiative) AND status not in (Cancelled, Backlog) ORDER BY summary ASC`;
}

export function buildCanonicalPayloadJql(featureKey: string): string {
  return `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf(\\"issue = ${featureKey}\\")") OR issueFunction in portfolioChildrenOf("issue = ${featureKey}") OR issue = ${featureKey}`;
}

export function buildFeatIdMentionJql(featureKey: string): string {
  return `cf[40468] ~ "${featureKey}"`;
}

export function buildFeatNumberMentionJql(featureKey: string): string {
  return `cf[14262] = "${featureKey}"`;
}

export function issueFromJira(issue: JiraIssue): FeatureDashboardIssue {
  const fields = issue.fields || {};
  const issueType = ((fields.issuetype as { name?: string } | undefined)?.name || '').trim();
  const status = ((fields.status as { name?: string } | undefined)?.name || '').trim();
  const assignee =
    ((fields.assignee as { displayName?: string } | null | undefined)?.displayName || null);
  return {
    key: issue.key,
    summary: String(fields.summary || ''),
    issueType,
    status,
    assignee,
    created: asIsoDay(fields.created),
    resolved: asIsoDay(fields.resolutiondate),
    updated: asIsoDay(fields.updated),
    priority: ((fields.priority as { name?: string } | undefined)?.name || null),
    labels: Array.isArray(fields.labels) ? (fields.labels as string[]) : [],
    epicLink: typeof fields.customfield_20363 === 'string' ? fields.customfield_20363 : null,
  };
}

export function toFeatureListItem(issue: FeatureDashboardIssue): FeatureListItem {
  return {
    key: issue.key,
    summary: issue.summary,
    issueType: issue.issueType,
    status: issue.status,
    assignee: issue.assignee,
  };
}

export function diffByKey(
  source: FeatureDashboardIssue[],
  minus: FeatureDashboardIssue[]
): FeatureDashboardIssue[] {
  const minusSet = new Set(minus.map((i) => i.key));
  return source.filter((i) => !minusSet.has(i.key));
}

export function buildFlowSeries(
  issues: FeatureDashboardIssue[],
  startIso: string,
  endIso: string
): FeatureFlowPoint[] {
  const timeline: FeatureFlowPoint[] = [];
  let cursor = toDate(startIso);
  const end = toDate(endIso);
  while (cursor <= end) {
    const day = isoDay(cursor);
    const created = issues.filter((i) => i.created === day).length;
    const resolved = issues.filter((i) => i.resolved === day).length;
    const open = issues.filter((i) => (i.created || '') <= day && (!i.resolved || i.resolved > day)).length;
    timeline.push({ day, created, resolved, open });
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000);
  }
  return timeline;
}

export function buildFeatureKpis(
  issues: FeatureDashboardIssue[],
  canonicalJql: string
): FeatureKpiTile[] {
  const addScoped = (extra: string) => `(${canonicalJql}) AND (${extra})`;
  const isOpen = (i: FeatureDashboardIssue) => !DONE_STATUSES.has(i.status.toLowerCase());

  const bugOpen = issues.filter(
    (i) => i.issueType.toLowerCase() === 'bug' && isOpen(i)
  ).length;

  const unassignedOpen = issues.filter((i) => !i.assignee && isOpen(i)).length;
  const unassignedTotal = issues.filter((i) => !i.assignee).length;

  const testCount = issues.filter((i) => TEST_TYPES.has(i.issueType.toLowerCase())).length;
  const qaBacklog = issues.filter(
    (i) => i.issueType.toLowerCase() === 'bug' && i.status.toLowerCase() === 'resolved'
  ).length;
  const stalled14d = issues.filter((i) => {
    if (!i.updated) return false;
    const deltaDays = Math.floor((Date.now() - toDate(i.updated).getTime()) / (24 * 60 * 60 * 1000));
    return deltaDays > 14 && isOpen(i);
  }).length;

  const p1p0Open = issues.filter(
    (i) => ['p0', 'p1'].includes((i.priority || '').toLowerCase()) && isOpen(i)
  ).length;
  const p1p0Total = issues.filter(
    (i) => ['p0', 'p1'].includes((i.priority || '').toLowerCase())
  ).length;

  return [
    {
      key: 'bugs_open',
      label: 'Open Bugs',
      count: bugOpen,
      jql: addScoped('issuetype = Bug AND status not in (Done, Closed, Resolved)'),
      severity: bugOpen > 20 ? 'red' : bugOpen > 0 ? 'amber' : 'green',
    },
    {
      key: 'unassigned',
      label: 'Unassigned',
      count: unassignedOpen,
      total: unassignedTotal !== unassignedOpen ? unassignedTotal : undefined,
      jql: addScoped('assignee is EMPTY AND status not in (Done, Closed, Resolved, Fixed, Complete)'),
      totalJql: unassignedTotal !== unassignedOpen ? addScoped('assignee is EMPTY') : undefined,
      severity: unassignedOpen > 0 ? 'amber' : 'green',
    },
    {
      key: 'qa_verification_backlog',
      label: 'QA Verification Backlog',
      count: qaBacklog,
      jql: addScoped('issuetype = Bug AND status = Resolved'),
      severity: qaBacklog > 0 ? 'amber' : 'green',
    },
    {
      key: 'stalled_14d',
      label: 'Stalled >14d',
      count: stalled14d,
      jql: addScoped('status not in (Done, Closed, Resolved) AND updated <= -14d'),
      severity: stalled14d > 0 ? 'red' : 'green',
    },
    {
      key: 'test_tasks',
      label: 'Test Tasks',
      count: testCount,
      jql: addScoped('issuetype = Test'),
      severity: testCount > 0 ? 'green' : 'grey',
    },
    {
      key: 'high_priority',
      label: 'P0/P1 Tickets',
      count: p1p0Open,
      total: p1p0Total !== p1p0Open ? p1p0Total : undefined,
      jql: addScoped('priority in (P0, P1) AND status not in (Done, Closed, Resolved, Fixed, Complete)'),
      totalJql: p1p0Total !== p1p0Open ? addScoped('priority in (P0, P1)') : undefined,
      severity: p1p0Open > 0 ? 'red' : 'green',
    },
  ];
}

export function parseStatusUpdate20(raw: string | null | undefined): StatusUpdateSection[] {
  if (!raw) return [];
  const lines = raw.split('\n').map((l) => l.trim());
  const sections: StatusUpdateSection[] = [];
  for (let i = 0; i < STATUS_UPDATE_HEADERS.length; i += 1) {
    const header = STATUS_UPDATE_HEADERS[i];
    const idx = lines.findIndex((l) => l.startsWith(header));
    if (idx < 0) continue;
    const value = lines[idx].slice(header.length).replace(/^[:\-\s]+/, '').trim();
    sections.push({
      id: header.split(' ')[0].toLowerCase().replace('.', ''),
      title: header,
      value: value || 'N/A',
    });
  }
  return sections;
}

function asIsoDay(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  return value.slice(0, 10);
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
