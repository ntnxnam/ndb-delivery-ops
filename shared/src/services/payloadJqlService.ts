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

/** Canonical bucket keys. Order matters: parents before children. */
export const PAYLOAD_BUCKET_KEYS = [
  'top_level_projects',
  'work_toward_project',
  'standalone_epics',
  'work_toward_standalone_epic',
  'direct_tickets',
] as const;

export type PayloadBucketKey = (typeof PAYLOAD_BUCKET_KEYS)[number];

/** Canonical sidecar tag values. */
export const WISHLIST_COMPONENT = 'wishlist';
export const DEFERRED_COMPONENT = 'deferred';

// ── Bucket builders (each returns the bucket-only JQL, sans project scope) ──

function jqlTopLevelProjects(release: string): string {
  return (
    `fixVersion = ${release} AND status not in (Cancelled, Backlog) ` +
    `AND issueType in ${PORTFOLIO_ROOT_TYPES}`
  );
}

function jqlWorkTowardProject(release: string): string {
  return (
    'issueFunction in issuesInEpics(' +
    `"issuefunction in portfolioChildrenOf(` +
    `\\"fixVersion = ${release} AND status not in (Cancelled, Backlog) ` +
    `AND issueType in ${PORTFOLIO_ROOT_TYPES}\\")")`
  );
}

function jqlStandaloneEpics(release: string): string {
  return `type = Epic AND fixVersion = ${release} AND "Parent Link" is EMPTY`;
}

function jqlWorkTowardStandaloneEpic(release: string): string {
  return (
    `issueFunction in issuesInEpics("type = Epic AND fixVersion = ${release} ` +
    `AND \\"Parent Link\\" is EMPTY")`
  );
}

function jqlDirectTickets(release: string): string {
  return (
    `(fixVersion was ${release} OR fixVersion = ${release} ` +
    `OR affectedVersion = ${release}) AND "Epic Link" is EMPTY ` +
    `AND issueType not in ${PORTFOLIO_CONTAINER_TYPES}`
  );
}

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * The 5 disjoint bucket queries keyed by canonical Components tag.
 *
 * Order is the iteration order used by the within-release dedup in the
 * dataset assembler: when a ticket happens to match multiple buckets
 * during fetch, it's tagged with the first match (parents before
 * children).
 */
export function getComponentQueries(
  release: string
): Record<PayloadBucketKey, string> {
  return {
    top_level_projects: jqlTopLevelProjects(release),
    work_toward_project: jqlWorkTowardProject(release),
    standalone_epics: jqlStandaloneEpics(release),
    work_toward_standalone_epic: jqlWorkTowardStandaloneEpic(release),
    direct_tickets: jqlDirectTickets(release),
  };
}

export interface BuildJqlOptions {
  /**
   * JIRA project key the release lives in. e.g. `'ERA'` for NDB,
   * `'DATALENS'` for DataLens. Supply from productService — never
   * hardcode in callers (D1).
   */
  projectKey: string;
  /**
   * Extra AND-clauses to compose onto the union. Each is wrapped in
   * `(...)` before joining so callers can pass OR-containing clauses
   * without breaking JQL precedence.
   */
  extras?: string[];
}

/**
 * Compose the project-scoped 5-bucket union plus any number of
 * AND-extra clauses. Equivalent to `payload_jql.build_jql(release,
 * extras=...)` in the Python source.
 */
export function buildPayloadJql(
  release: string,
  options: BuildJqlOptions
): string {
  if (!release) throw new Error('buildPayloadJql: release is required');
  if (!options?.projectKey) {
    throw new Error(
      'buildPayloadJql: options.projectKey is required (D1: no hardcoded "ERA")'
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
  return stripped;
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
