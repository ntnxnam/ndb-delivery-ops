/**
 * Decide whether a JIRA version belongs to a product: pinned
 * `activeVersionNames` always match, otherwise the name must start with
 * one of the product's release prefixes. With no prefix configured,
 * nothing matches — callers treat that as "no scoping" and keep every
 * version. Plural `productPrefixes` is canonical; singular
 * `productPrefix` is kept for backwards compat.
 */
export function versionBelongsToProduct(
  versionName: string,
  options: { productPrefix?: string; productPrefixes?: string[]; activeVersionNames?: string[] } = {}
): boolean {
  if (!versionName) return false;
  const pinned = options.activeVersionNames || [];
  if (pinned.includes(versionName)) return true;
  const prefixes: string[] = Array.isArray(options.productPrefixes) && options.productPrefixes.length > 0
    ? options.productPrefixes
    : options.productPrefix ? [options.productPrefix] : [];
  if (prefixes.length === 0) return false;
  return prefixes.some((p) => p && versionName.startsWith(p));
}

/**
 * Strip a team's release prefix from a version string.
 * Tries longest prefix first so NCN's 3-way prefixes don't collide.
 * Falls back to a generic `[A-Za-z][A-Za-z0-9]*[- ]` strip so a version
 * from an unknown team still shortens rather than leaking the prefix.
 */
export function stripReleasePrefix(
  versionName: string,
  options: { productPrefix?: string; productPrefixes?: string[] } = {}
): string {
  if (!versionName) return versionName;
  const prefixes: string[] = Array.isArray(options.productPrefixes) && options.productPrefixes.length > 0
    ? [...options.productPrefixes].sort((a, b) => b.length - a.length)
    : options.productPrefix ? [options.productPrefix] : [];
  for (const p of prefixes) {
    if (p && versionName.startsWith(p)) return versionName.slice(p.length);
  }
  // Generic fallback — never hardcode `NDB-`.
  return versionName.replace(/^[A-Za-z][A-Za-z0-9]*[- ]/, '');
}

/**
 * Predicate + sorter helpers for "is this fixVersion in scope for the team?"
 * Thin wrappers over versionBelongsToProduct so callers don't re-derive opts.
 */
export function isTeamRelease(
  versionName: string,
  opts: { productPrefixes?: string[]; productPrefix?: string; activeVersionNames?: string[] },
): boolean {
  return versionBelongsToProduct(versionName, opts);
}
