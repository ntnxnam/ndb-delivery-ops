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
  chunkKeys,
  getComponentQueries,
  getDeferredQuery,
  getExtensionQuery,
  getLongTermFundedQuery,
  getLongTermProjectsQuery,
  getMovedOutQuery,
  getWishlistQuery,
  jqlEpicsByParentKeys,
  jqlWorkByEpicKeys,
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

/** Concurrency for the bucket fetch. Always 1 — parallel /search trips JIRA 429. */
export const DEFAULT_FETCH_CONCURRENCY = 1;

/** Pause between sequential JIRA searches so a wave does not burst the rate limit. */
const BETWEEN_SEARCH_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * History-scan buckets whose first /search page routinely exceeds the
 * connector default of 30s. Used by fetchReleaseData unless the caller
 * passes an explicit perPageTimeoutMs.
 */
export const SLOW_BUCKETS = new Set<string>([
  MOVED_OUT_COMPONENT,
]);

/** Per-page timeout for SLOW_BUCKETS. Still under nginx's 300s proxy window. */
export const SLOW_BUCKET_TIMEOUT_MS = 120_000;

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
  /** Per-bucket fetch failures. Empty when every bucket succeeded. */
  bucketErrors: Record<string, string>;
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
    'Risk Indicator': typeof f.customfield_23560 === 'string'
      ? f.customfield_23560
      : (f.customfield_23560 as { value?: string } | null)?.value ?? '',

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
  /**
   * Per-page HTTP timeout passed directly to jiraConnector.searchAll.
   * Defaults to jiraConnector's own default (30 s). History-scan buckets
   * (`moved_out` / `fixVersion was`) should pass a larger value.
   */
  perPageTimeoutMs?: number;
  /**
   * Comma-separated field list for /search. Defaults to RELEASE_DATASET_FIELDS.
   * Pass `'key'` for precursor key-only fetches.
   */
  fields?: string;
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
  const fieldList = options.fields ?? RELEASE_DATASET_FIELDS.join(',');
  options.onProgress?.(bucketName, 'fetching', 'page 1');
  const searchOnce = () =>
    jira.searchAll(fullJql, fieldList, {
      pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
      maxIssues: options.maxIssues ?? DEFAULT_MAX_ISSUES_PER_BUCKET,
      perPageTimeoutMs: options.perPageTimeoutMs,
    });
  try {
    const issues = await searchOnce();
    options.onProgress?.(bucketName, 'done', `${issues.length} fetched`);
    return { bucketName, issues, error: null };
  } catch (err) {
    if (isJiraTimeout(err)) {
      options.onProgress?.(bucketName, 'fetching', 'retry after timeout');
      try {
        const issues = await searchOnce();
        options.onProgress?.(bucketName, 'done', `${issues.length} fetched (retry)`);
        return { bucketName, issues, error: null };
      } catch (retryErr) {
        return failBucket(bucketName, release, retryErr, options.onProgress);
      }
    }
    return failBucket(bucketName, release, err, options.onProgress);
  }
}

function isJiraTimeout(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  const code = (err as { code?: string })?.code;
  return (
    /timeout|timed out|ETIMEDOUT|ECONNABORTED/i.test(msg) ||
    code === 'ECONNABORTED' ||
    code === 'ETIMEDOUT'
  );
}

function failBucket(
  bucketName: string,
  release: string,
  err: unknown,
  onProgress: FetchBucketOptions['onProgress']
): FetchBucketResult {
  const wrapped = JiraConnector.wrapError(err);
  const msg = `[${bucketName}] ${wrapped.message} (HTTP ${wrapped.statusCode})`;
  // eslint-disable-next-line no-console
  console.error(
    `[releaseDatasetService] fetchBucket error for ${release}/${bucketName}:`,
    wrapped.message,
    wrapped.details ?? ''
  );
  onProgress?.(bucketName, 'error', msg);
  return { bucketName, issues: [], error: msg };
}

const KEY_ONLY_FIELDS = 'key';

function keysFromIssues(issues: JiraIssue[]): string[] {
  return issues.map((i) => i.key).filter(Boolean);
}

function emptyBucket(bucketName: string): FetchBucketResult {
  return { bucketName, issues: [], error: null };
}

