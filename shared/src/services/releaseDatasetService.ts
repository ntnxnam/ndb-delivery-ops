/**
 * releaseDatasetService — Phase 1 of the trunk port (updated to full
 * Release Payload model per D36 / user approval 2026-06-13).
 *
 * Fetch model (3 groups, 6 Group-1 buckets):
 *
 *   Group 1 — currently in release (6 buckets, no project scope):
 *     1A. top_level_projects        — Features/Initiatives tagged to release
 *     1B. epics_of_projects         — Epics that are portfolio children of 1A
 *     2.  work_toward_project       — Tasks/Bugs inside those Epics
 *     3.  standalone_epics          — Epics tagged with no Parent Link
 *     4.  work_toward_standalone_epic
 *     5.  direct_tickets            — loose Bugs/Tasks (no Epic Link)
 *
 *   Group 2 — moved out (1 broad query, classified in-memory):
 *     moved_out — all tickets where fixVersion was {release} but no longer is
 *     "hygienic" vs "needs cleanup" is derived from parent-link fields.
 *
 *   Group 3 — long-term funded (3 buckets, based on futureReleases list):
 *     long_term_projects — Features on future/master releases
 *     long_term_epics    — Epics of those features
 *     long_term_work     — Tasks/Bugs under those epics
 *
 *   Sidecars (label-based, NOT in the Group 1 union):
 *     wishlist, deferred, extension
 *
 * Project scope (D36, revised):
 *   The fetch NO LONGER adds `project = ERA` to every bucket. Features
 *   live in FEAT, documentation in TECHPUBS, engineering in ERA — a
 *   blanket project filter silently excludes legitimate tickets. Each
 *   bucket JQL is specific enough (fixVersion, issueType, Epic Link,
 *   Parent Link) to avoid returning unrelated data.
 *
 * Product-agnostic notes (D1):
 *   - `projectKey` is retained in options for the CACHE KEY and for
 *     engineering-only callers that still want the project-scoped view.
 *     Pass `projectKey: undefined` for the full Release Payload.
 *   - `labelPrefix` is required for sidecar labels.
 *   are already project-agnostic — see `buildReleasePayloadJql`.
 */

import { JiraConnector, type JiraIssue } from '../connectors/jiraConnector.js';
import {
  DEFERRED_COMPONENT,
  EXTENSION_COMPONENT,
  LONG_TERM_COMPONENT,
  LONG_TERM_EPICS_COMPONENT,
  LONG_TERM_PROJECTS_COMPONENT,
  LONG_TERM_WORK_COMPONENT,
  MOVED_OUT_COMPONENT,
  PAYLOAD_BUCKET_KEYS,
  WISHLIST_COMPONENT,
  getComponentQueries,
  getDeferredQuery,
  getExtensionQuery,
  getLongTermEpicsQuery,
  getLongTermFundedQuery,
  getLongTermProjectsQuery,
  getLongTermWorkQuery,
  getMovedOutQuery,
  getWishlistQuery,
  type PayloadBucketKey,
} from './payloadJqlService.js';
import {
  groupFor,
  workTypeFor,
  type IssueGroup,
  type WorkType,
} from './issueGroupsService.js';
import {
  categorizeResolution,
  isDoneResolution,
  type ResolutionCategory,
} from './resolutionCategoriesService.js';
import {
  classifyRelease,
  type ReleaseType,
} from './releaseClassificationService.js';
import {
  sprintFor,
  type SprintCalendar,
} from './sprintsService.js';

// ── Constants (port of data_layer.py constants) ────────────────────────────

/**
 * JIRA fields requested on the main fetch. Kept identical to the Python
 * FIELDS constant so the row shape lines up.
 */
/**
 * Fields fetched for every ticket in the release dataset — applies to ALL issue
 * types (Bug, Task, Spike, Story, Blog, PoC, Sub-task, Epic, FEAT, etc.).
 *
 * Rule of thumb: if any downstream consumer (retrospective, velocity chart,
 * gantt, naughty list) needs a field, it belongs here.
 *
 * Custom field IDs per jiraFieldsConfig.json / teamBoardConfig.json.
 * TODO(D1): move IDs to productService so non-NDB tenants can override.
 */
