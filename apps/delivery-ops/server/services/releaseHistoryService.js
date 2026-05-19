/**
 * Release-history service: orchestrates the post-load metadata fetches that
 * fill in checkpoint history and TCMS QI data for items already shown on
 * the Release Versions tab.
 *
 * Functions in this module:
 *   - getCheckpointHistory  — pulls field change history for every item in a
 *                              release (commit gate, promotion gate, code
 *                              complete, etc.); writes the raw payload to
 *                              JIRA-fields-history-for-project-dates.json as
 *                              a fallback cache and returns the transformed
 *                              UI shape. Powers POST /release-items-history.
 *   - getTcmsForItems       — runs the TCMS QI enrichment on a list of item
 *                              keys and returns a key -> { tcmsQI, tcmsQueryUrl }
 *                              map. Powers POST /release-items-tcms.
 *
 * Both endpoints are "secondary" — they run after /release-items-commit so
 * the Load button can render items quickly, then progressively fill in the
 * heavier columns. Failure modes are forgiving: getCheckpointHistory falls
 * back to the on-disk JSON snapshot if the upstream changelog fetch fails.
 *
 * Extracted from server/routes/jira/index.js during Phase 2b.1d.
 */

const fs = require('fs');
const path = require('path');
const { makeJiraSearchFetcher } = require('./jiraService');
const { resolveTeam } = require('../utils/jiraRouteHelpers');
const { getAllItemKeysForVersion } = require('../utils/jiraQueryUtils');
const {
  fetchFieldHistoryForMultiple,
  transformFieldHistoryToCheckpointHistory,
} = require('../utils/fieldHistoryUtils');

const FIELD_HISTORY_SNAPSHOT_PATH = path.join(
  __dirname, '..', 'JIRA-fields-history-for-project-dates.json'
);

const EMPTY_CHECKPOINT_HISTORY = {
  commitGate: [],
  promotionGate: [],
  testPlan: [],
  fsdsDone: [],
  codeComplete: [],
  statusUpdateDate: [],
};

/**
 * Hydrate `historyData` with empty checkpoint blocks for every key — used
 * as the last-resort fallback when both the live fetch and the on-disk
 * snapshot are unavailable.
 */
function fillEmptyHistoryForKeys(historyData, itemKeys) {
  for (const key of itemKeys) {
    historyData[key] = { ...EMPTY_CHECKPOINT_HISTORY };
  }
}

/**
 * Fetch checkpoint-history field changes for every commit + long-term +
 * extension-labelled item in a release.
 *
 * Failure ladder:
 *   1. Try the live upstream fetch; on success, write the raw payload to
 *      the JSON snapshot for next time + return the transformed history.
 *   2. On upstream failure but a snapshot file exists, read + transform it.
 *   3. On no snapshot either, return empty history for each known key so
 *      the UI still renders (rather than 500-ing the whole Load flow).
 *
 * @param {string} jiraToken
 * @param {{ fixVersion: string, teamId?: string }} input
 * @returns {Promise<{ history: object, itemCount: number }>}
 */
async function getCheckpointHistory(jiraToken, { fixVersion, teamId } = {}) {
  if (!fixVersion) {
    const err = new Error('fixVersion is required');
    err.statusCode = 400;
    throw err;
  }

  const { team } = resolveTeam(teamId);
  // Default tuning matches the legacy /release-items-history handler:
  // page 1000, 200ms inter-page delay, 6-second per-call timeout.
  const fetchIssuesWithJQL = makeJiraSearchFetcher(jiraToken);

  // Same key-discovery as the commit + long-term endpoints, kept aligned
  // by routing through getAllItemKeysForVersion.
  const itemKeys = await getAllItemKeysForVersion(fixVersion, jiraToken, fetchIssuesWithJQL, team);

  const historyData = {};

  try {
    const fieldHistoryResults = await fetchFieldHistoryForMultiple(itemKeys, jiraToken);

    // Persist a snapshot so the next call has a fallback if upstream flakes.
    try {
      fs.writeFileSync(FIELD_HISTORY_SNAPSHOT_PATH, JSON.stringify(fieldHistoryResults, null, 2), 'utf8');
    } catch (writeErr) {
      console.warn('[releaseHistoryService] Snapshot write failed (non-fatal):', writeErr.message);
    }

    const transformed = transformFieldHistoryToCheckpointHistory(fieldHistoryResults);
    Object.keys(transformed).forEach(key => { historyData[key] = transformed[key]; });
  } catch (error) {
    console.error('[releaseHistoryService] Error fetching field history:', error.message);

    if (fs.existsSync(FIELD_HISTORY_SNAPSHOT_PATH)) {
      try {
        const existing = JSON.parse(fs.readFileSync(FIELD_HISTORY_SNAPSHOT_PATH, 'utf8'));
        const transformed = transformFieldHistoryToCheckpointHistory(existing);
        Object.keys(transformed).forEach(key => { historyData[key] = transformed[key]; });
      } catch (readError) {
        console.error('[releaseHistoryService] Error reading existing snapshot:', readError.message);
        fillEmptyHistoryForKeys(historyData, itemKeys);
      }
    } else {
      console.warn('[releaseHistoryService] No existing snapshot found, returning empty history');
      fillEmptyHistoryForKeys(historyData, itemKeys);
    }
  }

  return { history: historyData, itemCount: Object.keys(historyData).length };
}

/**
 * Enrich a list of item keys with TCMS QI data + a TCMS query URL.
 * Delegates to the existing tcmsService (kept as a dynamic require so this
 * service still loads when TCMS upstream is offline / not configured).
 *
 * @param {string} _jiraToken  unused; kept for shape parity with sibling services
 * @param {{ fixVersion: string, itemKeys: string[], isLongTerm?: boolean }} input
 * @returns {Promise<Record<string, { tcmsQueryUrl: string|null, tcmsQI: object|null }>>}
 */
async function getTcmsForItems(_jiraToken, { fixVersion, itemKeys, isLongTerm = false } = {}) {
  if (!fixVersion || !Array.isArray(itemKeys) || itemKeys.length === 0) {
    const err = new Error('fixVersion and itemKeys[] are required');
    err.statusCode = 400;
    throw err;
  }

  const { enrichCommitItemsWithQI, enrichLongTermItemsWithQI } = require('./tcmsService');

  const stubItems = itemKeys.map(key => ({ key }));
  if (isLongTerm) {
    await enrichLongTermItemsWithQI(stubItems, fixVersion);
  } else {
    await enrichCommitItemsWithQI(stubItems, fixVersion);
  }

  const result = {};
  for (const item of stubItems) {
    result[item.key] = {
      tcmsQueryUrl: item.tcmsQueryUrl || null,
      tcmsQI: item.tcmsQI || null,
    };
  }
  return result;
}

module.exports = {
  getCheckpointHistory,
  getTcmsForItems,
};
