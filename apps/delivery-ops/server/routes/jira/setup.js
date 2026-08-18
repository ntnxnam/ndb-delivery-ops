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
router.post('/check-version-exists', validateJiraTokenMiddleware, requireAuth('releaseSetup'), async (req, res) => {
  try {
    const result = await releaseSetupService.checkVersionExists(req.jiraToken, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in /api/jira/check-version-exists:', error.message);
    return sendServiceError(res, error, 'Failed to check version');
  }
});

/**
 * Create a fixVersion in a JIRA project.
 * POST /api/jira/create-version  body: { projectKey, versionName, releaseDate }
 */

router.post('/create-version', validateJiraTokenMiddleware, requireAuth('releaseSetup'), async (req, res) => {
  try {
    const result = await releaseSetupService.createVersion(req.jiraToken, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in /api/jira/create-version:', error.message);
    return sendServiceError(res, error, 'Failed to create version');
  }
});

/**
 * Check whether a saved JIRA filter exists by name.
 * POST /api/jira/check-filter-exists  body: { filterName }
 */

router.post('/check-filter-exists', validateJiraTokenMiddleware, requireAuth('releaseSetup'), async (req, res) => {
  try {
    const result = await releaseSetupService.checkFilterExists(req.jiraToken, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in /api/jira/check-filter-exists:', error.message);
    return sendServiceError(res, error, 'Failed to check filter');
  }
});

/**
 * Create a saved JIRA filter.
 * POST /api/jira/create-filter  body: { filterName, jql, description? }
 */

router.post('/create-filter', validateJiraTokenMiddleware, requireAuth('releaseSetup'), async (req, res) => {
  try {
    const result = await releaseSetupService.createFilter(req.jiraToken, req.body || {});
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in /api/jira/create-filter:', error.message);
    return sendServiceError(res, error, 'Failed to create filter');
  }
});

/**
 * Rename a release end-to-end across all configured projects, the 5 saved
 * filters in the chain, and the releaseBaseFilters config entry. Filter JQL
 * bodies are regenerated so cross-filter references stay valid.
 *
 * POST /api/jira/rename-release-cascade
 * Body: { oldVersion, newVersion, excludeVersion?, projects?, dryRun? }
 */

router.post('/rename-release-cascade', validateJiraTokenMiddleware, requireAuth('releaseSetup'), async (req, res) => {
  try {
    const { oldVersion, newVersion, excludeVersion, projects, dryRun } = req.body || {};
    if (!oldVersion || !newVersion) {
      return res.status(400).json({ success: false, error: 'oldVersion and newVersion are required' });
    }
    if (String(oldVersion).trim() === String(newVersion).trim()) {
      return res.status(400).json({ success: false, error: 'oldVersion and newVersion must differ' });
    }
    const { renameReleaseCascade } = require('../../services/jiraFilterService');
    const actor = req.username || req.headers['x-username'] || 'unknown';
    const result = await renameReleaseCascade(req.jiraToken, {
      oldVersion, newVersion, excludeVersion, projects, dryRun: !!dryRun, actor,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error.statusCode === 409) {
      return res.status(409).json({ success: false, error: error.message, conflicts: error.conflicts || [] });
    }
    console.error('Error in /api/jira/rename-release-cascade:', error?.response?.data || error.message);
    const status = error.response?.status || 500;
    const msg = error.response?.data?.errorMessages?.[0]
      || (error.response?.data?.errors && Object.values(error.response.data.errors).join(', '))
      || error.message
      || 'Failed to rename release';
    return res.status(status).json({ success: false, error: msg });
  }
});

/**
 * Find filters previously created with the duplicate `GetNDB<NDB-x.y>...`
 * prefix bug and rename them to the correct `Get<NDB-x.y>...` form. Also
 * regenerates the JQL bodies of the 4 affected filters and patches the
 * <v>-All filter if its JQL still references the bad names.
 *
 * POST /api/jira/cleanup-duplicate-prefix-filters
 * Body: { versions: string[], dryRun?: boolean }
 */

router.post('/cleanup-duplicate-prefix-filters', validateJiraTokenMiddleware, requireAuth('releaseSetup'), async (req, res) => {
  try {
    const { versions, dryRun } = req.body || {};
    if (!Array.isArray(versions) || !versions.length) {
      return res.status(400).json({ success: false, error: 'versions[] is required' });
    }
    const { cleanupDuplicatePrefixFilters } = require('../../services/jiraFilterService');
    const actor = req.username || req.headers['x-username'] || 'unknown';
    const result = await cleanupDuplicatePrefixFilters(req.jiraToken, {
      versions, dryRun: !!dryRun, actor,
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    console.error('Error in /api/jira/cleanup-duplicate-prefix-filters:', error?.response?.data || error.message);
    const status = error.response?.status || 500;
    const msg = error.response?.data?.errorMessages?.[0]
      || (error.response?.data?.errors && Object.values(error.response.data.errors).join(', '))
      || error.message
      || 'Failed to cleanup filters';
    return res.status(status).json({ success: false, error: msg });
  }
});

/**
 * Fetch TCMS QI + component data for a list of feature keys.
 * Called by the client after items load (non-blocking background fetch).
 * POST /api/jira/release-items-tcms
 * Body: { fixVersion: "NDB-2.11", itemKeys: ["FEAT-16363", ...], isLongTerm: false }
 */

module.exports = router;
