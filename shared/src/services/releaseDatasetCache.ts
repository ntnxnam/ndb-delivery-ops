/**
 * releaseDatasetCache — Phase 3 of the trunk port (CONSOLIDATION #1b).
 *
 * On-disk cache for the release dataset, re-imagined for Node. The Python
 * original (`data_layer.py`) used pickle + Streamlit `@st.cache_data` +
 * ThreadPoolExecutor; here we use plain JSON + atomic file writes + a
 * fresh schema string. The Phase-1 docstring explicitly authorised a
 * fresh start, so this is a clean v1 — no upgrade path from legacy
 * pickle files.
 *
 * Schema: `v1-node-2026-05` — bump when the on-disk shape changes in a
 * non-backwards-compatible way. Caches stamped with a different schema
 * are rejected by strict loaders (lenient loaders return them with a
 * `schema_diff` flag so a sync orchestrator can decide whether to
 * top-up or refetch).
 *
 * Cache layout (under `<root>/<productId>/`):
 *
 *   per_release/
 *     <release>.json         array<ProcessedTicket>
 *     <release>.meta.json    { schema, jqlHash, projectKey, labelPrefix,
 *                              fetchedAtIso, ticketCount }
 *   bundle.json              { processed: ProcessedTicketWithDerived[],
 *                              releases: string[] }
 *   bundle.meta.json         { schema, productPrefix, labelPrefix,
 *                              projectKey, lastSyncIso, numTickets,
 *                              numReleases }
 *   .sync_in_progress        free-form text, mtime is the freshness
 *                              signal
 *
 * Atomic writes: every save writes to `<name>.tmp` then `fs.renameSync`
 * onto the final path so readers never see a half-written JSON file.
 *
 * Per-product scoping (D34): every cache instance is bound to one
 * `productId`. The labelPrefix / projectKey / productPrefix that go
 * into the meta come from `productService` — see
 * `shared/scripts/smoke-release-dataset-phase3.mjs` for the wiring.
 * Cross-product collisions are impossible by construction because the
 * directory tree separates them.
 *
 * Cache invalidation:
 *   - schema mismatch                 → strict load rejects (sync refetches)
 *   - jqlHash mismatch                → strict load rejects (sync refetches)
 *   - projectKey or labelPrefix drift → strict load rejects (sync refetches)
 *
 * Note on the productPrefix on per-release meta: NOT stamped, because
 * processMaster's productPrefix consumption only affects derived
 * columns (`Release Type` etc.) which are bundle-level, not per-release.
 * The bundle meta carries productPrefix instead.
 */

import {
  createHash,
} from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import {
  DEFERRED_COMPONENT,
  EXTENSION_COMPONENT,
  FETCH_STRATEGY,
  LONG_TERM_COMPONENT,
  PAYLOAD_BUCKET_KEYS,
  WISHLIST_COMPONENT,
  getComponentQueries,
  getDeferredQuery,
  getExtensionQuery,
  getLongTermFundedQuery,
  getWishlistQuery,
} from './payloadJqlService.js';
import type {
  ProcessedTicket,
  ProcessedTicketWithDerived,
} from './releaseDatasetService.js';

/**
 * On-disk schema version. Bump when the cache file layout changes in a
 * way that older Node code couldn't safely read. v1 = first Node-era
 * release; v2 = added Summary, Story Points, Due Date, CC/CG/PG Date,
 * Parent Key, Portfolio Parent Key, Epic Link Key to ProcessedTicket.
 */
export const CACHE_SCHEMA = 'v2-node-2026-06';

/**
 * Stale-lock threshold. The sync orchestrator touches the lock file
 * after every release completes; if more than this many seconds pass
 * without a touch, the lock is assumed crashed and auto-removed.
 * Matches the legacy Python value.
 */
export const SYNC_LOCK_STALE_SECONDS = 120;

const PER_RELEASE_DIRNAME = 'per_release';
const BUNDLE_DATA_FILENAME = 'bundle.json';
const BUNDLE_META_FILENAME = 'bundle.meta.json';
const SYNC_LOCK_FILENAME = '.sync_in_progress';

// ── Public types ───────────────────────────────────────────────────────────

export interface CacheOptions {
  /**
   * Absolute path to the cache root. The cache instance puts every
   * file under `<root>/<productId>/`. Required — no surprise default
   * locations (the legacy Python defaulted relative to its source dir;
   * that anti-pattern doesn't survive into the shared/ runtime).
   */
  cacheDir: string;
  /**
   * Product id (per D5 — every cache is product-scoped). Used as the
   * top-level directory under `cacheDir`. The value should come from
   * `productService.getDefaultProductId()` or an explicit caller
   * argument — never hardcoded.
   */
  productId: string;
}

