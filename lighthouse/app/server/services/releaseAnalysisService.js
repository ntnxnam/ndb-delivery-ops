/**
 * Release-analysis service: orchestration for release-level mutation /
 * read-only endpoints that round out the Release Versions tab + Release
 * Trends page.
 *
 * Functions in this module:
 *   - updateExecutiveSummary        — write customfield_38460 on a JIRA issue.
 *                                      Powers PUT  /update-executive-summary.
 *   - getRiskIndicatorChanges       — walk every commit + long-term + extension
 *                                      item in a release and extract every
 *                                      customfield_23560 change from its
 *                                      changelog. Powers POST /risk-indicator-changes.
 *
 * Errors thrown carry { statusCode, message } so the route shell can map
 * them to HTTP without inspecting the original axios error shape.
 *
 * Extracted from server/routes/jira/index.js during Phase 2b.1e.
 */

const { JIRA_API_V2 } = require('../config/api');
const logger = require('../utils/logger');
const {
  makeJiraSearchFetcher,
  wrapJiraError,
  getJira,
} = require('../utils/jiraClient');
const { getAllItemKeysForVersion } = require('../utils/jiraQueryUtils');
const { fetchAllChangelogHistories } = require('../utils/changelogPagination');
const { upstreamStatus, resolveTeam } = require('../utils/jiraRouteHelpers');

const RISK_INDICATOR_FIELD_ID = 'customfield_23560';

/**
 * Update customfield_38460 (Executive Status Update) on a single JIRA issue.
 * Empty / null values clear the field (JIRA treats null as "remove").
 *
 * @param {string} jiraToken
 * @param {{ jiraKey: string, executiveSummary: string|null }} input
 * @returns {Promise<{ jiraKey: string, message: string }>}
 * @throws {Error & { statusCode, details? }}
 */
async function updateExecutiveSummary(jiraToken, { jiraKey, executiveSummary } = {}) {
  if (!jiraKey) {
    const err = new Error('JIRA key is required');
    err.statusCode = 400;
    throw err;
  }
  if (executiveSummary === undefined || executiveSummary === null) {
    const err = new Error('Executive summary is required');
    err.statusCode = 400;
    throw err;
  }

  const jira = await getJira(jiraToken);
  const updateUrl = `/rest/api/2/issue/${jiraKey}`;
  const updatePayload = {
    // Empty string -> null clears the field in JIRA
    fields: { customfield_38460: executiveSummary || null },
  };

  try {
    await jira.put(updateUrl, updatePayload, { timeout: 30000 });
    return { jiraKey, message: 'Executive summary updated successfully' };
  } catch (error) {
    const wrapped = wrapJiraError(error, 'Failed to update executive summary');
    wrapped.statusCode = upstreamStatus(wrapped.statusCode);
    logger.jira.error(jiraKey, 'UPDATE_EXECUTIVE_SUMMARY', wrapped.message, { error: error.message });
    throw wrapped;
  }
}

/**
 * For every item in a release, walk the full changelog and emit one record
 * per customfield_23560 (Risk Indicator) change. Sorted newest-first by
 * `changedAt`. 300ms delay between items to be polite to JIRA changelog API.
 *
 * @param {string} jiraToken
 * @param {{ fixVersion: string, teamId?: string }} input
 * @returns {Promise<{ fixVersion: string, changes: Array }>}
 */
async function getRiskIndicatorChanges(jiraToken, { fixVersion, teamId } = {}) {
  if (!fixVersion) {
    const err = new Error('fixVersion is required');
    err.statusCode = 400;
    throw err;
  }
  const baseUrl = JIRA_API_V2.BASE_URL;
  const jira = await getJira(jiraToken);
  const { team } = resolveTeam(teamId);

  // Legacy /risk-indicator-changes used 500ms between pages (vs 200ms default)
  // and a wider default field set. Keep that tuning exactly.
  const fetchIssuesWithJQL = makeJiraSearchFetcher(jiraToken, {
    defaultFields: 'key,summary,labels,fixVersions',
    perPageDelayMs: 500,
  });
  const itemKeys = await getAllItemKeysForVersion(fixVersion, jiraToken, fetchIssuesWithJQL, team);

  const changes = [];

  for (const jiraKey of itemKeys) {
    try {
      const issueUrl = `/rest/api/2/issue/${jiraKey}`;
      const issueResponse = await jira.get(issueUrl, {
        timeout: 6000,
        params: { expand: 'changelog', fields: 'summary' },
      });
      const issue = issueResponse.data;
      const summary = (issue.fields && issue.fields.summary) || jiraKey;

      const paginationResult = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issue.id || null,
        jiraToken,
        null,
        null,
        logger,
        issue
      );
      const histories = paginationResult.histories || [];

      for (const history of histories) {
        const items = history.items || [];
        for (const item of items) {
          const fieldId = item.fieldId || item.field;
          if (fieldId !== RISK_INDICATOR_FIELD_ID && item.field !== 'Risk Indicator') continue;
          const fromRisk = item.fromString || item.from || '';
          const toRisk = item.toString || item.to || '';
          if (fromRisk === toRisk) continue;
          changes.push({
            key: jiraKey,
            summary,
            fromRisk: fromRisk || 'Not Set',
            toRisk: toRisk || 'Not Set',
            changedAt: history.created || new Date().toISOString(),
          });
        }
      }

      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      console.warn(`[releaseAnalysisService.getRiskIndicatorChanges] Failed for ${jiraKey}:`, err.message);
    }
  }

  changes.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
  return { fixVersion, changes };
}

module.exports = {
  updateExecutiveSummary,
  getRiskIndicatorChanges,
};
