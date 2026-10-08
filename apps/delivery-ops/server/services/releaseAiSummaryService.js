/**
 * Release AI Summary Service
 *
 * Builds a structured intelligence package for a full release by running
 * deriveSignals on every committed feature, then aggregating the results into
 * four buckets the LLM can reason about directly:
 *
 *   gate-lagging   — features that have NOT confirmed clearance of the most
 *                    recently elapsed release-level gate (latestPassedMarker
 *                    says the date passed but JIRA phase doesn't match)
 *   compliance     — features with open security / legal / docs gaps
 *   blocked        — features with open P0/P1 blockers or MISSED GATE risks
 *   dark           — features whose status update is ≥14 days stale
 *   clear          — features at PG Met or Shipped
 *   watching       — everything else (on-track but not yet clear)
 *
 * The service does NOT call the LLM — it returns the structured package so
 * the route can pass it to naiService.generateReleaseSummary.
 */

const { JIRA_API_V2 } = require('../config/api');
const { getJira } = require('../utils/jiraClient');
const { buildCommitItemsJQL } = require('../utils/jiraQueryUtils');
const { deriveSignals } = require('../utils/execSummarySignals');
const { processAllMilestones } = require('../utils/milestoneProcessor');
const releaseVersionsEmailConfig = require('../config/releaseVersionsEmailConfig.json');
const logger = require('../utils/logger');

let _shared;
async function getShared() {
  if (!_shared) {
    _shared = process.env.NODE_ENV === 'test'
      ? Promise.resolve(require('@portfolio-delivery-ops/shared'))
      : import('@portfolio-delivery-ops/shared');
  }
  return _shared;
}

const FIELDS = [
  'key', 'summary', 'status', 'assignee', 'priority',
  'customfield_23560',  // Risk Indicator
  'customfield_11067',  // Code Complete Date
  'customfield_35863',  // Commit Gate Ready Estimation Date
  'customfield_35864',  // Promotion Gate Ready Estimation Date
  'customfield_23073',  // Status Update
  'customfield_45660',  // Status Update Date
  'customfield_10860',  // QA Contact
  'customfield_27764',  // TPM Owner
  'customfield_14463',  // Requirements Link
  'customfield_13861',  // FS/DS Done Date
  'customfield_11068',  // Test Plan Date
  'customfield_31460',  // TCMS Link
  'issuelinks', 'labels',
].join(',');

/**
 * Build a ganttConfig-shaped object from the release versions email config.
 * This mirrors what the client builds when it loads gantt data.
 */
function buildGanttConfig(version) {
  try {
    const cfg = releaseVersionsEmailConfig.releaseGateDates?.[version];
    if (!cfg) return null;
    return cfg;
  } catch {
    return null;
  }
}

/**
 * Fetch all committed features for a release version and build the
 * structured release intelligence package.
 *
 * @param {string} version  e.g. "NDB-2.12"
 * @param {string} jiraToken
 * @returns {Promise<object>} releaseIntelligence
 */
async function buildReleaseIntelligence(version, jiraToken) {
  const ganttConfig = buildGanttConfig(version);
  const versionLabel = version.toLowerCase();

  // Committed features — same scope as the UI commit section:
  // fixVersion = version, Feature/Initiative, not cancelled, not long-term-funded.
  const commitJql = `${buildCommitItemsJQL(version)} AND labels != "${versionLabel}-long-term-funded"`;
  const jira = await getJira(jiraToken);
  const response = await jira.get(JIRA_API_V2.SEARCH, {
    timeout: 45000,
    params: { jql: commitJql, fields: FIELDS, maxResults: 500 },
  });

  const rawItems = response.data?.issues || [];

  // Date metrics for the prompt header (gate dates, daysFromCutoff)
  let dateMetrics = null;
  try {
    const cfg = releaseVersionsEmailConfig.releaseGateDates?.[version];
    if (cfg) dateMetrics = processAllMilestones(cfg);
  } catch (e) {
    logger.warn(`[releaseAiSummaryService] Could not load date metrics for ${version}: ${e.message}`);
  }

  // Fetch open P0 blockers with keys + summaries so the LLM can name them
  let p0Bugs = [];
  try {
    const filterName = `${versionLabel}-all`;
    const p0Resp = await jira.get(JIRA_API_V2.SEARCH, {
      timeout: 15000,
      params: {
        jql: `filter = "${filterName}" AND statusCategory != Done AND priority = "P0 - Blocker"`,
        fields: 'key,summary,assignee,status',
        maxResults: 50,
      },
    });
    p0Bugs = (p0Resp.data?.issues || []).map(i => ({
      key: i.key,
      summary: (i.fields?.summary || '').slice(0, 100),
      assignee: i.fields?.assignee?.displayName || i.fields?.assignee?.name || 'Unassigned',
      status: i.fields?.status?.name || 'Unknown',
    }));
  } catch (e) {
    logger.warn(`[releaseAiSummaryService] P0 fetch failed for ${version}: ${e.message}`);
  }

  // Fetch open must-fix tickets (label = "<version>-mustfix"), any issue type
  let mustFixTickets = [];
  try {
    const mustFixResp = await jira.get(JIRA_API_V2.SEARCH, {
      timeout: 15000,
      params: {
        jql: `labels = "${versionLabel}-mustfix" AND statusCategory != Done`,
        fields: 'key,summary,assignee,status,priority,issuetype',
        maxResults: 100,
      },
    });
    mustFixTickets = (mustFixResp.data?.issues || []).map(i => ({
      key: i.key,
      summary: (i.fields?.summary || '').slice(0, 100),
      assignee: i.fields?.assignee?.displayName || i.fields?.assignee?.name || 'Unassigned',
      status: i.fields?.status?.name || 'Unknown',
      priority: i.fields?.priority?.name || 'Unknown',
      issueType: i.fields?.issuetype?.name || 'Unknown',
    }));
  } catch (e) {
    logger.warn(`[releaseAiSummaryService] Must-fix fetch failed for ${version}: ${e.message}`);
  }

  const { buildFeatureRecord, assembleReleaseIntelligence } = await getShared();

  // Run deriveSignals on each feature (sync, CPU-only — no extra JIRA calls)
  const today = new Date();
  const featureRecords = rawItems.map(item => {
    try {
      const signals = deriveSignals({ item: { ...item.fields, key: item.key }, ganttConfig, release: version, today });
      return buildFeatureRecord(item, signals);
    } catch (e) {
      logger.warn(`[releaseAiSummaryService] deriveSignals failed for ${item.key}: ${e.message}`);
      return {
        key: item.key,
        summary: (item.fields?.summary || '').slice(0, 80),
        status: item.fields?.status?.name || 'Unknown',
        jiraRisk: 'not set',
        riskAssessment: null,
        pathToGreen: null,
        pathToGreenMissing: false,
        phase: 'Unknown',
        criticalRisks: [],
        assignee: 'Unassigned',
        tpmOwner: null,
        statusUpdateAgeDays: null,
        dates: { codeComplete: null, commitGate: null, promotionGate: null },
        buckets: ['watching'],
        error: e.message,
      };
    }
  });

  return assembleReleaseIntelligence({
    version,
    featureRecords,
    p0Bugs,
    mustFixTickets,
    dateMetrics,
    generatedAt: new Date().toISOString(),
  });
}

module.exports = { buildReleaseIntelligence };
