const express = require('express');
const router = express.Router();
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
const { formatRiskIndicator, sortByRiskIndicator, getRiskIndicatorPriority } = require('../../services/jiraService');
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
module.exports = router;
