/**
 * releaseInsightsService — payload-level analytics over a processed dataset.
 *
 * First slice of CONSOLIDATION.md #3 (`insights.py`, ~2,754 LOC). Ports
 * the highest-leverage metric family — payload metrics + label-anchored
 * metrics — so downstream consumers (Release Analysis page, chatbot,
 * team-exec report) can compute "what's in this release" without
 * needing the rest of insights.py.
 *
 * Pure functions over `ProcessedTicketWithDerived[]` (in-memory). The
 * caller is expected to have already produced the dataset via
 * `fetchReleaseData(...)` + `processMaster(...)`.
 *
 * What's in this slice:
 *
 *   - `VISIBLE_COMPONENTS` — the 5 bucket keys (excludes sidecars)
 *   - `filterVisiblePayload(rows, release)` — visible-components slice
 *     for a release (matches Release Analysis exactly)
 *   - `filterFullRelease(rows, release)` — all rows for a release
 *     including sidecar-only ones (used by label-anchored metrics so
 *     deferred count matches JIRA exactly)
 *   - `computePayloadMetrics(visible, { ga, bc })` — planned_total /
 *     completed_by_ga / deferred / open / unresolved / completion_pct
 *     + 5 issue-group shares + 3 arm shares + left-shift signals
 *     (pre_bc_share, test_pre_bc_share) + tail_share_at_ga
 *   - `computeLabelAnchoredMetrics(full, visible, release)` — total
 *     deferred (JIRA-label-anchored) + deferred_carry_over_count
 *     (visible tickets carrying earlier-release deferred labels)
 *   - `computeReleaseInsights(rows, release, ctx)` — convenience that
 *     fans out the above and returns the combined dict
 *
 * NOT in this slice (deferred to follow-ups within #3):
 *
 *   - Flow / triage debt / cohort / cycle-time / interval metrics
 *   - Velocity / pace metrics
 *   - `compute_release_matrix` / `compute_team_matrix` (multi-release
 *     comparison + per-team rollup)
 *   - Phase-normalised timing
 *   - Action recommendations (insights_actions.py)
 *   - History tracking (insights_history.py)
 *
 * The metric output dict keys are kept EXACTLY as Python's so the
 * Release Analysis port and chatbot snapshot ports can drop in without
 * translation.
 */

import { PAYLOAD_BUCKET_KEYS } from './payloadJqlService.js';
import { DISPLAY_GROUPS, type IssueGroup } from './issueGroupsService.js';
import {
  compareSortKeys,
  sortKey,
  type ClassificationOptions,
} from './releaseClassificationService.js';
import {
  extractDeferredSourceReleases,
  type ProcessedTicketWithDerived,
} from './releaseDatasetService.js';

/**
 * The 5 payload bucket keys (excluding wishlist + deferred sidecars).
 * Matches Python `VISIBLE_COMPONENTS`. Tickets are "visible" to the
 * Release Analysis page if ANY of their comma-joined Components tags
 * is one of these five.
 */
export const VISIBLE_COMPONENTS: ReadonlySet<string> = new Set(PAYLOAD_BUCKET_KEYS);

/**
 * The 3 KPI arms (kept stable for backward-compat with the legacy
 * dashboard's `arm_project_share` / `arm_standalone_share` /
 * `arm_unparented_share` metric IDs).
 */
const ARM_PROJECT_BUCKETS = ['top_level_projects', 'work_toward_project'];
const ARM_STANDALONE_BUCKETS = [
  'standalone_epics',
  'work_toward_standalone_epic',
];
const ARM_UNPARENTED_BUCKETS = ['direct_tickets'];

// ── Pure filtering helpers ────────────────────────────────────────────────

function rowInVisibleComponents(componentsString: string | null | undefined): boolean {
  if (!componentsString) return false;
  for (const tag of componentsString.split(',')) {
    if (VISIBLE_COMPONENTS.has(tag)) return true;
  }
  return false;
}

