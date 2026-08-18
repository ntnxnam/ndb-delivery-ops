const express = require('express');
const router = express.Router();
const axios = require('axios');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { JIRA_API_V2, JIRA_AGILE } = require('../../config/api');
const logger = require('../../utils/logger');
const { extractApiError, getJiraErrorMessage, formatErrorResponse } = require('../../utils/errorMessages');
const { formatDateWithHistoryHTML, formatAllCheckpointDatesHTML } = require('../../utils/dateFormatter');
const { formatContentForEmail, formatJiraWikiMarkupForEmail, adfToHtml } = require('../../utils/emailFormatter');
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { requireAuth } = require('../../middleware/authMiddleware');
const { jiraTimeout } = require('../../middleware/timeout');
const { getCached, setCached } = require('../../utils/simpleCache');
const { apiLimiter, releaseVersionsLimiter, checkpointHistoryLimiter } = require('../../middleware/security');
const allowedUsersConfig = require('../../config/allowedUsers.json');
const releaseVersionsEmailConfig = require('../../config/releaseVersionsEmailConfig.json');
const { extractUserName, extractAssigneeName, normalizeToUsername, usernameToEmail, checkKpiViewAuthorization, checkKpiTabAuthorization } = require('../../services/userService');
const { formatRiskIndicator, sortByRiskIndicator, retryJiraCall, createHttpsAgent, getRiskIndicatorPriority } = require('../../services/jiraService');
const { fetchAllChangelogHistories } = require('../../utils/changelogPagination');
const { fetchFieldHistoryForMultiple, transformFieldHistoryToCheckpointHistory } = require('../../utils/fieldHistoryUtils');
const {
  buildCommitItemsJQL,
  buildLongTermItemsJQL,
  buildTaskBreakdownJQL,
  buildAllTicketsJQL,
  getAllItemKeysForVersion,
  buildOptimizedProjectTicketsJQL,
  buildSprintReportJql,
} = require('../../utils/jiraQueryUtils');

// Dynamic ESM import of the shared workspace package (CommonJS server +
// ESM shared interop, mirrors the pattern in routes/dateMover.js).
let _sharedPromise = null;
function getShared() {
  if (!_sharedPromise) {
    _sharedPromise = import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}
const { getAllFields } = require('../../utils/jiraFieldsConfig');
const { processAllMilestones } = require('../../utils/milestoneProcessor');
const jiraFieldsConfig = require('../../config/jiraFieldsConfig.json');
const { runSearchByJql } = require('../../utils/jiraSearchByJql');
const teamBoardConfig = require('../../config/teamBoardConfig.json');
const { getSprintsForBoard, resolveSprintState, classifySprintIssue, getAddedToSprintAt } = require('../../utils/sprintCache');
const { runWithConcurrency } = require('../../utils/concurrency');
const releaseSetupService = require('../../services/releaseSetupService');
const releaseDataService = require('../../services/releaseDataService');
const releaseItemsService = require('../../services/releaseItemsDataService');
const releaseHistoryService = require('../../services/releaseHistoryService');
const releaseAnalysisService = require('../../services/releaseAnalysisService');

const NODE_ENV = process.env.NODE_ENV || 'development';

// RELEASE_ITEMS_CONFIG now lives in server/services/releaseItemsService.js
// (re-exported via releaseItemsService._internals.RELEASE_ITEMS_CONFIG for any
// route helper that still needs to read the limits directly).

const SPRINT_REPORT_CHANGELOG_CONCURRENCY = 5;
const SPRINT_TRENDS_SPRINT_CONCURRENCY = 3;
const SPRINT_TRENDS_CHANGELOG_CONCURRENCY = 5;

// Standard JIRA field names for search (excluding key which is on issue root)
const STANDARD_FIELD_NAMES = 'summary,status,assignee,reporter,issuetype,priority,fixVersions,labels,duedate,watchers,resolution,created,updated,description';

const { formatDate } = require('../../utils/dateFormatter');
const { extractTextFieldValue } = require('../../utils/adfText');
const { extractQIFromItem } = require('../../utils/tcmsHelpers');
const {
  normalizeTeamId,
  loadKpiConfigSync,
  getKpisForTeam,
  getTeamBaseFilter,
  getTeamSprintBaseFilter,
} = require('../../utils/teamConfig');
const {
  upstreamStatus,
  getDefaultReleaseBaseFilter,
  getTeamConfig,
  constructParentProjectFilter,
  getConfigOverride,
  getReleaseBaseFilter,
  sendServiceError,
} = require('../../utils/jiraRouteHelpers');

// Use validateJiraTokenMiddleware consistently throughout this file

/**
 * Simple diagnostic endpoint to test basic JIRA connectivity
 */
router.post('/release-versions', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const result = await releaseDataService.listOpenReleaseVersions(req.jiraToken, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in /api/jira/release-versions:', error.message);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: error.publicError || 'Failed to fetch release versions',
      message: error.message,
    });
  }
});

/**
 * Version discovery API that dynamically constructs release base filters.
 * POST /api/jira/discover-versions  body: { teamId }
 * Returns versions with dynamically constructed filter information.
 */

router.post('/discover-versions', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const result = await releaseDataService.discoverVersionsWithFilters(req.jiraToken, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in /api/jira/discover-versions:', error.message);
    const status = error.statusCode || 500;
    return res.status(status).json({
      success: false,
      error: error.publicError || 'Failed to discover versions',
      message: error.message,
    });
  }
});

/**
 * GET /api/jira/sprints → 405 (diagnostic: if you get 405 instead of 404, the route is reached but method is wrong).
 */

router.post('/release-items', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const data = await releaseItemsService.fetchAllItemsAcrossVersions(req.jiraToken, req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error in /api/jira/release-items:', error);
    const status = error.statusCode || error.response?.status || 500;
    return res.status(status).json({
      success: false,
      error: error.statusCode === 400 ? error.message : 'Failed to fetch release items',
      message: error.message,
      ...(NODE_ENV !== 'production' && {
        stack: error.stack,
        details: { name: error.name, code: error.code },
      }),
    });
  }
});

/**
 * TEST ENDPOINT: Compare API responses with and without fields parameter
 * GET /api/jira/test-changelog/:key
 * This is a temporary endpoint to debug changelog fetching
 */

router.put('/update-executive-summary', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const result = await releaseAnalysisService.updateExecutiveSummary(req.jiraToken, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in /api/jira/update-executive-summary:', error.message);
    return sendServiceError(res, error, 'Failed to update executive summary');
  }
});


router.post('/risk-indicator-changes', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const data = await releaseAnalysisService.getRiskIndicatorChanges(req.jiraToken, req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error in /api/jira/risk-indicator-changes:', error.message);
    return sendServiceError(res, error, 'Failed to fetch risk indicator changes');
  }
});

// ---------------------------------------------------------------------------
// Release Setup endpoints (check/create fixVersions and saved filters)
// ---------------------------------------------------------------------------

/**
 * Check whether a fixVersion exists in a given JIRA project.
 * POST /api/jira/check-version-exists  body: { projectKey, versionName }
 */

router.post('/release-items-tcms', releaseVersionsLimiter, jiraTimeout, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const data = await releaseHistoryService.getTcmsForItems(req.jiraToken, req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error in /api/jira/release-items-tcms:', error.message);
    return sendServiceError(res, error, 'Failed to fetch TCMS data');
  }
});

/**
 * Generate Executive Summary from current project data
 * POST /api/jira/generate-exec-summary
 * Body: { version: "NDB-2.11", items: [...], riskCounts: {...} }
 */

module.exports = router;
