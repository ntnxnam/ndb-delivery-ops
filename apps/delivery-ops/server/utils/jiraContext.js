/**
 * jiraContext.js — shared dependency barrel for JIRA route files.
 *
 * Every file under server/routes/jira/ needs the same ~20 require() calls.
 * Instead of copy-pasting 86 lines at the top of each route file, import
 * everything from here:
 *
 *   const ctx = require('../../utils/jiraContext');
 *   // then destructure what you need:
 *   const { axios, JIRA_API_V2, validateJiraTokenMiddleware, runSearchByJql } = ctx;
 *
 * Nothing in this file contains logic — it is a pure re-export. If a
 * dependency path changes, update it here once instead of in every route file.
 *
 * The getShared() ESM interop helper is also provided here so each route file
 * doesn't need to re-declare its own _sharedPromise closure.
 */

'use strict';

// ── Node built-ins ────────────────────────────────────────────────────────────
const axios   = require('axios');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const { JIRA_API_V2, JIRA_AGILE }    = require('../config/api');
const jiraFieldsConfig               = require('../config/jiraFieldsConfig.json');
const teamBoardConfig                = require('../config/teamBoardConfig.json');
const allowedUsersConfig             = require('../config/allowedUsers.json');
const releaseVersionsEmailConfig     = require('../config/releaseVersionsEmailConfig.json');

// ── Middleware ────────────────────────────────────────────────────────────────
const { validateJiraTokenMiddleware }                       = require('../middleware/auth/jira');
const { requireAuth }                                       = require('../middleware/authMiddleware');
const { jiraTimeout }                                       = require('../middleware/timeout');
const { apiLimiter, releaseVersionsLimiter,
        checkpointHistoryLimiter }                          = require('../middleware/security');

// ── Utilities ─────────────────────────────────────────────────────────────────
const logger                                               = require('./logger');
const { extractApiError,
        getJiraErrorMessage,
        formatErrorResponse }                              = require('./errorMessages');
const { formatDate,
        formatDateWithHistoryHTML,
        formatAllCheckpointDatesHTML }                     = require('./dateFormatter');
const { formatContentForEmail,
        formatJiraWikiMarkupForEmail,
        adfToHtml }                                        = require('./emailFormatter');
const { getCached, setCached }                             = require('./simpleCache');
const { fetchAllChangelogHistories }                       = require('./changelogPagination');
const { fetchFieldHistoryForMultiple,
        transformFieldHistoryToCheckpointHistory }         = require('./fieldHistoryUtils');
const { buildCommitItemsJQL,
        buildLongTermItemsJQL,
        buildTaskBreakdownJQL,
        buildAllTicketsJQL,
        getAllItemKeysForVersion,
        buildOptimizedProjectTicketsJQL,
        buildSprintReportJql }                             = require('./jiraQueryUtils');
const { getAllFields }                                     = require('./jiraFieldsConfig');
const { processAllMilestones }                             = require('./milestoneProcessor');
const { runSearchByJql }                                   = require('./jiraSearchByJql');
const { getSprintsForBoard,
        resolveSprintState,
        classifySprintIssue,
        getAddedToSprintAt }                               = require('./sprintCache');
const { runWithConcurrency }                               = require('./concurrency');
const { extractTextFieldValue }                            = require('./adfText');
const { extractQIFromItem }                                = require('./tcmsHelpers');
const { normalizeTeamId,
        loadKpiConfigSync,
        getKpisForTeam,
        getTeamBaseFilter,
        getTeamSprintBaseFilter }                          = require('./teamConfig');
const { upstreamStatus,
        getDefaultReleaseBaseFilter,
        getTeamConfig,
        constructParentProjectFilter,
        getConfigOverride,
        getReleaseBaseFilter,
        sendServiceError }                                 = require('./jiraRouteHelpers');

// ── Services ──────────────────────────────────────────────────────────────────
const { extractUserName,
        extractAssigneeName,
        normalizeToUsername,
        usernameToEmail,
        checkKpiViewAuthorization,
        checkKpiTabAuthorization }                         = require('../services/userService');
const { formatRiskIndicator,
        sortByRiskIndicator,
        getRiskIndicatorPriority }                         = require('../services/jiraService');