export const RELEASE_DATASET_FIELDS = [
  // ── Core identity ──────────────────────────────────────────────────────────
  'summary',      // ticket title — all types need this for display
  'issuetype',
  'status',
  'statusCategory',
  'resolution',
  'resolutiondate',
  'created',
  'updated',
  'fixVersions',
  'labels',
  'components',   // JIRA system Components field (team/area tagging)
  'priority',
  'assignee',

  // ── Effort / velocity ──────────────────────────────────────────────────────
  // Applies to Bug, Task, Spike, Story, PoC, Blog, Sub-task, Unit Test, etc.
  'customfield_10002', // Story Points (teamBoardConfig.json: storyPointsFieldId)

  // ── Date fields by issue type (per jira-date-hierarchy.mdc) ───────────────
  'duedate',           // Epic → Due Date is the Epic's timeline end point

  // Gate dates — non-null on FEAT/Initiative/X-FEAT/Capability tickets only.
  'customfield_11067', // Code Complete Date        (jiraFieldsConfig: checkpointDates.codeComplete)
  'customfield_35863', // Commit Gate Estimation     (jiraFieldsConfig: checkpointDates.commitGate)
  'customfield_35864', // Promotion Gate Estimation  (jiraFieldsConfig: checkpointDates.promotionGate)
  'customfield_11068', // Test Plan Date             (jiraFieldsConfig: checkpointDates.testPlan)
  'customfield_13861', // FS/DS Done Date            (jiraFieldsConfig: checkpointDates.fsdsDone)
  'customfield_45660', // Status Update Last Updated Date (jiraFieldsConfig: checkpointDates.statusUpdateDate)

  // ── Parent / hierarchy links ───────────────────────────────────────────────
  // Together these reconstruct FEAT → Epic → Spike/Story/Bug/Task chains from
  // the flat dataset without extra JIRA calls.
  // If these return null after a fresh fetch, verify IDs via:
  //   GET /rest/api/2/field  →  search for "Epic Link" and "Parent Link"
  //   GET /rest/api/2/issue/{key}?expand=names  →  spot-check a known Epic
  'parent',            // Immediate parent (standard JIRA field; populated for
                       //   sub-tasks and portfolio-direct children)
  'customfield_20363', // Portfolio Parent Link (JPO) — links Epics → FEAT/Initiative
                       //   (jiraFieldsConfig: relationships.parentLink)
  'customfield_10361', // Epic Link — links Task/Bug/Test/UnitTest → their Epic
                       //   Nutanix JIRA field ID (NOT customfield_10017 Atlassian default)
                       //   (jiraFieldsConfig: relationships.epicLink)

  // ── People (non-null primarily on Feature/Initiative tickets) ──────────────
  'customfield_10860', // QA Contact     (jiraFieldsConfig: people.qaContact)
  'customfield_27764', // TPM Owner      (jiraFieldsConfig: people.tpmOwner)
  'customfield_11065', // Test Lead      (jiraFieldsConfig: people.testLead)
  'customfield_11861', // GUI Lead       (jiraFieldsConfig: people.guiLead)
  'customfield_51460', // Team Members   (jiraFieldsConfig: people.teamMembers)
  'customfield_11260', // PM Owner       (jiraFieldsConfig: people.pmOwner)

  // ── Content / indicators (Feature/Initiative level) ────────────────────────
  'customfield_23073', // Status Update           (jiraFieldsConfig: content.statusUpdate)
  'customfield_38460', // Executive Status Update (jiraFieldsConfig: content.executiveStatusUpdate)
                       //   ADF field — use extractTextFieldValue() to get plain text
  'customfield_23560', // Risk Indicator          (jiraFieldsConfig: indicators.riskIndicator)
                       //   Values: Green / Yellow / Red

  // ── Document links (Feature/Initiative level) ──────────────────────────────
  'customfield_14463', // Link to Requirements (jiraFieldsConfig: links.requirementsLink)
  'customfield_31460', // TCMS Link            (jiraFieldsConfig: links.tcmsLink)
  'customfield_14464', // Link to Design Doc   (jiraFieldsConfig: links.designDocLink)
  'customfield_14465', // Link to Test Plan    (jiraFieldsConfig: links.testPlanLink)

  // ── Sprint (NDB board uses non-standard field ID) ──────────────────────────
  'customfield_10360', // Sprint (NDB board — teamBoardConfig: sprintFieldId)
                       //   NOT customfield_10020 (Atlassian default) or
                       //   customfield_10021 (multi-sprint boards)
] as const;

/** Default page size — matches Python's PAGE_SIZE. */
export const DEFAULT_PAGE_SIZE = 500;

/** Default per-component max issue cap. */
export const DEFAULT_MAX_ISSUES_PER_BUCKET = 20_000;

/** Concurrency for the 5-bucket + 4-sidecar parallel fetch. */
export const DEFAULT_FETCH_CONCURRENCY = 9;

// ── Gate date history types ────────────────────────────────────────────────

/**
 * One point in a gate-date slip timeline.
 * `value` is the date that was SET at this moment (i.e. the `toString`
 * value from the JIRA changelog item). `changedAt` is the ISO timestamp
 * of the changelog history entry — when the change was made.
 */
export interface GateDateHistoryEntry {
  value: string;     // YYYY-MM-DD
  changedAt: string; // ISO-8601 timestamp
}

/**
 * Full slip trail for a Feature/Initiative/X-FEAT/Capability ticket.
 * Each array is oldest-first; the LAST entry is the current value.
 */
export interface GateDateHistory {
  codeComplete: GateDateHistoryEntry[];   // CC date (customfield_11067) changes
  commitGate: GateDateHistoryEntry[];     // CG date (customfield_35863) changes
  promotionGate: GateDateHistoryEntry[];  // PG date (customfield_35864) changes
}

// ── The canonical row shape ────────────────────────────────────────────────

/**
 * One row of the processed dataset. Field names match the Python
 * `_ticket_from_issue` dict keys EXACTLY so downstream code that
 * consumes the dataset doesn't need any translation layer.
 *
 * `Components` is the canonical bucket tag (comma-joined when a ticket
 * lives in multiple buckets, e.g. `"top_level_projects,wishlist"`).
 * `JIRA Components` is the unrelated JIRA-system Components field
 * (preserved with the legacy name despite the collision).
 */
