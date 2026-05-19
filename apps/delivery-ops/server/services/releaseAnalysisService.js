/**
 * Release-analysis service: orchestration for the release-level analytics
 * and mutation endpoints that round out the Release Versions tab + Release
 * Trends page.
 *
 * Functions in this module:
 *   - analyzeReleases               — multi-release closed-ticket fetch used by
 *                                      Release Trends / velocity views.
 *                                      Powers POST /release-analysis.
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

const axios = require('axios');
const { JIRA_API_V2 } = require('../config/api');
const logger = require('../utils/logger');
const {
  createHttpsAgent,
  retryJiraCall,
  jiraHeaders,
  makeJiraSearchFetcher,
  wrapJiraError,
} = require('./jiraService');
const { getAllItemKeysForVersion } = require('../utils/jiraQueryUtils');
const { fetchAllChangelogHistories } = require('../utils/changelogPagination');
const { upstreamStatus, resolveTeam } = require('../utils/jiraRouteHelpers');

const RISK_INDICATOR_FIELD_ID = 'customfield_23560';

// Same tuning as the legacy inline handlers — kept verbatim so behaviour is
// identical after extraction.
const ANALYSIS_DEFAULT_RELEASES = ['NDB-2.8', 'NDB-2.9', 'NDB-2.10', 'NDB-2.11'];
const ANALYSIS_FIELDS = [
  'key', 'issuetype', 'status', 'resolution', 'resolutiondate',
  'resolved', 'updated', 'created', 'customfield_11067',
  'statusCategoryChangeDate', 'labels', 'fixVersions',
];
const ANALYSIS_MAX_TICKETS_PER_RELEASE = 500;
const ANALYSIS_BATCH_SIZE = 50;
const ANALYSIS_BATCH_TIMEOUT_MS = 30000;
const ANALYSIS_RETRY_ATTEMPTS = 2;

function buildAnalysisJql(releaseName) {
  return `project=ERA and (issuefunction in portfolioChildrenOf("fixVersion=${releaseName} and status not in (Cancelled,Backlog) and issueType in (Feature, Initiative)") OR fixVersion=${releaseName} and status not in (Cancelled,Backlog) and issueType in (Feature, Initiative) or issueFunction in issuesInEpics("issuefunction in portfolioChildrenOf(\\"fixVersion=${releaseName} and status not in (Cancelled,Backlog) and issueType in (Feature, Initiative)\\") and type=Epic"))`;
}

/**
 * Fetch closed Feature + Initiative tickets across a list of releases, used
 * by velocity / trends visualizations. Sequentially walks each release with
 * a 100ms inter-batch delay and a 500-ticket cap per release. Per-release
 * failures are logged and skipped (don't fail the whole batch).
 *
 * @param {string} jiraToken
 * @param {{ releases?: string[], includeFields?: string[] }} input
 * @returns {Promise<{ requestId, totalTickets, releases, releaseMapping, tickets, fetchTime, message, warning? }>}
 */
