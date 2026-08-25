/**
 * payloadJqlService — 5-bucket release payload JQL builders.
 *
 * Ported from `ndb-release-sprint-analysis-with-chatbot/payload_jql.py`
 * (CONSOLIDATION.md #1, the trunk). The JQL strings are kept
 * byte-equivalent to the Python version so insights / cache / data
 * cross-checks remain valid during the staged migration.
 *
 * Hierarchy that drives the model:
 *
 *   X-FEAT, Capability        (level 0 — spans multiple releases, never the fixVersion anchor)
 *     └─ Feature, Initiative   (level 1 — this is where fixVersion is tagged)
 *          └─ Epic              (level 2 — child of Initiative/Feature, or standalone)
 *               └─ Task, Bug ... (level 3 — implementation work)
 *
 * Five disjoint buckets:
 *
 *   1. top_level_projects          — Features/Initiatives directly tagged
 *   2. work_toward_project         — children of those, via Epic Link
 *   3. standalone_epics            — Epics tagged with no Parent Link
 *   4. work_toward_standalone_epic — children of those, via Epic Link
 *   5. direct_tickets              — loose Bugs/Tasks/Improvements (no Epic Link, not a container)
 *
 * Disjointness invariants:
 *
 *   - Buckets 2 and 4 carry tickets with `Epic Link` set; 1, 3, 5 are `Epic Link is EMPTY`.
 *   - Bucket 1 is restricted to issueType in (Feature, Initiative).
 *   - Bucket 3 is restricted to type = Epic AND "Parent Link" is EMPTY.
 *   - Bucket 5 excludes (Feature, Initiative, Epic, X-FEAT, Capability).
 *
 * Each ticket lands in exactly one bucket. The five component keys
 * here are also the canonical `Components` tag values stored on every
 * processed_df row when the dataset assembler (capability #1.b) lands.
 *
 * Two sidecar queries (wishlist + deferred) are exposed separately —
 * they intersect with the 5 buckets but are *not* in the union. The
 * dashboard treats them as label-anchored signals that may include
 * label-only rows outside the fixVersion-anchored payload.
 *
 * Product-agnostic notes (D1):
 *
 *   - The Python original hardcoded `project = ERA` (Nutanix NDB). Here
 *     we accept it via input so DataLens / NCM / future tenants can
 *     supply their own JIRA project key. `productService` is the
 *     intended supplier at call sites.
 *   - The wishlist/deferred label prefix (`ndb-<release>-...`) is also
 *     historically Nutanix-specific. We accept it as `labelPrefix` so
 *     other products can be `datalens-<release>-wishlist` etc.
 */

// fixVersion is anchored at level 1 (Feature/Initiative) per the
// Nutanix hierarchy. X-FEAT/Capability are level 0 and span multiple
// releases, so they are not valid roots for `portfolioChildrenOf` in
// this context.
export const PORTFOLIO_ROOT_TYPES = '(Feature, Initiative)';

// Issue types that act as containers in the portfolio hierarchy.
// Bucket 5 (direct_tickets) excludes these so it can't capture parents
// that already have their own buckets (1 and 3).
export const PORTFOLIO_CONTAINER_TYPES =
  '(Feature, Initiative, Epic, X-FEAT, Capability)';

/**
 * Canonical Group 1 bucket keys — the 6 disjoint buckets that make up
 * the "currently in this release" payload. Order matters: parents before
 * children, so the within-release dedup loop tags a ticket with its
 * highest-level bucket when it appears in multiple results.
 *
 *   1A. top_level_projects        — Features/Initiatives directly tagged
 *   1B. epics_of_projects         — Epics that are portfolio children of 1A
 *   2.  work_toward_project       — Tasks/Bugs/Tests inside those Epics
 *   3.  standalone_epics          — Epics tagged with no Parent Link
 *   4.  work_toward_standalone_epic — Tasks/Bugs/Tests inside standalone Epics
 *   5.  direct_tickets            — loose Bugs/Tasks/Improvements (no Epic Link)
 */
export const PAYLOAD_BUCKET_KEYS = [
  'top_level_projects',
  'epics_of_projects',
  'work_toward_project',
  'standalone_epics',
  'work_toward_standalone_epic',
  'direct_tickets',
] as const;