export interface ProcessedTicket {
  'Issue Key': string;
  Summary: string;
  'Issue Type': string;
  Status: string;
  'Status Category': string;
  Resolution: string;
  'Fix Version': string;
  'All Fix Versions': string;
  'Resolved Date': string | null;
  'Created Date': string | null;
  'Updated Date': string | null;
  'Closed Date': string | null;
  'Release Name': string;
  Labels: string;
  Components: string;
  'JIRA Components': string;
  'Primary Component': string;
  Priority: string;
  Assignee: string;
  /**
   * Story Points (customfield_10002). Non-null on any issue type that has
   * story points set — Bug, Task, Spike, Story, PoC, Blog, Sub-task, Unit Test.
   * Used by all velocity calculations (sprint-velocity-types.mdc).
   */
  'Story Points': number | null;
  /** Due Date. Non-null on Epic tickets only (per jira-date-hierarchy.mdc). */
  'Due Date': string | null;
  /** Code Complete Date from customfield_11067. Non-null on FEAT/Initiative/X-FEAT/Capability tickets only. */
  'CC Date': string | null;
  /** Commit Gate Ready Estimation Date from customfield_35863. */
  'CG Date': string | null;
  /** Promotion Gate Ready Estimation Date from customfield_35864. */
  'PG Date': string | null;
  /**
   * Immediate parent issue key (standard `parent` JIRA field).
   * Populated for sub-tasks and direct children of portfolio-tier issues.
   * Used together with `Portfolio Parent Key` to reconstruct the
   * FEAT → Epic → child hierarchy entirely from the bundle.
   */
  'Parent Key': string | null;
  /**
   * Portfolio Parent Link (customfield_20363).
   * Non-null on Epic tickets — links the Epic back to its parent FEAT/Initiative.
   */
  'Portfolio Parent Key': string | null;
  /**
   * Epic Link (customfield_10361 in Nutanix JIRA).
   * Non-null on Task, Bug, Test, Unit Test, and similar leaf issue types
   * that live under an Epic. Pair with `Portfolio Parent Key` on the Epic
   * to resolve the full chain to a FEAT without extra JIRA calls.
   */
  'Epic Link Key': string | null;
  /**
   * Last Resolved Date — the most-recent timestamp where the ticket's
   * status transitioned **to** "Resolved". Populated by the changelog
   * enrichment pass for Bug, Improvement, and Test tickets.
   * Distinct from `Resolved Date` (which is JIRA's `resolutiondate` field
   * and reflects only the first time a resolution was set).
   * Use this field for QA verification sprint assignment.
   */
  'Last Resolved Date': string | null;
  /**
   * Reopen Count — number of times the ticket transitioned FROM
   * "Resolved" or "Closed" back to an open/active state.
   * Quality signal: high reopen counts indicate poor fix quality or
   * insufficient test coverage. Populated by the changelog enrichment
   * pass for Bug, Improvement, and Test tickets.
   */
  'Reopen Count': number;

  // ── Gate date slip history (Feature / Initiative / X-FEAT / Capability) ──────
  /**
   * Chronological trail of CC / CG / PG date changes.
   * Each entry is { value: "YYYY-MM-DD", changedAt: ISO } — the date that
   * was SET at that point in time (i.e., the `toString` value from the
   * JIRA changelog item). Oldest → newest ordering.
   *
   * Populated by the `enrichGateDateHistory` pass during sync. Null for
   * all issue types that are not Feature / Initiative / X-FEAT / Capability.
   *
   * Derived fields (`CC Slip Count`, `CC Slip Days`, `Declared CC`,
   * `Final CC`) are computed in processMaster from this array.
   */
  'Gate Date History': GateDateHistory | null;

  // ── Additional date fields ───────────────────────────────────────────────
  /** Test Plan Date (customfield_11068). Non-null on FEAT/Initiative tickets. */
  'Test Plan Date': string | null;
  /** FS/DS Done Date (customfield_13861). Non-null on FEAT/Initiative tickets. */
  'FS/DS Done Date': string | null;
  /** Status Update Last Updated Date (customfield_45660). */
  'Status Update Date': string | null;

  // ── People (non-null primarily on Feature/Initiative tickets) ─────────────
  /** QA Contact (customfield_10860). */
  'QA Contact': string;
  /** TPM Owner (customfield_27764). */
  'TPM Owner': string;
  /** Test Lead (customfield_11065). */
  'Test Lead': string;
  /** GUI Lead (customfield_11861). */
  'GUI Lead': string;
  /** PM Owner (customfield_11260). */
  'PM Owner': string;

  // ── Content / indicators (Feature/Initiative level) ───────────────────────
  /** Status Update text (customfield_23073). */
  'Status Update': string;
  /** Executive Status Update plain text extracted from ADF (customfield_38460). */
  'Executive Status Update': string;
  /** Risk Indicator (customfield_23560). One of: Green | Yellow | Red | ''. */
  'Risk Indicator': string;

  // ── Document links (Feature/Initiative level) ──────────────────────────────
  /** Link to Requirements (customfield_14463). */
  'Requirements Link': string;
  /** TCMS Link (customfield_31460). */
  'TCMS Link': string;
  /** Link to Design Doc (customfield_14464). */
  'Design Doc Link': string;
  /** Link to Test Plan (customfield_14465). */
  'Test Plan Link': string;

  // ── Sprint (raw sprint name from the NDB board field) ─────────────────────
  /** Sprint name raw from customfield_10360 (NDB board). Used for display; Sprint Number is derived separately. */
  'Sprint Name': string;
}

/**
 * Result of a single-release fetch. `error` is the first bucket-fetch
 * error encountered (we keep going through the other buckets so a
 * partial dataset still lands); `bucketCounts` is per-bucket
 * (incl. sidecars) so callers can verify expected coverage.
 */
export interface FetchReleaseResult {
  release: string;
  tickets: ProcessedTicket[];
  bucketCounts: Record<string, number>;
  error: string | null;
}

// ── Helpers — pure transforms ──────────────────────────────────────────────

/**
 * Extract plain text from an Atlassian Document Format (ADF) field value.
 * JIRA returns ADF as a nested JSON object for rich-text fields like
 * customfield_38460 (Executive Status Update).
 */
function extractAdfText(raw: unknown): string {
  if (!raw || typeof raw !== 'object') return '';
  const parts: string[] = [];
  function walk(node: Record<string, unknown>): void {
    if (node.type === 'text' && typeof node.text === 'string') {
      parts.push(node.text);
    }
    const children = node.content as Record<string, unknown>[] | undefined;
    if (Array.isArray(children)) {
      children.forEach(walk);
    }
  }
  walk(raw as Record<string, unknown>);
  return parts.join(' ').trim();
}

/**
 * Extract the sprint name string from the raw JIRA sprint field value.
 * customfield_10360 can return an array of sprint objects or a single string.
 */