async function runNamedFetches(
  jira: JiraConnector,
  release: string,
  plans: Array<{ name: string; jql: string; fields?: string }>,
  options: FetchBucketOptions,
  concurrencyCap: number
): Promise<FetchBucketResult[]> {
  if (plans.length === 0) return [];
  const concurrency = Math.min(Math.max(concurrencyCap, 1), plans.length);
  const results: FetchBucketResult[] = new Array(plans.length);
  let nextIdx = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIdx++;
      if (i >= plans.length) return;
      const plan = plans[i]!;
      const timeout =
        options.perPageTimeoutMs ??
        (SLOW_BUCKETS.has(plan.name) ? SLOW_BUCKET_TIMEOUT_MS : undefined);
      results[i] = await fetchBucket(jira, release, plan.name, plan.jql, {
        ...options,
        perPageTimeoutMs: timeout,
        fields: plan.fields,
      });
      if (BETWEEN_SEARCH_MS > 0 && i + 1 < plans.length) {
        await sleep(BETWEEN_SEARCH_MS);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return results;
}

async function fetchKeyedChunks(
  jira: JiraConnector,
  release: string,
  bucketName: string,
  keys: string[],
  buildJql: (chunk: string[]) => string,
  options: FetchBucketOptions
): Promise<FetchBucketResult> {
  if (keys.length === 0) return emptyBucket(bucketName);
  const chunks = chunkKeys(keys);
  const all: JiraIssue[] = [];
  let firstErr: string | null = null;
  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c]!;
    const jql = buildJql(chunk);
    if (!jql) continue;
    options.onProgress?.(
      bucketName,
      'fetching',
      `chunk ${c + 1}/${chunks.length} (${chunk.length} keys)`
    );
    const r = await fetchBucket(jira, release, bucketName, jql, options);
    all.push(...r.issues);
    if (r.error && !firstErr) firstErr = r.error;
    if (BETWEEN_SEARCH_MS > 0 && c + 1 < chunks.length) {
      await sleep(BETWEEN_SEARCH_MS);
    }
  }
  const seen = new Set<string>();
  const issues: JiraIssue[] = [];
  for (const issue of all) {
    if (seen.has(issue.key)) continue;
    seen.add(issue.key);
    issues.push(issue);
  }
  return { bucketName, issues, error: firstErr };
}

function recordResult(
  map: Map<string, FetchBucketResult>,
  result: FetchBucketResult
): void {
  map.set(result.bucketName, result);
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
   * Ignored — fetches always run one JIRA search at a time. Parallel
   * /search trips HTTP 429. Kept on the options type so callers don't break.
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
  /**
   * When set, only the named buckets in this list are fetched.
   * All others in the fetch plan are skipped. Used by the cell-sync
   * path (`syncReleaseBucket`) to re-fetch a single bucket without
   * triggering a full release re-fetch.
   *
   * When omitted or empty, all buckets are fetched (normal behaviour).
   */
  bucketFilter?: string[];
  /**
   * Per-request timeout override for all buckets (milliseconds).
   * When omitted the connector default (30 s) is used for cheap buckets;
   * history-scan buckets in SLOW_BUCKETS (`moved_out`) get 120 s.
   */
  perPageTimeoutMs?: number;
}

