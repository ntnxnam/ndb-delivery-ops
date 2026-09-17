/**
 * SoS history version filter.
 *
 * The SoS date-movement history walk is expensive: one JIRA changelog fetch
 * per Feature/Initiative, run sequentially. Items whose ONLY fix versions are
 * rolling / placeholder buckets ("master", "Era Future") carry no meaningful
 * gate-date movement, and for the `ndb` SoS filter these buckets are huge
 * (master alone spans thousands of tickets). Walking their changelogs is what
 * pushes the request past the rate-limit / timeout ceiling, so we skip them.
 *
 * An item tagged to BOTH a real release (e.g. NDB-2.12) and "master" is KEPT —
 * its movement is still relevant for the real-release view. Only items whose
 * fix versions are ENTIRELY placeholder buckets are dropped. Unversioned items
 * are kept (matches the prior behaviour of the endpoint).
 *
 * NOTE: this is a JS post-filter on the returned issues — it does NOT modify
 * the JQL where-clause (per the JQL-edit-approval rule). The search JQL is
 * unchanged; we only ask for the `fixVersions` field and filter in memory.
 *
 * TODO(D1): the excluded version names are NDB/ERA-specific. When SoS goes
 * multi-product, source these from productService config instead of a literal.
 */

const EXCLUDED_HISTORY_VERSIONS = ['master', 'era future'];

/**
 * Extract normalised (trimmed, lower-cased) fix version names from a raw JIRA
 * issue (`issue.fields.fixVersions`) or an already-flattened issue.
 * @param {object} issue
 * @returns {string[]}
 */
function issueFixVersionNames(issue) {
  const raw =
    (issue && issue.fields && issue.fields.fixVersions) ||
    (issue && issue.fixVersions) ||
    [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((v) => (v && typeof v === 'object' ? v.name : v))
    .filter((n) => n != null && n !== '')
    .map((n) => String(n).trim().toLowerCase());
}

/**
 * True when an issue should be SKIPPED from the history walk — i.e. it has at
 * least one fix version and every one of them is an excluded placeholder.
 * @param {object} issue
 * @returns {boolean}
 */
function isHistoryExcludedIssue(issue) {
  const names = issueFixVersionNames(issue);
  if (names.length === 0) return false; // unversioned → keep
  return names.every((n) => EXCLUDED_HISTORY_VERSIONS.includes(n));
}

/**
 * Filter a list of raw JIRA issues down to those eligible for a history walk.
 * @param {object[]} issues
 * @returns {object[]}
 */
function filterHistoryEligibleIssues(issues) {
  return (Array.isArray(issues) ? issues : []).filter((i) => !isHistoryExcludedIssue(i));
}

module.exports = {
  EXCLUDED_HISTORY_VERSIONS,
  issueFixVersionNames,
  isHistoryExcludedIssue,
  filterHistoryEligibleIssues,
};
