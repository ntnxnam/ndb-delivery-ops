/**
 * POST /api/jira/sos-items
 *
 * Fetch Feature and Initiative tickets grouped by fixVersion.
 * Live JIRA first; disk cache only as a 429 fallback.
 *
 * Body: { teamId: string, forceLive?: boolean }
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

const fs = require('fs');
const path = require('path');
const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter, checkpointHistoryLimiter } = require('../../middleware/security');
const { getTeamSosBaseFilter, getTeamBaseFilter } = require('../../utils/teamConfig');
const { resolveKpiJql } = require('../../services/kpiService');
const { makeJiraSearchFetcher } = require('../../services/jiraService');
const { fetchSosItems } = require('../../services/releaseItemsDataService');
const { filterHistoryEligibleIssues } = require('../../utils/sosHistoryFilter');
const {
  fetchFieldHistoryForMultiple,
  transformFieldHistoryToCheckpointHistory,
} = require('../../utils/fieldHistoryUtils');

// Disk snapshot of the last successful SoS history walk. Mirrors the
// project-status failure ladder (live → snapshot → empty) so a JIRA
// rate-limit / timeout no longer blanks the movement overlay.
const SOS_HISTORY_SNAPSHOT_PATH = path.join(__dirname, '..', '..', 'JIRA-fields-history-for-sos.json');

router.post('/sos-items', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const { teamId, forceLive = false } = req.body || {};
    const data = await fetchSosItems({
      teamId,
      jiraToken: req.jiraToken,
      httpsAgent: null,
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
    const { teamId, keys } = req.body || {};

    // Preferred path: the client has already scoped the SoS items to the
    // tracked upcoming releases (excluding master / Era Future / untracked
    // versions) and sends the exact keys to walk. We walk only those — no JIRA
    // search needed, which is what keeps the changelog walk small and stops us
    // from ever touching the huge master / Era Future buckets.
    let itemKeys;
    let skipped = 0;

    if (Array.isArray(keys) && keys.length > 0) {
      itemKeys = [...new Set(keys.filter(Boolean))];
    } else {
      // Fallback path (no keys supplied): resolve the team filter and search.
      const rawSosFilter = getTeamSosBaseFilter(teamId) || getTeamBaseFilter(teamId);
      if (!rawSosFilter) {
        return res.status(400).json({
          success: false,
          error: `Team "${teamId || 'unknown'}" has no sosBaseFilter or baseFilter in Admin. Set the team base filter, then Fetch again.`,
        });
      }
      const resolvedFilter = await resolveKpiJql(rawSosFilter, req.jiraToken, null);

      // Fetch keys + fixVersions — no need for full field processing. The SoS
      // base filter can be a large JIRA saved filter; raise the timeout from the
      // 6s default to 30s so the search doesn't time out before returning keys.
      // NOTE: the JQL where-clause is unchanged; we only widen the returned
      // fields and filter in memory (per the JQL-edit-approval rule).
      const jql = `(${resolvedFilter}) AND issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY key ASC`;
      const fetchIssues = makeJiraSearchFetcher(req.jiraToken, { timeoutMs: 30000 });
      const rawIssues = await fetchIssues(jql, 'key,fixVersions');

      // Skip items whose only fix versions are rolling / placeholder buckets
      // ("master", "Era Future"). Their gate dates don't meaningfully move and,
      // for the ndb filter, walking their changelogs is what trips the JIRA
      // rate-limit / timeout. Items also tagged to a real release are kept.
      const eligibleIssues = filterHistoryEligibleIssues(rawIssues);
      itemKeys = eligibleIssues.map((i) => i.key).filter(Boolean);
      skipped = rawIssues.length - itemKeys.length;
    }

    if (itemKeys.length === 0) {
      return res.json({ success: true, data: { history: {}, itemCount: 0, skipped } });
    }

    // Restrict to the three checkpoint fields the SoS page renders (CC, CG, PG).
    // Fetching all six date fields per ticket is unnecessary and slows down the
    // changelog walk for a large SoS filter.
    const SOS_FIELDS = ['codeComplete', 'commitGate', 'promotionGate'];

    // Failure ladder: live walk → on-disk snapshot → propagate. On success we
    // refresh the snapshot so the next rate-limited call still has movement.
    let rawHistory;
    try {
      rawHistory = await fetchFieldHistoryForMultiple(itemKeys, req.jiraToken, { fields: SOS_FIELDS, includeRiskIndicator: true });
      try {
        fs.writeFileSync(SOS_HISTORY_SNAPSHOT_PATH, JSON.stringify(rawHistory, null, 2), 'utf8');
      } catch (writeErr) {
        console.warn('[sos-items-history] Snapshot write failed (non-fatal):', writeErr.message);
      }
    } catch (fetchErr) {
      if (fs.existsSync(SOS_HISTORY_SNAPSHOT_PATH)) {
        console.warn('[sos-items-history] Live fetch failed; serving snapshot:', fetchErr.message);
        rawHistory = JSON.parse(fs.readFileSync(SOS_HISTORY_SNAPSHOT_PATH, 'utf8'));
      } else {
        throw fetchErr;
      }
    }

    const history = transformFieldHistoryToCheckpointHistory(rawHistory);

    return res.json({ success: true, data: { history, itemCount: itemKeys.length, skipped } });
  } catch (err) {
    console.error('[sos-items-history] Error:', err.message);
    return res.status(err.statusCode || 500).json({ success: false, error: err.message || 'Failed to fetch SoS history' });
  }
});

module.exports = router;