function extractSprintName(raw: unknown): string {
  if (!raw) return '';
  const arr = Array.isArray(raw) ? raw : [raw];
  const last = arr[arr.length - 1];
  if (!last) return '';
  if (typeof last === 'string') {
    // Sprint name is embedded as name=... in the serialized string
    const match = /name=([^,\]]+)/.exec(last);
    return match ? match[1].trim() : last.trim();
  }
  if (typeof last === 'object') {
    return (last as Record<string, unknown>).name as string ?? '';
  }
  return '';
}

/**
 * Map a raw JIRA issue into a ProcessedTicket row, tagged with the
 * release name and (initial) bucket. Mirrors Python's
 * `_ticket_from_issue` field-for-field.
 *
 * `closedDate` is left null in Phase 1 — Phase 2 (changelog pass) will
 * fill it for Bug/Improvement-Done tickets.
 */
export function ticketFromIssue(
  issue: JiraIssue,
  release: string,
  componentTag: string,
  closedDate: string | null = null
): ProcessedTicket {
  const f = (issue.fields ?? {}) as Record<string, unknown>;
  const issueType = (f.issuetype as { name?: string } | undefined)?.name ?? '';
  const status = f.status as
    | { name?: string; statusCategory?: { name?: string } }
    | undefined;
  const resolution = (f.resolution as { name?: string } | undefined)?.name;
  const fixVersions = (f.fixVersions as { name?: string }[] | undefined) ?? [];
  const labels = (f.labels as string[] | undefined) ?? [];
  const jiraComponents = (f.components as { name?: string }[] | undefined) ?? [];
  const jiraCompNames = jiraComponents
    .map((c) => c.name ?? '')
    .filter((n) => n.length > 0);
  const priority = (f.priority as { name?: string } | undefined)?.name ?? '';
  const assigneeRaw = f.assignee as
    | { name?: string; key?: string }
    | undefined;
  const assignee = assigneeRaw?.name ?? assigneeRaw?.key ?? '';

  const toIsoDate = (raw: unknown): string | null => {
    if (!raw || typeof raw !== 'string') return null;
    const d = raw.split('T')[0];
    return d.length === 10 ? d : null;
  };

  // Story Points — applies to ALL work item types (Bug, Spike, Story, PoC, etc.).
  const rawSp = f.customfield_10002;
  const storyPoints: number | null =
    typeof rawSp === 'number' ? rawSp : rawSp != null ? parseFloat(String(rawSp)) || null : null;

  // Parent key from the standard `parent` field (direct children, sub-tasks).
  const parentRaw = f.parent as { key?: string } | undefined;
  const parentKey = parentRaw?.key ?? null;

  // Portfolio Parent Link (customfield_20363 — JPO) — links Epics to their parent FEAT.
  const portfolioParentRaw = f.customfield_20363 as { key?: string } | undefined;
  const portfolioParentKey = portfolioParentRaw?.key ?? null;

  // Epic Link (customfield_10361 in Nutanix JIRA) — links Task/Bug/Test/UnitTest to their Epic.
  // Can come back as a plain string key or as an object with a `key` property.
  const epicLinkRaw = f.customfield_10361;
  const epicLinkKey: string | null =
    typeof epicLinkRaw === 'string'
      ? epicLinkRaw || null
      : epicLinkRaw != null && typeof (epicLinkRaw as Record<string, unknown>).key === 'string'
        ? ((epicLinkRaw as Record<string, unknown>).key as string) || null
        : null;

  return {
    'Issue Key': issue.key,
    Summary: (f.summary as string | undefined) ?? '',
    'Issue Type': issueType,
    Status: status?.name ?? 'Unknown',
    'Status Category': status?.statusCategory?.name ?? '',
    Resolution: resolution ?? 'Unresolved',
    'Fix Version': fixVersions[0]?.name ?? '',
    'All Fix Versions': fixVersions
      .map((v) => v.name ?? '')
      .filter((n) => n.length > 0)
      .join(', '),
    'Resolved Date': (f.resolutiondate as string | null | undefined) ?? null,
    'Created Date': (f.created as string | null | undefined) ?? null,
    'Updated Date': (f.updated as string | null | undefined) ?? null,
    'Closed Date': closedDate,
    'Release Name': release,
    Labels: labels.join(','),
    Components: componentTag,
    'JIRA Components': jiraCompNames.join(', '),
    'Primary Component': jiraCompNames[0] ?? '',
    Priority: priority,
    Assignee: assignee,
    // Effort / velocity — present on all work item types.
    'Story Points': storyPoints,
    // Per jira-date-hierarchy.mdc: Epics use Due Date.
    'Due Date': toIsoDate(f.duedate as string | undefined),
    // Gate dates — non-null on FEAT/Initiative/X-FEAT/Capability tickets only.
    'CC Date': toIsoDate(f.customfield_11067),
    'CG Date': toIsoDate(f.customfield_35863),
    'PG Date': toIsoDate(f.customfield_35864),
    // Parent-link chain for FEAT→Epic→Spike/Story/Bug/Task hierarchy reconstruction.
    'Parent Key': parentKey,
    'Portfolio Parent Key': portfolioParentKey,
    'Epic Link Key': epicLinkKey,
    // Changelog-enriched fields — filled in Phase 2 (enrichClosedDates pass).
    'Last Resolved Date': null,
    'Reopen Count': 0,
    // Gate date history — filled in Phase 3 (enrichGateDateHistory pass).
    'Gate Date History': null,

    // Additional date fields.
    'Test Plan Date': toIsoDate(f.customfield_11068),
    'FS/DS Done Date': toIsoDate(f.customfield_13861),
    'Status Update Date': toIsoDate(f.customfield_45660),

    // People fields — extracting display name or username.
    'QA Contact': (f.customfield_10860 as { displayName?: string; name?: string } | undefined)?.displayName
      ?? (f.customfield_10860 as { displayName?: string; name?: string } | undefined)?.name ?? '',
    'TPM Owner': (f.customfield_27764 as { displayName?: string; name?: string } | undefined)?.displayName
      ?? (f.customfield_27764 as { displayName?: string; name?: string } | undefined)?.name ?? '',
    'Test Lead': (f.customfield_11065 as { displayName?: string; name?: string } | undefined)?.displayName
      ?? (f.customfield_11065 as { displayName?: string; name?: string } | undefined)?.name ?? '',
    'GUI Lead': (f.customfield_11861 as { displayName?: string; name?: string } | undefined)?.displayName
      ?? (f.customfield_11861 as { displayName?: string; name?: string } | undefined)?.name ?? '',
    'PM Owner': (f.customfield_11260 as { displayName?: string; name?: string } | undefined)?.displayName
      ?? (f.customfield_11260 as { displayName?: string; name?: string } | undefined)?.name ?? '',

    // Content / indicators.
    'Status Update': typeof f.customfield_23073 === 'string' ? f.customfield_23073 : '',
    // ADF field — strip to plain text by extracting text nodes from the document structure.
    'Executive Status Update': extractAdfText(f.customfield_38460),
    'Risk Indicator': typeof f.customfield_23560 === 'string' ? f.customfield_23560 : '',

    // Document links — these come back as plain string URLs.
    'Requirements Link': typeof f.customfield_14463 === 'string' ? f.customfield_14463 : '',
    'TCMS Link': typeof f.customfield_31460 === 'string' ? f.customfield_31460 : '',
    'Design Doc Link': typeof f.customfield_14464 === 'string' ? f.customfield_14464 : '',
    'Test Plan Link': typeof f.customfield_14465 === 'string' ? f.customfield_14465 : '',

    // Sprint name from the raw NDB board sprint field.
    'Sprint Name': extractSprintName(f.customfield_10360),
  };
}

