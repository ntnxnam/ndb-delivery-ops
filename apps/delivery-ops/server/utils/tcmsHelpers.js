/**
 * Helpers for working with TCMS (Test Case Management System) data on JIRA
 * items. The live TCMS Quality Index API is unreliable, so most NDB-Ops
 * surfaces extract QI from the Status Update narrative instead.
 *
 * Pulled out of server/routes/jira/index.js during Phase 2a.
 */

/**
 * Extract QI percentage from an item's Status Update narrative.
 *
 * Looks for the pattern "QI = NN" / "QI: NN%" / "QI NN" inside the human-
 * written Status Update field. Returns null if no QI value is present.
 *
 * @param {object} item - JIRA item with .statusUpdate (preferred) or .customfield_23073
 * @returns {number|null} percentage 0-100, or null
 */
function extractQIFromItem(item) {
  if (item && item.statusUpdate) {
    const qiMatch = item.statusUpdate.match(/QI\s*%?\s*[=:]\s*(\d+)%?/i);
    if (qiMatch) return parseInt(qiMatch[1], 10);
  }
  if (item && item.customfield_23073) {
    const qiMatch = item.customfield_23073.match(/QI\s*%?\s*[=:]\s*(\d+)%?/i);
    if (qiMatch) return parseInt(qiMatch[1], 10);
  }
  return null;
}

module.exports = { extractQIFromItem };
