/**
 * releaseDatasetService — Phase 1 of the trunk port.
 *
 * Ports the core fetch + dedup logic from
 * `ndb-release-sprint-analysis-with-chatbot/data_layer.py` (CONSOLIDATION
 * #1b) into a callable TS service. The full Python data layer is ~1,500
 * LOC; this phase ports ~400 LOC of essential machinery:
 *
 *   - The `ProcessedTicket` row shape (kept identical to the Python
 *     ticket dict so downstream insights/velocity/forecast ports don't
 *     have to translate field names)
 *   - `ticketFromIssue()` — raw JIRA issue → flat ticket dict
 *   - `fetchBucket()` — per-bucket paginated fetch via jiraConnector +
 *     payloadJqlService (single source of truth for the 5-bucket JQL)
 *   - `fetchReleaseData()` — orchestrator that fans out the 5 buckets
 *     + 2 sidecars in parallel and dedups within-release with the
 *     comma-joined `Components` tag
 *
 * Deferred to Phase 2:
 *
 *   - Components / Priority augmentation (the `_augment_*_inplace` family)
 *   - `processMaster()` — cross-release assembly into a single dataset
 *   - Sidecar merging helpers (`_merge_*_sidecar_inplace`)
 *
 * Deferred to Phase 3:
 *
 *   - Cache (per-release + bundle) — needs a re-imagined story for Node
 *     (the Python version uses pickle + ThreadPoolExecutor + Streamlit
 *     `@st.cache_data`; we'll likely use JSON + an explicit on-disk
 *     cache, or a SQLite layer)
 *   - `sync()` orchestration
 *   - Cache-schema upgrade path (the v11 story — probably a fresh start)
 *   - Targeted changelog fetch for `Closed Date` on Bug/Improvement
 *     (needs `jiraConnector.getIssue(key, { expand: 'changelog' })`
 *     which isn't on the connector yet)
 *
 * Product-agnostic notes (D1):
 *
 *   - `projectKey` is REQUIRED on every public entry. The Python
 *     hardcoded `project = ERA`; we pass it through so DataLens / NCM /
 *     other tenants can supply their own value via productService.
 *   - `labelPrefix` is required for the wishlist + deferred sidecars
 *     (the Python hardcoded `ndb-`). Caller supplies — same pattern as
 *     payloadJqlService.
 *
 * Payload scope (D36):
 *
 *   This service computes the **Engineering Payload** — every bucket
 *   query is scoped to `project = ${projectKey}` (see `fetchBucket`).
 *   That matches the legacy Python `data_layer.py` exactly and preserves
 *   the completion-% numbers people are used to seeing.
 *
 *   It does NOT yet compute the cross-team **Release Payload** (which
 *   would include TECHPUBS / FEAT / PM tickets carrying the same
 *   fixVersion). When the first cross-team consumer lands, add a
 *   `fetchReleasePayloadData` variant that omits the project scope and
 *   re-runs `processMaster` on the result. The bucket queries themselves
 *   are already project-agnostic — see `buildReleasePayloadJql`.
 */

import type { JiraConnector, JiraIssue } from '../connectors/jiraConnector.js';
import {
  DEFERRED_COMPONENT,
  PAYLOAD_BUCKET_KEYS,
  WISHLIST_COMPONENT,
  getComponentQueries,
  getDeferredQuery,
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
export const RELEASE_DATASET_FIELDS = [
  'issuetype',
  'status',
  'statusCategory',
  'resolution',
  'resolutiondate',
  'created',
  'updated',
  'fixVersions',
  'labels',
  'components',
  'priority',
  'assignee',
] as const;

/** Default page size — matches Python's PAGE_SIZE. */
export const DEFAULT_PAGE_SIZE = 500;

/** Default per-component max issue cap. */
export const DEFAULT_MAX_ISSUES_PER_BUCKET = 20_000;

/** Concurrency for the 5-bucket + 2-sidecar parallel fetch. */
export const DEFAULT_FETCH_CONCURRENCY = 7;

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

  return {
    'Issue Key': issue.key,
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
  };
}

// ── Bucket fetch ────────────────────────────────────────────────────────────

export interface FetchBucketResult {
  bucketName: string;
  issues: JiraIssue[];
  error: string | null;
}

export interface FetchBucketOptions {
  projectKey: string;
  pageSize?: number;
  maxIssues?: number;
  /**
   * Optional progress hook called as `(bucketName, status, detail)`.
   * Mirrors the Python `progress_cb` contract.
   */
  onProgress?: (bucketName: string, status: string, detail: string) => void;
}