export type PayloadBucketKey = (typeof PAYLOAD_BUCKET_KEYS)[number];

/** Canonical sidecar tag values. */
export const WISHLIST_COMPONENT = 'wishlist';
export const DEFERRED_COMPONENT = 'deferred';
export const LONG_TERM_COMPONENT = 'long_term_funded';
export const EXTENSION_COMPONENT = 'extension';

/** Group 2: tickets that WERE in the release but have been moved out. */
export const MOVED_OUT_COMPONENT = 'moved_out';

/** Group 3: Feature/Initiative top-level items on future/master releases. */
export const LONG_TERM_PROJECTS_COMPONENT = 'long_term_projects';
/** Group 3: Epics that are portfolio children of long-term funded features. */
export const LONG_TERM_EPICS_COMPONENT = 'long_term_epics';
/** Group 3: Work (Tasks/Bugs/Tests) under long-term funded epics. */
export const LONG_TERM_WORK_COMPONENT = 'long_term_work';

// ── JQL quoting helpers ────────────────────────────────────────────────────

/**
 * Quote a fixVersion value for **top-level** JQL.
 * Single-word names (`NDB-2.11`, `master`) need no quotes.
 * Multi-word names (`Era Future`) must be wrapped in double-quotes.
 */
function q(v: string): string {
  return /\s/.test(v) ? `"${v}"` : v;
}

/**
 * Quote a fixVersion value for use **inside** a double-quoted JQL string
 * (e.g., the inner JQL argument of `portfolioChildrenOf("...")` or
 * `issuesInEpics("...")`).
 *
 * Cannot use double-quotes inside an already-double-quoted string because
 * that would close the outer delimiter. Use single-quotes instead — they
 * are equally valid JQL string delimiters.
 */
function qInner(v: string): string {
  return /\s/.test(v) ? `'${v}'` : v;
}

// ── Group 1 bucket builders (each returns the bucket JQL, no project prefix) ─

function jqlTopLevelProjects(release: string): string {
  return (
    `fixVersion = ${q(release)} AND status not in (Cancelled, Backlog) ` +
    `AND issueType in ${PORTFOLIO_ROOT_TYPES}`
  );
}

/**
 * Bucket 1B: Epics that are direct portfolio children of top-level projects.
 * Distinct from `work_toward_project` (which uses issuesInEpics to get tasks).
 * This bucket captures the Epics themselves so the FEAT→Epic→Task chain is
 * fully materialised in the flat dump.
 */
function jqlEpicsOfProjects(release: string): string {
  // release is inside portfolioChildrenOf("...") — must use single-quotes for
  // multi-word names so they don't close the outer double-quote delimiter.
  return (
    `issueFunction in portfolioChildrenOf(` +
    `"fixVersion = ${qInner(release)} AND status not in (Cancelled, Backlog) ` +
    `AND issueType in ${PORTFOLIO_ROOT_TYPES}") ` +
    `AND issueType = Epic`
  );
}

function jqlWorkTowardProject(release: string): string {
  // release is inside the \\"...\\" escaped inner string — use single-quotes.
  return (
    'issueFunction in issuesInEpics(' +
    `"issuefunction in portfolioChildrenOf(` +
    `\\"fixVersion = ${qInner(release)} AND status not in (Cancelled, Backlog) ` +
    `AND issueType in ${PORTFOLIO_ROOT_TYPES}\\")")`
  );
}

function jqlStandaloneEpics(release: string): string {
  return `type = Epic AND fixVersion = ${q(release)} AND "Parent Link" is EMPTY`;
}

function jqlWorkTowardStandaloneEpic(release: string): string {
  // release is inside issuesInEpics("...") — must use single-quotes.
  return (
    `issueFunction in issuesInEpics("type = Epic AND fixVersion = ${qInner(release)} ` +
    `AND \\"Parent Link\\" is EMPTY")`
  );
}

