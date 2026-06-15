/**
 * releaseDatasetSync — Phase 3 of the trunk port (CONSOLIDATION #1b).
 *
 * Ports two pieces of `data_layer.py` that finally close out the
 * deferred items from the Phase-1 docstring:
 *
 *   1. **Targeted changelog enrichment** for `Closed Date`. After the
 *      Phase-1 parallel bucket fetch, walk every Bug/Improvement that
 *      resolved as Done and call `jiraConnector.getIssue(key, { expand:
 *      'changelog' })` to find the most-recent status → Closed transition
 *      timestamp. Required for the QA Verification flag (per
 *      `sprint-velocity-types.mdc` — Bug/Improvement closed within the
 *      sprint window = QA verified the fix).
 *
 *   2. **Sync orchestration**. The "when to refetch vs read cache"
 *      decision tree lives here. Two modes, both mirrored from the
 *      Python `sync()`:
 *
 *      - **full sync** (`forceReleases` empty or omitted): for every
 *        release, try the strict cache loader first; only hit JIRA on
 *        miss.
 *      - **scoped refetch** (`forceReleases` non-empty): refetch
 *        exactly those releases, leave every other on-disk cache alone,
 *        and rebuild the bundle by merging the freshly-fetched data
 *        with what's still loadable from disk.
 *
 * D1 wiring (D34): every public entry takes its `projectKey`,
 * `labelPrefix`, `productPrefix` from the caller, who in production
 * resolves them through `productService`. The smoke test demonstrates
 * the full chain end-to-end.
 *
 * Payload semantics (D36): this orchestrator computes the
 * **Engineering Payload** (project-scoped, same as `fetchReleaseData`).
 * A `syncRelease` variant for the cross-team Release Payload will be
 * added when the first consumer lands; the structure of this module
 * supports adding it without rewriting the cache layer.
 */

import type { JiraConnector, JiraIssue } from '../connectors/jiraConnector.js';
import { isDoneResolution } from './resolutionCategoriesService.js';
import { ReleaseDatasetCache } from './releaseDatasetCache.js';
import {
  fetchReleaseData,
  processMaster,
  type FetchReleaseResult,
  type GateDateHistory,
  type GateDateHistoryEntry,
  type ProcessedTicket,
  type ProcessedTicketWithDerived,
} from './releaseDatasetService.js';
import type { SprintCalendar } from './sprintsService.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Issue types whose changelog is fetched to fill `Closed Date`, `Last Resolved Date`, and `Reopen Count`. */
export const CHANGELOG_REQUIRED_TYPES = new Set(['Bug', 'Improvement', 'Test']);

/**
 * Issue types whose changelog is fetched for gate-date slip history
 * (CC / CG / PG date change trail).
 */
export const GATE_HISTORY_TYPES = new Set(['Feature', 'Initiative', 'X-FEAT', 'Capability']);

/** Default concurrency for the changelog enrichment fan-out. */
export const DEFAULT_CHANGELOG_CONCURRENCY = 8;

// ── Changelog enrichment ──────────────────────────────────────────────────

/**
 * Shape of a single JIRA changelog history entry. JIRA REST returns
 * these as nested objects on the issue when `expand=changelog` is
 * passed; the shape is documented in JIRA Server's `/rest/api/2/issue`
 * docs and unchanged for years.
 */
export interface JiraChangelogHistory {
  created?: string;
  items?: Array<{
    field?: string;
    /** JIRA's machine-readable field identifier, e.g. "customfield_11067". */
    fieldId?: string;
    toString?: string;
    fromString?: string;
  }>;
}

interface IssueWithChangelog extends JiraIssue {
  changelog?: {
    histories?: JiraChangelogHistory[];
  };
}

/**
 * Find the most-recent timestamp where status transitioned **to**
 * "Closed" in the changelog. Returns ISO string or null.
 *
 * Mirrors Python `_extract_closed_date` — we iterate histories newest
 * → oldest (the typical JIRA ordering is oldest first, so we walk
 * reverse) and stop at the first match.
 */