/**
 * Fetch a single bucket's issues. Wraps the bucket JQL with the
 * project scope (`project = X AND (BUCKET_JQL)`), pages via jiraConnector.
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
  if (!options.projectKey) {
    throw new Error('fetchBucket: options.projectKey is required (D1)');
  }
  const fullJql = `project = ${options.projectKey} AND (${bucketJql})`;
  options.onProgress?.(bucketName, 'fetching', 'page 1');
  try {
    const issues = await jira.searchAll(fullJql, RELEASE_DATASET_FIELDS.join(','), {
      pageSize: options.pageSize ?? DEFAULT_PAGE_SIZE,
      maxIssues: options.maxIssues ?? DEFAULT_MAX_ISSUES_PER_BUCKET,
    });
    options.onProgress?.(bucketName, 'done', `${issues.length} fetched`);
    return { bucketName, issues, error: null };
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    options.onProgress?.(bucketName, 'error', msg);
    return { bucketName, issues: [], error: msg };
  }
}

// ── Release-level orchestration ────────────────────────────────────────────

export interface FetchReleaseOptions {
  /** JIRA project key (D1 — no hardcoded ERA). Required. */
  projectKey: string;
  /**
   * Label prefix for the wishlist + deferred sidecars (D1 — Python
   * hardcoded `ndb`). Required.
   */
  labelPrefix: string;
  /** Page size for the per-bucket searchAll. Default 500. */
  pageSize?: number;
  /** Max issues per bucket safety cap. Default 20,000. */
  maxIssuesPerBucket?: number;
  /**
   * Max concurrent bucket fetches. Default 7 (= 5 buckets + 2 sidecars).
   * Lower this if you hit JIRA rate limits.
   */
  concurrency?: number;
  /** Progress hook, see `FetchBucketOptions.onProgress`. */
  onProgress?: (bucketName: string, status: string, detail: string) => void;
}

/**
 * Fetch all 5 disjoint buckets plus the wishlist + deferred sidecars
 * for one release, dedup within-release, and emit the processed ticket
 * rows.
 *
 * Order of operations (mirrors Python `fetch_release_data`):
 *
 *   1. Build the fetch plan: 5 bucket JQLs + 2 sidecar JQLs (label-based,
 *      not in the 5-bucket union — see payloadJqlService docs).
 *   2. Fan out the 7 fetches with bounded concurrency.
 *   3. Within-release dedup by `Issue Key`, preserving fetch order
 *      (buckets first, then wishlist, then deferred) so a sidecar
 *      ticket that's also in-payload is *seeded* with its real bucket
 *      and only *appended* with the sidecar tag in `Components`.
 *
 * The `error` field is the first bucket error encountered — partial
 * results land regardless, but callers should surface the error so the
 * user knows the dataset is incomplete.
 *
 * NOT YET DONE in Phase 1 (matches the deferred list at top of file):
 *
 *   - Targeted changelog fetch to fill `Closed Date` for Bug/Improvement
 *     tickets resolved as Done. The row's `Closed Date` will always be
 *     `null` here. Insights that rely on it will need to either wait
 *     for Phase 2 or skip the metric.
 */
export async function fetchReleaseData(
  jira: JiraConnector,
  release: string,
  options: FetchReleaseOptions
): Promise<FetchReleaseResult> {
  if (!release) throw new Error('fetchReleaseData: release is required');
  if (!options.projectKey) {
    throw new Error('fetchReleaseData: options.projectKey is required (D1)');
  }
  if (!options.labelPrefix) {
    throw new Error('fetchReleaseData: options.labelPrefix is required (D1)');
  }

  const buckets = getComponentQueries(release);

  // Fetch-plan keys order is significant: 5 buckets in their canonical
  // order, then wishlist, then deferred. The dedup loop iterates this
  // exact order so the within-release Components tag composition is
  // deterministic.
  const fetchPlan: Array<{ name: string; jql: string }> = [
    ...PAYLOAD_BUCKET_KEYS.map((k) => ({ name: k, jql: buckets[k] })),
    {
      name: WISHLIST_COMPONENT,
      jql: getWishlistQuery(release, { labelPrefix: options.labelPrefix }),
    },
    {
      name: DEFERRED_COMPONENT,
      jql: getDeferredQuery(release, { labelPrefix: options.labelPrefix }),
    },
  ];

  // Bounded-concurrency fan-out. Node has no built-in primitive for
  // this; a simple worker-pool over the plan is enough and matches
  // Python's ThreadPoolExecutor cap.
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