const { getJira,
        jiraGet,
        jiraPost,
        jiraPut,
        searchPages,
        wrapJiraError }                                    = require('./jiraClient');
const releaseSetupService    = require('../services/releaseSetupService');
const releaseDataService     = require('../services/releaseDataService');
const releaseItemsService    = require('../services/releaseItemsDataService');
const releaseHistoryService  = require('../services/releaseHistoryService');
const releaseAnalysisService = require('../services/releaseAnalysisService');

// ── ESM interop (shared workspace package) ────────────────────────────────────
// The @portfolio-delivery-ops/shared package is pure ESM ("type":"module").
// CommonJS route files must dynamic-import it. This singleton getter avoids
// each route file declaring its own _sharedPromise closure.
let _sharedPromise = null;
function getShared() {
  if (!_sharedPromise) {
    _sharedPromise = import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

// ── Shared constants used across route files ──────────────────────────────────
const NODE_ENV = process.env.NODE_ENV || 'development';

const SPRINT_REPORT_CHANGELOG_CONCURRENCY = 5;
const SPRINT_TRENDS_SPRINT_CONCURRENCY    = 3;
const SPRINT_TRENDS_CHANGELOG_CONCURRENCY = 5;

// Standard JIRA field names for search (key is on the issue root, not in fields)
const STANDARD_FIELD_NAMES = 'summary,status,assignee,reporter,issuetype,priority,fixVersions,labels,duedate,watchers,resolution,created,updated,description';

// ── Exports ───────────────────────────────────────────────────────────────────
module.exports = {
  // Node built-ins
  axios,
  https,
  fs,
  path,

  // Config
  JIRA_API_V2,
  JIRA_AGILE,
  jiraFieldsConfig,
  teamBoardConfig,
  allowedUsersConfig,
  releaseVersionsEmailConfig,

  // Middleware
  validateJiraTokenMiddleware,
  requireAuth,
  jiraTimeout,
  apiLimiter,
  releaseVersionsLimiter,
  checkpointHistoryLimiter,

  // Utilities
  logger,
  extractApiError,
  getJiraErrorMessage,
  formatErrorResponse,
  formatDate,
  formatDateWithHistoryHTML,
  formatAllCheckpointDatesHTML,
  formatContentForEmail,
  formatJiraWikiMarkupForEmail,
  adfToHtml,
  getCached,
  setCached,
  fetchAllChangelogHistories,
  fetchFieldHistoryForMultiple,
  transformFieldHistoryToCheckpointHistory,
  buildCommitItemsJQL,
  buildLongTermItemsJQL,
  buildTaskBreakdownJQL,
  buildAllTicketsJQL,
  getAllItemKeysForVersion,
  buildOptimizedProjectTicketsJQL,
  buildSprintReportJql,
  getAllFields,
  processAllMilestones,
  runSearchByJql,
  getSprintsForBoard,
  resolveSprintState,
  classifySprintIssue,
  getAddedToSprintAt,
  runWithConcurrency,
  extractTextFieldValue,
  extractQIFromItem,
  normalizeTeamId,
  loadKpiConfigSync,
  getKpisForTeam,
  getTeamBaseFilter,
  getTeamSprintBaseFilter,
  upstreamStatus,
  getDefaultReleaseBaseFilter,
  getTeamConfig,
  constructParentProjectFilter,
  getConfigOverride,
  getReleaseBaseFilter,
  sendServiceError,

  // Services
  extractUserName,
  extractAssigneeName,
  normalizeToUsername,
  usernameToEmail,
  checkKpiViewAuthorization,
  checkKpiTabAuthorization,
  formatRiskIndicator,
  sortByRiskIndicator,
  getRiskIndicatorPriority,
  getJira,
  jiraGet,
  jiraPost,
  jiraPut,
  searchPages,
  wrapJiraError,
  releaseSetupService,
  releaseDataService,
  releaseItemsService,
  releaseHistoryService,
  releaseAnalysisService,

  // ESM interop
  getShared,

  // Shared constants
  NODE_ENV,
  SPRINT_REPORT_CHANGELOG_CONCURRENCY,
  SPRINT_TRENDS_SPRINT_CONCURRENCY,
  SPRINT_TRENDS_CHANGELOG_CONCURRENCY,
  STANDARD_FIELD_NAMES,
};