// ── Bucket fetch ────────────────────────────────────────────────────────────

export interface FetchBucketResult {
  bucketName: string;
  issues: JiraIssue[];
  error: string | null;
}

export interface FetchBucketOptions {
  /**
   * Optional JIRA project key. When set, the query becomes
   * `project = {projectKey} AND ({bucketJql})` — this is the
   * "engineering payload" scoping.
   *
   * When omitted, the bucket JQL is executed as-is (Release Payload
   * mode). Features live in FEAT, docs in TECHPUBS, engineering work
   * in ERA — omitting the project filter captures all of them.
   */
  projectKey?: string;
  pageSize?: number;
  maxIssues?: number;
  /**
   * Optional progress hook called as `(bucketName, status, detail)`.
   * Mirrors the Python `progress_cb` contract.
   */
  onProgress?: (bucketName: string, status: string, detail: string) => void;
}

/**
 * Fetch a single bucket's issues. Optionally scopes to a project key.
 *
 * Errors are CAUGHT and returned in the result — callers fan out
 * multiple buckets in parallel and we don't want one bucket's failure
 * to nuke the whole release fetch. Mirrors Python's
 * `_fetch_component` behaviour.
 */
export async function fetchBucket(
  jira: JiraConnector,
  release: string,
  bucketName: string,
  bucketJql: string,
  options: FetchBucketOptions
): Promise<FetchBucketResult> {
  const fullJql = options.projectKey
    ? `project = ${options.projectKey} AND (${bucketJql})`
    : bucketJql;
  options.onProgress?.(bucketName, 'fetching', 'page 1');
  try {
    const issues = await jira.searchAll(fullJql, RELEASE_DATASET_FIELDS.join(','), {
      pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
      maxIssues: options.maxIssues ?? DEFAULT_MAX_ISSUES_PER_BUCKET,
    });
    options.onProgress?.(bucketName, 'done', `${issues.length} fetched`);
    return { bucketName, issues, error: null };
  } catch (err) {
    // Use JiraConnector.wrapError to extract the actual JIRA error message
    // (e.g. "Function portfolioChildrenOf not available" is far more
    // actionable than the raw axios status string).
    const wrapped = JiraConnector.wrapError(err);
    const msg = `[${bucketName}] ${wrapped.message} (HTTP ${wrapped.statusCode})`;
    // eslint-disable-next-line no-console
    console.error(`[releaseDatasetService] fetchBucket error for ${release}/${bucketName}:`, wrapped.message, wrapped.details ?? '');
    options.onProgress?.(bucketName, 'error', msg);
    return { bucketName, issues: [], error: msg };
  }
}

// ── Release-level orchestration ────────────────────────────────────────────

export interface FetchReleaseOptions {
  /**
   * Optional JIRA project key. When set, ALL bucket queries are scoped to
   * `project = X AND (...)` (engineering-only view). When omitted (default),
   * the full Release Payload is fetched across all projects (ERA, FEAT,
   * TECHPUBS, etc.).
   */
  projectKey?: string;
  /**
   * Label prefix for wishlist / deferred / extension sidecars (D1 — Python
   * hardcoded `ndb`). Required.
   */
  labelPrefix: string;
  /**
   * Unreleased JIRA versions that are NOT active releases. Used to build
   * the Group 3 (long-term funded) fetch. Obtain at sync time from
   * `jira.getProjectVersions(projectKey)` filtered to `released=false` and
   * NOT in the currently active release set.
   *
   * When empty or omitted, Group 3 is skipped entirely.
   */
  futureReleases?: string[];
  /** Page size for the per-bucket searchAll. Default 500. */
  pageSize?: number;
  /** Max issues per bucket safety cap. Default 20,000. */
  maxIssuesPerBucket?: number;
  /**
   * Max concurrent bucket fetches. Defaults to fetch-plan length (bounded
   * internally). Lower if JIRA rate-limits kick in.
   */
  concurrency?: number;
  /** Progress hook, see `FetchBucketOptions.onProgress`. */
  onProgress?: (bucketName: string, status: string, detail: string) => void;
  /**
   * Mark this release as a catch-all planning version (e.g. "master",
   * "Era Future"). When true:
   *
   *   1. `moved_out` bucket is skipped entirely — `fixVersion was master`
   *      scans all JIRA history and times out; semantically it means "every
   *      ticket ever committed to a release" which is not actionable.
   *   2. `work_toward_standalone_epic` uses a recency-bounded variant
   *      (`AND updated >= startOfYear(-1)`) to avoid the >20,000-issue limit
   *      caused by thousands of inactive epics accumulated in master.
   *   3. `direct_tickets` uses a simplified variant (`fixVersion = master`
   *      only, dropping `fixVersion was` and `affectedVersion`) for the
   *      same reason.
   */
  isCatchAllVersion?: boolean;
}