/**
 * Catch-all version variant of `work_toward_standalone_epic`.
 *
 * For versions like "master" / "Era Future" that accumulate unbounded
 * historical work, the standard query returns >20,000 issues. This variant
 * adds `AND updated >= startOfYear(-1)` to limit the result to tickets
 * touched in the last ~2 years — old inactive work under master epics is not
 * operationally useful.
 */
function jqlWorkTowardStandaloneEpicCatchAll(release: string): string {
  return (
    `issueFunction in issuesInEpics("type = Epic AND fixVersion = ${qInner(release)} ` +
    `AND \\"Parent Link\\" is EMPTY") AND updated >= startOfYear(-1)`
  );
}

function jqlDirectTickets(release: string): string {
  // `fixVersion was` is a changelog history scan and times out on large
  // releases. Group 2 `moved_out` already owns "was in this version, isn't
  // now". Direct tickets are current orphans only.
  return (
    `(fixVersion = ${q(release)} OR affectedVersion = ${q(release)}) ` +
    `AND "Epic Link" is EMPTY ` +
    `AND issueType not in ${PORTFOLIO_CONTAINER_TYPES}`
  );
}

/**
 * Catch-all version variant of `direct_tickets`.
 *
 * For versions like "master" / "Era Future":
 *   - `fixVersion was master` scans all JIRA changelog history and exceeds
 *     the 20,000-issue cap (and often times out at 30s).
 *   - `affectedVersion = master` is not meaningful for a planning bucket.
 *
 * This variant uses only `fixVersion = master` — tickets CURRENTLY in the
 * catch-all version with no Epic parent. This is the relevant set for
 * operational triage.
 */
function jqlDirectTicketsCatchAll(release: string): string {
  return (
    `fixVersion = ${q(release)} AND "Epic Link" is EMPTY ` +
    `AND issueType not in ${PORTFOLIO_CONTAINER_TYPES}`
  );
}

export const JQL_IN_CHUNK_SIZE = 75;

/**
 * Split issue keys into JQL-safe IN-clause chunks. JIRA URL / parser
 * limits make a single 500-key IN clause unreliable.
 */
export function chunkKeys(keys: string[], size = JQL_IN_CHUNK_SIZE): string[][] {
  const unique = [...new Set(keys.filter(Boolean))];
  const out: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    out.push(unique.slice(i, i + size));
  }
  return out;
}

/**
 * Indexed fetch for epics of features/initiatives.
 * Replaces ScriptRunner `portfolioChildrenOf` at fetch time.
 */
export function jqlEpicsByParentKeys(parentKeys: string[]): string {
  if (parentKeys.length === 0) return '';
  return `issuetype = Epic AND "Parent Link" in (${parentKeys.join(', ')})`;
}

/**
 * Indexed fetch for work under epics.
 * Replaces ScriptRunner `issuesInEpics` at fetch time.
 * @param extraAnd optional extra clause without a leading AND, e.g.
 *   `updated >= startOfYear(-1)` for catch-all versions.
 */
export function jqlWorkByEpicKeys(epicKeys: string[], extraAnd = ''): string {
  if (epicKeys.length === 0) return '';
  const extra = extraAnd ? ` AND ${extraAnd.replace(/^AND\s+/i, '')}` : '';
  return `"Epic Link" in (${epicKeys.join(', ')})${extra}`;
}

/**
 * Fetch-strategy tag folded into the per-release jqlHash so switching
 * from ScriptRunner nested JQL to indexed Parent Link / Epic Link
 * invalidates stale caches. Click-through JQL in getComponentQueries
 * may still use ScriptRunner (JIRA UI, not axios).
 */
export const FETCH_STRATEGY = 'indexed-parent-epic-v1';

