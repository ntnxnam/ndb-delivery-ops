/**
 * Compile user-supplied version filters without throwing.
 *
 * Admins type whatever they type: globs (`msp*`), regex (`^DataLens.*`),
 * or invalid strings. Sync Hub / Admin Test must never crash with
 * `Invalid regular expression: Nothing to repeat`.
 *
 * Keep in sync with `shared/src/utils/versionPattern.ts`.
 */

const REGEX_CONSTRUCT = /(?:\.\*)|[()[\]{}+|\\]/;

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function globToRegExp(glob, flags) {
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

function shouldTreatAsGlob(input) {
  const inner = input.replace(/^\^/, '').replace(/\$$/, '');
  return !REGEX_CONSTRUCT.test(inner);
}

function compileVersionPattern(raw, flags = 'i') {
  const input = String(raw == null ? '' : raw).trim();
  if (!input) return null;
  try {
    return shouldTreatAsGlob(input)
      ? globToRegExp(input, flags)
      : new RegExp(input, flags);
  } catch (_e) {
    try {
      return globToRegExp(input, flags);
    } catch (_e2) {
      return null;
    }
  }
}

function compileVersionPatterns(rawPatterns, flags = 'i') {
  if (!Array.isArray(rawPatterns)) return [];
  return rawPatterns
    .map((p) => compileVersionPattern(p, flags))
    .filter(Boolean);
}

function versionMatchesAny(versionName, rawPatterns) {
  if (!versionName) return false;
  return compileVersionPatterns(rawPatterns).some((re) => re.test(versionName));
}

function versionBelongsToProduct(product, versionName, options = {}) {
  if (!versionName) return false;
  const pinned = options.activeVersionNames || [];
  if (pinned.includes(versionName)) return true;
  if (
    product &&
    Array.isArray(product.versionPatterns) &&
    product.versionPatterns.length
  ) {
    return versionMatchesAny(versionName, product.versionPatterns);
  }
  const prefix = options.productPrefix || '';
  return Boolean(prefix && versionName.startsWith(prefix));
}

module.exports = {
  escapeRegExp,
  compileVersionPattern,
  compileVersionPatterns,
  versionMatchesAny,
  versionBelongsToProduct,
};