/**
 * Fetch all 3 groups (6 Group-1 buckets + Group-2 moved-out + Group-3
 * long-term funded) plus label sidecars for one release, dedup
 * within-release, and emit the processed ticket rows.
 *
 * Order of operations:
 *
 *   1. Build the fetch plan:
 *        Group 1 — 6 bucket JQLs (no project scope; covers ERA, FEAT, TECHPUBS)
 *        Group 2 — 1 broad moved-out JQL (classified in-memory post-fetch)
 *        Group 3 — 3 JQLs for long-term funded work (only when futureReleases given)
 *        Sidecars — wishlist, deferred, extension (label-based, not in the union)
 *   2. Fan out all fetches with bounded concurrency.
 *   3. Within-release dedup by `Issue Key`, preserving fetch order so
 *      parents win over children in the `Components` tag composition.
 *
 * Group 2 "hygienic vs needs cleanup" is derived in-memory from the
 * ticket's `Portfolio Parent Key` / `Epic Link Key` fields after the
 * flat dump lands — not at fetch time.
 */
export async function fetchReleaseData(
  jira: JiraConnector,
  release: string,
  options: FetchReleaseOptions
): Promise<FetchReleaseResult> {
  if (!release) throw new Error('fetchReleaseData: release is required');
  if (!options.labelPrefix) {
    throw new Error('fetchReleaseData: options.labelPrefix is required (D1)');
  }

  const catchAll = options.isCatchAllVersion ?? false;
  const buckets = getComponentQueries(release, catchAll);
  const sidecarOpts = { labelPrefix: options.labelPrefix };

  // Jira labels cannot contain spaces. Releases like "Era Future" or "master"
  // generate suffixes with spaces (e.g. "era future"), making label queries
  // like `labels = "ndb-era future-deferred"` invalid (HTTP 400). Skip all
  // label-anchored sidecar queries for those releases.
  const labelSuffix = deriveReleaseSuffix(release, options.labelPrefix);
  const sidecarsSafe = !/\s/.test(labelSuffix);

  // ── Fetch plan (order matters for the within-release dedup) ───────────────
  // Group 1: parents before children — when a ticket matches both a
  //   parent bucket (epics_of_projects) and a child bucket (work_toward_project)
  //   it's tagged with the parent (first seen).
  // Group 2: after Group 1 so Group-1 tickets that still show up via
  //   `fixVersion was` keep their Group-1 Component tag and are only
  //   annotated with `moved_out` as an additional tag.
  // Group 3: after Group 1 + 2 for the same dedup reason.
  // Sidecars: last so the payload tag always wins.
  const fetchPlan: Array<{ name: string; jql: string }> = [
    // Group 1 — 6 disjoint buckets, no project filter
    ...PAYLOAD_BUCKET_KEYS.map((k) => ({ name: k, jql: buckets[k] })),
    // Group 2 — moved-out (single broad query).
    // Skipped for catch-all versions (master / Era Future): `fixVersion was
    // master` scans all JIRA history, times out at 30s, and is semantically
    // meaningless for a planning bucket.
    ...(catchAll
      ? []
      : [{ name: MOVED_OUT_COMPONENT, jql: getMovedOutQuery(release) }]),
    // Group 3 — long-term funded (only when caller provides future releases)
    ...(options.futureReleases && options.futureReleases.length > 0
      ? [
          {
            name: LONG_TERM_PROJECTS_COMPONENT,
            jql: getLongTermProjectsQuery({ futureReleases: options.futureReleases }),
          },
          {
            name: LONG_TERM_EPICS_COMPONENT,
            jql: getLongTermEpicsQuery({ futureReleases: options.futureReleases }),
          },
          {
            name: LONG_TERM_WORK_COMPONENT,
            jql: getLongTermWorkQuery({ futureReleases: options.futureReleases }),
          },
        ]
      : []),
    // Sidecars — label-anchored, NOT in the Group 1 union.
    // Skipped when the release name generates a label suffix with spaces
    // (e.g. "Era Future" → "era future") because Jira rejects such labels.
    ...(sidecarsSafe
      ? [
          { name: WISHLIST_COMPONENT, jql: getWishlistQuery(release, sidecarOpts) },
          { name: DEFERRED_COMPONENT, jql: getDeferredQuery(release, sidecarOpts) },
          { name: LONG_TERM_COMPONENT, jql: getLongTermFundedQuery(release, sidecarOpts) },
          { name: EXTENSION_COMPONENT, jql: getExtensionQuery(release, sidecarOpts) },
        ]
      : []),
  ];

  // Bounded-concurrency fan-out.
  const concurrency = Math.min(
    options.concurrency ?? DEFAULT_FETCH_CONCURRENCY,
    fetchPlan.length
  );
  const results: FetchBucketResult[] = new Array(fetchPlan.length);
  let nextIdx = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIdx++;
      if (i >= fetchPlan.length) return;
      const plan = fetchPlan[i]!;
      results[i] = await fetchBucket(jira, release, plan.name, plan.jql, {
        projectKey: options.projectKey,
        pageSize: options.pageSize,
        maxIssues: options.maxIssuesPerBucket,
        onProgress: options.onProgress,
      });
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // First-error capture (partial results still land).
  let firstErr: string | null = null;
  const bucketCounts: Record<string, number> = {};
  for (const r of results) {
    bucketCounts[r.bucketName] = r.issues.length;
    if (r.error && !firstErr) firstErr = r.error;
  }

  // Within-release dedup. Iterate the plan order: buckets first
  // (parents → children → standalone), then wishlist, then deferred.
  // The first time we see an Issue Key, seed the row with that
  // bucket as the Components tag. Subsequent appearances *append*
  // (comma-join) so a deferred-and-in-payload ticket ends up as
  // `"direct_tickets,deferred"`, a promoted wishlist as
  // `"top_level_projects,wishlist"`, etc.
  const byKey = new Map<string, ProcessedTicket>();
  for (const { name: bucketName } of fetchPlan) {
    const bucketResult = results.find((r) => r.bucketName === bucketName);
    if (!bucketResult) continue;
    for (const issue of bucketResult.issues) {
      const existing = byKey.get(issue.key);
      if (existing) {
        const tags = existing.Components.split(',');
        if (!tags.includes(bucketName)) {
          existing.Components = [...tags, bucketName].join(',');
        }
        continue;
      }
      byKey.set(issue.key, ticketFromIssue(issue, release, bucketName, null));
    }
  }

  return {
    release,
    tickets: Array.from(byKey.values()),
    bucketCounts,
    error: firstErr,
  };
}

