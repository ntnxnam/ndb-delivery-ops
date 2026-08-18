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
 */

const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter } = require('../../middleware/security');
const { getTeamSosBaseFilter } = require('../../utils/teamConfig');
const { resolveKpiJql } = require('../../services/kpiService');
const { createHttpsAgent, sortByRiskIndicator } = require('../../services/jiraService');
const {
  _internals: { fetchReleaseItemsFromJira, processReleaseItems },
} = require('../../services/releaseItemsDataService');

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

module.exports = router;
