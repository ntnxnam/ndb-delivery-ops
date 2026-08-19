/**
 * POST /api/jira/sos-items
 *
 * Fetch ALL Feature and Initiative tickets in scope of the team's SoS base
 * filter — always live, no on-disk cache — and return them grouped by fixVersion.
 *
 * No fixVersion input required. The server resolves the filter, fetches all
 * matching issues, processes them, then groups by fixVersion so the client
 * can render one section per release without knowing the version list upfront.
 *
 * Body: { teamId?: string }
 * Response: { success: true, data: { byVersion: { [version]: Item[] }, usedFallbackFilter: bool } }
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
const { createHttpsAgent, sortByRiskIndicator, makeJiraSearchFetcher } = require('../../services/jiraService');
const {
  _internals: { fetchReleaseItemsFromJira, processReleaseItems },
} = require('../../services/releaseItemsDataService');
const {
  fetchFieldHistoryForMultiple,
  transformFieldHistoryToCheckpointHistory,
} = require('../../utils/fieldHistoryUtils');

router.post('/sos-items', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const { teamId = 'ndb' } = req.body;

    const httpsAgent = createHttpsAgent();

    // Resolve sosBaseFilter — may be filter=name, filter=id, or raw JQL
    const rawSosFilter = getTeamSosBaseFilter(teamId);
    const fallback = 'filter=NDB-All-Base-Filter';
    const sosFilter = rawSosFilter || fallback;
    const resolvedFilter = await resolveKpiJql(sosFilter, req.jiraToken, httpsAgent);

    // Fetch all Features + Initiatives in scope — no fixVersion constraint
    const jql = `(${resolvedFilter}) AND issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY fixVersion ASC, key ASC`;

    const issues = await fetchReleaseItemsFromJira(jql, req.jiraToken, httpsAgent, 'sos-items-all');
    const items = await processReleaseItems(issues, req.jiraToken, httpsAgent, 'sos-items-all');

    // Group by fixVersion — fixVersions is a comma-separated string on processed items
    const byVersion = {};
    for (const item of items) {
      const raw = item.fixVersions || item.fixVersion || '';
      const versions = raw && raw !== 'N/A'
        ? raw.split(',').map((v) => v.trim()).filter(Boolean)
        : ['Unversioned'];

      for (const v of versions) {
        if (!byVersion[v]) byVersion[v] = [];
        byVersion[v].push(item);
      }
    }

    // Sort items within each version by risk indicator
    for (const v of Object.keys(byVersion)) {
      byVersion[v] = sortByRiskIndicator(byVersion[v]);
    }

    return res.json({
      success: true,
      data: { byVersion, usedFallbackFilter: !rawSosFilter },
    });
  } catch (err) {
    console.error('[sos-items] Error:', err.message);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to fetch SoS items' });
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
