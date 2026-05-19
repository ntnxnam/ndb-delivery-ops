/**
 * Release and JIRA status constants — single source of truth for the client.
 *
 * These were previously duplicated as inline objects inside ReleaseVersionTab,
 * ReleaseVersionTableCell, ReleaseVersionGantt, and SprintReportPage.
 * Import from here; never redeclare inline.
 */

// ── JIRA colour name → hex (used in status-update markup and risk indicators) ─
export const JIRA_COLOR_MAP = {
  red:    '#de350b',
  green:  '#00875a',
  yellow: '#ff8b00',
  blue:   '#0052cc',
  orange: '#ff8b00',
};

// ── Risk indicator label → background colour ──────────────────────────────────
// Source: customfield_23560 values from Nutanix JIRA
export const RISK_COLOR_MAP = {
  green:  '#00875a',
  yellow: '#ff8b00',
  red:    '#de350b',
  blue:   '#0052cc',
  orange: '#ff8b00',
};

export const RISK_TEXT_COLOR = '#ffffff'; // always white on coloured bg

// ── Issue status groups ───────────────────────────────────────────────────────
export const CLOSED_STATUSES = ['done', 'closed', 'resolved', 'won\'t do', 'duplicate'];
export const IN_PROGRESS_STATUSES = ['in progress', 'in review', 'in development'];
export const NOT_STARTED_STATUSES = ['open', 'to do', 'backlog', 'new'];

// ── Sprint report status classifiers ─────────────────────────────────────────
export const SPRINT_CLOSED_STATUS_GROUP = new Set(CLOSED_STATUSES);
export const SPRINT_NEAR_COMPLETE_STATUSES = new Set([...IN_PROGRESS_STATUSES, 'in review']);

// ── UI colours for staleness / warning states ─────────────────────────────────
export const COLOR_WARN_BG    = '#856404';  // dark amber — team-select banner text
export const COLOR_INFO_BG    = '#0c5460';  // dark teal  — switching-teams banner text
export const COLOR_MUTED      = '#6c757d';  // Bootstrap muted
export const COLOR_DANGER     = '#dc3545';  // Bootstrap danger
export const COLOR_FIELD_LABEL = '#495057'; // field label grey
export const COLOR_NOT_SET    = '#999';     // "Not Set" placeholder

// ── Status text patterns used in executive-summary extraction ─────────────────
export const STATUS_KEYWORD_PATTERN =
  /(Done|In Progress|In progress|TBD|Not Done|Not Started|Completed|Blocked|At Risk)/i;
