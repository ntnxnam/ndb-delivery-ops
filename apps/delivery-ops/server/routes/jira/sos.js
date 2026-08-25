/**
 * POST /api/jira/sos-items
 *
 * Fetch Feature and Initiative tickets grouped by fixVersion.
 * Cache-first from the on-disk release dataset; live JIRA only when the
 * cache is empty or the client sends forceLive: true (Refresh All).
 * A JIRA 429 falls back to cache when available.
 *
 * Body: { teamId?: string, forceLive?: boolean }
 * Response: { success: true, data: { byVersion, source, usedFallbackFilter, lastSyncIso, degraded } }
 *
 * POST /api/jira/sos-items-history
 *
 * Fetch checkpoint-field change history (CC, CG, PG) for all Feature/Initiative
 * tickets in scope of the team's SoS base filter. Reuses the same filter +
 * fetchFieldHistoryForMultiple used by /release-items-history — but scoped
 * only to SoS items (no full release item walk needed).
 *
 * Body: { teamId?: string }
 * Response: { success: true, data: { history: { [key]: { codeComplete, commitGate, promotionGate } } } }
 */

const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter, checkpointHistoryLimiter } = require('../../middleware/security');
const { getTeamSosBaseFilter } = require('../../utils/teamConfig');
const { resolveKpiJql } = require('../../services/kpiService');
const { createHttpsAgent, makeJiraSearchFetcher } = require('../../services/jiraService');
const { fetchSosItems } = require('../../services/releaseItemsDataService');
const {
  fetchFieldHistoryForMultiple,
  transformFieldHistoryToCheckpointHistory,
} = require('../../utils/fieldHistoryUtils');

router.post('/sos-items', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const { teamId = 'ndb', forceLive = false } = req.body;
    const httpsAgent = createHttpsAgent();
    const data = await fetchSosItems({
      teamId,
      jiraToken: req.jiraToken,
      httpsAgent,
      forceLive: Boolean(forceLive),
    });
    return res.json({ success: true, data });
  } catch (err) {
    console.error('[sos-items] Error:', err.message);
    const status = err.statusCode || ( /rate limit/i.test(err.message || '') ? 429 : 500);
    return res.status(status).json({
      success: false,
      error: err.message || 'Failed to fetch SoS items',
    });
  }
});

router.post('/sos-items-history', validateJiraTokenMiddleware, checkpointHistoryLimiter, async (req, res) => {
  req.setTimeout(180000);
  res.setTimeout(180000);
  try {
    const { teamId = 'ndb' } = req.body;
    const httpsAgent = createHttpsAgent();

    // Resolve the same SoS filter used by /sos-items
    const rawSosFilter = getTeamSosBaseFilter(teamId);
    const fallback = 'filter=NDB-All-Base-Filter';
    const sosFilter = rawSosFilter || fallback;
    const resolvedFilter = await resolveKpiJql(sosFilter, req.jiraToken, httpsAgent);

    // Fetch just the keys — no need for full field processing.
    // The SoS base filter can be a large JIRA saved filter; raise the timeout
    // from the 6s default to 30s so the search doesn't time out before returning keys.
    const jql = `(${resolvedFilter}) AND issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY key ASC`;
    const fetchIssues = makeJiraSearchFetcher(req.jiraToken, { timeoutMs: 30000 });
    const issues = await fetchIssues(jql, 'key');
    const itemKeys = issues.map((i) => i.key).filter(Boolean);

    if (itemKeys.length === 0) {
      return res.json({ success: true, data: { history: {}, itemCount: 0 } });
    }

    // Restrict to the three checkpoint fields the SoS page renders (CC, CG, PG).
    // Fetching all six date fields per ticket is unnecessary and slows down the
    // changelog walk for a large SoS filter.
    const SOS_FIELDS = ['codeComplete', 'commitGate', 'promotionGate'];
    const rawHistory = await fetchFieldHistoryForMultiple(itemKeys, req.jiraToken, { fields: SOS_FIELDS });
    const history = transformFieldHistoryToCheckpointHistory(rawHistory);

    return res.json({ success: true, data: { history, itemCount: itemKeys.length } });
  } catch (err) {
    console.error('[sos-items-history] Error:', err.message);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to fetch SoS history' });
  }
});

module.exports = router;