/**
 * Restrict to the visible-components slice for one release. Matches
 * Release Analysis exactly so payload metrics line up.
 */
export function filterVisiblePayload<T extends ProcessedTicketWithDerived>(
  rows: T[],
  release: string
): T[] {
  return rows.filter(
    (r) =>
      r['Release Name'] === release && rowInVisibleComponents(r.Components)
  );
}

/**
 * All rows for `release` including sidecar-only ones (wishlist,
 * deferred). Used by label-anchored metrics so the count matches
 * JIRA's `labels = "..."` query regardless of bucket membership.
 */
export function filterFullRelease<T extends ProcessedTicketWithDerived>(
  rows: T[],
  release: string
): T[] {
  return rows.filter((r) => r['Release Name'] === release);
}

// ── Payload metrics ────────────────────────────────────────────────────────

export interface PayloadMetricsContext {
  /**
   * GA (release) date as a Date or null. Tickets resolved on/before this
   * count as `completed_by_ga`. Required for `completion_pct` to be
   * meaningful (if null, ALL Done tickets count as completed).
   */
  ga: Date | null;
  /**
   * Branch Cut date. Used to compute the left-shift signals
   * (`pre_bc_share`, `test_pre_bc_share`). Null → both NaN so the
   * dashboard doesn't show a spurious 0.
   */
  bc?: Date | null;
}

/**
 * Output of `computePayloadMetrics`. Field names match the Python dict
 * so downstream ports (Release Analysis, chatbot snapshot) consume
 * without translation. Numbers are kept as `number`; left-shift shares
 * use `NaN` (not null) when undefined, matching Python's `float('nan')`.
 */
export interface PayloadMetrics {
  planned_total: number;
  completed_by_ga: number;
  deferred: number;
  open: number;
  unresolved: number;
  completion_pct: number;
  bug_share: number;
  improvement_share: number;
  devcode_share: number;
  test_share: number;
  else_share: number;
  arm_project_share: number;
  arm_standalone_share: number;
  arm_unparented_share: number;
  /** NaN when BC is missing (intentional — matches Python). */
  pre_bc_share: number;
  /** NaN when BC is missing (intentional — matches Python). */
  test_pre_bc_share: number;
  tail_share_at_ga: number;
}

const EMPTY_PAYLOAD_METRICS: PayloadMetrics = {
  planned_total: 0,
  completed_by_ga: 0,
  deferred: 0,
  open: 0,
  unresolved: 0,
  completion_pct: 0,
  bug_share: 0,
  improvement_share: 0,
  devcode_share: 0,
  test_share: 0,
  else_share: 0,
  arm_project_share: 0,
  arm_standalone_share: 0,
  arm_unparented_share: 0,
  pre_bc_share: Number.NaN,
  test_pre_bc_share: Number.NaN,
  tail_share_at_ga: 0,
};

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function componentsHasAnyOf(
  componentsString: string | null | undefined,
  tags: string[]
): boolean {
  if (!componentsString) return false;
  const rowTags = componentsString.split(',');
  for (const t of tags) {
    if (rowTags.includes(t)) return true;
  }
  return false;
}

/**
 * Compute payload counts + shares for a single release's visible slice.
 * Mirrors Python `_payload_metrics` field-for-field.
 *
 * Lifecycle rules (locked in by the chatbot work):
 *
 *   - `completed_by_ga` = Is Done AND Resolved Date ≤ GA (or just
 *     Is Done when GA is null)
 *   - `open` = max(0, total - completed - deferred) so a deferred-
 *     and-done ticket isn't double-counted as both
 *   - `unresolved` excludes already-deferred (a deferred ticket has
 *     had its disposition decided — it's not in the queue to triage)
 *   - left-shift shares restrict the denominator to Done-by-GA-with-
 *     a-Resolved-Date so post-GA churn doesn't dilute them
 */