/**
 * Click-through / synopsis JQL for the 6 Group 1 buckets. Nested
 * ScriptRunner functions remain here so a JIRA hyperlink can run without
 * us first collecting parent keys. **Fetch** does not execute these
 * nested functions — see `jqlEpicsByParentKeys` / `jqlWorkByEpicKeys`
 * and `FETCH_STRATEGY` in fetchReleaseData.
 *
 * Order is the iteration order used by the within-release dedup in the
 * dataset assembler: when a ticket matches multiple buckets, it's tagged
 * with the first match (parents before children).
 *
 * No project prefix is applied here — the callers in `fetchReleaseData`
 * and `buildReleasePayloadJql` handle scoping. Features/Initiatives live
 * in FEAT, engineering work in ERA, documentation in TECHPUBS, etc. A
 * blanket `project = ERA` would silently exclude all of them.
 *
 * @param catchAllVersion - When true, use simplified JQL for
 *   `work_toward_standalone_epic` and `direct_tickets` that avoids
 *   unbounded historical scans. Intended for planning-bucket versions like
 *   "master" / "Era Future" that are never released and accumulate vast
 *   ticket histories. See individual function docs for the exact change.
 */
export function getComponentQueries(
  release: string,
  catchAllVersion = false
): Record<PayloadBucketKey, string> {
  return {
    top_level_projects: jqlTopLevelProjects(release),
    epics_of_projects: jqlEpicsOfProjects(release),
    work_toward_project: jqlWorkTowardProject(release),
    standalone_epics: jqlStandaloneEpics(release),
    work_toward_standalone_epic: catchAllVersion
      ? jqlWorkTowardStandaloneEpicCatchAll(release)
      : jqlWorkTowardStandaloneEpic(release),
    direct_tickets: catchAllVersion
      ? jqlDirectTicketsCatchAll(release)
      : jqlDirectTickets(release),
  };
}

export interface EngineeringPayloadOptions {
  /**
   * JIRA project key the engineering team's work lives in. e.g. `'ERA'`
   * for NDB, `'DATALENS'` for DataLens. Supply from
   * `productService.getJiraProjects(productId)[0]` — never hardcode (D1).
   */
  projectKey: string;
  /**
   * Extra AND-clauses to compose onto the union. Each is wrapped in
   * `(...)` before joining so callers can pass OR-containing clauses
   * without breaking JQL precedence.
   */
  extras?: string[];
}

export interface ReleasePayloadOptions {
  /**
   * Extra AND-clauses to compose onto the union. Each is wrapped in
   * `(...)` before joining so callers can pass OR-containing clauses
   * without breaking JQL precedence.
   */
  extras?: string[];
}

/**
 * Engineering Payload (D36): the 5-bucket union **scoped to a single
 * engineering project** (e.g. ERA for NDB). This is the legacy chatbot's
 * behaviour and what current "completion %" numbers everyone trusts are
 * computed from.
 *
 * Equivalent to `payload_jql.build_jql(release, extras=...)` in the
 * Python source.
 *
 * Use this for: dev burndown, sprint reports, EM/IC views, anything
 * answering "what is the engineering team working on for this release".
 *
 * For the cross-team release scope (TPM/RM/Team-Exec lens that includes
 * TECHPUBS / FEAT / PM work carrying the same fixVersion), see
 * `buildReleasePayloadJql`.
 */
export function buildEngineeringPayloadJql(
  release: string,
  options: EngineeringPayloadOptions
): string {
  if (!release) throw new Error('buildEngineeringPayloadJql: release is required');
  if (!options?.projectKey) {
    throw new Error(
      'buildEngineeringPayloadJql: options.projectKey is required (D1: no hardcoded "ERA")'
    );
  }
  const queries = getComponentQueries(release);
  const union = PAYLOAD_BUCKET_KEYS.map((k) => `(${queries[k]})`).join(' OR ');
  let out = `project = ${options.projectKey} AND (${union})`;
  for (const e of options.extras ?? []) {
    out += ` AND (${e})`;
  }
  return out;
}

/**
 * Release Payload (D36): the 5-bucket union with **no project filter**.
 * Captures every ticket carrying the release fixVersion regardless of
 * which contributing team's JIRA project it lives in (ERA, FEAT,
 * TECHPUBS, PM, …).
 *
 * NEW concept — not present in the legacy chatbot. Surfaces should label
 * the resulting number as "Release Payload" (not "Payload") so it isn't
 * confused with the engineering-only number people are used to seeing.
 *
 * No pollution guard (D36 decision): trust fixVersion. If an unrelated
 * project mis-tags a release, that's a JIRA hygiene issue surfaced at
 * the data-quality layer, not silently filtered here.
 *
 * Use this for: release readiness, "are we shipping?" dashboards,
 * cross-team Team-Exec rollups, any view that should include docs +
 * features + dev together.
 */
