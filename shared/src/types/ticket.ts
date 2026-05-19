/**
 * Ticket / Issue types.
 *
 * Type-safe wrapper over the JIRA REST v2 issue shape, with
 * Nutanix-specific custom-field reads going through productService
 * (per `product-agnostic.mdc`).
 */

export type IssueTypeFamily =
  | 'X-FEAT'
  | 'Capability'
  | 'Feature'
  | 'Initiative'
  | 'Epic'
  | 'Story'
  | 'Task'
  | 'Bug'
  | 'Sub-task'
  | 'Other';

export type TicketStatusCategory = 'To Do' | 'In Progress' | 'Done' | 'Indeterminate';

export interface Ticket {
  key: string;
  /** Project key prefix (e.g. 'NDB', 'ERA') — useful for grouping */
  projectKey: string;
  summary: string;
  description?: string;
  issueType: string;
  issueTypeFamily: IssueTypeFamily;
  status: string;
  statusCategory: TicketStatusCategory;
  priority?: string;
  assignee?: {
    name: string;
    displayName: string;
    email?: string;
  };
  reporter?: {
    name: string;
    displayName: string;
  };
  components?: string[];
  labels?: string[];
  fixVersions?: string[];
  affectsVersions?: string[];
  /** Story points if set (read from productConfig.customFields.storyPointsFieldId) */
  storyPoints?: number;
  /** Sprint(s) the ticket is in (read from productConfig.customFields.sprintFieldId) */
  sprintNames?: string[];
  /** Date fields per jira-date-hierarchy.mdc */
  dueDate?: string;
  startDate?: string;
  codeCompleteDate?: string;
  commitGateDate?: string;
  promotionGateDate?: string;
  /** Resolved JIRA-link relationships */
  blocks?: string[];          // tickets this ticket blocks
  isBlockedBy?: string[];     // tickets that block this ticket
  /** Raw fields object — for queries that need un-mapped data */
  raw?: Record<string, unknown>;
}

/**
 * The output of a paginated JIRA search, materialised into typed tickets.
 */
export interface TicketSearchResult {
  total: number;
  tickets: Ticket[];
  truncated: boolean;
  /** The JQL that produced this result — for citation per D10 */
  jql: string;
  capturedAt: string;
}

/**
 * Compact form for listing — used in tables and tooltips.
 */
export interface TicketSummary {
  key: string;
  summary: string;
  status: string;
  statusCategory: TicketStatusCategory;
  assigneeDisplay?: string;
}

/**
 * Classify an issue type into the date-hierarchy family per
 * jira-date-hierarchy.mdc.
 */
export function classifyIssueType(issueType: string | undefined): IssueTypeFamily {
  if (!issueType) return 'Other';
  const t = issueType.toUpperCase();
  if (t.includes('X-FEAT')) return 'X-FEAT';
  if (t.includes('CAPABILITY')) return 'Capability';
  if (t.includes('FEATURE')) return 'Feature';
  if (t.includes('INITIATIVE')) return 'Initiative';
  if (t.includes('EPIC')) return 'Epic';
  if (t.includes('STORY')) return 'Story';
  if (t.includes('SUB-TASK') || t.includes('SUBTASK')) return 'Sub-task';
  if (t.includes('TASK')) return 'Task';
  if (t.includes('BUG') || t.includes('DEFECT')) return 'Bug';
  return 'Other';
}

/**
 * Returns the set of date fields appropriate for this issue type, per
 * jira-date-hierarchy.mdc. The actual customfield IDs are resolved
 * via productService.getCustomFields(productId).
 */
export function dateFieldsForIssueType(family: IssueTypeFamily): Array<'gateDates' | 'duedate' | 'sprint'> {
  if (family === 'X-FEAT' || family === 'Capability') return ['gateDates'];
  if (family === 'Feature' || family === 'Initiative') return ['gateDates'];
  if (family === 'Epic') return ['duedate'];
  return ['sprint'];
}