export function extractClosedDate(issue: JiraIssue): string | null {
  const histories = (issue as IssueWithChangelog).changelog?.histories;
  if (!histories || histories.length === 0) return null;
  for (let i = histories.length - 1; i >= 0; i--) {
    const h = histories[i]!;
    const items = h.items ?? [];
    for (const item of items) {
      if (item.field === 'status' && item.toString === 'Closed') {
        return h.created ?? null;
      }
    }
  }
  return null;
}

/**
 * Find the most-recent timestamp where status transitioned **to**
 * "Resolved" in the changelog. Returns ISO string or null.
 *
 * Unlike `Resolved Date` (JIRA's `resolutiondate` field, which reflects
 * the *first* time a resolution was set), this returns the *last* time
 * the ticket actually moved to the Resolved status — the correct anchor
 * for QA verification sprint assignment when a ticket has been reopened
 * and re-resolved multiple times.
 */
export function extractLastResolvedDate(issue: JiraIssue): string | null {
  const histories = (issue as IssueWithChangelog).changelog?.histories;
  if (!histories || histories.length === 0) return null;
  for (let i = histories.length - 1; i >= 0; i--) {
    const h = histories[i]!;
    for (const item of h.items ?? []) {
      if (item.field === 'status' && item.toString === 'Resolved') {
        return h.created ?? null;
      }
    }
  }
  return null;
}

/**
 * Count how many times the ticket transitioned FROM "Resolved" or
 * "Closed" BACK to an open/active state (reopen events).
 *
 * A high reopen count is a quality signal — it indicates the fix was
 * insufficient or the ticket was insufficiently tested before being
 * marked resolved.
 */
export function extractReopenCount(issue: JiraIssue): number {
  const histories = (issue as IssueWithChangelog).changelog?.histories;
  if (!histories || histories.length === 0) return 0;
  const RESOLVED_STATES = new Set(['Resolved', 'Closed']);
  let count = 0;
  for (const h of histories) {
    for (const item of h.items ?? []) {
      if (
        item.field === 'status' &&
        item.fromString != null &&
        item.toString != null &&
        RESOLVED_STATES.has(item.fromString) &&
        !RESOLVED_STATES.has(item.toString)
      ) {
        count++;
      }
    }
  }
  return count;
}

export interface EnrichClosedDatesOptions {
  /** Bounded concurrency for the per-issue changelog fetches. */
  concurrency?: number;
  /**
   * `(done, total)` progress hook. `total` is the number of tickets
   * that needed enrichment, not the total ticket list.
   */
  onProgress?: (done: number, total: number) => void;
  /**
   * Internal: override the per-issue fetch — used by the smoke test
   * to avoid talking to the network. Production never sets this.
   */
  fetchChangelog?: (jira: JiraConnector, key: string) => Promise<JiraIssue>;
}

/**
 * Walk a ticket list, find every Bug/Improvement/Test row, fetch its
 * changelog with bounded concurrency, and mutate the rows in place to fill:
 *
 *   - `Closed Date`        — last transition to "Closed" (Done-resolution only)
 *   - `Last Resolved Date` — last transition to "Resolved" (all required types)
 *   - `Reopen Count`       — times reopened from Resolved/Closed (all required types)
 *
 * Returns counts so callers can surface progress / verify coverage.
 * Mutates `tickets` in place. Errors on individual changelog fetches
 * are caught and counted — a single bad ticket never aborts the whole release.
 */