/** Per-bucket count + timestamp entry in the per-release cache meta. */
export interface BucketCacheMeta {
  count: number;
  fetchedAtIso: string;
}

/** Per-release cache metadata as persisted on disk. */
export interface ReleaseCacheMeta {
  schema: string;
  jqlHash: string;
  projectKey: string;
  labelPrefix: string;
  fetchedAtIso: string;
  ticketCount: number;
  /** Per-bucket ticket counts + last-fetch timestamps. Written at save time. */
  buckets?: Record<string, BucketCacheMeta>;
}

/** Bundle (cross-release) cache metadata as persisted on disk. */
export interface BundleCacheMeta {
  schema: string;
  productPrefix: string;
  labelPrefix: string;
  projectKey: string;
  lastSyncIso: string;
  numTickets: number;
  numReleases: number;
}

/** Bundle payload as persisted on disk. */
export interface BundleCachePayload {
  processed: ProcessedTicketWithDerived[];
  releases: string[];
}

/**
 * What an audit-style listing of cached releases returns. Fields after
 * the persisted ones are computed on-read so sync orchestrators can see
 * at a glance which caches are still loadable.
 */
export interface CachedReleaseInfo extends ReleaseCacheMeta {
  /** True iff `loadRelease(release)` would accept the cache today. */
  loadableStrict: boolean;
  schemaDiff: boolean;
  jqlDiff: boolean;
  projectKeyDiff: boolean;
  labelPrefixDiff: boolean;
  /** True iff the data file is missing (orphan meta). */
  dataMissing: boolean;
}

export interface LoadReleaseOptions {
  /** Required for jqlHash recomputation (sidecars depend on it). */
  labelPrefix: string;
  /** Required so we reject caches built against a different project. */
  projectKey: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Stable hash of every JQL string that contributes to a release's
 * dataset. Any change to bucket SQL or sidecar SQL invalidates the
 * cache. labelPrefix is folded in because the sidecar JQL depends on
 * it.
 */
export function computeReleaseJqlHash(
  release: string,
  labelPrefix: string
): string {
  const buckets = getComponentQueries(release);
  const wishlist = getWishlistQuery(release, { labelPrefix });
  const deferred = getDeferredQuery(release, { labelPrefix });
  const longTerm = getLongTermFundedQuery(release, { labelPrefix });
  const extension = getExtensionQuery(release, { labelPrefix });
  // Stable ordering: bucket keys are already ordered; sidecars
  // tail-append.
  const parts: string[] = [];
  for (const [k, v] of Object.entries(buckets)) parts.push(`${k}::${v}`);
  parts.push(`${WISHLIST_COMPONENT}::${wishlist}`);
  parts.push(`${DEFERRED_COMPONENT}::${deferred}`);
  parts.push(`${LONG_TERM_COMPONENT}::${longTerm}`);
  parts.push(`${EXTENSION_COMPONENT}::${extension}`);
  // Fetch-path strategy (indexed Parent Link / Epic Link vs ScriptRunner).
  // Click-through JQL in getComponentQueries may still use ScriptRunner, so
  // this tag is what invalidates caches when the axios fetch path changes.
  parts.push(`fetch::${FETCH_STRATEGY}`);
  return createHash('md5').update(parts.join('|')).digest('hex').slice(0, 8);
}

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true });
}

function safeReadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return null;
  }
}

function atomicWriteJson(path: string, payload: unknown): void {
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload));
  renameSync(tmp, path);
}

function safeUnlink(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    /* swallow ENOENT etc. */
  }
}

// ── The cache class ────────────────────────────────────────────────────────

/**
 * Per-product cache facade. One instance per (cacheDir, productId)
 * pair. Methods are synchronous because JSON IO at this scale is
 * cheap and async-only would force every caller into a Promise chain
 * for no real win.
 */
export class ReleaseDatasetCache {
  readonly productId: string;
  readonly rootDir: string;
  readonly perReleaseDir: string;
  readonly bundleDataPath: string;
  readonly bundleMetaPath: string;
  readonly syncLockPath: string;

  constructor(options: CacheOptions) {
    if (!options?.cacheDir) {
      throw new Error('ReleaseDatasetCache: options.cacheDir is required');
    }
    if (!options?.productId) {
      throw new Error('ReleaseDatasetCache: options.productId is required (D5)');
    }
    this.productId = options.productId;
    this.rootDir = join(options.cacheDir, options.productId);
    this.perReleaseDir = join(this.rootDir, PER_RELEASE_DIRNAME);
    this.bundleDataPath = join(this.rootDir, BUNDLE_DATA_FILENAME);
    this.bundleMetaPath = join(this.rootDir, BUNDLE_META_FILENAME);
    this.syncLockPath = join(this.rootDir, SYNC_LOCK_FILENAME);
    ensureDir(this.perReleaseDir);
  }