export function computePayloadMetrics(
  visible: ProcessedTicketWithDerived[],
  ctx: PayloadMetricsContext
): PayloadMetrics {
  const total = visible.length;
  if (total === 0) return { ...EMPTY_PAYLOAD_METRICS };

  const ga = ctx.ga;
  const bc = ctx.bc ?? null;

  // Core lifecycle counts. We compute Boolean masks once (one pass per
  // row) instead of using filter().length repeatedly — same result,
  // less garbage. Closed-Date / Resolved-Date are converted lazily.
  let completed = 0;
  let deferred = 0;
  let unresolved = 0;
  // Per-group counts
  const groupCounts: Record<IssueGroup, number> = {
    'Project Hierarchy': 0,
    Bug: 0,
    Improvement: 0,
    'Dev Code': 0,
    Test: 0,
    'Everything Else': 0,
  };
  // Arm counts
  let armP = 0;
  let armS = 0;
  let armU = 0;
  // Left-shift window collectors
  let doneInWindow = 0;
  let preBcCount = 0;
  let testInWindow = 0;
  let testPreBcCount = 0;

  for (const row of visible) {
    const isDeferred = Boolean(row['Is Deferred']);
    const isDone = Boolean(row['Is Done']);
    const resolved = toDate(row['Resolved Date']);
    // `completed_by_ga`: Done AND (GA missing OR Resolved Date ≤ GA).
    // Note Python filters on `payload["Resolved Date"] <= ga` which
    // requires the date is present — we reproduce that by requiring
    // `resolved !== null` when GA is set.
    const completedByGa = isDone && (ga === null || (resolved !== null && resolved <= ga));
    if (completedByGa) completed += 1;
    if (isDeferred) deferred += 1;
    if (row['Resolution Category'] === 'Unresolved' && !isDeferred) {
      unresolved += 1;
    }

    groupCounts[row['Issue Group']] += 1;

    if (componentsHasAnyOf(row.Components, ARM_PROJECT_BUCKETS)) armP += 1;
    if (componentsHasAnyOf(row.Components, ARM_STANDALONE_BUCKETS)) armS += 1;
    if (componentsHasAnyOf(row.Components, ARM_UNPARENTED_BUCKETS)) armU += 1;

    if (bc !== null && completedByGa && resolved !== null) {
      doneInWindow += 1;
      if (resolved < bc) preBcCount += 1;
      if (row['Issue Type'] === 'Test') {
        testInWindow += 1;
        if (resolved < bc) testPreBcCount += 1;
      }
    }
  }

  const open = Math.max(0, total - completed - deferred);

  let preBcShare = Number.NaN;
  let testPreBcShare = Number.NaN;
  if (bc !== null && doneInWindow > 0) {
    preBcShare = preBcCount / doneInWindow;
    testPreBcShare = testInWindow > 0 ? testPreBcCount / testInWindow : 0;
  }

  return {
    planned_total: total,
    completed_by_ga: completed,
    deferred,
    open,
    unresolved,
    completion_pct: (completed / total) * 100,
    bug_share: groupCounts.Bug / total,
    improvement_share: groupCounts.Improvement / total,
    devcode_share: groupCounts['Dev Code'] / total,
    test_share: groupCounts.Test / total,
    else_share: groupCounts['Everything Else'] / total,
    arm_project_share: armP / total,
    arm_standalone_share: armS / total,
    arm_unparented_share: armU / total,
    pre_bc_share: preBcShare,
    test_pre_bc_share: testPreBcShare,
    tail_share_at_ga: unresolved / total,
  };
}

// Verify the DISPLAY_GROUPS array still matches our hard-coded share
// keys — if the upstream changes (e.g. a 6th display group lands), this
// assertion alerts us so we don't silently miss it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _DISPLAY_GROUPS_SHAPE: ReadonlyArray<IssueGroup> = DISPLAY_GROUPS;

// ── Label-anchored metrics ─────────────────────────────────────────────────

export interface LabelAnchoredMetrics {
  /** Total Is Deferred count in the full slice (matches JIRA exactly). */
  deferred: number;
  /**
   * Visible-payload tickets carrying an earlier-release deferred label.
   * Within-row dedup: a ticket with multiple earlier-deferred labels
   * counts once.
   */
  deferred_carry_over_count: number;
}