async function analyzeReleases(jiraToken, { releases, includeFields = [] } = {}) {
  const requestId = `release-analysis-${Date.now()}`;
  const startTime = Date.now();
  const effectiveReleases = Array.isArray(releases) && releases.length > 0
    ? releases
    : ANALYSIS_DEFAULT_RELEASES;
  console.log(`[${requestId}] Starting release analysis for releases: ${effectiveReleases.join(', ')}`);

  const fieldsToFetch = [...new Set([...ANALYSIS_FIELDS, ...includeFields])].join(',');
  const httpsAgent = createHttpsAgent();

  let allTickets = [];
  const releaseMapping = {};

  for (const release of effectiveReleases) {
    try {
      console.log(`[${requestId}] Fetching tickets for ${release}`);
      const jql = buildAnalysisJql(release);
      let startAt = 0;
      let hasMore = true;
      const releaseTickets = [];

      while (hasMore && releaseTickets.length < ANALYSIS_MAX_TICKETS_PER_RELEASE) {
        const batchSize = Math.min(
          ANALYSIS_BATCH_SIZE,
          ANALYSIS_MAX_TICKETS_PER_RELEASE - releaseTickets.length
        );

        const searchResponse = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
          params: {
            jql, fields: fieldsToFetch, maxResults: batchSize, startAt, validateQuery: 'false',
          },
          headers: jiraHeaders(jiraToken),
          httpsAgent,
          timeout: ANALYSIS_BATCH_TIMEOUT_MS,
        }), ANALYSIS_RETRY_ATTEMPTS);

        const issues = searchResponse.data.issues || [];
        for (const issue of issues) {
          // Only resolved / closed tickets matter for velocity analysis.
          const statusCategory = issue.fields.status?.statusCategory?.name;
          if (statusCategory !== 'Done') continue;

          releaseTickets.push({
            key: issue.key,
            issuetype: issue.fields.issuetype,
            status: issue.fields.status,
            statusCategory,
            resolution: issue.fields.resolution,
            resolved: issue.fields.resolved,
            resolutiondate: issue.fields.resolutiondate,
            created: issue.fields.created,
            updated: issue.fields.updated,
            codeCompleteDate: issue.fields.customfield_11067,
            labels: issue.fields.labels || [],
            fixVersions: issue.fields.fixVersions || [],
          });
          releaseMapping[issue.key] = release;
        }

        hasMore = issues.length === batchSize;
        startAt += batchSize;
        console.log(`[${requestId}] ${release}: Fetched ${releaseTickets.length} tickets so far`);

        if (hasMore) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }

      allTickets = allTickets.concat(releaseTickets);
      console.log(`[${requestId}] ${release}: Total ${releaseTickets.length} tickets`);
    } catch (releaseError) {
      console.error(`[${requestId}] Error fetching ${release}:`, releaseError.message);
      // Continue with other releases even if one fails
    }
  }

  const fetchTime = Date.now() - startTime;
  console.log(`[${requestId}] Completed analysis fetch: ${allTickets.length} total tickets in ${fetchTime}ms`);

  if (allTickets.length === 0) {
    console.warn(`[${requestId}] No tickets found for releases: ${effectiveReleases.join(', ')}`);
    return {
      requestId,
      totalTickets: 0,
      releases: effectiveReleases,
      releaseMapping: {},
      tickets: [],
      fetchTime,
      message: 'No tickets found for the selected releases. This could be due to permission restrictions or the releases not having resolved tickets yet.',
      warning: 'No data available for analysis',
    };
  }

  return {
    requestId,
    totalTickets: allTickets.length,
    releases: effectiveReleases,
    releaseMapping,
    tickets: allTickets,
    fetchTime,
    message: `Successfully fetched ${allTickets.length} tickets across ${effectiveReleases.length} releases`,
  };
}

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

  const httpsAgent = createHttpsAgent();
  const baseUrl = JIRA_API_V2.BASE_URL;
  const updateUrl = `${baseUrl}/rest/api/2/issue/${jiraKey}`;
  const updatePayload = {
    // Empty string -> null clears the field in JIRA
    fields: { customfield_38460: executiveSummary || null },
  };

  try {
    await retryJiraCall(() => axios.put(updateUrl, updatePayload, {
      headers: jiraHeaders(jiraToken),
      httpsAgent,
      timeout: 30000,
    }));
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
  const httpsAgent = createHttpsAgent();
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
      const issueUrl = `${baseUrl}/rest/api/2/issue/${jiraKey}`;
      const issueResponse = await retryJiraCall(() => axios.get(issueUrl, {
        headers: jiraHeaders(jiraToken),
        httpsAgent,
        timeout: 6000,
        params: { expand: 'changelog', fields: 'summary' },
      }));
      const issue = issueResponse.data;
      const summary = (issue.fields && issue.fields.summary) || jiraKey;

      const paginationResult = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issue.id || null,
        jiraToken,
        httpsAgent,
        retryJiraCall,
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
  analyzeReleases,
  updateExecutiveSummary,
  getRiskIndicatorChanges,
};
