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
  type ProcessedTicket,
  type ProcessedTicketWithDerived,
} from './releaseDatasetService.js';
import type { SprintCalendar } from './sprintsService.js';

// ── Constants ──────────────────────────────────────────────────────────────

/** Issue types whose `Closed Date` requires a changelog look-up. */
export const CHANGELOG_REQUIRED_TYPES = new Set(['Bug', 'Improvement']);

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
 * Walk a ticket list, find every Bug/Improvement-Done row that lacks
 * a `Closed Date`, fetch its changelog with bounded concurrency, and
 * mutate the rows in place to fill `Closed Date`.
 *
 * Returns counts so callers can surface progress / verify coverage.
 * Mutates `tickets` in place to match the Python contract (which
 * mutated the per-key dict by reference).
 *
 * Errors on individual changelog fetches are caught and counted in
 * `errors` — a single bad ticket should never abort the whole release.
 */
export async function enrichClosedDates(
  jira: JiraConnector,
  tickets: ProcessedTicket[],
  options: EnrichClosedDatesOptions = {}
): Promise<{ enriched: number; errors: number; checked: number }> {
  const needs = tickets.filter(
    (t) =>
      CHANGELOG_REQUIRED_TYPES.has(t['Issue Type']) &&
      isDoneResolution(t.Resolution) &&
      !t['Closed Date']
  );
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
        const closed = extractClosedDate(issue);
        if (closed) {
          ticket['Closed Date'] = closed;
          enriched += 1;
        }
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
  /** Required: JIRA project to scope the bucket queries to (D1 / D36). */
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
  /** Number of tickets the changelog pass updated (across all releases). */
  changelogEnriched: number;
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

  const perRelease: Record<string, ProcessedTicket[]> = {};
  const errors: Record<string, string> = {};
  const source: Record<string, 'cache_hit' | 'fetched' | 'error'> = {};
  let changelogEnriched = 0;
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

      emit({ release, status: 'fetching', detail: 'starting bucket fan-out' });
      let result: FetchReleaseResult;
      try {
        result = await fetchReleaseData(jira, release, {
          projectKey,
          labelPrefix,
          pageSize: options.fetchOptions?.pageSize,
          maxIssuesPerBucket: options.fetchOptions?.maxIssuesPerBucket,
          concurrency: options.fetchOptions?.concurrency,
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
        errors[release] = result.error;
      }

      // Targeted changelog enrichment. Mutates result.tickets in place.
      if (!options.skipChangelog && result.tickets.length > 0) {
        emit({
          release,
          status: 'changelog',
          detail: 'finding Closed Date for Bug/Improvement-Done',
        });
        try {
          const enrichResult = await enrichClosedDates(jira, result.tickets, {
            concurrency: options.changelogConcurrency,
            fetchChangelog: options.fetchChangelog,
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
