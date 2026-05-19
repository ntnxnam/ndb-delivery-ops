/**
 * releaseClassificationService — parse + classify release name strings.
 *
 * Ports `release_classification.py` (CONSOLIDATION.md #1b Phase 2).
 *
 * Rules (per the original `.cursor/rules/release-types.mdc`):
 *
 *   - 1 dot in base version  → 'Major/Minor'   (e.g. NDB-2.8, NDB-3.0)
 *   - 2 dots                 → 'Maintenance'   (e.g. NDB-2.8.1)
 *   - 3 dots                 → 'Patch'         (e.g. NDB-2.8.1.1)
 *   - suffix in PRE_RELEASE_SUFFIXES → 'Pre-release' (e.g. NDB-3.0-EA)
 *
 * Pre-release versions stay as separate rows, never merged into their
 * parent.
 *
 * D1 (product-agnostic):
 *
 *   - The original hardcoded `'NDB-'` as the product prefix and used it
 *     to strip the version from the name. Here `productPrefix` is
 *     required and supplied by callers (productService.getReleasePrefix
 *     at the call sites).
 */

export const PRE_RELEASE_SUFFIXES = new Set([
  'EA',
  'RC',
  'RC1',
  'RC2',
  'BETA',
  'ALPHA',
  'SNAPSHOT',
]);

export type ReleaseType =
  | 'Major/Minor'
  | 'Maintenance'
  | 'Patch'
  | 'Pre-release'
  | 'Unknown';

export const CLASSIFICATION_COLORS: Record<ReleaseType, string> = {
  'Major/Minor': '#1f77b4', // blue
  Maintenance: '#ff7f0e', // orange
  Patch: '#2ca02c', // green
  'Pre-release': '#9467bd', // purple
  Unknown: '#7f7f7f', // gray
};

export interface ParsedVersion {
  base: number[];
  suffix: string | null;
}

export interface ClassificationOptions {
  /** Product release prefix, e.g. `'NDB-'`, `'DATALENS-'`. Required (D1). */
  productPrefix: string;
}

/**
 * Parse `'NDB-3.0-EA'` → `{ base: [3, 0], suffix: 'EA' }`.
 * Returns `{ base: [], suffix: null }` on failure.
 */
export function parseVersion(
  name: string,
  options: ClassificationOptions
): ParsedVersion {
  if (!options?.productPrefix) {
    throw new Error('parseVersion: options.productPrefix is required (D1)');
  }
  if (!name) return { base: [], suffix: null };

  let raw = name.trim();
  if (raw.startsWith(options.productPrefix)) {
    raw = raw.slice(options.productPrefix.length);
  }

  let suffix: string | null = null;
  if (raw.includes('-')) {
    const dashIdx = raw.indexOf('-');
    const baseStr = raw.slice(0, dashIdx);
    const suffixCandidate = raw.slice(dashIdx + 1).toUpperCase();
    if (PRE_RELEASE_SUFFIXES.has(suffixCandidate)) {
      suffix = suffixCandidate;
      raw = baseStr;
    } else {
      // Unknown suffix → ignore and use the base
      raw = baseStr;
    }
  }

  const base: number[] = [];
  for (const p of raw.split('.')) {
    const n = Number(p);
    if (!Number.isInteger(n)) return { base: [], suffix };
    base.push(n);
  }
  return { base, suffix };
}

/**
 * Classify a release name into one of the five release-type buckets.
 */
export function classifyRelease(
  name: string,
  options: ClassificationOptions
): ReleaseType {
  const { base, suffix } = parseVersion(name, options);
  if (suffix !== null) return 'Pre-release';
  if (base.length === 0) return 'Unknown';
  const nDots = base.length - 1;
  if (nDots === 1) return 'Major/Minor';
  if (nDots === 2) return 'Maintenance';
  if (nDots === 3) return 'Patch';
  return 'Unknown';
}

/**
 * Default-selection predicate (Python: `is_major_minor_or_prerelease_ge_28`)
 * generalised: returns true when the base version is at least
 * `minVersion` (default: 2 components, ≥ [2, 8]) regardless of whether
 * it's a pre-release. Used for the burn-to-GA table.
 *
 * For other products: pass your own `minVersion` (e.g. `[1, 0]`).
 */
export function isAtLeastVersion(
  name: string,
  options: ClassificationOptions & { minVersion: number[] }
): boolean {
  const { base } = parseVersion(name, options);
  if (base.length !== options.minVersion.length) return false;
  // Lexicographic compare on equal-length tuples
  for (let i = 0; i < base.length; i++) {
    if (base[i]! > options.minVersion[i]!) return true;
    if (base[i]! < options.minVersion[i]!) return false;
  }
  return true; // exactly equal
}

/**
 * Sort key: numeric ascending; pre-release sorts BEFORE its parent
 * (`NDB-3.0-EA` < `NDB-3.0`). Suitable for `arr.sort((a, b) =>
 * compareSortKeys(sortKey(a), sortKey(b)))`.
 */
export interface SortKey {
  padded: number[];
  suffixPriority: 0 | 1;
  name: string;
}

export function sortKey(name: string, options: ClassificationOptions): SortKey {
  const { base, suffix } = parseVersion(name, options);
  if (base.length === 0) {
    return { padded: [9999], suffixPriority: 1, name };
  }
  // Pad to 4 ints so [2, 8] sorts naturally relative to [2, 8, 1, 1].
  const padded = [...base, ...Array(Math.max(0, 4 - base.length)).fill(0)];
  // Pre-release suffix sorts before unsuffixed at the same base.
  const suffixPriority: 0 | 1 = suffix !== null ? 0 : 1;
  return { padded, suffixPriority, name };
}

/**
 * Comparator over SortKey for `arr.sort()`. Lexicographic on `padded`,
 * then `suffixPriority`, then `name` (stable tiebreaker).
 */
export function compareSortKeys(a: SortKey, b: SortKey): number {
  for (let i = 0; i < Math.max(a.padded.length, b.padded.length); i++) {
    const av = a.padded[i] ?? 0;
    const bv = b.padded[i] ?? 0;
    if (av !== bv) return av - bv;
  }
  if (a.suffixPriority !== b.suffixPriority) {
    return a.suffixPriority - b.suffixPriority;
  }
  return a.name.localeCompare(b.name);
}
