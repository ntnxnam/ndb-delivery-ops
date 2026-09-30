/**
 * resolutionCategoriesService — JIRA resolution → 4-bucket category.
 *
 * Ports `resolution_categories.py` (CONSOLIDATION.md #1b Phase 2).
 *
 * Four buckets (per `.cursor/rules/velocity-resolution-categories.mdc`):
 *
 *   1. Unresolved
 *   2. Done / Positive            (POSITIVE_RESOLUTIONS — ticket shipped)
 *   3. Dupe or Not Reproducible   (Cannot Reproduce, Duplicate, Not Reproducible)
 *   4. Others / Negative          (anything resolved but not in positive — no need
 *                                  to enumerate; what is not positive is negative)
 *
 * The raw `Resolution` string from JIRA is preserved on every ticket;
 * this module only provides the derived bucket label and matching JQL
 * fragments so clickable URLs reproduce the same filter the dashboard
 * cell counted.
 *
 * Source of truth: .cursor/context/jira-workflows-and-resolutions.md §3
 * No D1 concerns: resolution names are JIRA-system standard.
 */

export const POSITIVE_RESOLUTIONS = new Set([
  'fixed',
  'done',
  'resolved',
  'complete',
  'approved',
]);

/** @deprecated Use POSITIVE_RESOLUTIONS */
export const DONE_RESOLUTIONS = POSITIVE_RESOLUTIONS;

export const DUPE_RESOLUTIONS = new Set([
  'cannot reproduce',
  'duplicate',
  'not reproducible',
]);

export const RESOLUTION_CATEGORIES = [
  'Unresolved',
  'Done',
  'Dupe or Not Reproducible',
  'Others',
] as const;

export type ResolutionCategory = (typeof RESOLUTION_CATEGORIES)[number];

/** Return one of the four categories for a raw resolution string. */
export function categorizeResolution(
  resolution: string | null | undefined
): ResolutionCategory {
  if (resolution === null || resolution === undefined) return 'Unresolved';
  const s = String(resolution).trim();
  if (!s || s.toLowerCase() === 'unresolved') return 'Unresolved';
  const sl = s.toLowerCase();
  if (POSITIVE_RESOLUTIONS.has(sl)) return 'Done';
  if (DUPE_RESOLUTIONS.has(sl)) return 'Dupe or Not Reproducible';
  // Everything resolved but not positive is negative — no enumeration needed.
  return 'Others';
}

/** JQL fragment that matches a resolution category. Used for clickable URLs. */
export function categoryFilterJql(category: ResolutionCategory): string {
  switch (category) {
    case 'Done':
      return 'resolution in (Fixed, Done, Resolved, Complete, Approved)';
    case 'Unresolved':
      return 'resolution = Unresolved';
    case 'Dupe or Not Reproducible':
      return 'resolution in ("Cannot Reproduce", Duplicate, "Not Reproducible")';
    case 'Others':
      // Negative = anything resolved that is not in the positive set.
      // No explicit enumeration — open-ended by design.
      return (
        'resolution not in (Fixed, Done, Resolved, Complete, Approved, Unresolved, ' +
        '"Cannot Reproduce", Duplicate, "Not Reproducible") ' +
        'AND resolution is not EMPTY'
      );
  }
}

/**
 * Convenience: is this raw resolution string positive (shipped)?
 * Cheaper than calling `categorizeResolution` when you only care about
 * the boolean (used by processMaster's `Is Done` derived column).
 */
export function isPositiveResolution(
  resolution: string | null | undefined
): boolean {
  if (resolution === null || resolution === undefined) return false;
  return POSITIVE_RESOLUTIONS.has(String(resolution).toLowerCase());
}

/** @deprecated Use isPositiveResolution */
export const isDoneResolution = isPositiveResolution;