/**
 * Fetch all 3 groups (6 Group-1 buckets + Group-2 moved-out + Group-3
 * long-term funded) plus label sidecars for one release, dedup
 * within-release, and emit the processed ticket rows.
 *
 * Fetch strategy (`FETCH_STRATEGY` = indexed-parent-epic-v1):
 *
 *   Wave 1 — indexed / cheap JQL, one search at a time:
 *     top_level_projects, standalone_epics, direct_tickets,
 *     moved_out, long_term_projects, sidecars
 *   Wave 2 — Parent Link IN (feature keys), chunked:
 *     epics_of_projects, work_toward_standalone_epic, long_term_epics
 *   Wave 3 — Epic Link IN (epic keys), chunked:
 *     work_toward_project, long_term_work
 *
 * Nested ScriptRunner `portfolioChildrenOf` / `issuesInEpics` are NOT
 * executed at fetch time. Click-through JQL in getComponentQueries still
 * uses them for JIRA hyperlinks.
 *
 * Cell sync (`bucketFilter`) still walks the parent chain as key-only
 * precursor fetches so a Work cell does not need a full Projects refetch.
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
  const labelSuffix = deriveReleaseSuffix(release, options.labelPrefix);
  const sidecarsSafe = !/\s/.test(labelSuffix);
  const allowBucket = options.bucketFilter && options.bucketFilter.length > 0
    ? new Set(options.bucketFilter)
    : null;
  const wants = (name: string): boolean => allowBucket === null || allowBucket.has(name);
  const hasFuture = !!(options.futureReleases && options.futureReleases.length > 0);
  const concurrency = 1;
  const baseOpts: FetchBucketOptions = {
    projectKey: options.projectKey,
    pageSize: options.pageSize,
    maxIssues: options.maxIssuesPerBucket,
    onProgress: options.onProgress,
    perPageTimeoutMs: options.perPageTimeoutMs,
  };

  const resultMap = new Map<string, FetchBucketResult>();
  const failedChild = (name: string, err: string): FetchBucketResult => ({
    bucketName: name,
    issues: [],
    error: err,
  });

  const wantTop = wants('top_level_projects');
  const wantEpics = wants('epics_of_projects');
  const wantWork = wants('work_toward_project');
  const wantSaEpics = wants('standalone_epics');
  const wantSaWork = wants('work_toward_standalone_epic');
  const wantDirect = wants('direct_tickets');
  const wantMoved = wants(MOVED_OUT_COMPONENT) && !catchAll;
  const wantLtProjects = wants(LONG_TERM_PROJECTS_COMPONENT) && hasFuture;
  const wantLtEpics = wants(LONG_TERM_EPICS_COMPONENT) && hasFuture;
  const wantLtWork = wants(LONG_TERM_WORK_COMPONENT) && hasFuture;

  // Precursors: a child cell still needs parent keys even if the parent
  // bucket is not being persisted this run.
  const needTopKeys = wantTop || wantEpics || wantWork;
  const needSaEpicKeys = wantSaEpics || wantSaWork;
  const needLtProjectKeys = wantLtProjects || wantLtEpics || wantLtWork;

  // ── Wave 1: independent indexed queries ─────────────────────────────────
  const wave1: Array<{ name: string; jql: string; fields?: string }> = [];
  if (needTopKeys) {
    wave1.push({
      name: 'top_level_projects',
      jql: buckets.top_level_projects,
      fields: wantTop ? undefined : KEY_ONLY_FIELDS,
    });
  }
  if (needSaEpicKeys) {
    wave1.push({
      name: 'standalone_epics',
      jql: buckets.standalone_epics,
      fields: wantSaEpics ? undefined : KEY_ONLY_FIELDS,
    });
  }
  if (wantDirect) {
    wave1.push({ name: 'direct_tickets', jql: buckets.direct_tickets });
  }
  if (wantMoved) {
    wave1.push({ name: MOVED_OUT_COMPONENT, jql: getMovedOutQuery(release) });
  }
  if (needLtProjectKeys) {
    wave1.push({
      name: LONG_TERM_PROJECTS_COMPONENT,
      jql: getLongTermProjectsQuery({ futureReleases: options.futureReleases! }),
      fields: wantLtProjects ? undefined : KEY_ONLY_FIELDS,
    });
  }
  if (sidecarsSafe) {
    const sidecars = [
      { name: WISHLIST_COMPONENT, jql: getWishlistQuery(release, sidecarOpts) },
      { name: DEFERRED_COMPONENT, jql: getDeferredQuery(release, sidecarOpts) },
      { name: LONG_TERM_COMPONENT, jql: getLongTermFundedQuery(release, sidecarOpts) },
      { name: EXTENSION_COMPONENT, jql: getExtensionQuery(release, sidecarOpts) },
    ];
    for (const s of sidecars) {
      if (wants(s.name)) wave1.push(s);
    }
  }

  const wave1Results = await runNamedFetches(jira, release, wave1, baseOpts, concurrency);
  for (const r of wave1Results) {
    if (wants(r.bucketName)) recordResult(resultMap, r);
  }

  const topWave = wave1Results.find((r) => r.bucketName === 'top_level_projects');
  const saWave = wave1Results.find((r) => r.bucketName === 'standalone_epics');
  const ltWave = wave1Results.find((r) => r.bucketName === LONG_TERM_PROJECTS_COMPONENT);
  const topLevelKeys = keysFromIssues(topWave?.issues ?? []);
  const standaloneEpicKeys = keysFromIssues(saWave?.issues ?? []);
  const longTermProjectKeys = keysFromIssues(ltWave?.issues ?? []);
  const topErr = topWave?.error ?? null;
  const saErr = saWave?.error ?? null;
  const ltErr = ltWave?.error ?? null;

  // ── Wave 2: Parent Link / standalone-epic children (one search at a time)
  let projectEpicKeys: string[] = [];
  let longTermEpicKeys: string[] = [];

  if (wantEpics || wantWork) {
    if (topErr) {
      if (wantEpics) recordResult(resultMap, failedChild('epics_of_projects', topErr));
      if (wantWork) recordResult(resultMap, failedChild('work_toward_project', topErr));
    } else {
      const r = await fetchKeyedChunks(
        jira,
        release,
        'epics_of_projects',
        topLevelKeys,
        (chunk) => jqlEpicsByParentKeys(chunk),
        { ...baseOpts, fields: wantEpics ? undefined : KEY_ONLY_FIELDS }
      );
      projectEpicKeys = keysFromIssues(r.issues);
      if (wantEpics) recordResult(resultMap, r);
      else if (r.error && wantWork) {
        recordResult(resultMap, failedChild('work_toward_project', r.error));
      }
    }
  }

  if (wantSaWork) {
    if (saErr) {
      recordResult(resultMap, failedChild('work_toward_standalone_epic', saErr));
    } else {
      const extra = catchAll ? 'updated >= startOfYear(-1)' : '';
      const r = await fetchKeyedChunks(
        jira,
        release,
        'work_toward_standalone_epic',
        standaloneEpicKeys,
        (chunk) => jqlWorkByEpicKeys(chunk, extra),
        baseOpts
      );
      recordResult(resultMap, r);
    }
  }

  if (wantLtEpics || wantLtWork) {
    if (ltErr) {
      if (wantLtEpics) recordResult(resultMap, failedChild(LONG_TERM_EPICS_COMPONENT, ltErr));
      if (wantLtWork) recordResult(resultMap, failedChild(LONG_TERM_WORK_COMPONENT, ltErr));
    } else {
      const r = await fetchKeyedChunks(
        jira,
        release,
        LONG_TERM_EPICS_COMPONENT,
        longTermProjectKeys,
        (chunk) => jqlEpicsByParentKeys(chunk),
        { ...baseOpts, fields: wantLtEpics ? undefined : KEY_ONLY_FIELDS }
      );
      longTermEpicKeys = keysFromIssues(r.issues);
      if (wantLtEpics) recordResult(resultMap, r);
      else if (r.error && wantLtWork) {
        recordResult(resultMap, failedChild(LONG_TERM_WORK_COMPONENT, r.error));
      }
    }
  }

  if (wantEpics && !resultMap.has('epics_of_projects')) {
    recordResult(resultMap, emptyBucket('epics_of_projects'));
  }
  if (wantSaWork && !resultMap.has('work_toward_standalone_epic')) {
    recordResult(resultMap, emptyBucket('work_toward_standalone_epic'));
  }
  if (wantLtEpics && !resultMap.has(LONG_TERM_EPICS_COMPONENT)) {
    recordResult(resultMap, emptyBucket(LONG_TERM_EPICS_COMPONENT));
  }

  // ── Wave 3: work under project epics (one search at a time) ─────────────
  if (wantWork && !resultMap.has('work_toward_project')) {
    const r = await fetchKeyedChunks(
      jira,
      release,
      'work_toward_project',
      projectEpicKeys,
      (chunk) => jqlWorkByEpicKeys(chunk),
      baseOpts
    );
    recordResult(resultMap, r);
  }
  if (wantLtWork && !resultMap.has(LONG_TERM_WORK_COMPONENT)) {
    const r = await fetchKeyedChunks(
      jira,
      release,
      LONG_TERM_WORK_COMPONENT,
      longTermEpicKeys,
      (chunk) => jqlWorkByEpicKeys(chunk),
      baseOpts
    );
    recordResult(resultMap, r);
  }

  if (wantWork && !resultMap.has('work_toward_project')) {
    recordResult(resultMap, emptyBucket('work_toward_project'));
  }
  if (wantDirect && !resultMap.has('direct_tickets')) {
    recordResult(resultMap, emptyBucket('direct_tickets'));
  }

  const fetchOrder = [
    ...PAYLOAD_BUCKET_KEYS,
    MOVED_OUT_COMPONENT,
    LONG_TERM_PROJECTS_COMPONENT,
    LONG_TERM_EPICS_COMPONENT,
    LONG_TERM_WORK_COMPONENT,
    WISHLIST_COMPONENT,
    DEFERRED_COMPONENT,
    LONG_TERM_COMPONENT,
    EXTENSION_COMPONENT,
  ];

  let firstErr: string | null = null;
  const bucketCounts: Record<string, number> = {};
  const bucketErrors: Record<string, string> = {};
  const byKey = new Map<string, ProcessedTicket>();
  for (const bucketName of fetchOrder) {
    const bucketResult = resultMap.get(bucketName);
    if (!bucketResult) continue;
    bucketCounts[bucketName] = bucketResult.issues.length;
    if (bucketResult.error) {
      bucketErrors[bucketName] = bucketResult.error;
      if (!firstErr) firstErr = bucketResult.error;
    }
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
    bucketErrors,
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
  const stripped = lower.startsWith(`${labelPrefix.toLowerCase()}-`)
    ? lower.slice(labelPrefix.length + 1)
    : lower;
  // JQL label values cannot contain spaces — collapse whitespace to hyphens.
  return stripped.replace(/[\s]+/g, '-');
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