export async function enrichClosedDates(
  jira: JiraConnector,
  tickets: ProcessedTicket[],
  options: EnrichClosedDatesOptions = {}
): Promise<{ enriched: number; errors: number; checked: number }> {
  // All Bug/Improvement/Test tickets need changelog enrichment — not
  // just Done-resolution ones — because Reopen Count applies regardless
  // of final resolution.
  const needs = tickets.filter((t) => CHANGELOG_REQUIRED_TYPES.has(t['Issue Type']));
  if (needs.length === 0) {
    return { enriched: 0, errors: 0, checked: 0 };
  }

  const concurrency = Math.min(
    options.concurrency ?? DEFAULT_CHANGELOG_CONCURRENCY,
    needs.length
  );
  const doFetch =
    options.fetchChangelog ??
    ((j: JiraConnector, key: string) =>
      j.getIssue(key, { fields: ['status'], expand: 'changelog' }));

  let enriched = 0;
  let errors = 0;
  let done = 0;
  let nextIdx = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIdx++;
      if (i >= needs.length) return;
      const ticket = needs[i]!;
      try {
        const issue = await doFetch(jira, ticket['Issue Key']);

        // Closed Date — only relevant for Done-resolution tickets
        if (isDoneResolution(ticket.Resolution) && !ticket['Closed Date']) {
          const closed = extractClosedDate(issue);
          if (closed) {
            ticket['Closed Date'] = closed;
            enriched += 1;
          }
        }

        // Last Resolved Date — all required types
        const lastResolved = extractLastResolvedDate(issue);
        if (lastResolved) {
          ticket['Last Resolved Date'] = lastResolved;
        }

        // Reopen Count — all required types
        ticket['Reopen Count'] = extractReopenCount(issue);
      } catch {
        errors += 1;
      }
      done += 1;
      if (options.onProgress && (done % 25 === 0 || done === needs.length)) {
        options.onProgress(done, needs.length);
      }
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { enriched, errors, checked: needs.length };
}

// ── Gate date history enrichment ───────────────────────────────────────────

/**
 * Walk every Feature / Initiative / X-FEAT / Capability ticket, fetch its
 * changelog, and populate `ticket['Gate Date History']` with the full
 * chronological trail of CC / CG / PG date changes.
 *
 * Each entry is `{ value: "YYYY-MM-DD", changedAt: ISO }` — the date
 * that was SET at that moment (the `toString` value from the JIRA
 * changelog item). Oldest-first ordering mirrors JIRA's changelog
 * default; the last entry is always the current committed date.
 *
 * Field IDs are the Nutanix defaults per jira-date-hierarchy.mdc:
 *   CC Date  → customfield_11067
 *   CG Date  → customfield_35863
 *   PG Date  → customfield_35864
 *
 * TODO(D1): accept productService fieldId overrides when non-NDB products land.
 */
