/**
 * Helpers for extracting plain text from JIRA field values that may arrive
 * in multiple shapes: string, ADF (Atlassian Document Format) object, or
 * legacy object with .value / .name.
 *
 * Pulled out of server/routes/jira/index.js during Phase 2a so route files
 * stay thin and these helpers are reusable from services, scripts, and tests.
 */

const { adfToHtml } = require('./emailFormatter');

/**
 * Safely extract a string value from a JIRA text field that can return:
 *   - null / undefined  -> null
 *   - string            -> as-is
 *   - ADF object        -> rendered HTML via adfToHtml
 *   - legacy object     -> .value || .name || JSON
 *
 * Used heavily for customfield_38460 (Executive Status Update) and similar
 * rich-text customfields.
 *
 * @param {*} value - raw JIRA field value
 * @returns {string|null}
 */
function extractTextFieldValue(value) {
  if (value === null || value === undefined) {
    return null;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'object') {
    if (value.type === 'doc' && Array.isArray(value.content)) {
      return adfToHtml(value);
    }
    return value.value || value.name || JSON.stringify(value);
  }
  return String(value);
}

module.exports = { extractTextFieldValue };
