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