// ── Phase 2: label helpers + derived columns + processMaster ───────────────
//
// Ports `_is_deferred_label`, `_is_wishlist_label`,
// `extract_deferred_source_releases`, `_priority_band`, and
// `process_master` from data_layer.py. All product-agnostic via
// explicit `labelPrefix` / `productPrefix` / `sprintCalendar` inputs.

export interface LabelOptions {
  /**
   * Label prefix used to derive the wishlist / deferred label.
   * The Python original baked in `'ndb'`. Required (D1).
   */
  labelPrefix: string;
}

function deriveReleaseSuffix(release: string, labelPrefix: string): string {
  const lower = release.toLowerCase();
  return lower.startsWith(`${labelPrefix.toLowerCase()}-`)
    ? lower.slice(labelPrefix.length + 1)
    : lower;
}

/**
 * True iff the comma-joined `labels` string contains
 * `<labelPrefix>-<rel>-deferred` for `release`. Mirrors Python
 * `_is_deferred_label`.
 */
export function isDeferredLabel(
  labels: string,
  release: string,
  options: LabelOptions
): boolean {
  if (!labels) return false;
  const suffix = deriveReleaseSuffix(release, options.labelPrefix);
  const needle = `${options.labelPrefix.toLowerCase()}-${suffix}-deferred`;
  return labels.toLowerCase().includes(needle);
}

/**
 * True iff the comma-joined `labels` string contains
 * `<labelPrefix>-<rel>-wishlist` for `release`. Mirrors Python
 * `_is_wishlist_label`.
 */
export function isWishlistLabel(
  labels: string,
  release: string,
  options: LabelOptions
): boolean {
  if (!labels) return false;
  const suffix = deriveReleaseSuffix(release, options.labelPrefix);
  const needle = `${options.labelPrefix.toLowerCase()}-${suffix}-wishlist`;
  return labels.toLowerCase().includes(needle);
}

/**
 * Return every release referenced by a `<labelPrefix>-<rel>-deferred`
 * label in the comma-joined `labels` string. Inverse of the
 * lower/strip mapping used by `isDeferredLabel`.
 *
 * Mirrors Python `extract_deferred_source_releases`:
 *
 *   `'ndb-2.10-deferred'`    → `'NDB-2.10'`
 *   `'ndb-2.10.3-deferred'`  → `'NDB-2.10.3'`
 *   `'ndb-3.0-ea-deferred'`  → `'NDB-3.0-EA'`
 *
 * Returns first-occurrence-order, de-duplicated.
 *
 * D1: requires both `labelPrefix` (matches the label scheme) AND
 * `productPrefix` (the canonical release name prefix, e.g. `'NDB-'`).
 * Often `labelPrefix.toUpperCase() + '-' === productPrefix` but we
 * accept them separately so weird tenant naming schemes still work.
 */
export interface ExtractDeferredOptions {
  labelPrefix: string;
  /** Canonical release name prefix used when restoring lineage. e.g. `'NDB-'`. */
  productPrefix: string;
}

export function extractDeferredSourceReleases(
  labels: string,
  options: ExtractDeferredOptions
): string[] {
  if (!labels) return [];
  // Build a regex on the fly so we honour the tenant's labelPrefix.
  // Pattern matches `<prefix>-<rel>-deferred` where `<rel>` may contain
  // digits, dots, hyphens, and lower-case letters (covers `3.0-ea`).
  // Word boundaries on both ends prevent accidental partial matches.
  const prefix = options.labelPrefix.toLowerCase();
  const pattern = new RegExp(
    `\\b${prefix}-([0-9][0-9a-z.\\-]*?)-deferred\\b`,
    'gi'
  );
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(labels)) !== null) {
    const relPart = m[1]!;
    // Restore canonical name. If a hyphen is present, split once and
    // upper-case the suffix portion (which carries the pre-release
    // token like `ea` → `EA`).
    let canonical: string;
    if (relPart.includes('-')) {
      const dashIdx = relPart.indexOf('-');
      const base = relPart.slice(0, dashIdx);
      const suffix = relPart.slice(dashIdx + 1).toUpperCase();
      canonical = `${options.productPrefix}${base}-${suffix}`;
    } else {
      canonical = `${options.productPrefix}${relPart}`;
    }
    if (!seen.has(canonical)) {
      seen.add(canonical);
      out.push(canonical);
    }
  }
  return out;
}

