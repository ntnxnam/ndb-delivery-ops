/**
 * POST /api/jira/sos-items
 *
 * Fetch all Feature and Initiative tickets for a single release directly
 * from JIRA — always live, no on-disk cache. Used by the SoS Summary page.
 *
 * Body: { fixVersion: string, teamId?: string }
 */

const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter } = require('../../middleware/security');
const { getTeamSosBaseFilter } = require('../../utils/teamConfig');
const { resolveKpiJql } = require('../../services/kpiService');
const { createHttpsAgent, sortByRiskIndicator } = require('../../services/jiraService');
const {
  _internals: { fetchReleaseItemsFromJira, processReleaseItems, RELEASE_ITEMS_CONFIG },
} = require('../../services/releaseItemsDataService');

router.post('/sos-items', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const { fixVersion, teamId = 'ndb' } = req.body;
    if (!fixVersion || typeof fixVersion !== 'string' || !fixVersion.trim()) {
      return res.status(400).json({ success: false, error: 'fixVersion is required' });
    }

    const httpsAgent = createHttpsAgent();

    // Resolve sosBaseFilter — may be filter=name, filter=id, or raw JQL
    const rawSosFilter = getTeamSosBaseFilter(teamId);
    const fallback = `filter=NDB-All-Base-Filter`;
    const sosFilter = rawSosFilter || fallback;
    const resolvedFilter = await resolveKpiJql(sosFilter, req.jiraToken, httpsAgent);

    const jql = `(${resolvedFilter}) AND fixVersion = "${fixVersion.trim()}" AND issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY key ASC`;

    const issues = await fetchReleaseItemsFromJira(jql, req.jiraToken, httpsAgent, `sos-items-${fixVersion}`);
    const items = await processReleaseItems(issues, req.jiraToken, httpsAgent, `sos-items-${fixVersion}`);

    return res.json({ success: true, data: { items: sortByRiskIndicator(items), usedFallbackFilter: !rawSosFilter } });
  } catch (err) {
    console.error('[sos-items] Error:', err.message);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to fetch SoS items' });
  }
});

module.exports = router;
