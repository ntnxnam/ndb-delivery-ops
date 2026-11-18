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
const { getJira } = require('../../utils/jiraClient');
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
  getConfigOverride,
  getReleaseBaseFilter,
  sendServiceError,
} = require('../../utils/jiraRouteHelpers');

// Use validateJiraTokenMiddleware consistently throughout this file

/**
 * Simple diagnostic endpoint to test basic JIRA connectivity
 */
router.get('/jira-diagnostic', [
  jiraTimeout,
  requireAuth,
  validateJiraTokenMiddleware
], async (req, res) => {
  const requestId = `diagnostic-${Date.now()}`;
  
  try {
    const { jiraToken: cleanToken } = req;
    const jira = await getJira(cleanToken);
    
    console.log(`[${requestId}] Running JIRA diagnostic tests`);
    
    const tests = [];
    
    // Test 1: Basic server info
    try {
      const serverInfo = await jira.get(`${JIRA_API_V2.SERVER_INFO}`, {
        timeout: 10000
      });
      tests.push({
        name: 'JIRA Server Info',
        status: 'success',
        data: {
          version: serverInfo.data.version,
          baseUrl: serverInfo.data.baseUrl
        }
      });
    } catch (error) {
      tests.push({
        name: 'JIRA Server Info', 
        status: 'failed',
        error: error.message
      });
    }
    
    // Test 2: Very basic project query
    try {
      const basicQuery = await jira.get(`${JIRA_API_V2.SEARCH}`, {
        timeout: 15000,
        params: {
          jql: 'project = ERA',
          maxResults: 1,
          fields: 'key'
        },
      });
      tests.push({
        name: 'Basic Project Query',
        status: 'success', 
        data: {
          total: basicQuery.data.total,
          sampleKey: basicQuery.data.issues[0]?.key
        }
      });
    } catch (error) {
      tests.push({
        name: 'Basic Project Query',
        status: 'failed',
        error: error.message
      });
    }
    
    // Test 3: Check available fix versions
    try {
      const versions = await jira.get(`${JIRA_API_V2.PROJECT('ERA')}/versions`, {
        timeout: 10000
      });
      const releaseVersions = versions.data.filter(v => 
        v.name && v.name.toLowerCase().includes('ndb-2.')
      ).slice(0, 10);
      
      tests.push({
        name: 'Available Fix Versions',
        status: 'success',
        data: {
          totalVersions: versions.data.length,
          releaseVersions: releaseVersions.map(v => v.name)
        }
      });
    } catch (error) {
      tests.push({
        name: 'Available Fix Versions',
        status: 'failed', 
        error: error.message
      });
    }
    
    res.json({
      success: true,
      requestId,
      tests,
      summary: {
        passed: tests.filter(t => t.status === 'success').length,
        failed: tests.filter(t => t.status === 'failed').length
      }
    });
    
  } catch (error) {
    console.error(`[${requestId}] Diagnostic failed:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      requestId
    });
  }
});

/**
 * Test JQL endpoint - validate JQL queries before using in analysis
 */

router.post('/test-jql', [
  jiraTimeout,
  requireAuth,
  validateJiraTokenMiddleware
], async (req, res) => {
  const requestId = `test-jql-${Date.now()}`;
  
  try {
    const { jql, maxResults = 10 } = req.body;
    const { jiraToken: cleanToken } = req;
    
    if (!jql) {
      return res.status(400).json({
        success: false,
        error: 'JQL query is required'
      });
    }

    console.log(`[${requestId}] Testing JQL: ${jql}`);
    
    const jira = await getJira(cleanToken);
    const startTime = Date.now();
    
    const searchResponse = await jira.get(`${JIRA_API_V2.SEARCH}`, {
      timeout: 30000,
      params: {
        jql,
        fields: 'key,issuetype,status,resolved',
        maxResults: maxResults,
        startAt: 0,
        validateQuery: 'true'
      },
    });
    
    const responseTime = Date.now() - startTime;
    const issues = searchResponse.data.issues || [];
    const total = searchResponse.data.total || 0;
    
    console.log(`[${requestId}] JQL test successful: ${issues.length}/${total} results in ${responseTime}ms`);
    
    res.json({
      success: true,
      requestId,
      jql,
      total,
      returnedResults: issues.length,
      responseTime,
      sampleResults: issues.map(issue => ({
        key: issue.key,
        type: issue.fields.issuetype?.name,
        status: issue.fields.status?.name,
        resolved: issue.fields.resolved
      }))
    });
    
  } catch (error) {
    console.error(`[${requestId}] JQL test failed:`, error.message);
    
    const apiError = extractApiError(error);
    const jiraMessage = getJiraErrorMessage(error);
    
    res.status(500).json(formatErrorResponse(
      'test-jql',
      'JQL test failed',
      apiError,
      jiraMessage,
      requestId
    ));
  }
});

// fetchReleaseItemsFromJira, processReleaseItems, and partialItemsFromIssues
// were moved to server/services/releaseItemsService.js during Phase 2b.1c.
// Use releaseItemsService.* (or _internals.*) instead of inline helpers.

/**
 * Translate a partial-failure Error thrown by releaseItemsService into the
 * legacy { success:false, partial:true, data:{items} } 200-OK response shape
 * the client UI expects (so users see whatever data we managed to fetch
 * before the upstream failure).
 */
function sendPartialItemsFailure(res, error, endpointName) {
  if (res.headersSent) return; // timeout already responded — don't double-send
  const requestId = error.requestId || 'unknown';
  console.error(`[${requestId}] Error in ${endpointName}:`, error.message);
  console.error(`[${requestId}] Error stack:`, error.stack);
  return res.status(200).json({
    success: false,
    error: `Partial failure - JIRA API timeout or error in ${endpointName}`,
    message: error.message,
    data: { items: Array.isArray(error.partialItems) ? error.partialItems : [] },
    partial: true,
    ...(NODE_ENV !== 'production' && {
      stack: error.stack,
      requestId,
      timestamp: new Date().toISOString(),
    }),
  });
}

// ============================================
// JIRA ROUTES
// ============================================

// Mount dynamic release items routes

// Mount label configuration routes

// REMOVED: /test-connection endpoint - replaced by /api/auth/login for better architecture

/**
 * Validate JIRA key (check issue type)
 * POST /api/jira/validate
 */

module.exports = router;
