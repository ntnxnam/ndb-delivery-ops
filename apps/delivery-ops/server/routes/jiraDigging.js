/**
 * JIRA Data Digging — Slice 2: real Fetch & Index (read-only, no persistence yet)
 * POST /api/jira-digging/prepare → searchCount + searchAll (first 100 keys sample)
 * Uses per-request PAT from Authorization: Bearer <pat> via validateJiraTokenMiddleware
 * Slice 2 is live-sample only (count + 10 keys); Slice 2b adds full download + changelog/comments enrichment + disk cache.
 */
const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { JiraConnector, loadEnv } = require('@portfolio-delivery-ops/shared');
const logger = require('../utils/logger');

// Caps mirror releaseDatasetService.ts: fetchReleaseData maxIssues but lower for digging UX
const MAX_JQL_LENGTH = 4000;
const MAX_ISSUES_SLICE2 = 10000;
const SAMPLE_KEYS = 10;
const DIGGING_FIELDS = [
  'key', 'summary', 'issuetype', 'status', 'priority', 'assignee',
  'fixVersions', 'created', 'updated', 'labels', 'components', 'resolution',
].join(',');

function hashJql(jql) {
  let h = 0;
  for (let i = 0; i < jql.length; i++) h = (Math.imul(31, h) + jql.charCodeAt(0)) >>> 0;
  return `${h.toString(16).slice(0, 8)}_${Date.now()}`;
}

router.post('/prepare', validateJiraTokenMiddleware, async (req, res) => {
  const jql = String(req.body?.jql || '').trim();
  const productId = String(req.body?.productId || '').trim() || 'ndb';

  if (!jql) return res.status(400).json({ error: 'jql is required' });
  if (jql.length > MAX_JQL_LENGTH) return res.status(400).json({ error: `jql too long (max ${MAX_JQL_LENGTH})` });

  const jiraPat = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!jiraPat) return res.status(401).json({ error: 'JIRA PAT required (Bearer)' });

  try {
    const env = loadEnv({ requirePat: false });
    env.jiraPat = jiraPat;
    // Inherit jiraBaseUrl/timeout/proxy from server env
    const jira = new JiraConnector(env);

    const total = await jira.searchCount(jql);
    if (total > MAX_ISSUES_SLICE2) {
      return res.status(400).json({ error: `Result too large: ${total} > ${MAX_ISSUES_SLICE2} cap. Narrow JQL.` , total });
    }

    // Fetch sample for preview (Slice 2: only first page, no full download yet)
    const issues = total > 0 ? await jira.searchAll(jql, DIGGING_FIELDS, { pageSize: Math.min(total, 100), maxIssues: 100 }) : [];
    const sampleKeys = issues.slice(0, SAMPLE_KEYS).map((i) => i.key);

    const datasetId = `dig_${hashJql(jql)}`;
    const payload = {
      datasetId,
      jql,
      productId,
      ticketCount: total,
      sampleKeys,
      fetchedAt: new Date().toISOString(),
      fields: DIGGING_FIELDS,
      truncated: total > issues.length,
      mode: 'live-sample',
    };

    logger.info(`[jira-digging] prepare ok jqlHash=${datasetId} total=${total} sample=${sampleKeys.length} product=${productId} user=${req.username || '-'}`);
    return res.json(payload);
  } catch (err) {
    const status = err.statusCode || err.response?.status || 500;
    const msg = err.message || err.response?.data?.errorMessages?.[0] || 'JIRA fetch failed';
    logger.error('[jira-digging] prepare failed', err, { jql, status, msg });
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg, details: err.details || err.response?.data });
  }
});

module.exports = router;