export interface LabelAnchoredOptions {
  /** Label prefix for `extractDeferredSourceReleases` (D1). */
  labelPrefix: string;
  /** Canonical release name prefix (D1). */
  productPrefix: string;
}

/**
 * Compute label-anchored deferred metrics. Mirrors Python
 * `_label_anchored_metrics`.
 *
 *   - `deferred`: total Is Deferred in the FULL slice (includes
 *     label-only sidecar rows that aren't in the 5 buckets)
 *   - `deferred_carry_over_count`: VISIBLE tickets that carry an
 *     `<prefix>-<X>-deferred` label where X sorts strictly earlier
 *     than `release` per `releaseClassificationService.sortKey`.
 *     A ticket with multiple earlier-deferred labels counts once.
 */
export function computeLabelAnchoredMetrics(
  fullSlice: ProcessedTicketWithDerived[],
  visiblePayload: ProcessedTicketWithDerived[],
  release: string,
  options: LabelAnchoredOptions
): LabelAnchoredMetrics {
  if (!options?.labelPrefix) {
    throw new Error(
      'computeLabelAnchoredMetrics: options.labelPrefix is required (D1)'
    );
  }
  if (!options?.productPrefix) {
    throw new Error(
      'computeLabelAnchoredMetrics: options.productPrefix is required (D1)'
    );
  }

  const out: LabelAnchoredMetrics = {
    deferred: 0,
    deferred_carry_over_count: 0,
  };

  for (const row of fullSlice) {
    if (row['Is Deferred']) out.deferred += 1;
  }

  if (visiblePayload.length === 0) return out;

  // Build sort key for the current release once. Anything that fails
  // to parse (release name doesn't match the productPrefix shape)
  // bails out with the deferred count we already have.
  const classOpts: ClassificationOptions = { productPrefix: options.productPrefix };
  let curKey;
  try {
    curKey = sortKey(release, classOpts);
  } catch {
    return out;
  }

  for (const row of visiblePayload) {
    const sources = extractDeferredSourceReleases(row.Labels, options);
    let hasEarlier = false;
    for (const src of sources) {
      if (src === release) continue;
      try {
        if (compareSortKeys(sortKey(src, classOpts), curKey) < 0) {
          hasEarlier = true;
          break;
        }
      } catch {
        // unparseable source — ignore
      }
    }
    if (hasEarlier) out.deferred_carry_over_count += 1;
  }

  return out;
}

// ── Convenience: combined release-level insights ──────────────────────────

export interface ReleaseInsights extends PayloadMetrics, LabelAnchoredMetrics {
  release: string;
  /** Visible-payload total. Same as `planned_total` but uncoupled from PayloadMetrics. */
  visible_total: number;
  /** Full-release total (visible + sidecar-only). */
  full_total: number;
}

export interface ReleaseInsightsOptions
  extends PayloadMetricsContext,
    LabelAnchoredOptions {}

/**
 * Compute the full set of release-level insights covered by this Phase
 * (payload + label-anchored). Single entry point for the common case
 * where a caller wants both metric families.
 */
export function computeReleaseInsights(
  rows: ProcessedTicketWithDerived[],
  release: string,
  options: ReleaseInsightsOptions
): ReleaseInsights {
  const fullSlice = filterFullRelease(rows, release);
  const visible = filterVisiblePayload(rows, release);
  const payload = computePayloadMetrics(visible, options);
  const labelAnchored = computeLabelAnchoredMetrics(
    fullSlice,
    visible,
    release,
    options
  );
  // The label-anchored `deferred` count is canonical (it counts the
  // full slice including sidecar-only rows); it overrides the
  // payload-level deferred count where they differ.
  return {
    ...payload,
    ...labelAnchored,
    release,
    visible_total: visible.length,
    full_total: fullSlice.length,
  };
}
