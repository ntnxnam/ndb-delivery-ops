/**
 * CJS adapter onto shared ConfluenceConnector (D3).
 * Express must not open its own axios + Bearer path to Confluence.
 */

const { getShared } = require('./jiraClient');
const { CONFLUENCE_BASE_URL } = require('../config/api');

function cleanToken(token) {
  return String(token || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

async function getConfluence(token) {
  const pat = cleanToken(token);
  if (!pat) {
    const err = new Error('Confluence Bearer token required');
    err.statusCode = 401;
    throw err;
  }
  const shared = await getShared();
  const env = {
    ...shared.loadEnv({ requirePat: false }),
    confluenceBaseUrl: CONFLUENCE_BASE_URL,
    confluencePat: pat,
  };
  return new shared.ConfluenceConnector(env);
}

module.exports = { getConfluence, cleanToken };
