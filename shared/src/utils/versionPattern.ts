/**
 * Decide whether a JIRA version belongs to a product: pinned
 * `activeVersionNames` always match, otherwise the name must start with
 * the product's release prefix. With no prefix configured, nothing
 * matches — callers treat that as "no scoping" and keep every version.
 */
export function versionBelongsToProduct(
  versionName: string,
  options: { productPrefix?: string; activeVersionNames?: string[] } = {}
): boolean {
  if (!versionName) return false;
  const pinned = options.activeVersionNames || [];
  if (pinned.includes(versionName)) return true;
  const prefix = options.productPrefix || '';
  return Boolean(prefix && versionName.startsWith(prefix));
}
