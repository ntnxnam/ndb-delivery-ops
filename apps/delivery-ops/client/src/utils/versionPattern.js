/**
 * Client-side version helpers — mirrors shared/src/utils/versionPattern.ts
 * but works with plain prefix arrays from TeamContext (no productService).
 */

export function stripReleasePrefix(versionName, prefixesOrTeam) {
  if (!versionName || typeof versionName !== 'string') return versionName;
  let prefixes = [];
  if (Array.isArray(prefixesOrTeam)) prefixes = prefixesOrTeam;
  else if (prefixesOrTeam && Array.isArray(prefixesOrTeam.releasePrefixes)) prefixes = prefixesOrTeam.releasePrefixes;
  else if (prefixesOrTeam && typeof prefixesOrTeam.releasePrefix === 'string') prefixes = [prefixesOrTeam.releasePrefix];
  // Longest first so NCN-Konvoy- wins
  const sorted = [...prefixes].sort((a, b) => b.length - a.length);
  for (const p of sorted) if (p && versionName.startsWith(p)) return versionName.slice(p.length);
  // Generic fallback — never hardcode NDB-
  return versionName.replace(/^[A-Za-z][A-Za-z0-9]*[- ]/, '');
}

export function isKnownReleaseVersion(versionName, prefixesOrTeam, activeVersionNames = []) {
  if (!versionName || typeof versionName !== 'string') return false;
  if (Array.isArray(activeVersionNames) && activeVersionNames.includes(versionName)) return true;
  let prefixes = [];
  if (Array.isArray(prefixesOrTeam)) prefixes = prefixesOrTeam;
  else if (prefixesOrTeam && Array.isArray(prefixesOrTeam.releasePrefixes)) prefixes = prefixesOrTeam.releasePrefixes;
  else if (prefixesOrTeam && typeof prefixesOrTeam.releasePrefix === 'string') prefixes = [prefixesOrTeam.releasePrefix];
  else if (Array.isArray(prefixesOrTeam)) prefixes = prefixesOrTeam;
  return prefixes.some((p) => p && versionName.startsWith(p));
}
