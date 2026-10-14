/**
 * Wishlist relationship helpers.
 * Clone / Duplicate (and other ignored patterns) do not count as dependency links.
 */

const DEFAULT_IGNORED = ['clone', 'cloner', 'duplicat'];

export function normalizeIgnoredPatterns(patterns) {
  const list = Array.isArray(patterns) && patterns.length ? patterns : DEFAULT_IGNORED;
  return list.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean);
}

/** True if this link type is Clone/Duplicate/etc. and should be ignored. */
export function isIgnoredLink(link, ignoredPatterns) {
  const patterns = normalizeIgnoredPatterns(ignoredPatterns);
  const hay = `${link?.type || ''} ${link?.typeName || ''} ${link?.direction || ''}`.toLowerCase();
  return patterns.some((p) => hay.includes(p));
}

export function meaningfulLinks(issue, ignoredPatterns) {
  return (issue?.links || []).filter((l) => l?.key && !isIgnoredLink(l, ignoredPatterns));
}

/** True if wishlist issue has at least one non-ignored issue link. */
export function hasMeaningfulLinks(issue, ignoredPatterns) {
  return meaningfulLinks(issue, ignoredPatterns).length > 0;
}

export function unlinkedKeySet(unlinkedIssues) {
  return new Set((unlinkedIssues || []).map((i) => i.key).filter(Boolean));
}

/**
 * Wishlist tickets with a real dependency relationship (non-Clone/Duplicate links).
 */
export function filterRelatedWishlist(wishlistIssues, _unlinkedIssues, ignoredPatterns) {
  return (wishlistIssues || []).filter(
    (iss) => iss?.key && hasMeaningfulLinks(iss, ignoredPatterns)
  );
}

/**
 * Label-only OR only-ignored-links (Clone/Duplicate) — not shown on Gantt.
 */
export function filterLabelOnlyWishlist(wishlistIssues, unlinkedIssues, ignoredPatterns) {
  const unlinked = unlinkedKeySet(unlinkedIssues);
  return (wishlistIssues || []).filter((iss) => {
    if (!iss?.key) return false;
    if (unlinked.has(iss.key)) return true;
    return !hasMeaningfulLinks(iss, ignoredPatterns);
  });
}

/**
 * Partners linked via a meaningful link to at least one related wishlist ticket.
 */
export function filterPartnersOfRelated(relatedWishlist, partnerIssues, ignoredPatterns) {
  const relatedKeys = new Set(relatedWishlist.map((i) => i.key));
  const partnerKeysWanted = new Set();
  relatedWishlist.forEach((w) => {
    meaningfulLinks(w, ignoredPatterns).forEach((l) => {
      partnerKeysWanted.add(l.key);
    });
  });
  (partnerIssues || []).forEach((p) => {
    meaningfulLinks(p, ignoredPatterns).forEach((l) => {
      if (relatedKeys.has(l.key)) partnerKeysWanted.add(p.key);
    });
  });
  return (partnerIssues || []).filter((p) => partnerKeysWanted.has(p.key));
}