  // ── per-release ──────────────────────────────────────────────────────────

  private releasePaths(release: string): { data: string; meta: string } {
    // Slashes in version names would create unintended subdirectories.
    // We rule them out because every JIRA release we've ever seen uses
    // dot-and-dash naming only.
    if (release.includes('/') || release.includes('\\')) {
      throw new Error(
        `ReleaseDatasetCache: release name '${release}' contains a path separator`
      );
    }
    return {
      data: join(this.perReleaseDir, `${release}.json`),
      meta: join(this.perReleaseDir, `${release}.meta.json`),
    };
  }

  /**
   * Persist a release's processed tickets + freshly-computed meta.
   * Returns true on success, false on IO failure (matches the Python
   * behaviour where save failures are non-fatal — the in-memory data
   * is still usable, just won't survive a restart).
   */
  saveRelease(
    release: string,
    tickets: ProcessedTicket[],
    options: {
      projectKey: string;
      labelPrefix: string;
      /**
       * Cell-sync: only these buckets get a fresh `fetchedAtIso`. Sibling
       * buckets keep their previous timestamps so the Sync Hub UI does not
       * look like the whole row was refreshed. Release-level `fetchedAtIso`
       * is also left unchanged.
       *
       * Omit on a full-release save — every bucket is stamped to now.
       */
      stampBuckets?: string[];
    }
  ): boolean {
    if (!options?.projectKey) {
      throw new Error('ReleaseDatasetCache.saveRelease: projectKey is required');
    }
    if (!options?.labelPrefix) {
      throw new Error('ReleaseDatasetCache.saveRelease: labelPrefix is required');
    }
    const { data, meta } = this.releasePaths(release);
    const nowIso = new Date().toISOString();
    const existing = safeReadJson<ReleaseCacheMeta>(meta);
    const existingBuckets = existing?.buckets ?? {};
    const stampSet = options.stampBuckets ? new Set(options.stampBuckets) : null;

    const bucketCounts: Record<string, number> = {};
    for (const ticket of tickets) {
      const components = (ticket as unknown as Record<string, unknown>)['Components'];
      if (typeof components === 'string') {
        for (const part of components.split(',')) {
          const key = part.trim();
          if (key) bucketCounts[key] = (bucketCounts[key] ?? 0) + 1;
        }
      }
    }

    const keys = new Set<string>([
      ...PAYLOAD_BUCKET_KEYS,
      ...Object.keys(bucketCounts),
      ...Object.keys(existingBuckets),
      ...(options.stampBuckets ?? []),
    ]);

    const buckets: Record<string, BucketCacheMeta> = {};
    for (const k of keys) {
      const count = bucketCounts[k] ?? 0;
      const isGroup1 = (PAYLOAD_BUCKET_KEYS as readonly string[]).includes(k);
      if (!isGroup1 && count === 0 && !stampSet?.has(k) && !existingBuckets[k]) {
        continue;
      }
      let fetchedAtIso: string;
      if (!stampSet) {
        fetchedAtIso = nowIso;
      } else if (stampSet.has(k)) {
        fetchedAtIso = nowIso;
      } else {
        fetchedAtIso = existingBuckets[k]?.fetchedAtIso ?? nowIso;
      }
      buckets[k] = { count, fetchedAtIso };
    }

    const md: ReleaseCacheMeta = {
      schema: CACHE_SCHEMA,
      jqlHash: computeReleaseJqlHash(release, options.labelPrefix),
      projectKey: options.projectKey,
      labelPrefix: options.labelPrefix,
      fetchedAtIso: stampSet && existing?.fetchedAtIso ? existing.fetchedAtIso : nowIso,
      ticketCount: tickets.length,
      buckets,
    };
    try {
      atomicWriteJson(data, tickets);
      atomicWriteJson(meta, md);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Patch a single bucket's count + timestamp in the existing meta without
   * rewriting the full ticket file. Used by the cell-sync path so that a
   * targeted bucket re-fetch updates its freshness indicator immediately.
   *
   * Returns false when the meta file is missing (caller should do a full save).
   */
  saveBucketMeta(
    release: string,
    bucketName: string,
    count: number
  ): boolean {
    const { meta } = this.releasePaths(release);
    const existing = safeReadJson<ReleaseCacheMeta>(meta);
    if (!existing) return false;
    const nowIso = new Date().toISOString();
    const updated: ReleaseCacheMeta = {
      ...existing,
      buckets: {
        ...(existing.buckets ?? {}),
        [bucketName]: { count, fetchedAtIso: nowIso },
      },
    };
    try {
      atomicWriteJson(meta, updated);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Strict load: returns the cached tickets only if every cache-key
   * dimension matches today's expectations.
   *
   * Returns null when:
   *   - data file or meta file is missing
   *   - schema string mismatches
   *   - recomputed jqlHash mismatches (bucket or sidecar SQL changed)
   *   - projectKey or labelPrefix on disk don't match the caller's
   *
   * Sync orchestrators interpret null as "must refetch this release".
   */
  loadRelease(
    release: string,
    options: LoadReleaseOptions
  ): ProcessedTicket[] | null {
    if (!options?.labelPrefix || !options?.projectKey) {
      throw new Error(
        'ReleaseDatasetCache.loadRelease: labelPrefix and projectKey are required'
      );
    }
    const { data, meta } = this.releasePaths(release);
    const md = safeReadJson<ReleaseCacheMeta>(meta);
    if (!md) return null;
    if (md.schema !== CACHE_SCHEMA) return null;
    if (md.projectKey !== options.projectKey) return null;
    if (md.labelPrefix !== options.labelPrefix) return null;
    const expectedHash = computeReleaseJqlHash(release, options.labelPrefix);
    if (md.jqlHash !== expectedHash) return null;
    return safeReadJson<ProcessedTicket[]>(data);
  }

  /**
   * Lenient load: returns whatever is on disk along with the raw meta.
   * Used by upgrade/audit paths. Either element of the returned tuple
   * can be null if the corresponding file is missing or unreadable.
   *
   * Never use in the normal load path — the strict loader is the only
   * one that guarantees the returned data matches today's code shape.
   */
  loadReleaseLenient(release: string): {
    tickets: ProcessedTicket[] | null;
    meta: ReleaseCacheMeta | null;
  } {
    const { data, meta } = this.releasePaths(release);
    return {
      tickets: safeReadJson<ProcessedTicket[]>(data),
      meta: safeReadJson<ReleaseCacheMeta>(meta),
    };
  }

  /** Remove one release (data + meta), or every release if omitted. */
  clearRelease(release?: string): void {
    if (release !== undefined) {
      const { data, meta } = this.releasePaths(release);
      safeUnlink(data);
      safeUnlink(meta);
      return;
    }
    if (!existsSync(this.perReleaseDir)) return;
    for (const fn of readdirSync(this.perReleaseDir)) {
      safeUnlink(join(this.perReleaseDir, fn));
    }
  }

  /**
   * Load every per-release cache that strict-loads today, keyed by
   * release name. Releases whose cache is stale / missing / mismatched
   * are silently omitted — the sync orchestrator's job to refetch them.
   */
  loadAllReleases(
    options: LoadReleaseOptions
  ): Record<string, ProcessedTicket[]> {
    const out: Record<string, ProcessedTicket[]> = {};
    if (!existsSync(this.perReleaseDir)) return out;
    for (const fn of readdirSync(this.perReleaseDir)) {
      if (!fn.endsWith('.meta.json')) continue;
      const release = fn.slice(0, -'.meta.json'.length);
      const tickets = this.loadRelease(release, options);
      if (tickets !== null) out[release] = tickets;
    }
    return out;
  }

  /**
   * Per-release audit listing. Returns one entry per `.meta.json` on
   * disk — including stale ones — annotated with drift flags so the
   * sync orchestrator (or a future admin UI) can decide what to top
   * up vs refetch vs leave alone.
   */
  getCachedReleasesInfo(options: {
    projectKey: string;
    labelPrefix: string;
  }): Record<string, CachedReleaseInfo> {
    const out: Record<string, CachedReleaseInfo> = {};
    if (!existsSync(this.perReleaseDir)) return out;
    for (const fn of readdirSync(this.perReleaseDir)) {
      if (!fn.endsWith('.meta.json')) continue;
      const release = fn.slice(0, -'.meta.json'.length);
      const md = safeReadJson<ReleaseCacheMeta>(
        join(this.perReleaseDir, fn)
      );
      if (!md) continue;
      let expectedHash: string | null = null;
      try {
        expectedHash = computeReleaseJqlHash(release, options.labelPrefix);
      } catch {
        expectedHash = null;
      }
      const { data } = this.releasePaths(release);
      const schemaDiff = md.schema !== CACHE_SCHEMA;
      const jqlDiff =
        expectedHash !== null && md.jqlHash !== expectedHash;
      const projectKeyDiff = md.projectKey !== options.projectKey;
      const labelPrefixDiff = md.labelPrefix !== options.labelPrefix;
      const dataMissing = !existsSync(data);
      out[release] = {
        ...md,
        schemaDiff,
        jqlDiff,
        projectKeyDiff,
        labelPrefixDiff,
        dataMissing,
        loadableStrict:
          !schemaDiff &&
          !jqlDiff &&
          !projectKeyDiff &&
          !labelPrefixDiff &&
          !dataMissing,
      };
    }
    return out;
  }

  // ── bundle ───────────────────────────────────────────────────────────────

  /**
   * Persist the master processed dataset (cross-release). Returns
   * true on success, false on IO failure (same non-fatal contract as
   * `saveRelease`).
   */
  saveBundle(
    processed: ProcessedTicketWithDerived[],
    releases: string[],
    options: {
      projectKey: string;
      labelPrefix: string;
      productPrefix: string;
    }
  ): boolean {
    if (!options?.projectKey || !options?.labelPrefix || !options?.productPrefix) {
      throw new Error(
        'ReleaseDatasetCache.saveBundle: projectKey, labelPrefix, and productPrefix are required'
      );
    }
    const md: BundleCacheMeta = {
      schema: CACHE_SCHEMA,
      productPrefix: options.productPrefix,
      labelPrefix: options.labelPrefix,
      projectKey: options.projectKey,
      lastSyncIso: new Date().toISOString(),
      numTickets: processed.length,
      numReleases: releases.length,
    };
    const payload: BundleCachePayload = { processed, releases };
    try {
      atomicWriteJson(this.bundleDataPath, payload);
      atomicWriteJson(this.bundleMetaPath, md);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Load the bundle iff it matches the caller's productPrefix /
   * labelPrefix / projectKey AND the schema. Returns null otherwise.
   * Bundle is purely a hot-start convenience — never trusted as the
   * source of truth (per-release caches are).
   */
  loadBundle(options: {
    projectKey: string;
    labelPrefix: string;
    productPrefix: string;
  }): {
    payload: BundleCachePayload;
    meta: BundleCacheMeta;
  } | null {
    const md = safeReadJson<BundleCacheMeta>(this.bundleMetaPath);
    if (!md) return null;
    if (md.schema !== CACHE_SCHEMA) return null;
    if (md.projectKey !== options.projectKey) return null;
    if (md.labelPrefix !== options.labelPrefix) return null;
    if (md.productPrefix !== options.productPrefix) return null;
    const payload = safeReadJson<BundleCachePayload>(this.bundleDataPath);
    if (!payload) return null;
    return { payload, meta: md };
  }

  /** Lenient bundle load — for audit / inspection only. */
  loadBundleLenient(): {
    payload: BundleCachePayload | null;
    meta: BundleCacheMeta | null;
  } {
    return {
      payload: safeReadJson<BundleCachePayload>(this.bundleDataPath),
      meta: safeReadJson<BundleCacheMeta>(this.bundleMetaPath),
    };
  }

  clearBundle(): void {
    safeUnlink(this.bundleDataPath);
    safeUnlink(this.bundleMetaPath);
  }

  // ── sync lock ────────────────────────────────────────────────────────────

  /**
   * True iff a fresh sync lock file exists. Stale locks (older than
   * `SYNC_LOCK_STALE_SECONDS`) are auto-cleaned on this call — same
   * behaviour as the Python `is_sync_in_progress`.
   */
  isSyncInProgress(): boolean {
    if (!existsSync(this.syncLockPath)) return false;
    let mtimeMs: number;
    try {
      mtimeMs = statSync(this.syncLockPath).mtimeMs;
    } catch {
      return false;
    }
    const ageSec = (Date.now() - mtimeMs) / 1000;
    if (ageSec > SYNC_LOCK_STALE_SECONDS) {
      safeUnlink(this.syncLockPath);
      return false;
    }
    return true;
  }

  /** Write a free-form payload to the lock file (overwrites). */
  acquireSyncLock(payload: string = ''): void {
    writeFileSync(this.syncLockPath, payload || `${new Date().toISOString()}\n`);
  }

  /** Update the lock mtime — called between releases during a long sync. */
  touchSyncLock(): void {
    if (!existsSync(this.syncLockPath)) return;
    const now = new Date();
    try {
      utimesSync(this.syncLockPath, now, now);
    } catch {
      /* best-effort; ignore */
    }
  }

  releaseSyncLock(): void {
    safeUnlink(this.syncLockPath);
  }
}