export async function enrichGateDateHistory(
  jira: JiraConnector,
  tickets: ProcessedTicket[],
  options: {
    concurrency?: number;
    /** `(done, total)` progress hook fired every 10 tickets. */
    onProgress?: (done: number, total: number) => void;
    /** Internal: override the per-issue fetch — used by tests. */
    fetchChangelog?: (jira: JiraConnector, key: string) => Promise<JiraIssue>;
  } = {}
): Promise<{ enriched: number; errors: number; checked: number }> {
  const needs = tickets.filter((t) => GATE_HISTORY_TYPES.has(t['Issue Type']));
  if (needs.length === 0) return { enriched: 0, errors: 0, checked: 0 };

  const concurrency = Math.min(
    options.concurrency ?? DEFAULT_CHANGELOG_CONCURRENCY,
    needs.length
  );
  const doFetch =
    options.fetchChangelog ??
    ((j: JiraConnector, key: string) =>
      j.getIssue(key, { expand: 'changelog' }));

  // Nutanix canonical gate-date customfield IDs (per jira-date-hierarchy.mdc).
  const CC_FIELD = 'customfield_11067';
  const CG_FIELD = 'customfield_35863';
  const PG_FIELD = 'customfield_35864';

  let enriched = 0;
  let errors = 0;
  let done = 0;
  const queue = [...needs];

  async function worker(): Promise<void> {
    while (true) {
      const ticket = queue.shift();
      if (!ticket) break;
      try {
        const issue = await doFetch(jira, ticket['Issue Key']);
        const histories = (issue as IssueWithChangelog).changelog?.histories ?? [];

        const ccHistory: GateDateHistoryEntry[] = [];
        const cgHistory: GateDateHistoryEntry[] = [];
        const pgHistory: GateDateHistoryEntry[] = [];

        // JIRA changelog is oldest-first. Each history entry is a change event;
        // `items` can cover multiple fields changed simultaneously.
        for (const h of histories) {
          for (const item of (h.items ?? [])) {
            const fid = item.fieldId;
            const toVal = item.toString;
            if (!fid || !toVal || toVal === 'null' || toVal === '') continue;
            const entry: GateDateHistoryEntry = {
              value: toVal,
              changedAt: h.created ?? '',
            };
            if (fid === CC_FIELD) ccHistory.push(entry);
            else if (fid === CG_FIELD) cgHistory.push(entry);
            else if (fid === PG_FIELD) pgHistory.push(entry);
          }
        }

        const history: GateDateHistory = {
          codeComplete: ccHistory,
          commitGate: cgHistory,
          promotionGate: pgHistory,
        };
        ticket['Gate Date History'] = history;
        enriched += 1;
      } catch {
        errors += 1;
      }
      done += 1;
      if (options.onProgress && (done % 10 === 0 || done === needs.length)) {
        options.onProgress(done, needs.length);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { enriched, errors, checked: needs.length };
}

// ── Sync orchestration ─────────────────────────────────────────────────────

export interface SyncProgressEvent {
  release: string;
  /**
   * One of:
   *   - 'cache_hit' — cache satisfied the request, no JIRA calls
   *   - 'fetching' — JIRA fetch started for this release
   *   - 'changelog' — changelog enrichment pass started for this release
   *   - 'done' — release fully processed and saved
   *   - 'error' — release failed (detail = message)
   */
  status: 'cache_hit' | 'fetching' | 'changelog' | 'done' | 'error';
  detail: string;
}

export interface SyncOptions {
  /** Required: where to cache. Caller-owned (D5 / D34). */
  cache: ReleaseDatasetCache;
  /**
   * JIRA project key used ONLY for the cache file naming convention and
   * the JIRA versions API call to determine future releases.
   *
   * It is NO LONGER passed as a project scope to the bucket queries —
   * those now run without a project filter so Features (FEAT), docs
   * (TECHPUBS), and engineering work (ERA) are all captured.
   *
   * Required for cache key stability (D1 — no hardcoded ERA).
   */
  projectKey: string;
  /** Required: label prefix for sidecars + derived columns (D1). */
  labelPrefix: string;
  /** Required: product release prefix for `Release Type` classification (D1). */
  productPrefix: string;
  /** Required: sprint calendar for derived columns (D1). */
  sprintCalendar: SprintCalendar;
  /**
   * Force a refetch for these specific releases regardless of cache
   * state. Non-forced releases keep their on-disk cache (full-sync
   * and scoped-refetch share the same dispatch — see docstring).
   */
  forceReleases?: string[];
  /**
   * When true, the Group 3 (long-term funded) fetch is included. The
   * sync will call `jira.getProjectVersions(projectKey)` to determine
   * which versions are "future" (unreleased + not in the active release
   * set). Defaults to true.
   */
  includeLongTermFunded?: boolean;
  /**
   * Skip the targeted changelog pass. Useful for tests, or when the
   * caller doesn't care about `Closed Date` and wants the fetch to be
   * cheaper.
   */
  skipChangelog?: boolean;
  /** Changelog enrichment concurrency. */
  changelogConcurrency?: number;
  /**
   * Bucket-fetch options passed straight through to `fetchReleaseData`.
   * `projectKey` / `labelPrefix` are added by sync; do not duplicate.
   */
  fetchOptions?: {
    pageSize?: number;
    maxIssuesPerBucket?: number;
    concurrency?: number;
  };
  /** Per-release progress hook (one call per status transition). */
  onProgress?: (event: SyncProgressEvent) => void;
  /**
   * Internal: changelog-fetch override. Same purpose as
   * `EnrichClosedDatesOptions.fetchChangelog` — smoke-test seam.
   */
  fetchChangelog?: (jira: JiraConnector, key: string) => Promise<JiraIssue>;
}

export interface SyncResult {
  /** Cross-release dataset (bundle), freshly computed and saved. */
  processed: ProcessedTicketWithDerived[];
  /** Releases that ended up in the bundle (alphabetically sorted). */
  releases: string[];
  /** Per-release errors keyed by release name. Empty on full success. */
  errors: Record<string, string>;
  /** Per-release fetch outcome: 'cache_hit' | 'fetched' | 'error'. */
  source: Record<string, 'cache_hit' | 'fetched' | 'error'>;
  /** Number of tickets the Phase 2 changelog pass updated (Bug/Improvement/Test). */
  changelogEnriched: number;
  /** Number of Feature/Initiative/X-FEAT tickets whose gate date history was enriched. */
  gateHistoryEnriched: number;
}

/**
 * Run a full or scoped sync.
 *
 * Decision tree per release:
 *
 *   - in `forceReleases`        → fetch from JIRA, overwrite cache
 *   - strict cache hit          → use cache, no JIRA calls
 *   - strict cache miss         → fetch from JIRA, save cache
 *
 * After every release is processed, `processMaster` runs across the
 * union of `{freshly fetched} ∪ {strict cache hits from disk for any
 * release not in this run}` so the bundle stays complete even in
 * scoped-refetch mode.
 *
 * Acquires the sync lock for the duration; always releases on the way
 * out (including on uncaught exceptions).
 */
export async function syncReleaseDataset(
  jira: JiraConnector,
  releases: string[],
  options: SyncOptions
): Promise<SyncResult> {
  if (!options?.cache) {
    throw new Error('syncReleaseDataset: options.cache is required');
  }
  if (!options.projectKey) {
    throw new Error('syncReleaseDataset: options.projectKey is required (D1)');
  }
  if (!options.labelPrefix) {
    throw new Error('syncReleaseDataset: options.labelPrefix is required (D1)');
  }
  if (!options.productPrefix) {
    throw new Error('syncReleaseDataset: options.productPrefix is required (D1)');
  }
  if (!options.sprintCalendar) {
    throw new Error('syncReleaseDataset: options.sprintCalendar is required (D1)');
  }

  const { cache, projectKey, labelPrefix, productPrefix, sprintCalendar } =
    options;

  // Preserve order, dedupe; in scoped mode we operate only on the
  // forced subset — the rest of disk is left alone.
  const forcedList = Array.from(new Set(options.forceReleases ?? []));
  const scoped = forcedList.length > 0;
  const forced = new Set(forcedList);
  const releaseIter = scoped
    ? forcedList
    : Array.from(new Set(releases));

  cache.acquireSyncLock(
    `${new Date().toISOString()}\n${releaseIter.length} releases\nscoped=${scoped}\n`
  );

  // ── Determine future releases for Group 3 (long-term funded) ───────────────
  // Active releases = the releases we're syncing right now. Future releases =
  // any unreleased JIRA version that is NOT in that active set.
  // We attempt this once; if the versions API fails we log and skip Group 3
  // rather than aborting the whole sync.
  let futureReleases: string[] = [];
  const includeLongTerm = options.includeLongTermFunded !== false;
  if (includeLongTerm) {
    try {
      const allVersions = await jira.getProjectVersions(projectKey);
      const activeSet = new Set(releaseIter.map((r) => r.toUpperCase()));
      futureReleases = allVersions
        .filter((v) => !v.released && !v.archived)
        .map((v) => v.name)
        .filter((name) => !activeSet.has(name.toUpperCase()));
      // eslint-disable-next-line no-console
      console.info(
        `[releaseDatasetSync] Group 3: ${futureReleases.length} future releases found`,
        futureReleases.slice(0, 5)
      );
    } catch (err) {
      // Non-fatal — Group 3 fetch is omitted but Group 1 + 2 still run.
      // eslint-disable-next-line no-console
      console.warn(
        `[releaseDatasetSync] Could not fetch project versions for Group 3 — skipping long-term funded: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const perRelease: Record<string, ProcessedTicket[]> = {};
  const errors: Record<string, string> = {};
  const source: Record<string, 'cache_hit' | 'fetched' | 'error'> = {};
  let changelogEnriched = 0;
  let gateHistoryEnriched = 0;
  const emit = (e: SyncProgressEvent) => options.onProgress?.(e);

  try {
    for (const release of releaseIter) {
      // Full-sync only: try the on-disk cache first.
      if (!scoped && !forced.has(release)) {
        const cached = cache.loadRelease(release, { projectKey, labelPrefix });
        if (cached !== null) {
          perRelease[release] = cached;
          source[release] = 'cache_hit';
          emit({
            release,
            status: 'cache_hit',
            detail: `${cached.length} tickets from cache`,
          });
          cache.touchSyncLock();
          continue;
        }
      }

      // "master", "Era Future", and any other non-versioned planning bucket
      // don't start with the product prefix (e.g. "NDB-").  Their accumulated
      // ticket history is too large for the standard JQL — skip moved_out and
      // use recency-bounded variants for the heavy buckets.
      const isCatchAllVersion = !release
        .toUpperCase()
        .startsWith(productPrefix.toUpperCase());

      emit({ release, status: 'fetching', detail: 'starting bucket fan-out (Groups 1+2+3)' });
      let result: FetchReleaseResult;
      try {
        result = await fetchReleaseData(jira, release, {
          // No projectKey passed — full Release Payload (ERA + FEAT + TECHPUBS + …)
          labelPrefix,
          futureReleases,
          isCatchAllVersion,
          pageSize: options.fetchOptions?.pageSize,
          maxIssuesPerBucket: options.fetchOptions?.maxIssuesPerBucket,
          concurrency: options.fetchOptions?.concurrency,
          // Per-bucket progress: emit a fetching event after each bucket so
          // the UI shows "top_level_projects: 47 tickets" in real time instead
          // of going silent for minutes while Jira API calls run.
          onProgress: (bucketName, status, detail) => {
            if (status === 'done' || status === 'error') {
              emit({ release, status: 'fetching', detail: `${bucketName}: ${detail}` });
            }
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        errors[release] = msg;
        source[release] = 'error';
        emit({ release, status: 'error', detail: msg });
        cache.touchSyncLock();
        continue;
      }

      if (result.error) {
        // Partial fetch — keep the tickets we did get, surface the error.
        // eslint-disable-next-line no-console
        console.warn(`[releaseDatasetSync] ${release}: partial fetch error — ${result.error}`);
        errors[release] = result.error;
      }

      // Phase 2: Changelog enrichment — Closed Date, Last Resolved Date, Reopen Count.
      if (!options.skipChangelog && result.tickets.length > 0) {
        const changelogNeeds = result.tickets.filter(
          (t) =>
            t['Issue Type'] === 'Bug' ||
            t['Issue Type'] === 'Improvement' ||
            t['Issue Type'] === 'Test'
        ).length;
        emit({
          release,
          status: 'changelog',
          detail: `changelog: 0/${changelogNeeds} tickets`,
        });
        try {
          const enrichResult = await enrichClosedDates(jira, result.tickets, {
            concurrency: options.changelogConcurrency,
            fetchChangelog: options.fetchChangelog,
            onProgress: (done, total) => {
              // Emit every 100 tickets to avoid flooding the SSE log.
              if (done % 100 === 0 || done === total) {
                emit({ release, status: 'changelog', detail: `changelog: ${done}/${total} tickets` });
              }
            },
          });
          changelogEnriched += enrichResult.enriched;
        } catch (err) {
          // Changelog failure is NOT fatal — the dataset is still usable
          // without Closed Date; QA Verification metrics will just be
          // under-counted. Log via the error map so the caller knows.
          const msg = err instanceof Error ? err.message : String(err);
          errors[release] = errors[release]
            ? `${errors[release]}; changelog: ${msg}`
            : `changelog: ${msg}`;
        }
      }

      // Phase 3: Gate date history — CC / CG / PG slip trail for FEATs.
      // Targets only Feature/Initiative/X-FEAT/Capability (~30–80 per release),
      // so the cost is small relative to Phase 2's Bug/Improvement/Test pass.
      if (!options.skipChangelog && result.tickets.length > 0) {
        const gateNeeds = result.tickets.filter((t) =>
          GATE_HISTORY_TYPES.has(t['Issue Type'])
        ).length;
        if (gateNeeds > 0) {
          emit({
            release,
            status: 'changelog',
            detail: `gate history: 0/${gateNeeds} FEAT tickets`,
          });
          try {
            const gateResult = await enrichGateDateHistory(jira, result.tickets, {
              concurrency: options.changelogConcurrency,
              fetchChangelog: options.fetchChangelog,
              onProgress: (done, total) => {
                emit({ release, status: 'changelog', detail: `gate history: ${done}/${total} FEAT tickets` });
                // Every 10 ticks (from enrichGateDateHistory) → emit all; FEATs per release ≈ 30–80
              },
            });
            gateHistoryEnriched += gateResult.enriched;
          } catch (err) {
            // Non-fatal — slip analytics degrade gracefully to null.
            const msg = err instanceof Error ? err.message : String(err);
            errors[release] = errors[release]
              ? `${errors[release]}; gate-history: ${msg}`
              : `gate-history: ${msg}`;
          }
        }
      }

      perRelease[release] = result.tickets;
      source[release] = errors[release] ? 'error' : 'fetched';
      cache.saveRelease(release, result.tickets, { projectKey, labelPrefix });
      emit({
        release,
        status: errors[release] ? 'error' : 'done',
        detail: errors[release]
          ? errors[release]!
          : `${result.tickets.length} tickets`,
      });
      cache.touchSyncLock();
    }

    // Build the bundle. In scoped mode, overlay the freshly-fetched
    // releases onto whatever else is still strict-loadable from disk
    // so the bundle stays a true cross-release view.
    let combined: Record<string, ProcessedTicket[]>;
    if (scoped) {
      combined = cache.loadAllReleases({ projectKey, labelPrefix });
      for (const [r, t] of Object.entries(perRelease)) combined[r] = t;
    } else {
      combined = perRelease;
    }

    const processed = processMaster(combined, {
      labelPrefix,
      productPrefix,
      sprintCalendar,
    });
    const sortedReleases = Object.keys(combined).sort();
    cache.saveBundle(processed, sortedReleases, {
      projectKey,
      labelPrefix,
      productPrefix,
    });

    return {
      processed,
      releases: sortedReleases,
      errors,
      source,
      changelogEnriched,
      gateHistoryEnriched,
    };
  } finally {
    cache.releaseSyncLock();
  }
}

/**
 * Pure-disk rebuild: load every strict-loadable per-release cache,
 * processMaster, save the bundle. Returns the freshly-built bundle or
 * null if no per-release cache is loadable.
 *
 * Used at app start so the UI renders immediately from disk before
 * the user kicks off a JIRA sync.
 */
export function rebuildBundleFromDisk(options: {
  cache: ReleaseDatasetCache;
  projectKey: string;
  labelPrefix: string;
  productPrefix: string;
  sprintCalendar: SprintCalendar;
}): {
  processed: ProcessedTicketWithDerived[];
  releases: string[];
} | null {
  const { cache, projectKey, labelPrefix, productPrefix, sprintCalendar } =
    options;
  const perRelease = cache.loadAllReleases({ projectKey, labelPrefix });
  const releaseList = Object.keys(perRelease);
  if (releaseList.length === 0) return null;
  const processed = processMaster(perRelease, {
    labelPrefix,
    productPrefix,
    sprintCalendar,
  });
  const sortedReleases = releaseList.sort();
  cache.saveBundle(processed, sortedReleases, {
    projectKey,
    labelPrefix,
    productPrefix,
  });
  return { processed, releases: sortedReleases };
}