export function buildReleasePayloadJql(
  release: string,
  options: ReleasePayloadOptions = {}
): string {
  if (!release) throw new Error('buildReleasePayloadJql: release is required');
  const queries = getComponentQueries(release);
  const union = PAYLOAD_BUCKET_KEYS.map((k) => `(${queries[k]})`).join(' OR ');
  let out = `(${union})`;
  for (const e of options.extras ?? []) {
    out += ` AND (${e})`;
  }
  return out;
}

// ── Sidecars (wishlist + deferred — NOT in the 5-bucket union) ─────────────

export interface SidecarOptions {
  /**
   * Label prefix used to derive the wishlist / deferred label. The
   * Python original baked in `'ndb'`; we accept it explicitly so other
   * tenants can use `'datalens'`, `'ncm'`, etc.
   *
   * The final label form is `${labelPrefix}-${releaseLowered}-wishlist`
   * (or `-deferred`), where `releaseLowered` is `release.toLowerCase()`
   * with the labelPrefix stripped from the front if present (mirrors
   * the Python `release.lower().replace("ndb-", "")` behaviour).
   */
  labelPrefix: string;
}

function deriveReleaseSuffix(release: string, labelPrefix: string): string {
  const lower = release.toLowerCase();
  const stripped = lower.startsWith(`${labelPrefix.toLowerCase()}-`)
    ? lower.slice(labelPrefix.length + 1)
    : lower;
  // JQL label values cannot contain spaces or special chars — collapse to hyphens.
  // e.g. "era future" → "era-future", "ndb-3.0 ea" → "ndb-3.0-ea"
  return stripped.replace(/[\s]+/g, '-');
}

/**
 * Sidecar JQL for the wishlist label. Wishlist is a *candidate pool*,
 * not committed work — intentionally outside the 5-bucket union.
 *
 * Examples (labelPrefix='ndb'):
 *
 *   NDB-2.11    → 'labels = "ndb-2.11-wishlist"'
 *   NDB-2.10.3  → 'labels = "ndb-2.10.3-wishlist"'
 *   NDB-3.0-EA  → 'labels = "ndb-3.0-ea-wishlist"'
 */
export function getWishlistQuery(
  release: string,
  options: SidecarOptions
): string {
  const suffix = deriveReleaseSuffix(release, options.labelPrefix);
  return `labels = "${options.labelPrefix.toLowerCase()}-${suffix}-wishlist"`;
}

/**
 * Sidecar JQL for the deferred label. Like wishlist this is
 * label-anchored, not fixVersion-anchored — a ticket can carry the
 * deferred label and have moved off the release's fixVersion entirely.
 *
 * Examples (labelPrefix='ndb'):
 *
 *   NDB-2.11    → 'labels = "ndb-2.11-deferred"'
 *   NDB-2.10.3  → 'labels = "ndb-2.10.3-deferred"'
 *   NDB-3.0-EA  → 'labels = "ndb-3.0-ea-deferred"'
 */
export function getDeferredQuery(
  release: string,
  options: SidecarOptions
): string {
  const suffix = deriveReleaseSuffix(release, options.labelPrefix);
  return `labels = "${options.labelPrefix.toLowerCase()}-${suffix}-deferred"`;
}

export function getLongTermFundedQuery(
  release: string,
  options: SidecarOptions
): string {
  const suffix = deriveReleaseSuffix(release, options.labelPrefix);
  return `labels = "${options.labelPrefix.toLowerCase()}-${suffix}-long-term-funded"`;
}

export function getExtensionQuery(
  release: string,
  options: SidecarOptions
): string {
  const suffix = deriveReleaseSuffix(release, options.labelPrefix);
  const prefix = `${options.labelPrefix.toLowerCase()}-${suffix}`;
  return `labels in ("${prefix}-code-complete-extension-recieved", "${prefix}-code-complete-extention-recieved")`;
}

// ── Group 2 — Moved-out tickets ─────────────────────────────────────────────

