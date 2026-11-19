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
 * Used heavily for executiveStatusUpdate (Executive Status Update) and similar
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

/**
 * Extract plain text from a JIRA field that may be an ADF doc.
 * Unlike extractTextFieldValue (which returns HTML for email),
 * this returns raw text safe for table/JSON consumers.
 *
 * @param {*} value - raw JIRA field value
 * @returns {string|null}
 */
function extractPlainTextFieldValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    if (value.type === 'doc' && Array.isArray(value.content)) {
      return adfToPlainText(value);
    }
    return value.value || value.url || value.name || null;
  }
  return String(value);
}

function adfToPlainText(node) {
  if (!node || typeof node !== 'object') return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'emoji') return node.attrs?.text || node.attrs?.shortName || '';
  if (node.type === 'mention') return node.attrs?.text || (node.attrs?.id ? '@' + node.attrs.id : '');
  if (node.type === 'inlineCard' || node.type === 'media' || node.type === 'mediaSingle' || node.type === 'mediaGroup') return '';
  const kids = Array.isArray(node.content)
    ? node.content.map(adfToPlainText).join('')
    : '';
  if (node.type === 'doc') return kids.trimEnd();
  if (node.type === 'paragraph') return kids + '\n';
  if (node.type === 'heading') return kids + '\n';
  if (node.type === 'bulletList' || node.type === 'orderedList') return kids;
  if (node.type === 'listItem') return '• ' + kids.trim() + '\n';
  if (node.type === 'codeBlock') return kids + '\n';
  if (node.type === 'blockquote') return kids + '\n';
  if (node.type === 'panel') return kids + '\n';
  if (node.type === 'rule') return '\n---\n';
  return kids;
}

module.exports = { extractTextFieldValue, extractPlainTextFieldValue, adfToPlainText };
