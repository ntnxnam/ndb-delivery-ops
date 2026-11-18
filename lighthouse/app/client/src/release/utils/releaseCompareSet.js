/**
 * releaseCompareSet — pure helpers to pick the set of releases the
 * retrospective comparison should span.
 *
 * Per the plan: compare the selected release against the latest
 * major/minor ("big") releases. A big release has exactly one dot
 * after the product prefix (e.g. NDB-2.11), per release-types.mdc.
 * Maintenance (two dots) and patch (three dots) are excluded so the
 * comparison stays like-for-like (they skip CG/PG entirely).
 *
 * No JQL, no fetch — just version-string math.
 */

/** Strip the product prefix (letters + dash) and any pre-release suffix. */
function baseVersion(name) {
  if (!name) return '';
  const raw = String(name).trim();
  // Drop leading product prefix like "NDB-", "DataLens-", "NCM-".
  const noPrefix = raw.replace(/^[A-Za-z][A-Za-z0-9]*-/, '');
  // Drop pre-release suffix like "-EA", "-RC1", "-BETA".
  const [core] = noPrefix.split('-');
  return core || '';
}

/** True when the version is a major/minor release (exactly one dot). */
export function isMajorMinor(name) {
  const core = baseVersion(name);
  if (!core) return false;
  return (core.match(/\./g) || []).length === 1;
}

/** Numeric sort key from the base version (e.g. "2.11" -> 2.011). */
function versionSortKey(name) {
  const core = baseVersion(name);
  const parts = core.split('.').map((n) => parseInt(n, 10) || 0);
  // major.minor with minor zero-padded so 2.9 < 2.11.
  return (parts[0] || 0) + (parts[1] || 0) / 1000;
}

/**
 * Return the ordered set of releases to compare.
 *
 * @param {Array<string|{name:string}>} versions  all known versions
 * @param {string} selectedRelease                the currently selected release
 * @param {number} count                          how many big releases to include (default 3)
 * @returns {string[]} release names, oldest -> newest, selected always included
 */
export function pickComparisonReleases(versions, selectedRelease, count = 3) {
  const names = (versions || [])
    .map((v) => (typeof v === 'string' ? v : v?.name))
    .filter(Boolean);

  const bigs = names.filter(isMajorMinor);

  // Unique, sorted newest -> oldest.
  const uniqueSorted = Array.from(new Set(bigs)).sort(
    (a, b) => versionSortKey(b) - versionSortKey(a)
  );

  const latest = uniqueSorted.slice(0, count);

  const set = new Set(latest);
  // Always include the selected release so the user sees it in context,
  // even if it is not a big release or falls outside the latest N.
  if (selectedRelease) set.add(selectedRelease);

  // Return oldest -> newest for left-to-right trend reading.
  return Array.from(set).sort((a, b) => versionSortKey(a) - versionSortKey(b));
}
