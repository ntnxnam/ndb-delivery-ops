/**
 * Compile user-supplied version filters without throwing.
 *
 * Admins type whatever they type: globs (`msp*`), regex (`^DataLens.*`),
 * or invalid strings. Sync Hub / ProductService must never crash with
 * `Invalid regular expression: Nothing to repeat`.
 *
 * Keep in sync with `apps/delivery-ops/server/utils/versionPattern.js`.
 */

const REGEX_CONSTRUCT = /(?:\.\*)|[()[\]{}+|\\]/;

export function escapeRegExp(value: string): string {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(glob: string, flags: string): RegExp {
  const inner = String(glob).replace(/^\^/, '').replace(/\$$/, '');
  let out = '';
  let hasWild = false;
  for (const ch of inner) {
    if (ch === '*') {
      out += '.*';
      hasWild = true;
    } else if (ch === '?') {
      out += '.';
      hasWild = true;
    } else {
      out += escapeRegExp(ch);
    }
  }
  return new RegExp(hasWild ? `^${out}$` : `^${out}`, flags);
}

function shouldTreatAsGlob(input: string): boolean {
  const inner = input.replace(/^\^/, '').replace(/\$$/, '');
  return !REGEX_CONSTRUCT.test(inner);
}

/**
 * Compile one version-name pattern. Returns null for empty / unusable input.
 * Never throws.
 */
export function compileVersionPattern(raw: unknown, flags = 'i'): RegExp | null {
  const input = String(raw ?? '').trim();
  if (!input) return null;
  try {
    return shouldTreatAsGlob(input)
      ? globToRegExp(input, flags)
      : new RegExp(input, flags);
  } catch {
    try {
      return globToRegExp(input, flags);
    } catch {
      return null;
    }
  }
}

export function compileVersionPatterns(rawPatterns: unknown, flags = 'i'): RegExp[] {
  if (!Array.isArray(rawPatterns)) return [];
  return rawPatterns
    .map((p) => compileVersionPattern(p, flags))
    .filter((re): re is RegExp => re != null);
}

export function versionMatchesAny(versionName: string, rawPatterns: unknown): boolean {
  if (!versionName) return false;
  const regexes = compileVersionPatterns(rawPatterns);
  return regexes.some((re) => re.test(versionName));
}

/**
 * Decide whether a JIRA version belongs to a product.
 * Parent projects match `versionPatterns` (globs or regex). Dedicated
 * products match `releasePrefix` / pinned `activeVersionNames`.
 */
export function versionBelongsToProduct(
  product: {
    projectType?: string;
    versionPatterns?: string[];
  } | null | undefined,
  versionName: string,
  options: { productPrefix?: string; activeVersionNames?: string[] } = {}
): boolean {
  if (!versionName) return false;
  const pinned = options.activeVersionNames || [];
  if (pinned.includes(versionName)) return true;
  if (
    Array.isArray(product?.versionPatterns) &&
    product.versionPatterns.length
  ) {
    return versionMatchesAny(versionName, product.versionPatterns);
  }
  const prefix = options.productPrefix || '';
  return Boolean(prefix && versionName.startsWith(prefix));
}