/**
 * Extract the P-band (`P0`..`P4`) from a raw JIRA priority string.
 * Mirrors Python `_priority_band`.
 *
 * Returns `'Unknown'` when the priority is empty or doesn't match the
 * canonical `Px` token. Empty band is preferred over a wrong band —
 * closure-regime metrics filter by exact band membership and silently
 * misclassifying would be worse than missing.
 */
const PRIORITY_BAND_RE = /P([0-4])\b/i;

export function priorityBand(priority: string | null | undefined): string {
  if (priority === null || priority === undefined) return 'Unknown';
  const s = String(priority);
  if (!s) return 'Unknown';
  const m = PRIORITY_BAND_RE.exec(s);
  return m ? `P${m[1]}` : 'Unknown';
}

/**
 * The fully-derived row — extends `ProcessedTicket` with the columns
 * `processMaster` adds. Mirrors the Python processed_df schema.
 */
export interface ProcessedTicketWithDerived extends ProcessedTicket {
  'Priority Band': string;
  'Sprint Number': number | null;
  'Closed Sprint Number': number | null;
  'Issue Group': IssueGroup;
  'Work Type': WorkType;
  'Resolution Category': ResolutionCategory;
  'Is Done': boolean;
  'Is Deferred': boolean;
  'Is Wishlist': boolean;
  'Is QA Verification': boolean;
  'Release Type': ReleaseType;
}

/** All output column names in canonical order (matches Python). */
export const PROCESSED_DATASET_COLUMNS = [
  'Issue Key',
  'Summary',
  'Issue Type',
  'Status',
  'Status Category',
  'Resolution',
  'Fix Version',
  'All Fix Versions',
  'Resolved Date',
  'Created Date',
  'Updated Date',
  'Closed Date',
  'Release Name',
  'Labels',
  'Components',
  'JIRA Components',
  'Primary Component',
  'Priority',
  'Priority Band',
  'Assignee',
  'Sprint Number',
  'Closed Sprint Number',
  'Issue Group',
  'Work Type',
  'Resolution Category',
  'Is Done',
  'Is Deferred',
  'Is Wishlist',
  'Is QA Verification',
  'Release Type',
  'Story Points',
  'Due Date',
  'CC Date',
  'CG Date',
  'PG Date',
  'Parent Key',
  'Portfolio Parent Key',
  'Epic Link Key',
  'Last Resolved Date',
  'Reopen Count',
  'Gate Date History',
  // Additional dates
  'Test Plan Date',
  'FS/DS Done Date',
  'Status Update Date',
  // People
  'QA Contact',
  'TPM Owner',
  'Test Lead',
  'GUI Lead',
  'PM Owner',
  // Content / indicators
  'Status Update',
  'Executive Status Update',
  'Risk Indicator',
  // Document links
  'Requirements Link',
  'TCMS Link',
  'Design Doc Link',
  'Test Plan Link',
  // Sprint raw name
  'Sprint Name',
] as const;

export interface ProcessMasterOptions {
  /** D1: label prefix for is-deferred / is-wishlist checks. Required. */
  labelPrefix: string;
  /** D1: product release prefix for release-type classification. Required. */
  productPrefix: string;
  /**
   * Sprint calendar for Sprint Number derivation. Defaults to
   * NDB_SPRINT_CALENDAR; supply your own for other tenants.
   */
  sprintCalendar?: SprintCalendar;
}

/**
 * Build the master processed dataset from per-release ticket lists.
 * Mirrors Python `process_master(per_release_tickets)`.
 *
 * Concatenates the per-release lists in input-map insertion order
 * (matters: `Object.entries` preserves insertion order in modern JS).
 * Each ticket gets the derived columns described in
 * `ProcessedTicketWithDerived`.
 *
 * Returns an empty array when the input is empty (matches the Python
 * "empty DataFrame with all columns" shape — but in TS we just return
 * `[]` and rely on `PROCESSED_DATASET_COLUMNS` for the schema).
 */
export function processMaster(
  perReleaseTickets: Record<string, ProcessedTicket[]>,
  options: ProcessMasterOptions
): ProcessedTicketWithDerived[] {
  if (!options?.labelPrefix) {
    throw new Error('processMaster: options.labelPrefix is required (D1)');
  }
  if (!options?.productPrefix) {
    throw new Error('processMaster: options.productPrefix is required (D1)');
  }
  const cal = options.sprintCalendar;
  const out: ProcessedTicketWithDerived[] = [];
  for (const tickets of Object.values(perReleaseTickets)) {
    for (const t of tickets) {
      const issueGroup = groupFor(t['Issue Type']);
      const workType = workTypeFor(t['Issue Type']);
      const resCat = categorizeResolution(t.Resolution);
      const isDone = isDoneResolution(t.Resolution);
      const isQaVerification =
        (t['Issue Type'] === 'Bug' || t['Issue Type'] === 'Improvement') &&
        t['Closed Date'] !== null &&
        isDone;
      out.push({
        ...t,
        'Priority Band': priorityBand(t.Priority),
        'Sprint Number': sprintFor(t['Resolved Date'], cal),
        'Closed Sprint Number': sprintFor(t['Closed Date'], cal),
        'Issue Group': issueGroup,
        'Work Type': workType,
        'Resolution Category': resCat,
        'Is Done': isDone,
        'Is Deferred': isDeferredLabel(t.Labels, t['Release Name'], {
          labelPrefix: options.labelPrefix,
        }),
        'Is Wishlist': isWishlistLabel(t.Labels, t['Release Name'], {
          labelPrefix: options.labelPrefix,
        }),
        'Is QA Verification': isQaVerification,
        'Release Type': classifyRelease(t['Release Name'], {
          productPrefix: options.productPrefix,
        }),
      });
    }
  }
  return out;
}

// ── Public re-exports for downstream consumers ─────────────────────────────

export type { PayloadBucketKey };
export { PAYLOAD_BUCKET_KEYS, WISHLIST_COMPONENT, DEFERRED_COMPONENT };
