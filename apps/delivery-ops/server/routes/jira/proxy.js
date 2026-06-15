const express = require('express');
const router  = express.Router();
const axios   = require('axios');
const { JIRA_API_V2 } = require('../../config/api');
const { createHttpsAgent } = require('../../services/jiraService');
const logger = require('../../utils/logger');

/**
 * POST /api/jira/proxy
 *
 * Thin pass-through for Google Apps Script (and other server-side callers)
 * that cannot reach jira.nutanix.com directly.  The caller supplies its own
 * Jira bearer token; this server only forwards and returns the response.
 *
 * Required headers:
 *   Authorization : Bearer <jira-personal-access-token>
 *   x-proxy-key   : <value of APPS_SCRIPT_PROXY_KEY env var>  (if set)
 *
 * Body (JSON):
 *   path    {string}  Jira REST path, must start with /rest/  (default: /rest/api/2/myself)
 *   method  {string}  HTTP method                             (default: GET)
 *   data    {object}  Request body forwarded to Jira          (default: null)
 */
router.post('/', async (req, res) => {
  // ── 1. Optional proxy-key guard ───────────────────────────────────────────
  const envKey = process.env.APPS_SCRIPT_PROXY_KEY;
  if (envKey) {
    const callerKey = req.headers['x-proxy-key'];
    if (callerKey !== envKey) {
      logger.warn('[JiraProxy] Rejected request — missing or invalid x-proxy-key');
      return res.status(401).json({ error: 'Invalid or missing x-proxy-key header' });
    }
  }

  // ── 2. Extract bearer token ───────────────────────────────────────────────
  const authHeader = (req.headers.authorization || '').trim();
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7).trim()
    : authHeader;

  if (!token) {
    return res.status(401).json({ error: 'Missing Authorization: Bearer <token> header' });
  }

  // ── 3. Validate and build target URL ─────────────────────────────────────
  const { path = '/rest/api/2/myself', method = 'GET', data = null } = req.body || {};

  if (!path.startsWith('/rest/')) {
    return res.status(400).json({ error: 'path must start with /rest/' });
  }

  const targetUrl = `${JIRA_API_V2.BASE_URL}${path}`;

  logger.info(`[JiraProxy] ${method.toUpperCase()} ${targetUrl}`);

  // ── 4. Forward to Jira ────────────────────────────────────────────────────
  try {
    const jiraResponse = await axios({
      method          : method.toUpperCase(),
      url             : targetUrl,
      data            : data || undefined,
      headers         : {
        'Authorization' : `Bearer ${token}`,
        'Content-Type'  : 'application/json',
        'Accept'        : 'application/json'
      },
      httpsAgent      : createHttpsAgent(),
      timeout         : 30000,
      validateStatus  : () => true  // forward all status codes; let caller decide
    });

    return res.status(jiraResponse.status).json(jiraResponse.data);

  } catch (err) {
    logger.error(`[JiraProxy] Error forwarding to Jira: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