/**
 * Group 2: a single broad query that captures ALL tickets that carried
 * `fixVersion = {release}` at some point but no longer do.
 *
 * We use one broad query (not 6 sub-queries) to avoid the JIRA timeout
 * risk of running nested `portfolioChildrenOf` / `issuesInEpics` for the
 * moved-out universe. Bucket classification (1A/1B/2/3/4/5) is done in
 * the middleware from the ticket's `issuetype` + hierarchy link fields
 * (`Portfolio Parent Key`, `Epic Link Key`) — these are populated by the
 * expanded `RELEASE_DATASET_FIELDS` fetch.
 *
 * "Hygienic" vs "needs cleanup" is also derived in-memory:
 *   - hygienic  = parent Feature was also moved (they moved together)
 *   - needs cleanup = parent Feature is still in the release but this
 *                     child was moved independently (orphaned reference)
 */
export function getMovedOutQuery(release: string): string {
  return (
    `fixVersion was ${q(release)} AND fixVersion not in (${q(release)}) ` +
    `AND status not in (Cancelled)`
  );
}

// ── Group 3 — Long-term funded (future/master releases) ─────────────────────

export interface LongTermOptions {
  /**
   * Unreleased JIRA versions that are NOT currently active releases.
   * Determined at sync time by calling `jira.getProjectVersions(projectKey)`
   * and filtering: `released = false AND name NOT IN (activeReleases)`.
   * Also includes the string `'master'` if the JIRA project uses it.
   */
  futureReleases: string[];
}

/**
 * Group 3, Bucket 1A: Feature/Initiative tickets on future or master releases.
 * These represent work the team is ALSO doing during the current release
 * timeframe but that's officially scoped for a future version.
 *
 * Returns empty string when `futureReleases` is empty — callers must skip
 * the fetch in that case.
 */
export function getLongTermProjectsQuery(options: LongTermOptions): string {
  if (options.futureReleases.length === 0) return '';
  // Top-level JQL — use double-quotes for multi-word names.
  const inList = options.futureReleases.map((r) => q(r)).join(', ');
  return (
    `issueType in ${PORTFOLIO_ROOT_TYPES} AND ` +
    `fixVersion in (${inList}) AND ` +
    `status not in (Cancelled)`
  );
}

/**
 * Group 3, Bucket 1B: Epics that are portfolio children of long-term projects.
 * Click-through / synopsis JQL only — fetch uses `jqlEpicsByParentKeys`
 * against keys from `getLongTermProjectsQuery`.
 */
export function getLongTermEpicsQuery(options: LongTermOptions): string {
  if (options.futureReleases.length === 0) return '';
  // inListOuter: top-level JQL wrapper (getLongTermProjectsQuery mirror)
  const inListOuter = options.futureReleases.map((r) => q(r)).join(', ');
  // inListInner: inside portfolioChildrenOf("...") — must use single-quotes
  // so multi-word names like "Era Future" don't close the outer delimiter.
  const inListInner = options.futureReleases.map((r) => qInner(r)).join(', ');
  return (
    `issueFunction in portfolioChildrenOf(` +
    `"issueType in ${PORTFOLIO_ROOT_TYPES} AND fixVersion in (${inListInner}) ` +
    `AND status not in (Cancelled)") ` +
    `AND issueType = Epic AND fixVersion in (${inListOuter})`
  );
}

/**
 * Group 3, Bucket 2: Tasks/Bugs/Tests under long-term funded Epics.
 * Click-through JQL only — fetch uses `jqlWorkByEpicKeys`.
 */
export function getLongTermWorkQuery(options: LongTermOptions): string {
  if (options.futureReleases.length === 0) return '';
  // Both nesting levels use single-quotes for safety inside outer string delimiters.
  const inListInner = options.futureReleases.map((r) => qInner(r)).join(', ');
  return (
    `issueFunction in issuesInEpics(` +
    `"issueFunction in portfolioChildrenOf(` +
    `\\"issueType in ${PORTFOLIO_ROOT_TYPES} AND fixVersion in (${inListInner}) ` +
    `AND status not in (Cancelled)\\") AND issueType = Epic")`
  );
}
