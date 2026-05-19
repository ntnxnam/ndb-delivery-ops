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
const { jiraTimeout, releaseAnalysisTimeout } = require('../../middleware/timeout');
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
const { getAllFields } = require('../../utils/jiraFieldsConfig');
const { processAllMilestones } = require('../../utils/milestoneProcessor');
const jiraFieldsConfig = require('../../config/jiraFieldsConfig.json');
const { runSearchByJql } = require('../../utils/jiraSearchByJql');
const teamBoardConfig = require('../../config/teamBoardConfig.json');
const { getSprintsForBoard, resolveSprintState, classifySprintIssue, getAddedToSprintAt } = require('../../utils/sprintCache');
const { runWithConcurrency } = require('../../utils/concurrency');
const releaseSetupService = require('../../services/releaseSetupService');
const releaseDataService = require('../../services/releaseDataService');
const releaseItemsService = require('../../services/releaseItemsService');
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
router.get('/jira-diagnostic', [
  jiraTimeout,
  requireAuth,
  validateJiraTokenMiddleware
], async (req, res) => {
  const requestId = `diagnostic-${Date.now()}`;
  
  try {
    const { jiraToken: cleanToken } = req;
    const httpsAgent = createHttpsAgent();
    
    console.log(`[${requestId}] Running JIRA diagnostic tests`);
    
    const tests = [];
    
    // Test 1: Basic server info
    try {
      const serverInfo = await axios.get(`${JIRA_API_V2.SERVER_INFO}`, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Accept': 'application/json'
        },
        httpsAgent,
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
      const basicQuery = await axios.get(`${JIRA_API_V2.SEARCH}`, {
        params: {
          jql: 'project = ERA',
          maxResults: 1,
          fields: 'key'
        },
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Accept': 'application/json'
        },
        httpsAgent,
        timeout: 15000
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
      const versions = await axios.get(`${JIRA_API_V2.PROJECT('ERA')}/versions`, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Accept': 'application/json'
        },
        httpsAgent,
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
    
    const httpsAgent = createHttpsAgent();
    const startTime = Date.now();
    
    const searchResponse = await axios.get(`${JIRA_API_V2.SEARCH}`, {
      params: {
        jql,
        fields: 'key,issuetype,status,resolved',
        maxResults: maxResults,
        startAt: 0,
        validateQuery: 'true'
      },
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json'
      },
      httpsAgent,
      timeout: 30000
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

/**
 * Release Analysis endpoint - fetch historical ticket data for velocity analysis
 * Fetches tickets for multiple releases using the specified JQL pattern
 */
router.post('/release-analysis', [
  releaseAnalysisTimeout,
  requireAuth,
  validateJiraTokenMiddleware
], async (req, res) => {
  const requestId = `release-analysis-${Date.now()}`;
  try {
    const data = await releaseAnalysisService.analyzeReleases(req.jiraToken, req.body || {});
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error(`[${requestId}] Release analysis error:`, error);
    const apiError = extractApiError(error);
    const jiraMessage = getJiraErrorMessage(error);
    return res.status(500).json(formatErrorResponse(
      'release-analysis',
      'Failed to fetch release analysis data',
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
router.post('/validate', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { jiraKey } = req.body;
    const username = req.username || req.body?.username;

    if (!jiraKey) {
      return res.status(400).json({ 
        error: 'JIRA key is required' 
      });
    }

    const cleanToken = req.jiraToken;
    
    logger.audit.action(username || 'unknown', 'VALIDATE_JIRA_KEY', `JIRA key: ${jiraKey}`, {
      jiraKey,
      ip: req.ip || req.connection.remoteAddress
    });
    
    const baseUrl = JIRA_API_V2.BASE_URL;
    const httpsAgent = createHttpsAgent();
    const apiUrl = JIRA_API_V2.ISSUE(jiraKey);

    try {
      const response = await retryJiraCall(() => axios.get(apiUrl, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 30000,
        params: {
          fields: 'issuetype,summary,status'
        }
      }));

      const issueType = response.data.fields?.issuetype?.name;
      const allowedTypes = ['Feature', 'Initiative', 'X-FEAT', 'Capability'];
      
      if (!allowedTypes.includes(issueType)) {
        return res.status(400).json({
          error: `Invalid JIRA issue type for ticket ${jiraKey}`,
          message: `The ticket ${jiraKey} has issue type "${issueType || 'Unknown'}", which is not allowed.`,
          details: [
            `Current issue type: ${issueType || 'Unknown'}`,
            `Allowed issue types: ${allowedTypes.join(', ')}`,
            `Ticket summary: ${response.data.fields?.summary || 'N/A'}`,
            '',
            'To fix this:',
            '• The ticket must be one of: Feature, Initiative, X-FEAT, or Capability',
            '• If this is the correct ticket, you may need to change its issue type in JIRA',
            '• Or use a different ticket that matches the required issue types'
          ],
          issueType: issueType,
          allowedTypes: allowedTypes,
          jiraKey: jiraKey,
          summary: response.data.fields?.summary
        });
      }
      
      return res.json({
        valid: true,
        issueType: issueType,
        summary: response.data.fields?.summary || 'N/A',
        status: response.data.fields?.status?.name || 'N/A',
        key: response.data.key
      });
    } catch (apiError) {
      console.error('JIRA validation error:', apiError.message);
      console.error('JIRA validation error details:', {
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        data: apiError.response?.data,
        url: apiUrl
      });
      
      if (apiError.response?.status === 404) {
        return res.status(404).json({
          error: `JIRA ticket "${jiraKey}" not found`,
          message: `The ticket ${jiraKey} does not exist or you may not have permission to view it. Please verify:`,
          details: [
            'Check that the JIRA key format is correct (e.g., FEAT-12345)',
            'Verify the ticket exists in the JIRA instance',
            'Ensure you have permission to view this ticket'
          ],
          jiraKey: jiraKey
        });
      } else if (apiError.response?.status === 401) {
        return res.status(401).json({
          error: 'JIRA authentication failed - Invalid token',
          message: 'Your JIRA token is invalid or expired. Please:',
          details: [
            'Check that your JIRA Personal Access Token (PAT) is correct',
            'Verify the token has not expired',
            'Ensure the token has the necessary permissions (Browse Projects, View Issues)',
            'Logout and re-enter your JIRA token'
          ],
          jiraKey: jiraKey
        });
      } else if (apiError.response?.status === 403) {
        return res.status(403).json({
          error: 'JIRA access forbidden',
          message: `You do not have permission to view ticket ${jiraKey}. Please:`,
          details: [
            'Verify you have access to the project containing this ticket',
            'Check that your JIRA token has the necessary permissions',
            'Contact your JIRA administrator if you believe you should have access'
          ],
          jiraKey: jiraKey
        });
      } else if (apiError.code === 'ECONNABORTED' || apiError.code === 'ETIMEDOUT') {
        return res.status(504).json({
          error: 'JIRA request timed out',
          message: 'The JIRA server took too long to respond. Please:',
          details: [
            'Check your network connection',
            'Verify the JIRA server is accessible',
            'Try again in a few moments'
          ],
          jiraKey: jiraKey
        });
      } else if (apiError.code === 'ENOTFOUND' || apiError.code === 'EAI_AGAIN') {
        return res.status(503).json({
          error: 'JIRA server not reachable',
          message: 'Unable to connect to the JIRA server. Please:',
          details: [
            'Check your network connection',
            'Verify the JIRA base URL is correct',
            'Ensure you are connected to the corporate network (if required)'
          ],
          jiraKey: jiraKey
        });
      }
      
      const jiraErrorMessages = apiError.response?.data?.errorMessages || [];
      const jiraWarnings = apiError.response?.data?.warningMessages || [];
      const jiraErrors = apiError.response?.data?.errors || {};
      const status = apiError.response?.status;
      
      let errorMessage = 'Failed to validate JIRA key';
      let details = [];
      
      if (jiraErrorMessages.length > 0) {
        errorMessage = `JIRA API Error: ${jiraErrorMessages.join(', ')}`;
        details.push(...jiraErrorMessages);
      } else if (Object.keys(jiraErrors).length > 0) {
        const errorDetails = Object.entries(jiraErrors).map(([key, value]) => `${key}: ${value}`);
        errorMessage = `JIRA Validation Error: ${errorDetails.join(', ')}`;
        details.push(...errorDetails);
      } else if (apiError.response?.data?.message) {
        errorMessage = apiError.response.data.message;
        details.push(apiError.response.data.message);
      } else if (apiError.message) {
        errorMessage = apiError.message;
        details.push(apiError.message);
      } else if (status) {
        errorMessage = `JIRA API returned ${status} ${apiError.response?.statusText || ''}. Check network/VPN and ticket key.`;
        details.push(errorMessage);
      } else {
        errorMessage = apiError.code
          ? `Connection error (${apiError.code}). Check network/VPN and that JIRA is reachable.`
          : 'Failed to validate JIRA key. Check the ticket key, network, and JIRA token.';
        details.push(errorMessage);
      }
      
      if (jiraWarnings.length > 0) {
        details.push('Warnings:', ...jiraWarnings);
      }
      
      return res.status(status || 500).json({
        error: errorMessage,
        message: `Unable to validate JIRA ticket ${jiraKey}. ${errorMessage}`,
        details: details.length > 0 ? details : ['An unexpected error occurred while validating the JIRA ticket'],
        jiraKey: jiraKey,
        statusCode: status || 500
      });
    }
  } catch (error) {
    console.error('Error in JIRA validation endpoint:', error);
    const msg = error.message || String(error);
    return res.status(500).json({
      error: msg ? `Failed to validate JIRA key: ${msg}` : 'Failed to validate JIRA key',
      message: msg
    });
  }
});

/**
 * Search JIRA by JQL and return issues plus list of fields that have data (for Generic Emailer)
 * POST /api/jira/search-by-jql
 * Body: { jql: string, maxResults?: number }
 */
router.post('/search-by-jql', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const { jql, maxResults: requestedMax } = req.body;
    if (!jql || typeof jql !== 'string' || !jql.trim()) {
      return res.status(400).json({ error: 'jql is required and must be a non-empty string' });
    }
    const maxResults = Math.min(Number(requestedMax) || 100, 500);
    const { issues, fieldsWithData } = await runSearchByJql(req.jiraToken, jql, maxResults);
    return res.json({ issues, fieldsWithData });
  } catch (error) {
    const apiError = extractApiError(error);
    console.error('Error in /api/jira/search-by-jql:', apiError.message);
    return res.status(apiError.statusCode || 500).json({
      error: 'JQL search failed',
      message: apiError.message,
      details: apiError.details
    });
  }
});


/**
 * Run a KPI query and return either count or list (key, summary, priority, assignee, status)
 * POST /api/jira/kpi-results  body: { teamId, kpiId }
 * Requires KPI tab authorization.
 */
const KPI_LIST_MAX_RESULTS = 200;
router.post('/kpi-results', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const username = req.username || req.headers['x-username'] || '';
    const { authorized } = checkKpiViewAuthorization(username);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You are not authorized to view KPI results.' });
    }
    const { teamId, kpiId } = req.body || {};
    if (!teamId || !kpiId) {
      return res.status(400).json({ error: 'teamId and kpiId are required' });
    }
    const teams = loadKpiConfigSync();
    const { kpis, normalizedTeamId } = getKpisForTeam(teams, teamId);
    if (!kpis) {
      return res.status(404).json({
        error: 'Team KPIs not found',
        message: `No KPI config for team "${teamId}". Add KPIs in KPI config or choose a team that has KPIs configured.`
      });
    }
    const kpi = kpis.find((k) => k.id === kpiId);
    if (!kpi) {
      return res.status(404).json({
        error: 'KPI not found',
        message: `KPI "${kpiId}" not found for team "${teamId}".`
      });
    }
    const baseQuery = (kpi.baseQuery || '').trim();
    if (!baseQuery) {
      return res.status(400).json({ error: 'KPI has no base query' });
    }
    const displayType = kpi.displayType === 'list' ? 'list' : 'count';

    const cleanToken = req.jiraToken;
    const httpsAgent = createHttpsAgent();
    const jql = await buildKpiCombinedJql(normalizedTeamId, baseQuery, cleanToken, httpsAgent);
    if (!jql) {
      return res.status(400).json({ error: 'Could not resolve KPI query' });
    }
    if (displayType === 'count') {
      const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
        headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        httpsAgent,
        timeout: 20000,
        params: { jql, maxResults: 0 }
      }));
      const total = response.data.total != null ? response.data.total : 0;
      return res.json({ success: true, total, combinedJql: jql });
    }

    const fieldsList = 'key,summary,priority,assignee,status';
    const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
      headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      httpsAgent,
      timeout: 20000,
      params: { jql, fields: fieldsList, maxResults: KPI_LIST_MAX_RESULTS }
    }));
    const issues = (response.data.issues || []).map((issue) => {
      const f = issue.fields || {};
      return {
        key: issue.key,
        summary: (f.summary != null ? f.summary : '') || '',
        priority: (f.priority && f.priority.name) ? f.priority.name : '',
        assignee: (f.assignee && f.assignee.displayName) ? f.assignee.displayName : '',
        status: (f.status && f.status.name) ? f.status.name : ''
      };
    });
    return res.json({ success: true, issues, total: response.data.total, combinedJql: jql });
  } catch (err) {
    console.error('Error in /api/jira/kpi-results:', err?.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'KPI query failed';
    return res.status(statusCode).json({ success: false, error: message });
  }
});

/**
 * Resolve baseQuery to JQL: filter=123 (by id), filter=FilterName (by name), or raw JQL.
 * Normalize raw JQL: JIRA uses "issuetype" not "type", so replace "type=" with "issuetype=".
 */
async function resolveKpiJql(baseQuery, cleanToken, httpsAgent) {
  const trimmed = (baseQuery || '').trim();
  if (!trimmed) return null;
  const filterMatch = trimmed.match(/^filter\s*=\s*(.+)$/i);
  if (filterMatch) {
    const filterVal = filterMatch[1].trim();
    if (/^\d+$/.test(filterVal)) {
      const filterUrl = JIRA_API_V2.FILTER ? JIRA_API_V2.FILTER(filterVal) : `${JIRA_API_V2.BASE_URL}/rest/api/2/filter/${filterVal}`;
      const filterRes = await retryJiraCall(() => axios.get(filterUrl, {
        headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        httpsAgent,
        timeout: 15000
      }));
      if (filterRes.data && filterRes.data.jql) return filterRes.data.jql;
      return trimmed;
    }
    const favouriteUrl = `${JIRA_API_V2.BASE_URL}/rest/api/2/filter/favourite`;
    const tryFavouriteOnly = async () => {
      const favRes = await retryJiraCall(() => axios.get(favouriteUrl, {
        headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        httpsAgent,
        timeout: 15000
      }));
      const favList = Array.isArray(favRes.data) ? favRes.data : [];
      const fromFav = favList.find((f) => f.name && String(f.name).trim() === filterVal);
      return fromFav && fromFav.jql ? fromFav.jql : null;
    };
    try {
      const searchUrl = `${JIRA_API_V2.BASE_URL}/rest/api/2/filter/search?filterName=${encodeURIComponent(filterVal)}&maxResults=50`;
      const listRes = await retryJiraCall(() => axios.get(searchUrl, {
        headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        httpsAgent,
        timeout: 15000
      }));
      const filters = Array.isArray(listRes.data?.values)
        ? listRes.data.values
        : Array.isArray(listRes.data?.results)
          ? listRes.data.results
          : Array.isArray(listRes.data)
            ? listRes.data
            : [];
      const byName = filters.find((f) => f.name && String(f.name).trim() === filterVal);
      if (byName && byName.jql) return byName.jql;
      const byId = filters.find((f) => String(f.id) === filterVal);
      if (byId && byId.jql) return byId.jql;
      const byNamePartial = filters.find((f) => f.name && String(f.name).trim().toLowerCase() === filterVal.toLowerCase());
      if (byNamePartial && byNamePartial.jql) return byNamePartial.jql;
      const fromFavJql = await tryFavouriteOnly();
      if (fromFavJql) return fromFavJql;
    } catch (e) {
      if (e?.response?.status === 404) {
        const fromFavJql = await tryFavouriteOnly();
        if (fromFavJql) return fromFavJql;
      }
    }
    // Could not resolve the filter by name/id server-side; return the original
    // string as-is so JIRA can interpret "filter=Name" natively in JQL.
    return trimmed;
  }
  // JIRA JQL field is "issuetype", not "type" – normalize so queries like "type=Bug" work
  const normalized = trimmed.replace(/\btype\s*=/gi, 'issuetype=');
  return normalized;
}

/**
 * Build combined JQL: (team base filter) AND (KPI filter). If no team base filter, return only KPI JQL.
 * The team base filter is used as-is (JIRA accepts "filter=Name" inline in JQL) rather than
 * resolved through resolveKpiJql, because it may contain mixed syntax like
 * "filter=NDB-All-Base-Filter and statusCategory!=Done".
 */
async function buildKpiCombinedJql(teamId, kpiBaseQuery, cleanToken, httpsAgent) {
  const kpiJql = await resolveKpiJql(kpiBaseQuery, cleanToken, httpsAgent);
  if (!kpiJql) return null;
  const teamBaseFilter = getTeamBaseFilter(teamId);
  if (!teamBaseFilter) return kpiJql;
  return `(${teamBaseFilter}) AND (${kpiJql})`;
}


/**
 * Build combined JQL for release KPIs: "filter=ReleaseBase and filter=KpiFilter" (or and (rawJQL)).
 * Does not resolve filters to JQL; JIRA search accepts filter= by name/id. If no release base, returns resolved KPI only.
 */
async function buildReleaseKpiCombinedJql(releaseVersion, kpiBaseQuery, cleanToken, httpsAgent, teamId = null) {
  const trimmedKpi = (kpiBaseQuery || '').trim();
  if (!trimmedKpi) return null;

  const releaseBaseFilter = getReleaseBaseFilter(releaseVersion, teamId);
  if (!releaseBaseFilter) {
    return resolveKpiJql(kpiBaseQuery, cleanToken, httpsAgent);
  }

  const kpiPart = trimmedKpi.match(/^filter\s*=\s*.+$/i)
    ? trimmedKpi
    : `(${trimmedKpi.replace(/\btype\s*=/gi, 'issuetype=')})`;
  return `${releaseBaseFilter.trim()} and ${kpiPart} and status != Closed`;
}

/**
 * Run all KPI queries for a team in one request. One JIRA round-trip per KPI; response keyed by kpiId.
 * POST /api/jira/kpi-results-batch  body: { teamId }
 * Returns { success: true, results: { [kpiId]: { total } | { issues, total } } }
 */
router.post('/kpi-results-batch', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const username = req.username || req.headers['x-username'] || '';
    const { authorized } = checkKpiViewAuthorization(username);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You are not authorized to view KPI results.' });
    }
    const { teamId } = req.body || {};
    if (!teamId) {
      return res.status(400).json({ error: 'teamId is required' });
    }
    const teams = loadKpiConfigSync();
    const { kpis, normalizedTeamId } = getKpisForTeam(teams, teamId);
    if (!kpis || kpis.length === 0) {
      return res.json({ success: true, results: {} });
    }

    const cleanToken = req.jiraToken;
    const httpsAgent = createHttpsAgent();
    const results = {};

    for (const kpi of kpis) {
      const baseQuery = (kpi.baseQuery || '').trim();
      if (!baseQuery) {
        results[kpi.id] = { error: 'No base query' };
        continue;
      }
      const displayType = kpi.displayType === 'list' ? 'list' : 'count';

      try {
        const jql = await buildKpiCombinedJql(normalizedTeamId, baseQuery, cleanToken, httpsAgent);
        if (!jql) {
          results[kpi.id] = { error: 'Could not resolve query' };
          continue;
        }

        if (displayType === 'count') {
          const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
            headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            httpsAgent,
            timeout: 20000,
            params: { jql, maxResults: 0 }
          }));
          results[kpi.id] = { total: response.data.total != null ? response.data.total : 0, combinedJql: jql };
        } else {
          const fieldsList = 'key,summary,priority,assignee,status';
          const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
            headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            httpsAgent,
            timeout: 20000,
            params: { jql, fields: fieldsList, maxResults: KPI_LIST_MAX_RESULTS }
          }));
          const issues = (response.data.issues || []).map((issue) => {
            const f = issue.fields || {};
            return {
              key: issue.key,
              summary: (f.summary != null ? f.summary : '') || '',
              priority: (f.priority && f.priority.name) ? f.priority.name : '',
              assignee: (f.assignee && f.assignee.displayName) ? f.assignee.displayName : '',
              status: (f.status && f.status.name) ? f.status.name : ''
            };
          });
          results[kpi.id] = { issues, total: response.data.total, combinedJql: jql };
        }
      } catch (err) {
        const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'Query failed';
        results[kpi.id] = { error: message };
      }
    }

    return res.json({ success: true, results });
  } catch (err) {
    console.error('Error in /api/jira/kpi-results-batch:', err?.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'KPI batch failed';
    return res.status(statusCode).json({ success: false, error: message });
  }
});

/**
 * Run a KPI query scoped by release version (release base filter + KPI filter). Same response shape as kpi-results including combinedJql.
 * POST /api/jira/release-kpi-results  body: { releaseVersion, teamId, kpiId }
 */
router.post('/release-kpi-results', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const username = req.username || req.headers['x-username'] || '';
    const { authorized } = checkKpiViewAuthorization(username);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You are not authorized to view KPI results.' });
    }
    const { releaseVersion, teamId, kpiId } = req.body || {};
    if (!releaseVersion || !teamId || !kpiId) {
      return res.status(400).json({ error: 'releaseVersion, teamId and kpiId are required' });
    }
    const teams = loadKpiConfigSync();
    const { kpis, normalizedTeamId } = getKpisForTeam(teams, teamId);
    if (!kpis) {
      return res.status(404).json({
        error: 'Team KPIs not found',
        message: `No KPI config for team "${teamId}". Add KPIs in KPI config or choose a team that has KPIs configured.`
      });
    }
    const kpi = kpis.find((k) => k.id === kpiId);
    if (!kpi) {
      return res.status(404).json({
        error: 'KPI not found',
        message: `KPI "${kpiId}" not found for team "${teamId}".`
      });
    }
    const baseQuery = (kpi.baseQuery || '').trim();
    if (!baseQuery) {
      return res.status(400).json({ error: 'KPI has no base query' });
    }
    const displayType = kpi.displayType === 'list' ? 'list' : 'count';

    const cleanToken = req.jiraToken;
    const httpsAgent = createHttpsAgent();
    const jql = await buildReleaseKpiCombinedJql(releaseVersion, baseQuery, cleanToken, httpsAgent, normalizedTeamId);
    if (!jql) {
      return res.status(400).json({ error: 'Could not resolve release KPI query (check release base filter config)' });
    }
    if (displayType === 'count') {
      const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
        headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        httpsAgent,
        timeout: 20000,
        params: { jql, maxResults: 0 }
      }));
      const total = response.data.total != null ? response.data.total : 0;
      return res.json({ success: true, total, combinedJql: jql });
    }
    const fieldsList = 'key,summary,priority,assignee,status';
    const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
      headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      httpsAgent,
      timeout: 20000,
      params: { jql, fields: fieldsList, maxResults: KPI_LIST_MAX_RESULTS }
    }));
    const issues = (response.data.issues || []).map((issue) => {
      const f = issue.fields || {};
      return {
        key: issue.key,
        summary: (f.summary != null ? f.summary : '') || '',
        priority: (f.priority && f.priority.name) ? f.priority.name : '',
        assignee: (f.assignee && f.assignee.displayName) ? f.assignee.displayName : '',
        status: (f.status && f.status.name) ? f.status.name : ''
      };
    });
    return res.json({ success: true, issues, total: response.data.total, combinedJql: jql });
  } catch (err) {
    console.error('Error in /api/jira/release-kpi-results:', err?.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'Release KPI query failed';
    return res.status(statusCode).json({ success: false, error: message });
  }
});

/**
 * Run all KPIs for a team scoped by release version. Same response shape as kpi-results-batch including combinedJql per result.
 * POST /api/jira/release-kpi-results-batch  body: { releaseVersion, teamId }
 */
router.post('/release-kpi-results-batch', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const username = req.username || req.headers['x-username'] || '';
    const { authorized } = checkKpiViewAuthorization(username);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You are not authorized to view KPI results.' });
    }
    const { releaseVersion, teamId } = req.body || {};
    if (!releaseVersion || !teamId) {
      return res.status(400).json({ error: 'releaseVersion and teamId are required' });
    }
    const teams = loadKpiConfigSync();
    const { kpis } = getKpisForTeam(teams, teamId);
    if (!kpis || kpis.length === 0) {
      return res.json({ success: true, results: {} });
    }

    const cleanToken = req.jiraToken;
    const httpsAgent = createHttpsAgent();
    const results = {};

    for (const kpi of kpis) {
      const baseQuery = (kpi.baseQuery || '').trim();
      if (!baseQuery) {
        results[kpi.id] = { error: 'No base query' };
        continue;
      }
      const displayType = kpi.displayType === 'list' ? 'list' : 'count';

      try {
        const jql = await buildReleaseKpiCombinedJql(releaseVersion, baseQuery, cleanToken, httpsAgent, teamId);
        if (!jql) {
          results[kpi.id] = { error: 'Could not resolve query (check release base filter)' };
          continue;
        }

        if (displayType === 'count') {
          const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
            headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            httpsAgent,
            timeout: 20000,
            params: { jql, maxResults: 0 }
          }));
          results[kpi.id] = { total: response.data.total != null ? response.data.total : 0, combinedJql: jql };
        } else {
          const fieldsList = 'key,summary,priority,assignee,status';
          const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
            headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            httpsAgent,
            timeout: 20000,
            params: { jql, fields: fieldsList, maxResults: KPI_LIST_MAX_RESULTS }
          }));
          const issues = (response.data.issues || []).map((issue) => {
            const f = issue.fields || {};
            return {
              key: issue.key,
              summary: (f.summary != null ? f.summary : '') || '',
              priority: (f.priority && f.priority.name) ? f.priority.name : '',
              assignee: (f.assignee && f.assignee.displayName) ? f.assignee.displayName : '',
              status: (f.status && f.status.name) ? f.status.name : ''
            };
          });
          results[kpi.id] = { issues, total: response.data.total, combinedJql: jql };
        }
      } catch (err) {
        const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'Query failed';
        results[kpi.id] = { error: message };
      }
    }

    return res.json({ success: true, results });
  } catch (err) {
    console.error('Error in /api/jira/release-kpi-results-batch:', err?.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'Release KPI batch failed';
    return res.status(statusCode).json({ success: false, error: message });
  }
});


/**
 * Group breakdown results by parent project for bulk requests
 */
function groupBreakdownByProject(issues, projectKeys, excludedTypes) {
  const projectBreakdowns = {};
  
  // Initialize breakdown for each project
  projectKeys.forEach(key => {
    projectBreakdowns[key] = {
      breakdown: {},
      totalFiltered: 0
    };
  });
  
  // Process each issue and assign to parent project(s)
  issues.forEach(issue => {
    const issueType = issue.fields?.issuetype?.name || 'Unknown';
    const status = issue.fields?.status?.name || 'Unknown';
    const issueKey = issue.key;
    
    // Skip excluded types
    if (excludedTypes.includes(issueType)) {
      return;
    }
    
    // Determine which project(s) this issue belongs to
    const parentProjects = [];
    
    // Direct key match
    if (projectKeys.includes(issueKey)) {
      parentProjects.push(issueKey);
    }
    
    // Parent Link field match
    const parentLink = issue.fields?.['Parent Link']?.key;
    if (parentLink && projectKeys.includes(parentLink)) {
      parentProjects.push(parentLink);
    }
    
    // FEAT ID field match
    const featId = issue.fields?.['FEAT ID'];
    if (featId && projectKeys.includes(featId)) {
      parentProjects.push(featId);
    }
    
    // FEAT Number field match  
    const featNumber = issue.fields?.['FEAT Number'];
    if (featNumber && projectKeys.includes(featNumber)) {
      parentProjects.push(featNumber);
    }
    
    // If no specific parent found, try to infer from hierarchy
    // For complex portfolio relationships, assign to all projects (conservative approach)
    if (parentProjects.length === 0) {
      parentProjects.push(...projectKeys);
    }
    
    // Add issue to each parent project's breakdown
    parentProjects.forEach(projectKey => {
      const projectBreakdown = projectBreakdowns[projectKey];
      
      if (!projectBreakdown.breakdown[issueType]) {
        projectBreakdown.breakdown[issueType] = {
          total: 0,
          statuses: {}
        };
      }
      
      projectBreakdown.breakdown[issueType].total++;
      projectBreakdown.totalFiltered++;
      
      if (!projectBreakdown.breakdown[issueType].statuses[status]) {
        projectBreakdown.breakdown[issueType].statuses[status] = 0;
      }
      projectBreakdown.breakdown[issueType].statuses[status]++;
    });
  });
  
  return projectBreakdowns;
}

/**
 * Get issue breakdown statistics (optimized for single and bulk requests)  
 * POST /api/jira/issue-breakdown
 */
router.post('/issue-breakdown', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { jiraKey, jiraKeys } = req.body;
    
    // Determine single vs bulk request
    const projectKeys = jiraKey ? [jiraKey] : (jiraKeys || []);
    const isBulkRequest = jiraKeys && jiraKeys.length > 1;
    
    if (projectKeys.length === 0) {
      return res.status(400).json({ error: 'jiraKey or jiraKeys is required' });
    }
    
    // Validate project keys format
    const invalidKeys = projectKeys.filter(key => !/^[A-Z]+-\d+$/.test(key));
    if (invalidKeys.length > 0) {
      return res.status(400).json({ 
        error: `Invalid project key format: ${invalidKeys.join(', ')}. Expected format: LETTERS-NUMBERS (e.g., FEAT-1001)` 
      });
    }

    // Use validated token from middleware
    const cleanToken = req.jiraToken;
    const baseUrl = JIRA_API_V2.BASE_URL;
    const httpsAgent = createHttpsAgent();
    
    // Build optimized JQL query based on request type
    const jqlQuery = buildOptimizedProjectTicketsJQL(projectKeys);
    const searchUrl = JIRA_API_V2.SEARCH;
    
    logger.jira.fetch(
      isBulkRequest ? `BULK[${projectKeys.join(',')}]` : projectKeys[0], 
      'FETCH_ISSUE_BREAKDOWN', 
      `Fetching issue breakdown for ${isBulkRequest ? 'bulk' : 'single'} JIRA ${isBulkRequest ? 'tickets' : 'ticket'}`
    );
    
    try {
      const response = await axios.get(searchUrl, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 30000,
        params: {
          jql: jqlQuery,
          fields: 'key,summary,status,issuetype,parent',
          maxResults: 1000
        }
      });

      const issues = response.data.issues || [];
      // Note: Exclusions are now handled at JQL level, no need for additional filtering
      
      // Categorize statuses based on actual JIRA workflow statuses
      const categorizeStatus = (status) => {
        // Use exact status matching for known JIRA statuses
        switch (status) {
          // Done - Truly completed work
          case 'Done':
          case 'Closed':
            return 'Done';
          
          // To Be Verified - Work completed but pending verification
          case 'Resolved':
            return 'To Be Verified';
          
          // In Progress - Active development/review work  
          case 'In Progress':
          case 'Development':
          case 'Code Review':
          case 'In Review':
          case 'Testing':
          case 'QA':
          case 'UAT':
          case 'Pending Merge':
            return 'In Progress';
          
          // To Do - Work not yet started
          case 'To Do':
          case 'Open':
          case 'Backlog':
          case 'New':
          case 'Ready':
          case 'Ready for Development':
          case 'Selected for Development':
            return 'To Do';
          
          // Blocked - Work that is blocked or needs information
          case 'Blocked':
          case 'On Hold':
          case 'Need Info':
          case 'Needs Info':
          case 'Waiting':
          case 'Waiting for Information':
          case 'Pending':
            return 'Blocked';
          
          // Everything else goes to Other
          default:
            return 'Other';
        }
      };
      
      if (isBulkRequest) {
        // Bulk request - group results by parent project  
        const projectBreakdowns = groupBreakdownByProject(issues, projectKeys, []);
        
        // Process each project's breakdown
        const bulkResults = {};
        
        Object.entries(projectBreakdowns).forEach(([projectKey, projectData]) => {
          const { breakdown, totalFiltered } = projectData;
          
          // Apply the same formatting logic as single requests
          const formattedBreakdown = Object.entries(breakdown).map(([type, data]) => {
            const statusCategories = {
              'Done': {},
              'To Be Verified': {},
              'In Progress': {},
              'To Do': {},
              'Blocked': {},
              'Other': {}
            };
            
            Object.entries(data.statuses).forEach(([status, count]) => {
              const category = categorizeStatus(status);
              statusCategories[category][status] = count;
            });
            
            return {
              type,
              total: data.total,
              statusCategories
            };
          }).sort((a, b) => b.total - a.total);
          
          // Calculate overall stats for this project
          let totalDone = 0, totalToBeVerified = 0, totalInProgress = 0;
          let totalToDo = 0, totalBlocked = 0, totalOther = 0;
          
          formattedBreakdown.forEach(({ statusCategories }) => {
            Object.values(statusCategories['Done']).forEach(count => totalDone += count);
            Object.values(statusCategories['To Be Verified']).forEach(count => totalToBeVerified += count);
            Object.values(statusCategories['In Progress']).forEach(count => totalInProgress += count);
            Object.values(statusCategories['To Do']).forEach(count => totalToDo += count);
            Object.values(statusCategories['Blocked']).forEach(count => totalBlocked += count);
            Object.values(statusCategories['Other']).forEach(count => totalOther += count);
          });
          
          const overallStats = {
            done: totalDone,
            toBeVerified: totalToBeVerified,
            inProgress: totalInProgress,
            toDo: totalToDo,
            blocked: totalBlocked,
            other: totalOther,
            completionRate: totalFiltered > 0 ? (((totalDone + totalToBeVerified) / totalFiltered) * 100).toFixed(1) : '0.0'
          };
          
          // Generate JIRA search URL for this project key
          const projectJQL = buildTaskBreakdownJQL(projectKey);
          const jiraBaseUrl = 'https://jira.nutanix.com';
          const encodedProjectJql = encodeURIComponent(projectJQL);
          const projectJiraSearchUrl = `${jiraBaseUrl}/issues/?jql=${encodedProjectJql}`;
          
          bulkResults[projectKey] = {
            success: true,
            total: totalFiltered,
            breakdown: formattedBreakdown,
            overallStats: overallStats,
            jiraSearchUrl: projectJiraSearchUrl
          };
        });
        
        logger.jira.issueBreakdown(`BULK[${projectKeys.join(',')}]`, issues.length, bulkResults);
        
        return res.json({
          success: true,
          isBulk: true,
          results: bulkResults,
          totalIssuesProcessed: issues.length
        });
        
      } else {
        // Single request - return raw tickets data for client-side processing
        const ticketsData = issues.map(issue => ({
          key: issue.key,
          issueType: issue.fields?.issuetype?.name || 'Unknown',
          status: issue.fields?.status?.name || 'Unknown',
          summary: issue.fields?.summary || ''
        }));
        
        logger.jira.issueBreakdown(projectKeys[0], issues.length, 'Raw tickets returned for client processing');
        
        // Generate JIRA search URL for all tickets (no status exclusion)
        const jiraBaseUrl = 'https://jira.nutanix.com';
        const encodedJql = encodeURIComponent(jqlQuery);
        const jiraSearchUrl = `${jiraBaseUrl}/issues/?jql=${encodedJql}`;
        
        // Generate URL for outstanding tickets only (with status exclusion)
        const outstandingJQL = buildTaskBreakdownJQL(projectKeys[0]);
        const encodedOutstandingJql = encodeURIComponent(outstandingJQL);
        const outstandingUrl = `${jiraBaseUrl}/issues/?jql=${encodedOutstandingJql}`;
        
        res.json({
          success: true,
          total: issues.length,
          tickets: ticketsData,
          jiraSearchUrl: jiraSearchUrl,
          outstandingUrl: outstandingUrl,
          clientProcessing: true // Flag to indicate client should process the data
        });
      }

    } catch (error) {
      console.error('Error fetching issue breakdown from JIRA:', error.message);
      if (error.response) {
        console.error('JIRA API Error Response:', error.response.status, error.response.data);
        return res.status(upstreamStatus(error.response.status)).json({
          error: `Failed to fetch issue breakdown: ${error.response.data.errorMessages?.join(', ') || error.response.statusText}`
        });
      }
      throw error;
    }

  } catch (error) {
    console.error('Error in /api/jira/issue-breakdown:', error);
    res.status(500).json({
      error: 'Failed to fetch issue breakdown',
      message: error.message
    });
  }
});

/**
 * Get checkpoint history for a JIRA issue
 * POST /api/jira/checkpoint-history
 */
router.post('/checkpoint-history', checkpointHistoryLimiter, validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { jiraKey } = req.body;

    if (!jiraKey) {
      return res.status(400).json({
        success: false,
        error: 'JIRA key is required'
      });
    }

    const baseUrl = JIRA_API_V2.BASE_URL;
    const httpsAgent = createHttpsAgent();
    const cleanToken = req.jiraToken;

    // Checkpoint field IDs
    const checkpointFields = {
      codeComplete: 'customfield_11067',
      commitGate: 'customfield_35863',
      promotionGate: 'customfield_35864'
    };

    // Fetch issue with changelog using pagination utility
    const issueUrl = `${baseUrl}/rest/api/2/issue/${jiraKey}`;
    
    try {
      // First, fetch issue to get issue ID and initial changelog
      const response = await retryJiraCall(() => axios.get(issueUrl, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 30000,
        params: {
          expand: 'changelog',
          fields: `${checkpointFields.codeComplete},${checkpointFields.commitGate},${checkpointFields.promotionGate}`
        }
      }));

      const issue = response.data;
      
      // Use pagination utility to fetch all changelog histories
      const paginationResult = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issue.id || null, // Pass issue ID for Strategy 2
        cleanToken,
        httpsAgent,
        retryJiraCall,
        logger
      );
      
      const histories = paginationResult.histories;
      
      // Log pagination results if pagination was needed
      if (paginationResult.paginationInfo.needsPagination) {
        console.log(`[Checkpoint History] ${jiraKey} - Pagination complete: ${paginationResult.paginationInfo.fetched}/${paginationResult.paginationInfo.total} histories fetched using strategies: ${paginationResult.paginationInfo.strategiesUsed.join(', ')}`);
        if (paginationResult.warnings.length > 0) {
          console.warn(`[Checkpoint History] ${jiraKey} - Pagination warnings:`, paginationResult.warnings);
        }
      }

      // Current checkpoint dates
      const fields = issue.fields || {};
      const currentDates = {
        codeComplete: fields[checkpointFields.codeComplete] || null,
        commitGate: fields[checkpointFields.commitGate] || null,
        promotionGate: fields[checkpointFields.promotionGate] || null
      };

      // Track historical dates for each checkpoint
      const historyData = {
        codeComplete: [],
        commitGate: [],
        promotionGate: []
      };

      // Process changelog to find date changes
      histories.forEach(history => {
        const created = history.created;
        const items = history.items || [];

        items.forEach(item => {
          const fieldId = item.fieldId;
          const fromValue = item.fromString || item.from;
          const toValue = item.toString || item.to;

          // Check if this is a checkpoint field change
          if (fieldId === checkpointFields.codeComplete) {
            if (fromValue && fromValue !== 'null' && fromValue !== '') {
              historyData.codeComplete.push({
                date: fromValue,
                changedAt: created,
                isCurrent: false
              });
            }
          } else if (fieldId === checkpointFields.commitGate) {
            if (fromValue && fromValue !== 'null' && fromValue !== '') {
              historyData.commitGate.push({
                date: fromValue,
                changedAt: created,
                isCurrent: false
              });
            }
          } else if (fieldId === checkpointFields.promotionGate) {
            if (fromValue && fromValue !== 'null' && fromValue !== '') {
              historyData.promotionGate.push({
                date: fromValue,
                changedAt: created,
                isCurrent: false
              });
            }
          }
        });
      });

      // Add current dates as the latest entries
      if (currentDates.codeComplete) {
        historyData.codeComplete.push({
          date: currentDates.codeComplete,
          changedAt: new Date().toISOString(),
          isCurrent: true
        });
      }
      if (currentDates.commitGate) {
        historyData.commitGate.push({
          date: currentDates.commitGate,
          changedAt: new Date().toISOString(),
          isCurrent: true
        });
      }
      if (currentDates.promotionGate) {
        historyData.promotionGate.push({
          date: currentDates.promotionGate,
          changedAt: new Date().toISOString(),
          isCurrent: true
        });
      }

      // Sort by date (oldest first) and remove duplicates
      Object.keys(historyData).forEach(key => {
        const dates = historyData[key];
        // Remove duplicates based on date value
        const uniqueDates = [];
        const seenDates = new Set();
        
        dates.forEach(entry => {
          const dateStr = entry.date;
          if (!seenDates.has(dateStr)) {
            seenDates.add(dateStr);
            uniqueDates.push(entry);
          }
        });
        
        // Sort by date
        uniqueDates.sort((a, b) => {
          const dateA = new Date(a.date);
          const dateB = new Date(b.date);
          return dateA - dateB;
        });
        
        historyData[key] = uniqueDates;
      });

      return res.json({
        success: true,
        currentDates: currentDates,
        history: historyData
      });
    } catch (error) {
      console.error(`Error fetching checkpoint history for ${jiraKey}:`, error);
      if (error.response) {
        return res.status(upstreamStatus(error.response.status)).json({
          success: false,
          error: `JIRA API error: ${error.response.statusText}`,
          message: error.response.data?.errorMessages?.join(', ') || error.message
        });
      }
      return res.status(500).json({
        success: false,
        error: 'Failed to fetch checkpoint history',
        message: error.message
      });
    }
  } catch (error) {
    console.error('Error in /api/jira/checkpoint-history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch checkpoint history',
      message: error.message
    });
  }
});

/**
 * Fetch all JIRA tickets (Features/Initiatives with Epics and breakdown statistics)
 * POST /api/jira/fetch-all-jira-tickets (formerly fetch-epics)
 * 
 * This endpoint fetches Features/Initiatives with their linked Epics plus breakdown statistics.
 * Uses different JQL queries based on main ticket type (X-FEAT/Capability vs Feature/Initiative).
 */
router.post('/fetch-all-jira-tickets', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { jiraKey, jiraData } = req.body;

    if (!jiraKey) {
      return res.status(400).json({ error: 'JIRA key is required' });
    }

    // Use validated token from middleware
    const cleanToken = req.jiraToken;
    const baseUrl = JIRA_API_V2.BASE_URL;
    const httpsAgent = createHttpsAgent();
    
    // First, fetch the main ticket to determine its issue type
    // OPTIMIZATION: Use already-fetched jiraData if provided to avoid redundant API call
    let mainTicketIssueType = null;
    if (jiraData && jiraData.issueType) {
      // Use issue type from already-fetched data
      mainTicketIssueType = jiraData.issueType;
      logger.jira.fetch(jiraKey, 'MAIN_TICKET_TYPE_CACHED', `Using cached issue type: ${mainTicketIssueType}`);
    } else {
      // Fetch from JIRA if not provided
      try {
        const mainTicketResponse = await axios.get(`${baseUrl}/rest/api/2/issue/${jiraKey}`, {
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          httpsAgent: httpsAgent,
          timeout: 6000, // Reduced from 30s to 6s
          params: {
            fields: 'issuetype',
          }
        });
        mainTicketIssueType = mainTicketResponse.data.fields?.issuetype?.name;
        logger.jira.fetch(jiraKey, 'MAIN_TICKET_TYPE', `Main ticket issue type: ${mainTicketIssueType}`);
      } catch (mainTicketError) {
        logger.jira.warning(jiraKey, `Failed to fetch main ticket type: ${mainTicketError.message}`);
        return res.status(500).json({ error: 'Failed to fetch main ticket type', message: mainTicketError.message });
      }
    }
    
    if (!mainTicketIssueType || !['Feature', 'Initiative', 'X-FEAT', 'Capability'].includes(mainTicketIssueType)) {
      return res.status(400).json({ 
        error: `Invalid issue type: ${mainTicketIssueType}. Expected Feature, Initiative, X-FEAT, or Capability.` 
      });
    }
    
    // Use different JQL queries based on issue type (Level 1 vs Level 2)
    let jqlQuery;
    if (mainTicketIssueType === 'X-FEAT' || mainTicketIssueType === 'Capability') {
      // Level 1: X-FEAT or Capability - Use comprehensive query
      jqlQuery = `key=${jiraKey} OR "Parent Link"=${jiraKey} OR "FEAT Number" = ${jiraKey} OR issueFunction in portfolioChildrenOf("key=${jiraKey}") OR issueFunction in portfolioChildrenOf("\\"FEAT Number\\" = ${jiraKey}") OR issueFunction in portfolioChildrenOf("\\"Parent Link\\"=${jiraKey}") OR issueFunction in linkedIssuesOf("\\"FEAT Number\\" = ${jiraKey}") OR issueFunction in linkedIssuesOf("\\"Parent Link\\"=${jiraKey}") OR issueFunction in linkedIssuesOf("key=${jiraKey}") OR issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf(\\"key=${jiraKey}\\")") OR issueFunction in linkedIssuesOf("issueFunction in portfolioChildrenOf(\\"key=${jiraKey}\\")") OR issueFunction in portfolioChildrenOf("issueFunction in linkedIssuesOf(\\"key=${jiraKey}\\")") OR issueFunction in linkedIssuesOf("issueFunction in issuesInEpics(\\"issueFunction in portfolioChildrenOf(\\\\\\"key=${jiraKey}\\\\\\")\\")")`;
      logger.jira.fetch(jiraKey, 'BUILD_JQL', `Using comprehensive query for ${mainTicketIssueType} (Level 1)`);
    } else if (mainTicketIssueType === 'Feature' || mainTicketIssueType === 'Initiative') {
      // Level 2: Feature or Initiative - Use comprehensive query across all projects (removed project = ERA restriction)
      jqlQuery = `(key = ${jiraKey} OR "Parent Link" = ${jiraKey} OR "FEAT ID" ~ ${jiraKey} OR "FEAT Number" = ${jiraKey} OR issueFunction in portfolioChildrenOf("key=${jiraKey}") OR issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key=${jiraKey}')") OR issueFunction in subtasksOf("key=${jiraKey}") OR issueFunction in subtasksOf("issueFunction in issuesInEpics(\\"issueFunction in portfolioChildrenOf('key=${jiraKey}') \\")"))`;
      logger.jira.fetch(jiraKey, 'BUILD_JQL', `Using comprehensive query for ${mainTicketIssueType} (Level 2) - all projects`);
    }
    
    const searchUrl = JIRA_API_V2.SEARCH;
    
    logger.jira.fetch(jiraKey, 'FETCH_ALL_ISSUES', `Fetching all related issues with query for ${mainTicketIssueType}`);
    
    try {
      const response = await axios.get(searchUrl, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 60000, // Increased timeout for comprehensive query
        params: {
          jql: jqlQuery,
          fields: 'key,summary,status,resolution,assignee,duedate,fixVersions,customfield_10860,issuetype,customfield_20363',
          expand: 'names',
          maxResults: 1000
        }
      });

      const allIssues = response.data.issues || [];
      logger.jira.fetch(jiraKey, 'FETCH_ALL_ISSUES_SUCCESS', `Fetched ${allIssues.length} total issues`);
      
      // Ensure main ticket is in the results
      const mainTicket = allIssues.find(issue => issue.key === jiraKey);
      if (!mainTicket) {
        // If main ticket not in results, fetch it separately
        try {
          const mainTicketResponse = await axios.get(`${baseUrl}/rest/api/2/issue/${jiraKey}`, {
            headers: {
              'Authorization': `Bearer ${cleanToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            httpsAgent: httpsAgent,
            timeout: 6000, // Reduced from 30s to 6s
            params: {
              fields: 'key,summary,status,issuetype,resolution,assignee,duedate,fixVersions,customfield_10860,customfield_20363',
              expand: 'names'
            }
          });
          allIssues.unshift(mainTicketResponse.data);
        } catch (mainTicketError) {
          logger.jira.warning(jiraKey, `Failed to fetch main ticket: ${mainTicketError.message}`);
          return res.status(500).json({ error: 'Failed to fetch main ticket', message: mainTicketError.message });
        }
      }

      const issues = allIssues;
      
      // Get field names from the names object in the response
      let names = response.data.names || {};
      
      // If names object is empty, try to fetch field metadata separately
      if (Object.keys(names).length === 0) {
        console.log('Names object is empty, fetching field metadata...');
        try {
          const fieldMetadataUrl = JIRA_API_V2.FIELD;
          const fieldResponse = await axios.get(fieldMetadataUrl, {
            headers: {
              'Authorization': `Bearer ${cleanToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            httpsAgent: httpsAgent,
            timeout: 30000
          });
          
          if (fieldResponse.data && Array.isArray(fieldResponse.data)) {
            fieldResponse.data.forEach(field => {
              if (field.id && field.name) {
                names[field.id] = field.name;
              }
            });
            console.log('Fetched field metadata, found', Object.keys(names).length, 'fields');
          }
        } catch (fieldError) {
          console.warn('Could not fetch field metadata:', fieldError.message);
        }
      }
      
      // Helper function to get field display name
      const getFieldName = (fieldId) => {
        if (names[fieldId]) {
          return names[fieldId];
        }
        // If still not found, return a more user-friendly fallback
        logger.jira.warning(jiraKey, `Field name not found for ${fieldId}, using fallback`, { fieldId });
        return fieldId.replace('customfield_', 'cf[').replace(/(\d+)$/, '$1]');
      };
      
      // Helper function to format custom field value
      const formatCustomFieldValue = (value) => {
        if (value === null || value === undefined || value === '') {
          return 'Not Set';
        }
        if (typeof value === 'object') {
          if (Array.isArray(value)) {
            return value.length > 0 ? value.map(v => v.name || v.value || v).join(', ') : 'Not Set';
          }
          return value.name || value.value || JSON.stringify(value);
        }
        // Check if it's an ISO date string
        if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
          return formatDate(value);
        }
        return String(value);
      };
      
      // Filter all issues to get Features/Initiatives based on main ticket type
      let featuresAndInitiatives = [];
      
      if (mainTicketIssueType === 'X-FEAT' || mainTicketIssueType === 'Capability') {
        // For X-FEAT/Capability: Get Features/Initiatives where "Parent Link" = main ticket
        // Parent Link is customfield_20363
        // First, get all Features/Initiatives from the query results
        const allFeaturesAndInitiatives = issues.filter(issue => {
          const issueType = issue.fields?.issuetype?.name;
          return issueType === 'Feature' || issueType === 'Initiative';
        });
        
        logger.jira.fetch(jiraKey, 'DEBUG_FEATURES', `Found ${allFeaturesAndInitiatives.length} Features/Initiatives in query results`, {
          featureKeys: allFeaturesAndInitiatives.map(f => f.key).join(', ')
        });
        
        // Filter by Parent Link
        featuresAndInitiatives = allFeaturesAndInitiatives.filter(issue => {
          const parentLink = issue.fields?.customfield_20363;
          if (!parentLink) {
            return false;
          }
          // Parent Link can be an object with .key or a string
          const parentKey = parentLink.key || parentLink;
          const matches = parentKey === jiraKey;
          
          if (matches) {
            logger.jira.fetch(jiraKey, 'DEBUG_PARENT_LINK_MATCH', `Feature ${issue.key} has Parent Link = ${jiraKey}`);
          }
          
          return matches;
        });
        
        logger.jira.fetch(jiraKey, 'FILTERED_FEATURES', `Filtered to ${featuresAndInitiatives.length} Features/Initiatives with Parent Link = ${jiraKey}`);
      } else if (mainTicketIssueType === 'Feature' || mainTicketIssueType === 'Initiative') {
        // For Feature/Initiative: Include the main ticket itself and ALL Features/Initiatives from the query
        // This includes direct children and related Features/Initiatives from the comprehensive query
        const allFeaturesAndInitiatives = issues.filter(issue => {
          const issueType = issue.fields?.issuetype?.name;
          return issueType === 'Feature' || issueType === 'Initiative';
        });
        
        // Ensure main ticket is first in the list
        const mainTicketIssue = allFeaturesAndInitiatives.find(issue => issue.key === jiraKey) || 
                                 issues.find(issue => issue.key === jiraKey);
        if (mainTicketIssue) {
          // Remove main ticket from list if it's there, then add it first
          featuresAndInitiatives = allFeaturesAndInitiatives.filter(f => f.key !== jiraKey);
          featuresAndInitiatives.unshift(mainTicketIssue);
        } else {
          featuresAndInitiatives = allFeaturesAndInitiatives;
        }
      }
      
      // Filter all issues to get Epics
      const allEpics = issues.filter(issue => {
        const issueType = issue.fields?.issuetype?.name;
        return issueType === 'Epic';
      });
      
      logger.jira.fetch(jiraKey, 'FILTERED_DATA', `Found ${featuresAndInitiatives.length} Features/Initiatives and ${allEpics.length} Epics from ${issues.length} total issues`, {
        featuresCount: featuresAndInitiatives.length,
        epicsCount: allEpics.length,
        totalIssues: issues.length,
        epicKeys: allEpics.map(e => e.key).join(', ')
      });

      // Build hierarchical structure: Match Epics to their parent Features/Initiatives
      const formattedFeatures = featuresAndInitiatives.map(feature => {
        const fields = feature.fields;
        const featureKey = feature.key;
        
        // Debug: Log Parent Link structure for first few Epics
        if (featureKey === jiraKey && allEpics.length > 0) {
          const sampleEpics = allEpics.slice(0, 3);
          sampleEpics.forEach(epic => {
            const parentLink = epic.fields?.customfield_20363;
            logger.jira.fetch(jiraKey, 'DEBUG_EPIC_PARENT_LINK', `Epic ${epic.key} Parent Link: ${JSON.stringify(parentLink)}`);
          });
        }
        
        // Find Epics that belong to this Feature/Initiative
        // Epics can be linked via:
        // 1. Parent Link (customfield_20363) on Epic pointing to this Feature/Initiative
        // 2. Epic Link field on Feature (we can't check this directly, so we use heuristics)
        const childEpics = allEpics.filter(epic => {
          const parentLink = epic.fields?.customfield_20363;
          
          // If Epic has Parent Link pointing to this Feature/Initiative, include it
          if (parentLink) {
            // Parent Link can be an object with .key or a string
            const parentKey = parentLink.key || parentLink;
            if (parentKey === featureKey) {
              return true;
            }
          }
          
          // Special case: If this is the main ticket (Feature/Initiative)
          // Since all Epics were fetched via the comprehensive query for the main ticket,
          // they are all related. Include ALL Epics except those with Parent Link pointing to another Feature/Initiative
          if (featureKey === jiraKey) {
            if (!parentLink) {
              // No Parent Link - include it (likely linked via Epic Link field)
              return true;
            } else {
              // Check if Parent Link points to another Feature/Initiative in our list
              const parentKey = parentLink.key || parentLink;
              // Only exclude if Parent Link points to another Feature/Initiative (not the main ticket)
              const pointsToAnotherFeature = featuresAndInitiatives.some(f => 
                f.key === parentKey && f.key !== jiraKey
              );
              if (!pointsToAnotherFeature) {
                // Epic's parent is not another Feature/Initiative in our list, so include it
                return true;
              }
            }
          }
          
          return false;
        }).map(epic => {
          const epicFields = epic.fields;
          return {
            key: epic.key,
            summary: epicFields.summary || 'N/A',
            status: epicFields.status?.name || 'N/A',
            issueType: epicFields.issuetype?.name || 'Epic',
            resolution: epicFields.resolution?.name || 'N/A',
            assignee: epicFields.assignee?.displayName || epicFields.assignee?.name || 'N/A',
            customfield_10860: {
              name: getFieldName('customfield_10860'),
              value: formatCustomFieldValue(epicFields.customfield_10860)
            },
            duedate: epicFields.duedate ? (formatDate(epicFields.duedate) || epicFields.duedate) : 'Not Set',
            fixVersions: epicFields.fixVersions && epicFields.fixVersions.length > 0 
              ? epicFields.fixVersions.map(v => v.name).join(', ') 
              : 'N/A'
          };
        });
        
        logger.jira.fetch(jiraKey, 'MATCHED_EPICS', `Matched ${childEpics.length} Epics to ${featureKey}`, {
          featureKey,
          epicCount: childEpics.length
        });
        
        return {
          key: featureKey,
          summary: fields.summary || 'N/A',
          status: fields.status?.name || 'N/A',
          issueType: fields.issuetype?.name || 'Feature',
          resolution: fields.resolution?.name || 'N/A',
          assignee: fields.assignee?.displayName || fields.assignee?.name || 'N/A',
          customfield_10860: {
            name: getFieldName('customfield_10860'),
            value: formatCustomFieldValue(fields.customfield_10860)
          },
          duedate: fields.duedate ? (formatDate(fields.duedate) || fields.duedate) : 'Not Set',
          fixVersions: fields.fixVersions && fields.fixVersions.length > 0 
            ? fields.fixVersions.map(v => v.name).join(', ') 
            : 'N/A',
          childEpics: childEpics
        };
      });

      logger.jira.epics(jiraKey, formattedFeatures.length, issues.length);

      // Calculate issue breakdown statistics from already-fetched issues
      // Filter out Feature, Epic, Initiative, X-FEAT, Capability for breakdown
      const breakdownIssues = issues.filter(issue => {
        const issueType = issue.fields?.issuetype?.name;
        return !['Feature', 'Epic', 'Initiative', 'X-FEAT', 'Capability'].includes(issueType);
      });
      
      logger.jira.fetch(jiraKey, 'FETCH_BREAKDOWN_ISSUES', `Fetched ${breakdownIssues.length} issues for breakdown statistics from ${issues.length} total issues`);
      
      // Note: Exclusions are now handled at JQL level, no need for additional filtering

      // Group by type and status
      const breakdown = {};
      let totalFiltered = 0;

      breakdownIssues.forEach(issue => {
        const issueType = issue.fields?.issuetype?.name || 'Unknown';
        const status = issue.fields?.status?.name || 'Unknown';

        // All types are now included (exclusions handled at JQL level)
        if (true) {
          totalFiltered++;
          
          if (!breakdown[issueType]) {
            breakdown[issueType] = {
              total: 0,
              statuses: {}
            };
          }
          
          breakdown[issueType].total++;
          if (!breakdown[issueType].statuses[status]) {
            breakdown[issueType].statuses[status] = 0;
          }
          breakdown[issueType].statuses[status]++;
        }
      });

      // Categorize statuses for completion level
      const categorizeStatus = (status) => {
        // Use exact status matching for known JIRA statuses (consistent with other function)
        switch (status) {
          // Done - Truly completed work
          case 'Done':
          case 'Closed':
            return 'Done';

          // To Be Verified - Work completed but pending verification
          case 'Resolved':
            return 'To Be Verified';

          // In Progress - Active development/review work
          case 'In Progress':
          case 'Development':
          case 'Code Review':
          case 'In Review':
          case 'Testing':
          case 'QA':
          case 'UAT':
          case 'Pending Merge':
            return 'In Progress';

          // To Do - Work not yet started
          case 'To Do':
          case 'Open':
          case 'Backlog':
          case 'New':
          case 'Ready':
          case 'Ready for Development':
          case 'Selected for Development':
            return 'To Do';

          // Blocked - Work that is blocked or needs information
          case 'Blocked':
          case 'On Hold':
          case 'Need Info':
          case 'Needs Info':
          case 'Waiting':
          case 'Waiting for Information':
          case 'Pending':
            return 'Blocked';

          // Everything else
          default:
            return 'Other';
        }
      };


      // Format the breakdown with status categories
      const formattedBreakdown = Object.entries(breakdown).map(([type, data]) => {
        const statusCategories = {
          'Done': {},
          'To Be Verified': {},
          'In Progress': {},
          'To Do': {},
          'Blocked': {},
          'Other': {}
        };
        
        Object.entries(data.statuses).forEach(([status, count]) => {
          const category = categorizeStatus(status);
          statusCategories[category][status] = count;
        });
        
        return {
          type,
          total: data.total,
          statusCategories
        };
      }).sort((a, b) => b.total - a.total);

      // Calculate overall completion statistics
      let totalDone = 0;
      let totalToBeVerified = 0;
      let totalInProgress = 0;
      let totalToDo = 0;
      let totalBlocked = 0;
      let totalOther = 0;

      formattedBreakdown.forEach(({ statusCategories }) => {
        Object.values(statusCategories['Done']).forEach(count => totalDone += count);
        Object.values(statusCategories['To Be Verified']).forEach(count => totalToBeVerified += count);
        Object.values(statusCategories['In Progress']).forEach(count => totalInProgress += count);
        Object.values(statusCategories['To Do']).forEach(count => totalToDo += count);
        Object.values(statusCategories['Blocked']).forEach(count => totalBlocked += count);
        Object.values(statusCategories['Other']).forEach(count => totalOther += count);
      });

      const overallStats = {
        done: totalDone,
        toBeVerified: totalToBeVerified,
        inProgress: totalInProgress,
        toDo: totalToDo,
        blocked: totalBlocked,
        other: totalOther,
        completionRate: totalFiltered > 0 ? ((totalDone / totalFiltered) * 100).toFixed(1) : '0.0'
      };
      
      logger.jira.issueBreakdown(jiraKey, totalFiltered, formattedBreakdown, overallStats);

      res.json({
        success: true,
        epics: formattedFeatures, // Return Features/Initiatives with their Epics
        count: formattedFeatures.length,
        // Also return breakdown statistics
        issueBreakdown: {
          total: totalFiltered,
          breakdown: formattedBreakdown,
          overallStats: overallStats
        }
      });

    } catch (error) {
      console.error('Error fetching epics from JIRA:', error.message);
      if (error.response) {
        console.error('JIRA API Error Response:', error.response.status, error.response.data);
        return res.status(upstreamStatus(error.response.status)).json({
          error: `Failed to fetch epics: ${error.response.data.errorMessages?.join(', ') || error.response.statusText}`
        });
      }
      throw error;
    }

  } catch (error) {
    console.error('Error in /api/jira/fetch-all-jira-tickets:', error);
    res.status(500).json({
      error: 'Failed to fetch epic information',
      message: error.message
    });
  }
});

// Legacy endpoint: fetch-epics (backward compatibility)
// Extract handler from fetch-all-jira-tickets route after it's registered
// We use setImmediate to ensure the route is registered first
let fetchAllJiraTicketsHandler = null;
setImmediate(() => {
  const route = router.stack.find(layer => 
    layer.route?.path === '/fetch-all-jira-tickets' && 
    layer.route?.methods?.post
  );
  if (route && route.route && route.route.stack && route.route.stack[0]) {
    fetchAllJiraTicketsHandler = route.route.stack[0].handle;
  }
});

// Register legacy endpoint - will use handler once it's available
router.post('/fetch-epics', validateJiraTokenMiddleware, async (req, res) => {
  if (fetchAllJiraTicketsHandler) {
    return fetchAllJiraTicketsHandler(req, res);
  }
  // If handler not found yet, try to find it dynamically
  const route = router.stack.find(layer => 
    layer.route?.path === '/fetch-all-jira-tickets' && 
    layer.route?.methods?.post
  );
  if (route && route.route && route.route.stack && route.route.stack[0]) {
    return route.route.stack[0].handle(req, res);
  }
  return res.status(500).json({ 
    error: 'Endpoint temporarily unavailable',
    message: 'Please use /api/jira/fetch-all-jira-tickets instead'
  });
});

/**
 * Fetch a single JIRA ticket with all custom fields
 * POST /api/jira/fetch
 */
router.post('/fetch', apiLimiter, validateJiraTokenMiddleware, async (req, res) => {
  const { jiraKey } = req.body;
  logger.jira.fetch(jiraKey || 'UNKNOWN', 'FETCH_ENDPOINT_CALLED', `Fetch endpoint called`, { body: req.body });
  
  try {

    if (!jiraKey) {
      return res.status(400).json({ error: 'JIRA key is required' });
    }

    // Use validated token from middleware
    const cleanToken = req.jiraToken;

    const baseUrl = JIRA_API_V2.BASE_URL;
    const httpsAgent = createHttpsAgent();
    
    // JIRA uses PAT (Personal Access Token) with Bearer authentication
    // Use only API v2 direct issue endpoint
    const apiUrl = `${baseUrl}/rest/api/2/issue/${jiraKey}`;
    
    logger.jira.fetch(jiraKey, 'FETCH_TICKET', `Fetching JIRA ticket using API v2`, { apiUrl, tokenLength: cleanToken.length });
    
    try {
      // For API v2, use expand=names to get custom field display names
      const response = await axios.get(apiUrl, {
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 30000,
        params: {
          fields: 'key,summary,status,issuetype,fixVersions,labels,reporter,assignee,watchers,customfield_11067,customfield_11068,customfield_13861,customfield_23073,customfield_35863,customfield_35864,customfield_45660,customfield_23560,customfield_14463,customfield_31460,customfield_14464,customfield_14465,customfield_11260,customfield_10860,customfield_11960,customfield_27764,customfield_38460',
          expand: 'names'
        }
      });

      const issue = response.data;
      const fields = issue.fields;
      // Get field names from the names object in the response
      let names = response.data.names || {};
      
      logger.jira.fetch(jiraKey, 'FETCH_TICKET_SUCCESS', `Successfully fetched JIRA ticket using API v2`);
      const sampleFields = Object.entries(names).slice(0, 5).map(([k, v]) => `${k}: ${v}`);
      logger.jira.fieldNames(jiraKey, Object.keys(names).length, sampleFields);
      
      // Always try to fetch field metadata to ensure we have all field names
      // This is especially important for custom fields that might not be in expand=names
      // If names object is empty, log a warning
      if (Object.keys(names).length === 0) {
        logger.jira.warning(jiraKey, 'Names object is empty, attempting to fetch field metadata...');
      }
      
      try {
        const fieldMetadataUrl = JIRA_API_V2.FIELD;
        const fieldResponse = await axios.get(fieldMetadataUrl, {
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          httpsAgent: httpsAgent,
          timeout: 15000
        });
        
        // Create a map of field ID to field name
        if (Array.isArray(fieldResponse.data)) {
          let fieldsAdded = 0;
          fieldResponse.data.forEach(field => {
            if (field.id && field.name) {
              // Only add if not already present (don't overwrite existing names)
              if (!names[field.id]) {
                names[field.id] = field.name;
                fieldsAdded++;
              }
            }
          });
          // Log the specific custom fields we're looking for
          const customFieldsToCheck = ['customfield_35863', 'customfield_35864', 'customfield_45660'];
          const customFieldsStatus = customFieldsToCheck.map(cf => ({
            fieldId: cf,
            found: !!names[cf],
            name: names[cf] || null
          }));
          logger.jira.fieldMetadata(jiraKey, fieldsAdded, Object.keys(names).length, customFieldsStatus);
        }
      } catch (fieldError) {
        console.warn('Could not fetch field metadata:', fieldError.message);
      }
      
      // Validate issue type
      const issueType = fields?.issuetype?.name;
      const allowedTypes = ['Feature', 'Initiative', 'X-FEAT', 'Capability'];
      
      logger.jira.fetch(jiraKey, 'VALIDATE_ISSUE_TYPE', `JIRA fetch - issueType: ${issueType}`, { issueType });
      
      if (!allowedTypes.includes(issueType)) {
        return res.status(400).json({
          error: `Invalid JIRA issue type. Expected one of: ${allowedTypes.join(', ')}, but got: ${issueType || 'Unknown'}`,
          issueType: issueType,
          jiraKey: jiraKey,
          summary: fields?.summary
        });
      }

      // Get display names for custom fields
      const getFieldName = (fieldId) => {
        // Check if we have the field name in the names object
        if (names[fieldId]) {
          return names[fieldId];
        }
        // If not found, try to get from schema if available
        if (response.data.schema && response.data.schema[fieldId]) {
          return response.data.schema[fieldId].name || fieldId;
        }
        // Fallback to field ID if name not available
        logger.jira.warning(jiraKey, `Field name not found for ${fieldId}, using ID`, { fieldId });
        return fieldId;
      };

      // Extract custom field values
      const customFields = {
        'customfield_11067': fields.customfield_11067,
        'customfield_11068': fields.customfield_11068,
        'customfield_13861': fields.customfield_13861,
        'customfield_23073': fields.customfield_23073,
        'customfield_35863': fields.customfield_35863,
        'customfield_35864': fields.customfield_35864,
        'customfield_45660': fields.customfield_45660,
        'customfield_23560': fields.customfield_23560,
        'customfield_14463': fields.customfield_14463,
        'customfield_31460': fields.customfield_31460,
        'customfield_14464': fields.customfield_14464,
        'customfield_14465': fields.customfield_14465,
        'customfield_38460': fields?.customfield_38460 || null,
        'customfield_11260': fields.customfield_11260  // QA Contact
      };

      // Format custom field values
      const formatCustomFieldValue = (value) => {
        if (value === null || value === undefined || value === '') return 'Not Set';
        
        // Handle date strings (ISO format like 2025-12-30T17:56:20.477+0000 or YYYY-MM-DD)
        if (typeof value === 'string') {
          // If it's 'N/A' or 'NA', return 'Not Set' for date fields
          if (value === 'N/A' || value === 'NA' || value.trim() === '') {
            return 'Not Set';
          }
          // Check if it's a date string (ISO with time or date-only)
          const isoDateRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/;
          if (isoDateRegex.test(value)) {
            const formatted = formatDate(value);
            if (formatted) {
              return formatted;
            }
          }
        }
        
        if (typeof value === 'object') {
          if (value.type === 'doc' && Array.isArray(value.content)) {
            return adfToHtml(value);
          }
          if (Array.isArray(value)) {
            return value.map(v => {
              // Check if array element is a date string
              if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(v)) {
                const formatted = formatDate(v);
                if (formatted) {
                  return formatted;
                }
              }
              return v.name || v.value || v;
            }).join(', ');
          }
          // Check if object has a date value
          if (value.value && typeof value.value === 'string' && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value.value)) {
            const formatted = formatDate(value.value);
            if (formatted) {
              return formatted;
            }
          }
          return value.name || value.value || JSON.stringify(value);
        }
        return String(value);
      };

      // Helper function to format link/text custom fields (14463, 14464, 14465)
      const formatLinkField = (value) => {
        if (value === null || value === undefined || value === '') {
          return { type: 'notSet', display: 'Not Set' };
        }
        
        const strValue = String(value).trim();
        
        // Check if it's a URL (starts with http:// or https://)
        if (/^https?:\/\//i.test(strValue)) {
          return { type: 'link', display: 'Link', url: strValue };
        }
        
        // If it's empty or just whitespace, return Not Set
        if (strValue === '') {
          return { type: 'notSet', display: 'Not Set' };
        }
        
        // If it's N/A or NA, return as text (don't highlight)
        if (strValue === 'N/A' || strValue === 'NA' || strValue.toLowerCase() === 'na') {
          return { type: 'text', display: strValue };
        }
        
        // Otherwise, return as text
        return { type: 'text', display: strValue };
      };

      const result = {
        key: issue.key,
        summary: fields.summary || 'N/A',
        status: fields.status?.name || 'N/A',
        issueType: issueType || 'N/A',
        fixVersions: fields.fixVersions?.map(v => v.name).join(', ') || 'N/A',
        labels: fields.labels?.join(', ') || 'N/A',
        // User fields for email CC
        reporter: fields.reporter || null,
        assignee: fields.assignee || null,
        watchers: fields.watchers || null,
        customfield_11260: fields.customfield_11260 || null, // PM Owner
        customfield_10860: fields.customfield_10860 || null, // QA Contact
        customfield_11960: fields.customfield_11960 || null, // Participants
        customfield_27764: fields.customfield_27764 || null, // Program Mgr
        customfield_11067: {
          name: getFieldName('customfield_11067'),
          value: formatCustomFieldValue(customFields.customfield_11067)
        },
        customfield_11068: {
          name: getFieldName('customfield_11068'),
          value: formatCustomFieldValue(customFields.customfield_11068)
        },
        customfield_13861: {
          name: getFieldName('customfield_13861'),
          value: formatCustomFieldValue(customFields.customfield_13861)
        },
        customfield_23073: {
          name: getFieldName('customfield_23073'),
          value: formatCustomFieldValue(customFields.customfield_23073)
        },
        customfield_35863: {
          name: getFieldName('customfield_35863'),
          value: formatCustomFieldValue(customFields.customfield_35863)
        },
        customfield_35864: {
          name: getFieldName('customfield_35864'),
          value: formatCustomFieldValue(customFields.customfield_35864)
        },
        customfield_45660: {
          name: getFieldName('customfield_45660'),
          value: formatCustomFieldValue(customFields.customfield_45660)
        },
        customfield_23560: {
          name: getFieldName('customfield_23560'),
          value: formatCustomFieldValue(customFields.customfield_23560),
          // Risk Indicator color mapping - handles format like "Green - On Track"
          color: (() => {
            const value = customFields.customfield_23560;
            if (!value || value === null || value === undefined) return null;
            
            // Handle object format: { value: "Green - On Track", ... }
            const valueStr = typeof value === 'object' && value.value ? String(value.value) : String(value);
            const valueLower = valueStr.toLowerCase();
            
            // Check the first part (before dash) for color indicators
            // Format: "Green - On Track", "Yellow - At Risk", "Red - Critical"
            const firstPart = valueStr.split('-')[0].trim().toLowerCase();
            
            // Check for red/high risk indicators
            if (firstPart.includes('red') || valueLower.includes('red') || valueLower.includes('high') || valueLower.includes('critical')) {
              return '#dc3545'; // Red
            }
            // Check for yellow/medium risk indicators
            if (firstPart.includes('yellow') || valueLower.includes('yellow') || valueLower.includes('medium') || valueLower.includes('moderate') || valueLower.includes('at risk')) {
              return '#ffc107'; // Yellow
            }
            // Check for green/low risk indicators
            if (firstPart.includes('green') || valueLower.includes('green') || valueLower.includes('low') || valueLower.includes('minimal') || valueLower.includes('on track')) {
              return '#28a745'; // Green
            }
            return null;
          })()
        },
        customfield_14463: {
          name: getFieldName('customfield_14463'),
          value: formatLinkField(customFields.customfield_14463)
        },
        customfield_31460: {
          name: getFieldName('customfield_31460'),
          value: formatLinkField(customFields.customfield_31460)
        },
        customfield_14464: {
          name: getFieldName('customfield_14464'),
          value: formatLinkField(customFields.customfield_14464)
        },
        customfield_14465: {
          name: getFieldName('customfield_14465'),
          value: formatLinkField(customFields.customfield_14465)
        },
        customfield_38460: {
          name: getFieldName('customfield_38460'),
          value: formatCustomFieldValue(customFields.customfield_38460)
        }
      };

      logger.jira.fetch(jiraKey, 'FETCH_TICKET_COMPLETE', `Fetched JIRA ticket successfully`);

      return res.json({
        success: true,
        data: result
      });

    } catch (error) {
      console.error('Error fetching JIRA ticket:', error.message);
      console.error('Error details:', {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        url: apiUrl
      });
      
      if (error.response?.status === 400) {
        const errorMessages = error.response?.data?.errorMessages || [];
        const warnings = error.response?.data?.warningMessages || [];
        return res.status(400).json({
          error: `JIRA request error: ${errorMessages.join(', ') || error.message}`,
          warnings: warnings,
          message: 'Please check the JIRA key format and fields requested'
        });
      } else if (error.response?.status === 404) {
        return res.status(404).json({
          error: `JIRA ticket ${jiraKey} not found`,
          message: 'The ticket may not exist, or you may not have permission to view it'
        });
      } else if (error.response?.status === 401 || error.response?.status === 403) {
        return res.status(401).json({
          error: 'JIRA authentication failed',
          message: 'Please check your JIRA token'
        });
      }
      
      // Network errors or other issues
      const errorMessage = error.response?.data?.errorMessages?.join(', ') || 
                          error.response?.data?.message ||
                          error.message ||
                          'Unknown error';
      
      return res.status(upstreamStatus(error.response?.status || 500)).json({
        error: 'Failed to fetch JIRA ticket',
        message: errorMessage,
        details: error.response?.data || { message: error.message }
      });
    }
  } catch (error) {
    console.error('Error in JIRA fetch endpoint:', error);
    return res.status(500).json({
      error: 'Failed to fetch JIRA ticket',
      message: error.message
    });
  }
});

/**
 * Fetch open release versions for the selected team's JIRA project.
 * Team must have projectKey in teamBoardConfig (e.g. NDB -> ERA).
 * POST /api/jira/release-versions  body: { teamId }
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
router.get(/^\/sprints\/?$/, (req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'Use POST with body { teamId }. GET is not supported.'
  });
});

/**
 * List sprints for a team's board (for Sprint Report tab).
 * POST /api/jira/sprints  body: { teamId }
 * Returns { success: true, sprints: [ { id, name, state, startDate, endDate, completeDate } ] }
 * Also matches POST /api/jira/sprints/ (trailing slash) to avoid 404 from proxies.
 */
router.post(/^\/sprints\/?$/, releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  try {
    const { teamId, state } = req.body || {};
    const teams = teamBoardConfig.teams || [];
    const effectiveTeamId = teamId || teamBoardConfig.defaultTeamId;
    const team = teams.find(t => t.id === effectiveTeamId) || teams[0];
    const boardId = team ? team.boardId : null;

    if (!boardId) {
      return res.status(400).json({
        success: false,
        error: 'Team has no board configured',
        message: 'Select a team with a boardId in teamBoardConfig.json.'
      });
    }

    const httpsAgent = createHttpsAgent();
    const cleanToken = req.jiraToken;

    const sprintMap = await getSprintsForBoard(boardId, cleanToken, httpsAgent, state);
    const sprints = Array.from(sprintMap.entries()).map(([id, info]) => ({
      id,
      name: info.name,
      state: info.state,
      startDate: info.startDate || null,
      endDate: info.endDate || null,
      completeDate: info.completeDate || null
    })).sort((a, b) => {
      const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0;
      const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0;
      return bEnd - aEnd;
    });

    return res.json({ success: true, sprints });
  } catch (error) {
    console.error('Error in /api/jira/sprints:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch sprints',
      message: error.message
    });
  }
});

/**
 * List Jira project components (Component field) for a team's project.
 * GET /api/jira/project-components?teamId=ndb
 * Returns { success: true, components: [ { id, name } ] }
 */
router.get('/project-components', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  try {
    const teamId = req.query.teamId || teamBoardConfig.defaultTeamId;
    const teams = teamBoardConfig.teams || [];
    const team = teams.find(t => t.id === teamId) || teams[0];
    const projectKey = team ? team.projectKey : null;
    if (!projectKey) {
      return res.status(400).json({
        success: false,
        error: 'Team has no project key',
        message: 'Set projectKey for this team in teamBoardConfig.json.'
      });
    }
    const httpsAgent = createHttpsAgent();
    const cleanToken = req.jiraToken;
    const projectUrl = JIRA_API_V2.PROJECT ? JIRA_API_V2.PROJECT(projectKey) : `${JIRA_API_V2.BASE_URL}/rest/api/2/project/${projectKey}`;
    const response = await retryJiraCall(() => axios.get(projectUrl, {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      httpsAgent,
      timeout: 15000
    }));
    const components = (response.data && response.data.components) || [];
    const list = components.map(c => ({ id: c.id, name: c.name || '' })).filter(c => c.name !== undefined);
    return res.json({ success: true, components: list });
  } catch (error) {
    console.error('Error in /api/jira/project-components:', error);
    return res.status(error.response?.status === 404 ? 404 : 500).json({
      success: false,
      error: 'Failed to fetch project components',
      message: error.response?.data?.errorMessages?.[0] || error.message
    });
  }
});

/**
 * Build JQL for issues in a sprint, scoped by team sprintBaseFilter (project scope only; no statusCategory exclusion).
 * options.componentNames: optional string[] — when provided, appends AND component in ("A", "B").
 */


/**
 * Single sprint report with Scrum Master metrics.
 * POST /api/jira/sprint-report  body: { teamId, sprintId }
 * Returns metrics + issues list. Changelog is fetched for "added after start"; "removed" may be 0 (see docs).
 */
router.post('/sprint-report', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);

  try {
    const { teamId, sprintId } = req.body || {};
    if (!sprintId) {
      return res.status(400).json({ success: false, error: 'sprintId is required' });
    }

    const teams = teamBoardConfig.teams || [];
    const effectiveTeamId = teamId || teamBoardConfig.defaultTeamId;
    const team = teams.find(t => t.id === effectiveTeamId) || teams[0];
    const boardId = team ? team.boardId : null;
    if (boardId == null) {
      return res.status(400).json({
        success: false,
        error: 'Team has no board configured',
        message: 'Select a team with a boardId in teamBoardConfig.json.'
      });
    }
    const baseUrl = JIRA_API_V2.BASE_URL;
    const httpsAgent = createHttpsAgent();
    const cleanToken = req.jiraToken;
    const sprintFieldId = teamBoardConfig.sprintFieldId || 'customfield_10360';

    const sprintMap = await getSprintsForBoard(boardId, cleanToken, httpsAgent);
    const sprintInfo = sprintMap.get(Number(sprintId));
    if (!sprintInfo) {
      return res.status(400).json({
        success: false,
        error: 'Sprint not found',
        message: `Sprint ${sprintId} not found for this board.`
      });
    }

    const sprintStartDate = sprintInfo.startDate || null;
    const sprintEndDate = sprintInfo.endDate || sprintInfo.completeDate || null;

    const jql = buildSprintReportJql(sprintId, effectiveTeamId);
    const storyPointsFieldId = teamBoardConfig.storyPointsFieldId || null;
    const fieldsList = 'key,summary,status,resolution,resolutiondate,issuetype,priority,assignee,' + sprintFieldId + (storyPointsFieldId ? ',' + storyPointsFieldId : '');

    let allIssues = [];
    let startAt = 0;
    const maxResults = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
        headers: {
          Authorization: `Bearer ${cleanToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json'
        },
        httpsAgent,
        timeout: 30000,
        params: { jql, fields: fieldsList, maxResults, startAt }
      }));

      const issues = response.data?.issues || [];
      const total = response.data?.total ?? 0;
      allIssues = allIssues.concat(issues);
      startAt = allIssues.length;
      hasMore = allIssues.length < total && issues.length === maxResults;
      if (hasMore) await new Promise(r => setTimeout(r, 200));
    }

    const totalInSprint = allIssues.length;
    let addedAfterStart = 0;
    let open = 0;
    let inProgress = 0;
    let pendingQA = 0;
    let completedInSprint = 0;

    const issuesWithClassification = allIssues.map(issue => {
      const classification = classifySprintIssue(issue);
      if (classification === 'open') open++;
      else if (classification === 'inProgress') inProgress++;
      else if (classification === 'pendingQA') pendingQA++;
      else completedInSprint++;

      let storyPoints = 0;
      if (storyPointsFieldId && issue.fields && issue.fields[storyPointsFieldId] != null) {
        const raw = issue.fields[storyPointsFieldId];
        if (typeof raw === 'number' && !Number.isNaN(raw)) storyPoints = raw;
        else if (raw && typeof raw === 'object' && typeof raw.value === 'number' && !Number.isNaN(raw.value)) storyPoints = raw.value;
      }

      return {
        key: issue.key,
        summary: issue.fields?.summary || '',
        status: issue.fields?.status?.name || '',
        resolution: issue.fields?.resolution?.name || null,
        issuetype: issue.fields?.issuetype?.name || '',
        priority: issue.fields?.priority?.name || '',
        assignee: issue.fields?.assignee?.displayName || null,
        classification,
        storyPoints
      };
    });

    const addedAfterStartJql = `issueFunction in addedAfterSprintStart("${boardId}", "${sprintInfo.name}")`;
    const removedFromSprintJql = `issueFunction in removedAfterSprintStart("${boardId}", "${sprintInfo.name}")`;
    let removedFromSprint = 0;
    try {
      const [addedRes, removedRes] = await Promise.all([
        retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
          headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          httpsAgent,
          timeout: 6000, // Reduced from 30s to 6s
          params: { jql: addedAfterStartJql, fields: 'key', maxResults: 1, startAt: 0 }
        })),
        retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
          headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          httpsAgent,
          timeout: 6000, // Reduced from 30s to 6s
          params: { jql: removedFromSprintJql, fields: 'key', maxResults: 1, startAt: 0 }
        }))
      ]);
      addedAfterStart = addedRes.data?.total ?? 0;
      removedFromSprint = removedRes.data?.total ?? 0;
    } catch (e) {
      // leave addedAfterStart and removedFromSprint as 0 on error
    }

    const completionRate = totalInSprint > 0 ? Math.round((completedInSprint / totalInSprint) * 100) : 0;
    const pendingQARate = totalInSprint > 0 ? Math.round((pendingQA / totalInSprint) * 100) : 0;
    const carryoverRate = totalInSprint > 0 ? Math.round(((pendingQA + inProgress) / totalInSprint) * 100) : 0;
    const plannedIssues = totalInSprint - addedAfterStart;
    const scopeCreepRate = plannedIssues > 0 ? Math.round((addedAfterStart / plannedIssues) * 100) : 0;

    const byStatus = {};
    for (const iss of issuesWithClassification) {
      const s = iss.status || 'Unknown';
      byStatus[s] = (byStatus[s] || 0) + 1;
    }

    const pendingQAStatusName = teamBoardConfig.pendingQAStatusName || 'Resolved';
    const jqlByMetric = {
      totalInSprint: jql,
      addedAfterStart: addedAfterStartJql,
      removedFromSprint: removedFromSprintJql,
      open: `(${jql}) AND statusCategory = To Do`,
      inProgress: `(${jql}) AND statusCategory = "In Progress"`,
      pendingQA: `(${jql}) AND status = "${pendingQAStatusName}"`,
      completedInSprint: `issueFunction in completeInSprint("${boardId}", "${sprintInfo.name}")`
    };

    return res.json({
      success: true,
      jql,
      jqlByMetric,
      jiraBaseUrl: JIRA_API_V2.BASE_URL,
      storyPointsFieldId: storyPointsFieldId || null,
      sprint: {
        id: Number(sprintId),
        name: sprintInfo.name,
        state: sprintInfo.state,
        startDate: sprintStartDate,
        endDate: sprintEndDate
      },
      metrics: {
        totalInSprint,
        addedAfterStart,
        removedFromSprint,
        open,
        inProgress,
        pendingQA,
        completedInSprint,
        completionRate,
        pendingQARate,
        carryoverRate,
        scopeCreepRate
      },
      byStatus,
      issues: issuesWithClassification,
      note: removedFromSprint === 0 ? 'Removed-from-sprint count requires issues no longer in sprint; currently reported as 0. See docs for limitation.' : undefined
    });
  } catch (error) {
    console.error('Error in /api/jira/sprint-report:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to build sprint report',
      message: error.message
    });
  }
});

const SPRINT_REPORT_BY_RANGE_MAX_SPRINTS = 20;
const SPRINT_REPORT_BY_RANGE_MAX_DAYS = 365 * 2; // 2 years

/**
 * Past sprint report by date range: find closed sprints overlapping [startDate, endDate], run sprint report for each.
 * POST /api/jira/sprint-report-by-range  body: { teamId, startDate, endDate, componentNames?: string[] }
 * Returns { success, sprints, reports, jiraBaseUrl, aggregatedIssues }.
 */
router.post('/sprint-report-by-range', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);

  try {
    const { teamId, startDate, endDate, componentNames } = req.body || {};
    if (!startDate || !endDate) {
      return res.status(400).json({ success: false, error: 'startDate and endDate are required (ISO date strings).' });
    }
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
      return res.status(400).json({ success: false, error: 'Invalid startDate or endDate.' });
    }
    if (start.getTime() > end.getTime()) {
      return res.status(400).json({ success: false, error: 'startDate must be before or equal to endDate.' });
    }
    const daysDiff = Math.round((end - start) / (24 * 60 * 60 * 1000));
    if (daysDiff > SPRINT_REPORT_BY_RANGE_MAX_DAYS) {
      return res.status(400).json({
        success: false,
        error: `Date range must not exceed ${SPRINT_REPORT_BY_RANGE_MAX_DAYS / 365} years.`
      });
    }

    const teams = teamBoardConfig.teams || [];
    const effectiveTeamId = teamId || teamBoardConfig.defaultTeamId;
    const team = teams.find(t => t.id === effectiveTeamId) || teams[0];
    const boardId = team ? team.boardId : null;
    if (boardId == null) {
      return res.status(400).json({
        success: false,
        error: 'Team has no board configured',
        message: 'Select a team with a boardId in teamBoardConfig.json.'
      });
    }
    const httpsAgent = createHttpsAgent();
    const cleanToken = req.jiraToken;
    const sprintFieldId = teamBoardConfig.sprintFieldId || 'customfield_10360';
    const storyPointsFieldId = teamBoardConfig.storyPointsFieldId || null;
    const fieldsList = 'key,summary,status,resolution,resolutiondate,issuetype,priority,assignee,components,created,' + sprintFieldId + (storyPointsFieldId ? ',' + storyPointsFieldId : '');
    const compNames = (Array.isArray(componentNames) ? componentNames.filter(Boolean) : []).slice(0, 5);

    const sprintMap = await getSprintsForBoard(boardId, cleanToken, httpsAgent, 'closed');
    const rangeStart = start.getTime();
    const rangeEnd = end.getTime();
    const overlapping = Array.from(sprintMap.entries())
      .filter(([, info]) => {
        const sStart = info.startDate ? new Date(info.startDate).getTime() : 0;
        const sEnd = (info.endDate || info.completeDate) ? new Date(info.endDate || info.completeDate).getTime() : 0;
        return sEnd >= rangeStart && sStart <= rangeEnd;
      })
      .map(([id, info]) => ({ id, ...info }))
      .sort((a, b) => {
        const aEnd = (a.endDate || a.completeDate) ? new Date(a.endDate || a.completeDate).getTime() : 0;
        const bEnd = (b.endDate || b.completeDate) ? new Date(b.endDate || b.completeDate).getTime() : 0;
        return aEnd - bEnd;
      })
      .slice(0, SPRINT_REPORT_BY_RANGE_MAX_SPRINTS);

    const reports = [];
    const aggregatedIssues = [];

    for (const sprintInfo of overlapping) {
      const sprintId = sprintInfo.id;
      const jql = buildSprintReportJql(sprintId, effectiveTeamId, { componentNames: compNames });
      let allIssues = [];
      let startAt = 0;
      const maxResults = 100;
      let hasMore = true;
      while (hasMore) {
        const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
          headers: {
            Authorization: `Bearer ${cleanToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          httpsAgent,
          timeout: 6000, // Reduced from 30s to 6s
          params: { jql, fields: fieldsList, maxResults, startAt }
        }));
        const issues = response.data?.issues || [];
        const total = response.data?.total ?? 0;
        allIssues = allIssues.concat(issues);
        startAt = allIssues.length;
        hasMore = allIssues.length < total && issues.length === maxResults;
        if (hasMore) await new Promise(r => setTimeout(r, 200));
      }

      let open = 0;
      let inProgress = 0;
      let pendingQA = 0;
      let completedInSprint = 0;
      const issuesWithClassification = allIssues.map(issue => {
        const classification = classifySprintIssue(issue);
        if (classification === 'open') open++;
        else if (classification === 'inProgress') inProgress++;
        else if (classification === 'pendingQA') pendingQA++;
        else completedInSprint++;

        let storyPoints = 0;
        if (storyPointsFieldId && issue.fields && issue.fields[storyPointsFieldId] != null) {
          const raw = issue.fields[storyPointsFieldId];
          if (typeof raw === 'number' && !Number.isNaN(raw)) storyPoints = raw;
          else if (raw && typeof raw === 'object' && typeof raw.value === 'number' && !Number.isNaN(raw.value)) storyPoints = raw.value;
        }
        const compList = issue.fields?.components || [];
        const componentNamesList = compList.map(c => c.name).filter(Boolean);
        return {
          key: issue.key,
          summary: issue.fields?.summary || '',
          status: issue.fields?.status?.name || '',
          resolution: issue.fields?.resolution?.name || null,
          issuetype: issue.fields?.issuetype?.name || '',
          priority: issue.fields?.priority?.name || '',
          assignee: issue.fields?.assignee?.displayName || null,
          classification,
          storyPoints,
          sprintId,
          sprintName: sprintInfo.name,
          components: componentNamesList,
          created: issue.fields?.created || null,
          resolutiondate: issue.fields?.resolutiondate || null
        };
      });

      const totalInSprint = allIssues.length;
      const addedAfterStartJql = `issueFunction in addedAfterSprintStart("${boardId}", "${(sprintInfo.name || '').replace(/"/g, '\\"')}")`;
      const removedFromSprintJql = `issueFunction in removedAfterSprintStart("${boardId}", "${(sprintInfo.name || '').replace(/"/g, '\\"')}")`;
      let addedAfterStart = 0;
      let removedFromSprint = 0;
      try {
        const [addedRes, removedRes] = await Promise.all([
          retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
            headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            httpsAgent,
            timeout: 6000, // Reduced from 30s to 6s
            params: { jql: addedAfterStartJql, fields: 'key', maxResults: 1, startAt: 0 }
          })),
          retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
            headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            httpsAgent,
            timeout: 6000, // Reduced from 30s to 6s
            params: { jql: removedFromSprintJql, fields: 'key', maxResults: 1, startAt: 0 }
          }))
        ]);
        addedAfterStart = addedRes.data?.total ?? 0;
        removedFromSprint = removedRes.data?.total ?? 0;
      } catch (e) {
        // leave as 0
      }

      const completionRate = totalInSprint > 0 ? Math.round((completedInSprint / totalInSprint) * 100) : 0;
      const pendingQARate = totalInSprint > 0 ? Math.round((pendingQA / totalInSprint) * 100) : 0;
      const carryoverRate = totalInSprint > 0 ? Math.round(((pendingQA + inProgress) / totalInSprint) * 100) : 0;
      const plannedIssues = totalInSprint - addedAfterStart;
      const scopeCreepRate = plannedIssues > 0 ? Math.round((addedAfterStart / plannedIssues) * 100) : 0;
      const pendingQAStatusName = teamBoardConfig.pendingQAStatusName || 'Resolved';
      const jqlByMetric = {
        totalInSprint: jql,
        addedAfterStart: addedAfterStartJql,
        removedFromSprint: removedFromSprintJql,
        open: `(${jql}) AND statusCategory = To Do`,
        inProgress: `(${jql}) AND statusCategory = "In Progress"`,
        pendingQA: `(${jql}) AND status = "${pendingQAStatusName}"`,
        completedInSprint: `issueFunction in completeInSprint("${boardId}", "${(sprintInfo.name || '').replace(/"/g, '\\"')}")`
      };

      reports.push({
        sprintId,
        sprintName: sprintInfo.name,
        startDate: sprintInfo.startDate || null,
        endDate: sprintInfo.endDate || sprintInfo.completeDate || null,
        metrics: {
          totalInSprint,
          addedAfterStart,
          removedFromSprint,
          open,
          inProgress,
          pendingQA,
          completedInSprint,
          completionRate,
          pendingQARate,
          carryoverRate,
          scopeCreepRate
        },
        issues: issuesWithClassification,
        jqlByMetric
      });
      aggregatedIssues.push(...issuesWithClassification);
    }

    const sprints = overlapping.map(s => ({
      id: s.id,
      name: s.name,
      state: s.state,
      startDate: s.startDate || null,
      endDate: s.endDate || s.completeDate || null
    }));

    return res.json({
      success: true,
      sprints,
      reports,
      jiraBaseUrl: JIRA_API_V2.BASE_URL,
      aggregatedIssues
    });
  } catch (error) {
    console.error('Error in /api/jira/sprint-report-by-range:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to build sprint report by range',
      message: error.message
    });
  }
});

/**
 * Discover Jira fields — useful for finding the correct storyPointsFieldId.
 * GET /api/jira/fields?search=story
 * Returns all fields from /rest/api/2/field, optionally filtered by name.
 */
router.get('/fields', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const cleanToken = req.jiraToken;
    const httpsAgent = createHttpsAgent();
    const search = (req.query.search || '').toLowerCase();
    const response = await axios.get(JIRA_API_V2.FIELD, {
      headers: {
        Authorization: `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      httpsAgent,
      timeout: 15000
    });
    let fields = response.data || [];
    if (search) {
      fields = fields.filter(
        (f) => f.name?.toLowerCase().includes(search) || f.id?.toLowerCase().includes(search)
      );
    }
    return res.json({ success: true, fields: fields.map((f) => ({ id: f.id, name: f.name, custom: f.custom, type: f.schema?.type })) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * NDB Team KPI breakdown for a sprint.
 * POST /api/jira/sprint-kpi-breakdown  body: { teamId, sprintId, sprintName }
 * Returns { success: true, kpiBreakdown: [ { kpiName, completed, pendingQA, inProgress, total, jqlByStatus } ] }
 *
 * "True sprint content" JQL per KPI:
 *   sprint in ("sprintName") AND NOT issueFunction in removedAfterSprintStart("boardId", "sprintName") AND <kpi.baseQuery>
 *
 * KPI queries run sequentially (concurrency=1) to avoid overloading Jira after the sprint-report call.
 * sprintName accepted from request body to skip the sprint map lookup entirely.
 */
router.post('/sprint-kpi-breakdown', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  req.setTimeout(120000);
  res.setTimeout(120000);
  try {
    const { teamId, sprintId, sprintName: sprintNameFromBody } = req.body || {};
    if (!sprintId) return res.status(400).json({ success: false, error: 'sprintId is required' });
    if (!sprintNameFromBody) return res.status(400).json({ success: false, error: 'sprintName is required' });

    const teams = teamBoardConfig.teams || [];
    const effectiveTeamId = teamId || teamBoardConfig.defaultTeamId;
    const team = teams.find(t => t.id === effectiveTeamId) || teams[0];
    const boardId = team ? team.boardId : null;
    if (!boardId) return res.status(400).json({ success: false, error: 'Team has no boardId configured' });

    const cleanToken = req.jiraToken;
    const httpsAgent = createHttpsAgent();

    const kpiTeams = loadKpiConfigSync();
    const { kpis } = getKpisForTeam(kpiTeams, effectiveTeamId);
    if (!kpis || kpis.length === 0) {
      return res.json({ success: true, kpiBreakdown: [], note: 'No KPIs configured for this team.' });
    }

    const pendingQAStatusName = teamBoardConfig.pendingQAStatusName || 'Resolved';
    const completedStatusName = teamBoardConfig.completedStatusName || 'Closed';

    // True sprint content: same scope as sprint-report (sprintBaseFilter + sprint name)
    const sprintBaseFilter = team.sprintBaseFilter || team.baseFilter || '';
    const trueSprint = sprintBaseFilter
      ? `(${sprintBaseFilter}) AND sprint in ("${sprintNameFromBody}")`
      : `sprint in ("${sprintNameFromBody}")`;

    const kpiTasks = kpis.map((kpi) => async () => {
      const kpiJql = `(${trueSprint}) AND (${kpi.baseQuery})`;
      const fieldsList = 'key,status,issuetype';
      let allIssues = [];
      let startAt = 0;
      const maxResults = 100;
      let hasMore = true;
      try {
        while (hasMore) {
          const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
            headers: { Authorization: `Bearer ${cleanToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
            httpsAgent,
            timeout: 25000,
            params: { jql: kpiJql, fields: fieldsList, maxResults, startAt }
          }));
          const issues = response.data?.issues || [];
          const total = response.data?.total ?? 0;
          allIssues = allIssues.concat(issues);
          startAt = allIssues.length;
          hasMore = allIssues.length < total && issues.length === maxResults;
          if (hasMore) await new Promise(r => setTimeout(r, 200));
        }
      } catch (e) {
        console.warn(`[sprint-kpi-breakdown] KPI "${kpi.name}" query failed:`, e.message);
        return { kpiName: kpi.name, completed: 0, pendingQA: 0, inProgress: 0, total: 0, error: e.message };
      }

      let completed = 0, pendingQA = 0, inProgress = 0;
      const byType = {};
      for (const issue of allIssues) {
        const cls = classifySprintIssue(issue);
        if (cls === 'completedInSprint') completed++;
        else if (cls === 'pendingQA') pendingQA++;
        else inProgress++;
        const typeName = issue.fields?.issuetype?.name || 'Unknown';
        byType[typeName] = (byType[typeName] || 0) + 1;
      }

      return {
        kpiName: kpi.name,
        completed,
        pendingQA,
        inProgress,
        total: allIssues.length,
        byType,
        jqlByStatus: {
          all: kpiJql,
          completed: `(${trueSprint}) AND (${kpi.baseQuery}) AND status = "${completedStatusName}"`,
          pendingQA: `(${trueSprint}) AND (${kpi.baseQuery}) AND status = "${pendingQAStatusName}"`,
          inProgress: `(${trueSprint}) AND (${kpi.baseQuery}) AND statusCategory != Done`
        }
      };
    });

    // Sequential (concurrency=1) — KPI breakdown fires after sprint-report is done, keep Jira load low
    const kpiBreakdown = await runWithConcurrency(kpiTasks, 1);
    return res.json({ success: true, kpiBreakdown, sprintName: sprintNameFromBody, jiraBaseUrl: JIRA_API_V2.BASE_URL });
  } catch (error) {
    console.error('Error in /api/jira/sprint-kpi-breakdown:', error);
    return res.status(500).json({ success: false, error: 'Failed to build KPI breakdown', message: error.message });
  }
});

/**
 * Sprint report trends: metrics for multiple sprints (same metrics as sprint-report).
 * POST /api/jira/sprint-report-trends  body: { teamId, sprintIds: number[] }
 * Returns { success: true, trends: [ { sprintId, sprintName, metrics } ] }
 */
router.post('/sprint-report-trends', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);

  try {
    const { teamId, sprintIds } = req.body || {};
    const ids = Array.isArray(sprintIds) ? sprintIds.filter(x => x != null) : [];
    if (ids.length === 0) {
      return res.status(400).json({ success: false, error: 'sprintIds array is required' });
    }

    const teams = teamBoardConfig.teams || [];
    const effectiveTeamId = teamId || teamBoardConfig.defaultTeamId;
    const team = teams.find(t => t.id === effectiveTeamId) || teams[0];
    const boardId = team ? team.boardId : null;
    const baseUrl = JIRA_API_V2.BASE_URL;
    const httpsAgent = createHttpsAgent();
    const cleanToken = req.jiraToken;
    const sprintFieldId = teamBoardConfig.sprintFieldId || 'customfield_10360';

    const sprintMap = await getSprintsForBoard(boardId, cleanToken, httpsAgent);
    const maxChangelogForTrends = 15;

    const trendTasks = ids.map((sprintId) => async () => {
      const sprintInfo = sprintMap.get(Number(sprintId));
      if (!sprintInfo) {
        return {
          sprintId: Number(sprintId),
          sprintName: null,
          metrics: null,
          error: 'Sprint not found'
        };
      }

      const sprintEndDate = sprintInfo.endDate || sprintInfo.completeDate || null;
      const sprintStartDate = sprintInfo.startDate || null;
      const jql = buildSprintReportJql(sprintId, effectiveTeamId);
      const fieldsList = 'key,summary,status,resolution,resolutiondate,issuetype,priority,assignee,' + sprintFieldId;

      let allIssues = [];
      let startAt = 0;
      const maxResults = 100;
      let hasMore = true;

      while (hasMore) {
        const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
          headers: {
            Authorization: `Bearer ${cleanToken}`,
            'Content-Type': 'application/json',
            Accept: 'application/json'
          },
          httpsAgent,
          timeout: 6000, // Reduced from 30s to 6s
          params: { jql, fields: fieldsList, maxResults, startAt }
        }));
        const issues = response.data?.issues || [];
        const total = response.data?.total ?? 0;
        allIssues = allIssues.concat(issues);
        startAt = allIssues.length;
        hasMore = allIssues.length < total && issues.length === maxResults;
        if (hasMore) await new Promise(r => setTimeout(r, 200));
      }

      let completedInSprint = 0;
      let pendingQA = 0;
      let inProgress = 0;

      for (const issue of allIssues) {
        const c = classifySprintIssue(issue);
        if (c === 'completedInSprint') completedInSprint++;
        else if (c === 'pendingQA') pendingQA++;
        else inProgress++;
      }

      const issuesForChangelog = allIssues.slice(0, maxChangelogForTrends);
      const changelogTasks = issuesForChangelog.map((issue) => async () => {
        try {
          const { histories } = await fetchAllChangelogHistories(
            baseUrl, issue.key, issue.id, cleanToken, httpsAgent, retryJiraCall, logger, null
          );
          const addedAt = getAddedToSprintAt(histories, sprintId, sprintFieldId);
          return (addedAt && sprintStartDate && new Date(addedAt).getTime() > new Date(sprintStartDate).getTime()) ? 1 : 0;
        } catch (e) {
          return 0;
        }
      });
      const addedCounts = await runWithConcurrency(changelogTasks, SPRINT_TRENDS_CHANGELOG_CONCURRENCY);
      const addedAfterStart = addedCounts.reduce((a, b) => a + b, 0);

      const total = allIssues.length;
      const plannedIssues = total - addedAfterStart;
      const completionRate = total > 0 ? Math.round((completedInSprint / total) * 100) : 0;
      const scopeCreepRate = plannedIssues > 0 ? Math.round((addedAfterStart / plannedIssues) * 100) : 0;

      return {
        sprintId: Number(sprintId),
        sprintName: sprintInfo.name,
        metrics: {
          totalInSprint: total,
          addedAfterStart,
          removedFromSprint: 0,
          completedInSprint,
          pendingQA,
          inProgress,
          completionRate,
          scopeCreepRate
        }
      };
    });

    const trends = await runWithConcurrency(trendTasks, SPRINT_TRENDS_SPRINT_CONCURRENCY);
    return res.json({ success: true, trends });
  } catch (error) {
    console.error('Error in /api/jira/sprint-report-trends:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to build sprint report trends',
      message: error.message
    });
  }
});

/**
 * Fetch items by fixVersion and labels
 * POST /api/jira/release-items
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
 * Fetch Section 1 (Commit) items
 * POST /api/jira/release-items-commit
 */
router.post('/release-items-commit', jiraTimeout, releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const { items, cached } = await releaseItemsService.getCommitItems(req.jiraToken, {
      fixVersion: req.body?.fixVersion,
      username: req.user?.username,
    });
    return res.json({ success: true, data: { items }, cached });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return sendPartialItemsFailure(res, error, '/api/jira/release-items-commit');
  }
});

/**
 * Fetch Section 2 (Long-term-funded) items
 * POST /api/jira/release-items-long-term
 */
router.post('/release-items-long-term', jiraTimeout, releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const { items, cached } = await releaseItemsService.getLongTermItems(req.jiraToken, {
      fixVersion: req.body?.fixVersion,
      username: req.user?.username,
    });
    return res.json({ success: true, data: { items }, cached });
  } catch (error) {
    if (error.statusCode === 400) {
      return res.status(400).json({ success: false, error: error.message });
    }
    return sendPartialItemsFailure(res, error, '/api/jira/release-items-long-term');
  }
});

/**
 * TEST ENDPOINT: Compare API responses with and without fields parameter
 * GET /api/jira/test-changelog/:key
 * This is a temporary endpoint to debug changelog fetching
 */
router.get('/test-changelog/:key', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { key } = req.params;
    const baseUrl = JIRA_API_V2.BASE_URL;
    const httpsAgent = createHttpsAgent();
    const cleanToken = req.jiraToken;
    
    const issueUrl = `${baseUrl}/rest/api/2/issue/${key}`;
    
    // Test 1: WITH fields parameter (current approach)
    const checkpointFields = {
      codeComplete: 'customfield_11067',
      fsdsDone: 'customfield_13861',
      testPlan: 'customfield_11068',
      commitGate: 'customfield_35863',
      promotionGate: 'customfield_35864'
    };
    
    console.log(`[Test] Testing changelog fetch for ${key}...`);
    
    const responseWithFields = await retryJiraCall(() => axios.get(issueUrl, {
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      httpsAgent: httpsAgent,
      timeout: 30000,
      params: {
        expand: 'changelog',
        fields: Object.values(checkpointFields).join(',')
      }
    }));
    
    // Test 2: WITHOUT fields parameter
    const responseWithoutFields = await retryJiraCall(() => axios.get(issueUrl, {
      headers: {
        'Authorization': `Bearer ${cleanToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      httpsAgent: httpsAgent,
      timeout: 30000,
      params: {
        expand: 'changelog'
      }
    }));
    
    const withFields = responseWithFields.data;
    const withoutFields = responseWithoutFields.data;
    
    res.json({
      success: true,
      key: key,
      comparison: {
        withFields: {
          hasChangelog: !!withFields.changelog,
          changelogKeys: withFields.changelog ? Object.keys(withFields.changelog) : [],
          historiesCount: withFields.changelog?.histories?.length || 0,
          total: withFields.changelog?.total || 0,
          maxResults: withFields.changelog?.maxResults || 0,
          startAt: withFields.changelog?.startAt || 0,
          firstHistory: withFields.changelog?.histories?.[0] || null,
          changelogStructure: withFields.changelog ? {
            type: typeof withFields.changelog,
            keys: Object.keys(withFields.changelog),
            hasHistories: !!withFields.changelog.histories,
            historiesType: Array.isArray(withFields.changelog.histories) ? 'array' : typeof withFields.changelog.histories
          } : null
        },
        withoutFields: {
          hasChangelog: !!withoutFields.changelog,
          changelogKeys: withoutFields.changelog ? Object.keys(withoutFields.changelog) : [],
          historiesCount: withoutFields.changelog?.histories?.length || 0,
          total: withoutFields.changelog?.total || 0,
          maxResults: withoutFields.changelog?.maxResults || 0,
          startAt: withoutFields.changelog?.startAt || 0,
          firstHistory: withoutFields.changelog?.histories?.[0] || null,
          changelogStructure: withoutFields.changelog ? {
            type: typeof withoutFields.changelog,
            keys: Object.keys(withoutFields.changelog),
            hasHistories: !!withoutFields.changelog.histories,
            historiesType: Array.isArray(withoutFields.changelog.histories) ? 'array' : typeof withoutFields.changelog.histories
          } : null
        }
      },
      fullChangelogWithFields: withFields.changelog,
      fullChangelogWithoutFields: withoutFields.changelog
    });
  } catch (error) {
    console.error(`[Test] Error testing changelog for ${req.params.key}:`, error);
    res.status(500).json({
      success: false,
      error: error.message,
      response: error.response?.data,
      stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined
    });
  }
});

/**
 * Fetch checkpoint history for all items in a release version.
 * POST /api/jira/release-items-history
 */
router.post('/release-items-history', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  // History fetching walks the full release item set and pulls per-item changelogs;
  // the upstream JIRA changelog endpoint can be slow, so raise the timeouts.
  req.setTimeout(300000);
  res.setTimeout(300000);
  try {
    const data = await releaseHistoryService.getCheckpointHistory(req.jiraToken, req.body || {});
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Error in /api/jira/release-items-history:', error.message);
    return sendServiceError(res, error, 'Failed to fetch checkpoint history', { includeStack: true });
  }
});


/**
 * Endpoint to log user actions for audit purposes
 * POST /api/jira/log-user-action
 */
router.post('/log-user-action', async (req, res) => {
  try {
    const { action, resource, username, metadata } = req.body;
    const userIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || metadata?.userAgent || 'unknown';
    
    // Log the user action
    logger.audit.action(
      username || 'unknown',
      action || 'UNKNOWN_ACTION',
      resource || 'N/A',
      {
        ...metadata,
        ip: userIp,
        userAgent
      }
    );
    
    res.json({ success: true, message: 'Action logged' });
  } catch (err) {
    logger.error('Failed to log user action', err);
    res.status(500).json({ success: false, error: 'Failed to log action' });
  }
});

/**
 * Update Executive Summary field in JIRA
 * PUT /api/jira/update-executive-summary
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
router.post('/generate-exec-summary', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const { version, items, riskCounts, breakdownData } = req.body;

    if (!version || !Array.isArray(items)) {
      return res.status(400).json({ success: false, error: 'version and items[] are required' });
    }

    // Filter to only Commit projects (exclude Long-term-funded)
    const commitItems = items.filter(item => 
      item.fixVersions && item.fixVersions.includes(version) && 
      !item.isLongTermFunded
    );

    // Generate executive summary using VP report logic
    const execSummary = generateExecutiveSummary(version, commitItems, riskCounts, breakdownData);

    return res.json({ 
      success: true, 
      data: { 
        summary: execSummary,
        projectCount: commitItems.length,
        generatedAt: new Date().toISOString()
      } 
    });
  } catch (error) {
    console.error('Error in /api/jira/generate-exec-summary:', error.message);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to generate executive summary', 
      message: error.message 
    });
  }
});

// Executive Summary Generation Logic
function generateExecutiveSummary(version, commitItems, riskCounts, breakdownData = {}) {
  const total = commitItems.length;
  if (total === 0) {
    return {
      executiveSummary: `No commit projects found for ${version}.`,
      riskBreakdown: '',
      highlights: '',
      lowlights: '',
      actionItems: ''
    };
  }

  // Helper function to extract risk level from customfield_23560
  const getRiskFromItem = (item) => {
    const risk = item.customfield_23560;
    if (!risk) return 'not set';
    
    // Handle different data structures
    let value;
    if (typeof risk === 'object' && risk !== null) {
      value = risk.value || risk.name || String(risk);
    } else {
      value = String(risk);
    }
    
    return value.toLowerCase().trim();
  };

  // Classify projects by risk using actual JIRA field customfield_23560
  const reds = commitItems.filter(item => {
    const risk = getRiskFromItem(item);
    return risk.includes('red') || risk.includes('big risk') || risk.includes('critical');
  });

  const yellows = commitItems.filter(item => {
    const risk = getRiskFromItem(item);
    return risk.includes('yellow') || risk.includes('slight risk') || risk.includes('at risk') || risk.includes('moderate');
  });

  const greens = commitItems.filter(item => {
    const risk = getRiskFromItem(item);
    return risk.includes('green') || risk.includes('on track') || risk.includes('low risk');
  });

  const notSet = commitItems.filter(item => {
    const risk = getRiskFromItem(item);
    return risk.includes('not set') || risk === '' || !item.customfield_23560;
  });

  // Analyze breakdown data if provided
  let breakdownAnalysis = null;
  if (breakdownData && Object.keys(breakdownData).length > 0) {
    let totalSubTasks = 0;
    let totalDone = 0;
    let totalToBeVerified = 0;
    let totalInProgress = 0;
    let totalRemaining = 0;
    let projectsWithBreakdown = 0;

    Object.values(breakdownData).forEach(data => {
      if (data && data.overallStats) {
        projectsWithBreakdown++;
        totalSubTasks += data.total || 0;
        totalDone += data.overallStats.done || 0;
        totalToBeVerified += data.overallStats.toBeVerified || 0;
        totalInProgress += data.overallStats.inProgress || 0;
        totalRemaining += (data.overallStats.toDo || 0) + (data.overallStats.blocked || 0) + (data.overallStats.other || 0);
      }
    });

    if (totalSubTasks > 0) {
      breakdownAnalysis = {
        projectsWithBreakdown,
        totalSubTasks,
        totalDone,
        totalToBeVerified,
        totalInProgress,
        totalRemaining,
        completionRate: ((totalDone / totalSubTasks) * 100).toFixed(1),
        verificationBacklog: totalToBeVerified > 0 ? ((totalToBeVerified / totalSubTasks) * 100).toFixed(1) : '0'
      };
    }
  }

  // Generate executive summary
  let execText = `The ${version} release shows `;
  if (greens.length > reds.length + yellows.length) {
    execText += `strong execution across ${total} committed projects with ${greens.length} projects (${Math.round(greens.length/total*100)}%) maintaining Green status. `;
  } else {
    execText += `mixed execution requiring focused attention across ${total} committed projects. `;
  }
  
  if (reds.length > 0) {
    execText += `${reds.length} projects at big risk (${Math.round(reds.length/total*100)}%) and `;
  }
  
  if (yellows.length > 0) {
    execText += `${yellows.length} projects at slight risk (${Math.round(yellows.length/total*100)}%) `;
  }
  
  execText += `require immediate management focus as critical gate milestones approach.`;

  // Add breakdown analysis to executive summary
  if (breakdownAnalysis) {
    execText += ` Sub-task analysis across ${breakdownAnalysis.projectsWithBreakdown} projects reveals ${breakdownAnalysis.totalSubTasks} tasks with ${breakdownAnalysis.completionRate}% completion rate.`;
    
    if (parseFloat(breakdownAnalysis.verificationBacklog) > 10) {
      execText += ` Notable verification backlog of ${breakdownAnalysis.totalToBeVerified} tasks (${breakdownAnalysis.verificationBacklog}%) indicates QA bottleneck requiring attention.`;
    } else if (breakdownAnalysis.totalInProgress > breakdownAnalysis.totalDone) {
      execText += ` High work-in-progress ratio suggests need for delivery focus.`;
    }
  }

  // Risk breakdown table
  const riskBreakdown = `
| Risk Level | Count | Percentage |
|------------|-------|------------|
| 🟢 Green - On Track | ${greens.length} | ${Math.round(greens.length/total*100)}% |
| 🟡 Yellow - Slight Risk | ${yellows.length} | ${Math.round(yellows.length/total*100)}% |
| 🔴 Red - Big Risk | ${reds.length} | ${Math.round(reds.length/total*100)}% |
| ⚪ Not Set | ${notSet.length} | ${Math.round(notSet.length/total*100)}% |
| **TOTAL COMMIT** | **${total}** | **100%** |
`;

  // Highlights (Green projects)
  let highlights = '';
  if (greens.length > 0) {
    highlights = '## Highlights (Execution Wins)\n';
    greens.slice(0, 5).forEach(item => {
      const qi = extractQIFromItem(item);
      highlights += `• **${item.summary}** (${item.key}) - ${item.priority || 'Major'} - ${item.status || 'In Progress'}`;
      if (qi) highlights += ` - QI: ${qi}%`;
      highlights += '\n';
    });
  }

  // Lowlights (Red and Yellow projects)
  let lowlights = '';
  if (reds.length > 0) {
    lowlights += '## 🔴 Red Risk Projects (Immediate Action Required)\n';
    reds.forEach(item => {
      const qi = extractQIFromItem(item);
      lowlights += `• **${item.summary}** (${item.key}) - ${item.priority || 'Major'} - ${item.status || 'In Progress'}`;
      if (qi) lowlights += ` - QI: ${qi}%`;
      lowlights += '\n';
    });
    lowlights += '\n';
  }

  if (yellows.length > 0) {
    lowlights += '## 🟡 Yellow Risk Projects (Monitor Closely)\n';
    yellows.slice(0, 8).forEach(item => {
      const qi = extractQIFromItem(item);
      lowlights += `• **${item.summary}** (${item.key}) - ${item.priority || 'Major'} - ${item.status || 'In Progress'}`;
      if (qi) lowlights += ` - QI: ${qi}%`;
      lowlights += '\n';
    });
  }

  // Action items
  let actionItems = '## Action Items\n';
  if (reds.length > 0) {
    actionItems += `1. **Immediate Intervention**: ${reds.length} commit projects at big risk - escalate to leadership\n`;
  }
  if (yellows.length > 0) {
    actionItems += `${reds.length > 0 ? '2' : '1'}. **Weekly Review**: ${yellows.length} commit projects at slight risk - confirm mitigation plans\n`;
  }
  if (notSet.length > 0) {
    actionItems += `${reds.length + yellows.length > 0 ? (reds.length > 0 && yellows.length > 0 ? '3' : '2') : '1'}. **Risk Assessment**: ${notSet.length} commit projects need risk indicator updates\n`;
  }

  return {
    executiveSummary: execText,
    riskBreakdown,
    highlights,
    lowlights,
    actionItems,
    totalProjects: total,
    riskCounts: {
      red: reds.length,
      yellow: yellows.length,
      green: greens.length,
      notSet: notSet.length
    },
    breakdownAnalysis: breakdownAnalysis
  };
}


/**
 * Sprint Gantt Data Endpoint
 * POST /api/jira/sprint-gantt-data
 * 
 * Fetches and processes ticket data for sprint-based Gantt chart visualization.
 * Follows Nutanix JIRA date hierarchy rule:
 * - Focuses on "Everything Else" issue types (Stories, Tasks, Bugs) that use sprint dates
 * - Filters out high-level issues (X-FEAT, Capability, Feature, Initiative, Epic)
 * - Fetches sprint details from JIRA Sprint API for sprint-assigned tickets
 */
router.post('/sprint-gantt-data', validateJiraTokenMiddleware, async (req, res) => {
  const { jiraKey, jiraData, epics } = req.body;
  
  try {
    if (!jiraKey) {
      return res.status(400).json({ error: 'JIRA key is required' });
    }

    const cleanToken = req.jiraToken;
    const baseUrl = JIRA_API_V2.BASE_URL;
    const httpsAgent = createHttpsAgent();

    logger.jira.fetch(jiraKey, 'SPRINT_GANTT_DATA', 'Fetching sprint Gantt data');

    // Step 1: Get all child tickets (we'll use the same logic as fetch-all-jira-tickets)
    let allTickets = [];
    
    // If we already have epics data, extract tickets from there
    if (epics && Array.isArray(epics)) {
      epics.forEach(feature => {
        if (feature.childEpics && Array.isArray(feature.childEpics)) {
          feature.childEpics.forEach(epic => {
            if (epic.childTickets && Array.isArray(epic.childTickets)) {
              allTickets.push(...epic.childTickets);
            }
          });
        }
      });
    }

    // If no tickets from epics, fetch directly
    if (allTickets.length === 0 && jiraData) {
      // Get child issues directly from the main ticket
      const childIssuesUrl = `${baseUrl}/rest/api/2/search`;
      const childJql = `parent = "${jiraKey}" OR "Epic Link" = "${jiraKey}"`;
      
      const childResponse = await axios.get(childIssuesUrl, {
        params: {
          jql: childJql,
          maxResults: 200,
          fields: 'summary,status,assignee,issueType,sprint,customfield_10020,customfield_10021' // Include sprint fields
        },
        headers: {
          'Authorization': `Bearer ${cleanToken}`,
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        },
        httpsAgent
      });

      if (childResponse.data && childResponse.data.issues) {
        allTickets = childResponse.data.issues.map(issue => ({
          key: issue.key,
          summary: issue.fields.summary,
          status: issue.fields.status?.name || 'Unknown',
          assignee: issue.fields.assignee?.displayName || 'Unassigned',
          issueType: issue.fields.issuetype?.name || 'Unknown',
          sprint: issue.fields.sprint || issue.fields.customfield_10020 || issue.fields.customfield_10021,
        }));
      }
    }

    // Step 2: Apply Nutanix JIRA date hierarchy rule - filter for "Everything Else" tickets
    const sprintBasedTickets = allTickets.filter(ticket => {
      const issueType = (ticket.issueType || '').toUpperCase();
      
      // Exclude high-level issue types that use gate dates
      return !issueType.includes('X-FEAT') && 
             !issueType.includes('CAPABILITY') && 
             !issueType.includes('FEATURE') && 
             !issueType.includes('INITIATIVE') && 
             !issueType.includes('EPIC');
    });

    // Step 3: Enrich with sprint data for tickets that have sprints
    const enrichedTickets = [];
    const sprintCache = new Map(); // Cache to avoid duplicate sprint API calls

    for (const ticket of sprintBasedTickets) {
      const enrichedTicket = { ...ticket };
      
      if (ticket.sprint) {
        let sprintId;
        let sprintName;
        
        // Handle different sprint field formats
        if (typeof ticket.sprint === 'object' && ticket.sprint.id) {
          sprintId = ticket.sprint.id;
          sprintName = ticket.sprint.name;
        } else if (typeof ticket.sprint === 'string') {
          // Extract sprint ID from sprint string format
          const sprintMatch = ticket.sprint.match(/id=(\d+)/);
          const nameMatch = ticket.sprint.match(/name=([^,\]]+)/);
          sprintId = sprintMatch ? sprintMatch[1] : null;
          sprintName = nameMatch ? nameMatch[1] : ticket.sprint;
        }

        if (sprintId && !sprintCache.has(sprintId)) {
          try {
            // Fetch sprint details from JIRA Agile API
            const sprintUrl = `${baseUrl}/rest/agile/1.0/sprint/${sprintId}`;
            const sprintResponse = await axios.get(sprintUrl, {
              headers: {
                'Authorization': `Bearer ${cleanToken}`,
                'Accept': 'application/json'
              },
              httpsAgent
            });

            if (sprintResponse.data) {
              sprintCache.set(sprintId, {
                id: sprintId,
                name: sprintResponse.data.name || sprintName,
                startDate: sprintResponse.data.startDate ? new Date(sprintResponse.data.startDate).toISOString().split('T')[0] : null,
                endDate: sprintResponse.data.endDate ? new Date(sprintResponse.data.endDate).toISOString().split('T')[0] : null,
                state: sprintResponse.data.state
              });
            }
          } catch (sprintErr) {
            logger.jira.fetch(jiraKey, 'SPRINT_FETCH_ERROR', `Error fetching sprint ${sprintId}:`, sprintErr.message);
            // Continue without sprint data for this ticket
          }
        }

        // Apply sprint data to ticket
        const sprintData = sprintCache.get(sprintId);
        if (sprintData) {
          enrichedTicket.sprintId = sprintData.id;
          enrichedTicket.sprintName = sprintData.name;
          enrichedTicket.sprintStartDate = sprintData.startDate;
          enrichedTicket.sprintEndDate = sprintData.endDate;
          enrichedTicket.sprintState = sprintData.state;
        }
      }
      
      enrichedTickets.push(enrichedTicket);
    }

    // Step 4: Generate timeline columns (monthly view by default)
    const today = new Date();
    const startDate = new Date(today.getFullYear(), today.getMonth() - 2, 1); // 2 months ago
    const endDate = new Date(today.getFullYear(), today.getMonth() + 4, 0); // 4 months ahead
    
    const timelineColumns = [];
    const current = new Date(startDate);
    
    while (current <= endDate) {
      const monthStart = new Date(current.getFullYear(), current.getMonth(), 1);
      const monthEnd = new Date(current.getFullYear(), current.getMonth() + 1, 0);
      const isToday = today >= monthStart && today <= monthEnd;
      
      timelineColumns.push({
        label: current.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
        startDate: monthStart.toISOString().split('T')[0],
        endDate: monthEnd.toISOString().split('T')[0],
        isToday
      });
      
      current.setMonth(current.getMonth() + 1);
    }

    // Step 5: Calculate sprint statistics
    const sprintStats = {
      sprintCoverage: enrichedTickets.length > 0 ? 
        Math.round((enrichedTickets.filter(t => t.sprintEndDate).length / enrichedTickets.length) * 100) : 0,
      activeSprints: new Set(enrichedTickets.filter(t => t.sprintState === 'active').map(t => t.sprintId)).size,
      avgSprintLength: 0,
      nextSprintEnd: null
    };

    // Calculate average sprint length and next sprint end
    const sprintLengths = [];
    let nextSprintEndDate = null;
    
    sprintCache.forEach(sprint => {
      if (sprint.startDate && sprint.endDate) {
        const start = new Date(sprint.startDate);
        const end = new Date(sprint.endDate);
        const lengthDays = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        sprintLengths.push(lengthDays);
        
        // Find next sprint end date
        if (end > today && (!nextSprintEndDate || end < nextSprintEndDate)) {
          nextSprintEndDate = end;
        }
      }
    });

    if (sprintLengths.length > 0) {
      sprintStats.avgSprintLength = Math.round(sprintLengths.reduce((a, b) => a + b, 0) / sprintLengths.length);
    }

    if (nextSprintEndDate) {
      sprintStats.nextSprintEnd = nextSprintEndDate.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    }

    logger.jira.fetch(jiraKey, 'SPRINT_GANTT_SUCCESS', `Sprint Gantt data processed: ${enrichedTickets.length} tickets, ${sprintCache.size} sprints`);

    return res.json({
      success: true,
      sprintTickets: enrichedTickets,
      timelineColumns,
      sprintStats,
      metadata: {
        totalTickets: allTickets.length,
        sprintBasedTickets: sprintBasedTickets.length,
        sprintsFound: sprintCache.size,
        dateRange: {
          start: startDate.toISOString().split('T')[0],
          end: endDate.toISOString().split('T')[0]
        }
      }
    });

  } catch (error) {
    logger.jira.fetch(jiraKey, 'SPRINT_GANTT_ERROR', 'Error in sprint Gantt data endpoint:', error.message);
    console.error('Sprint Gantt Data Error:', error);
    
    return res.status(500).json({
      error: 'Failed to fetch sprint Gantt data',
      message: error.message,
      success: false
    });
  }
});

/**
 * Helper function to get release commit items (reusing existing API logic)
 */
async function getReleaseCommitItems(fixVersion, jiraToken, username) {
  const requestId = `exec-commit-${Date.now()}`;
  const cleanToken = jiraToken?.replace(/^Bearer\s+/i, '') || jiraToken;
  const httpsAgent = createHttpsAgent();
  
  try {
    // Use same logic as /api/jira/release-items-commit
    const teamBoardConfig = require('../../config/teamBoardConfig.json');
    const teams = teamBoardConfig.teams || [];
    const team = teams.find(t => t.id === teamBoardConfig.defaultTeamId) || teams[0];
    
    const jql = buildCommitItemsJQL(fixVersion, team);
    console.log(`[getReleaseCommitItems] Using JQL: ${jql}`);
    
    const allIssues = await releaseItemsService._internals.fetchReleaseItemsFromJira(jql, cleanToken, httpsAgent, requestId);
    const items = await releaseItemsService._internals.processReleaseItems(allIssues, cleanToken, httpsAgent, requestId, team?.boardId);
    
    console.log(`[getReleaseCommitItems] Fetched ${items.length} commit items for ${fixVersion}`);
    return { items, success: true };
  } catch (error) {
    console.error(`[getReleaseCommitItems] Error:`, error.message);
    return { items: [], success: false, error: error.message };
  }
}

/**
 * Helper function to get release long-term items (reusing existing API logic)
 */
async function getReleaseLongTermItems(fixVersion, jiraToken, username) {
  const requestId = `exec-longterm-${Date.now()}`;
  const cleanToken = jiraToken?.replace(/^Bearer\s+/i, '') || jiraToken;
  const httpsAgent = createHttpsAgent();
  
  try {
    // Use same logic as /api/jira/release-items-long-term
    const teamBoardConfig = require('../../config/teamBoardConfig.json');
    const teams = teamBoardConfig.teams || [];
    const team = teams.find(t => t.id === teamBoardConfig.defaultTeamId) || teams[0];
    
    const jql = buildLongTermItemsJQL(fixVersion, team);
    console.log(`[getReleaseLongTermItems] Using JQL: ${jql}`);
    
    const allIssues = await releaseItemsService._internals.fetchReleaseItemsFromJira(jql, cleanToken, httpsAgent, requestId);
    const items = await releaseItemsService._internals.processReleaseItems(allIssues, cleanToken, httpsAgent, requestId, team?.boardId);
    
    console.log(`[getReleaseLongTermItems] Fetched ${items.length} long-term items for ${fixVersion}`);
    return { items, success: true };
  } catch (error) {
    console.error(`[getReleaseLongTermItems] Error:`, error.message);
    return { items: [], success: false, error: error.message };
  }
}

/**
 * Fetch JIRA issues for executive summary processing using filter-based queries
 * @param {string} jiraToken - Clean JIRA token for authentication
 * @param {string} jqlQuery - JQL query string (typically filter-based)
 * @returns {Promise<Array>} Array of JIRA issues with full field data
 */
async function fetchExecSummaryIssues(jiraToken, jqlQuery) {
  const cleanToken = jiraToken?.replace(/^Bearer\s+/i, '') || jiraToken;
  const httpsAgent = createHttpsAgent();
  
  // Use comprehensive field list needed for executive summary analytics
  const fields = [
    'key', 'summary', 'status', 'priority', 'assignee', 'issuetype',
    'fixVersions', 'labels', 'duedate', 'created', 'updated', 'resolution',
    'customfield_11067', 'customfield_35863', 'customfield_35864', // Gate dates
    'customfield_23560', 'customfield_10360', 'customfield_27764'   // Risk, Sprint, etc.
  ].join(',');

  try {
    const response = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
      headers: { 
        Authorization: `Bearer ${cleanToken}`, 
        'Content-Type': 'application/json', 
        Accept: 'application/json' 
      },
      httpsAgent,
      timeout: 30000, // 30 second timeout for executive summary queries
      params: { 
        jql: jqlQuery, 
        fields: fields,
        maxResults: 1000 // Executive summary needs comprehensive data
      }
    }));

    console.log(`[fetchExecSummaryIssues] Fetched ${response.data.issues?.length || 0} issues for query: ${jqlQuery.substring(0, 100)}...`);
    return response.data.issues || [];
    
  } catch (error) {
    console.error(`[fetchExecSummaryIssues] Error fetching issues for query: ${jqlQuery.substring(0, 150)}...`);
    console.error(`[fetchExecSummaryIssues] Error details:`, {
      message: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data
    });
    throw new Error(`Failed to fetch executive summary issues: ${error.response?.data?.errorMessages?.[0] || error.message}`);
  }
}


/**
 * Enhanced Executive Summary with FEAT vs Non-FEAT Analysis (DEPRECATED - Use client-side processing)
 * POST /api/jira/enhanced-exec-summary
 * Body: { version: "NDB-2.11" }
 */
router.post('/enhanced-exec-summary', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  // Add request timeout to prevent runaway processing
  const timeoutId = setTimeout(() => {
    if (!res.headersSent) {
      console.error(`[enhanced-exec-summary] Request timeout for version: ${req.body.version}`);
      res.status(504).json({ 
        success: false, 
        error: 'Request timeout - processing took too long',
        timeout: true
      });
    }
  }, 60000); // 60 second timeout

  try {
    const { version } = req.body;
    const jiraToken = req.jiraToken;

    if (!version) {
      clearTimeout(timeoutId);
      return res.status(400).json({ success: false, error: 'version is required' });
    }

    console.log(`[enhanced-exec-summary] Processing request for version: ${version}`);

    // Reuse existing release APIs instead of duplicate JIRA calls
    console.log(`[enhanced-exec-summary] Reusing existing release APIs for ${version}`);
    
    // Get FEAT items from existing release APIs
    const [commitItemsResult, longTermItemsResult] = await Promise.all([
      // Get commit items (Features/Initiatives) 
      getReleaseCommitItems(version, jiraToken, req.user?.username),
      // Get long-term funded items
      getReleaseLongTermItems(version, jiraToken, req.user?.username)
    ]);

    // Combine all FEAT items (commit + long-term)
    const featItems = [
      ...(commitItemsResult.items || []),
      ...(longTermItemsResult.items || [])
    ];

    // For Non-FEAT analysis, we still need broader data
    // Only make this call if we need comprehensive analytics
    const allReleaseItems = await fetchExecSummaryIssues(jiraToken, 
      `fixVersion = "${version}" AND status != Cancelled ORDER BY key ASC`
    );

    // Separate FEAT from Non-FEAT items
    const featKeys = new Set(featItems.map(item => item.key));
    const nonFeatItems = allReleaseItems.filter(item => !featKeys.has(item.key));

    console.log(`[enhanced-exec-summary] Found ${featItems.length} FEAT items, ${nonFeatItems.length} Non-FEAT items`);

    // Calculate enhanced analytics
    const analytics = calculateEnhancedAnalytics(version, featItems, nonFeatItems);

    // Generate executive summary with enhanced data
    const execSummary = generateEnhancedExecutiveSummary(version, featItems, nonFeatItems, analytics);

    clearTimeout(timeoutId);
    return res.json({
      success: true,
      data: {
        summary: execSummary,
        analytics: analytics,
        projectCount: featItems.length,
        totalWorkItems: allReleaseItems.length,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    clearTimeout(timeoutId);
    console.error('Error in /api/jira/enhanced-exec-summary:', error.message);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate enhanced executive summary',
        message: error.message
      });
    }
  }
});

// Enhanced Analytics Calculation
function calculateEnhancedAnalytics(version, featItems, nonFeatItems) {
  
  // Calculate risk breakdown for all items
  // Note: featItems come from processed APIs, nonFeatItems from raw JIRA
  const allItems = [...featItems, ...nonFeatItems];
  const riskCounts = calculateRiskBreakdown(allItems);
  
  // Calculate P0 bugs count
  const p0BugsCount = allItems.filter(item => {
    let priority;
    if (item.priority) {
      // Processed item from existing APIs
      priority = item.priority;
    } else if (item.fields?.priority?.name) {
      // Raw JIRA item
      priority = item.fields.priority.name;
    }
    
    return priority === 'Highest' || priority === 'Blocker' || 
           (priority && (priority.toLowerCase().includes('p0') || priority.toLowerCase().includes('critical')));
  }).length;
  
  // Calculate date-related metrics
  const dateMetrics = calculateDateMetrics(featItems, nonFeatItems, version);
  
  // Calculate FEAT vs Non-FEAT breakdown
  const featVsNonFeat = calculateFeatVsNonFeatBreakdown(featItems, nonFeatItems);
  
  return {
    version,
    daysFromCutoff: dateMetrics.daysToPG,
    daysFromPG: dateMetrics.daysToPG, // Days to Promotion Gate
    currentCCDate: dateMetrics.currentCCDate,
    currentCGDate: dateMetrics.currentCGDate,
    currentPGDate: dateMetrics.currentPGDate,
    p0BugsCount: p0BugsCount,
    riskCounts,
    featVsNonFeat,
    milestones: dateMetrics.milestones
  };
}

// Calculate date-related metrics using release config
function calculateDateMetrics(featItems, nonFeatItems, version) {
  const now = new Date();
  
  // Get version config from email config
  const versionConfig = releaseVersionsEmailConfig.releaseGateDates[version];
  if (!versionConfig) {
    console.warn(`[calculateDateMetrics] No config found for version: ${version}`);
    return {
      daysToPG: null,
      currentCCDate: null,
      currentCGDate: null,
      currentPGDate: null,
      milestones: {
        codeComplete: [],
        commitGate: [],
        promotionGate: [],
        generalAvailability: []
      }
    };
  }

  console.log(`[calculateDateMetrics] Processing version: ${version}`);
  console.log(`[calculateDateMetrics] Version config keys:`, Object.keys(versionConfig));

  // Helper function to format dates
  const formatDate = (date) => {
    if (!date) return null;
    return date.toLocaleDateString('en-US', { 
      month: 'short', 
      day: 'numeric',
      year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
    });
  };

  // Helper function to process milestone gates
  const processMilestones = (gatePrefix) => {
    const milestones = [];
    let currentDate = null;
    
    console.log(`[processMilestones] Processing ${gatePrefix} gates`);
    
    // Handle different naming patterns
    let gateNum = 1;
    while (true) {
      let gateKey;
      let gate;
      
      if (gatePrefix === 'ccm') {
        // CCM gates use format: ccm1Gate, ccm2Gate
        gateKey = `${gatePrefix}${gateNum}Gate`;
        gate = versionConfig[gateKey];
      } else {
        // Other gates use format: commitGate1, promotionGate1, ga1, ga2
        gateKey = `${gatePrefix}${gateNum}`;
        gate = versionConfig[gateKey];
      }
      
      console.log(`[processMilestones] Checking ${gateKey}:`, gate ? 'found' : 'not found');
      
      if (!gate) break;
      
      if (Array.isArray(gate)) {
        // Handle array format (multiple milestones in one gate)
        gate.forEach(milestone => {
          milestones.push({
            label: milestone.label,
            date: milestone.date,
            formattedDate: formatDate(new Date(milestone.date)),
            isStrikeThrough: milestone.style === 'dotted',
            isCurrent: milestone.style === 'solid'
          });
          
          if (milestone.style === 'solid') {
            currentDate = formatDate(new Date(milestone.date));
          }
        });
      } else {
        // Handle object format (single milestone)
        milestones.push({
          label: gate.label,
          date: gate.date,
          formattedDate: formatDate(new Date(gate.date)),
          isStrikeThrough: gate.style === 'dotted',
          isCurrent: gate.style === 'solid'
        });
        
        if (gate.style === 'solid') {
          currentDate = formatDate(new Date(gate.date));
        }
      }
      
      gateNum++;
    }
    
    console.log(`[processMilestones] Found ${milestones.length} ${gatePrefix} milestones, current date: ${currentDate}`);
    return { milestones, currentDate };
  };

  // Process all milestone types
  const codeComplete = processMilestones('ccm');
  const commitGate = processMilestones('commitGate');
  const promotionGate = processMilestones('promotionGate');
  const generalAvailability = processMilestones('ga');

  // Calculate days to current Promotion Gate
  let daysToPG = null;
  const currentPGMilestone = promotionGate.milestones.find(m => m.isCurrent);
  console.log(`[calculateDateMetrics] Current PG milestone:`, currentPGMilestone);
  
  if (currentPGMilestone) {
    const pgDate = new Date(currentPGMilestone.date);
    const diffTime = pgDate - now;
    daysToPG = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    console.log(`[calculateDateMetrics] PG Date: ${pgDate}, Days to PG: ${daysToPG}`);
  } else {
    console.log(`[calculateDateMetrics] No current PG milestone found. PG milestones:`, promotionGate.milestones);
  }

  return {
    daysToPG: daysToPG,
    currentCCDate: codeComplete.currentDate,
    currentCGDate: commitGate.currentDate,
    currentPGDate: promotionGate.currentDate,
    milestones: {
      codeComplete: codeComplete.milestones,
      commitGate: commitGate.milestones,
      promotionGate: promotionGate.milestones,
      generalAvailability: generalAvailability.milestones
    }
  };
}

// Calculate FEAT vs Non-FEAT breakdown with work item analysis
function calculateFeatVsNonFeatBreakdown(featItems, nonFeatItems) {
  
  const calculateWorkMetrics = (items) => {
    const total = items.length;
    
    // P0/P1 Outstanding (not resolved/closed)
    const p0p1Outstanding = items.filter(item => {
      let priority, status;
      
      if (item.priority && item.status) {
        // Processed item from existing APIs
        priority = item.priority;
        status = item.status.toLowerCase();
      } else if (item.fields) {
        // Raw JIRA item
        priority = item.fields?.priority?.name;
        status = item.fields?.status?.name?.toLowerCase();
      }
      
      const isHighPriority = priority === 'Highest' || priority === 'High' || priority === 'Blocker' ||
                            (priority && (priority.toLowerCase().includes('p0') || priority.toLowerCase().includes('p1')));
      const isOutstanding = !status?.includes('resolved') && !status?.includes('closed') && !status?.includes('done');
      return isHighPriority && isOutstanding;
    }).length;
    
    // Post-CC Created (created after Code Complete dates)
    const postCCCreated = items.filter(item => {
      // This would need CC dates from FEAT items to compare against creation dates
      // For now, return 0 as placeholder
      return false;
    }).length;
    
    // Overdue Items (past due date or sprint end date)
    const overdue = items.filter(item => {
      let dueDate;
      
      if (item.dueDate) {
        // Processed item from existing APIs
        dueDate = item.dueDate;
      } else if (item.fields?.duedate) {
        // Raw JIRA item
        dueDate = item.fields.duedate;
      }
      
      if (dueDate && new Date(dueDate) < new Date()) {
        return true;
      }
      // TODO: Check sprint end dates for non-gate items
      return false;
    }).length;
    
    // In Progress
    const inProgress = items.filter(item => {
      let status;
      
      if (item.status) {
        // Processed item from existing APIs
        status = item.status.toLowerCase();
      } else if (item.fields?.status?.name) {
        // Raw JIRA item
        status = item.fields.status.name.toLowerCase();
      } else {
        status = '';
      }
      
      return status.includes('progress') || status.includes('development') || status.includes('review');
    }).length;
    
    return {
      total,
      p0p1Outstanding,
      postCCCreated,
      overdue,
      inProgress
    };
  };
  
  const featMetrics = calculateWorkMetrics(featItems);
  const nonFeatMetrics = calculateWorkMetrics(nonFeatItems);
  
  return {
    featTotal: featMetrics.total,
    featP0P1: featMetrics.p0p1Outstanding,
    featPostCC: featMetrics.postCCCreated,
    featOverdue: featMetrics.overdue,
    featInProgress: featMetrics.inProgress,
    
    nonFeatTotal: nonFeatMetrics.total,
    nonFeatP0P1: nonFeatMetrics.p0p1Outstanding,
    nonFeatPostCC: nonFeatMetrics.postCCCreated,
    nonFeatOverdue: nonFeatMetrics.overdue,
    nonFeatInProgress: nonFeatMetrics.inProgress
  };
}

// Risk breakdown calculation (from existing logic)
function calculateRiskBreakdown(items) {
  console.log(`[calculateRiskBreakdown] Processing ${items.length} items for risk analysis`);
  
  const getRiskFromItem = (item) => {
    // Handle both processed items (from APIs) and raw JIRA items
    let risk;
    if (item.riskIndicator) {
      // Processed item from existing APIs
      risk = item.riskIndicator;
    } else if (item.fields?.customfield_23560) {
      // Raw JIRA item
      risk = item.fields.customfield_23560;
    } else {
      return 'not set';
    }
    
    if (!risk) return 'not set';
    
    let value;
    if (typeof risk === 'object' && risk !== null) {
      value = risk.value || risk.name || String(risk);
    } else {
      value = String(risk);
    }
    
    return value.toLowerCase().trim();
  };

  const reds = items.filter(item => {
    const risk = getRiskFromItem(item);
    return risk.includes('red') || risk.includes('big risk') || risk.includes('critical');
  });

  const yellows = items.filter(item => {
    const risk = getRiskFromItem(item);
    return risk.includes('yellow') || risk.includes('slight risk') || risk.includes('at risk') || risk.includes('moderate');
  });

  const greens = items.filter(item => {
    const risk = getRiskFromItem(item);
    return risk.includes('green') || risk.includes('on track') || risk.includes('low risk');
  });

  const notSet = items.filter(item => {
    const risk = getRiskFromItem(item);
    return risk.includes('not set') || risk === '' || !item.customfield_23560;
  });

  console.log(`[calculateRiskBreakdown] Risk breakdown: Green=${greens.length}, Yellow=${yellows.length}, Red=${reds.length}, NotSet=${notSet.length}, Total=${items.length}`);
  
  // Log some sample risk values for debugging
  const sampleRisks = items.slice(0, 5).map(item => ({
    key: item.key,
    risk: item.fields?.customfield_23560
  }));
  console.log(`[calculateRiskBreakdown] Sample risk values:`, sampleRisks);

  return {
    green: greens.length,
    yellow: yellows.length,
    red: reds.length,
    notSet: notSet.length,
    total: items.length
  };
}

// Gate Readiness Assessment - REMOVED FOR DEBUGGING
function calculateGateReadiness(featItems, nonFeatItems, timelineContext) {
  return {
    overallScore: 0,
    overallStatus: 'debug-mode',
    categories: {},
    recommendations: []
  };
}


// Generate Enhanced Executive Summary
function generateEnhancedExecutiveSummary(version, featItems, nonFeatItems, analytics) {
  const allItems = [...featItems, ...nonFeatItems];
  
  return {
    totalProjects: allItems.length,
    daysFromCutoff: analytics.daysToPG,
    currentCCDate: analytics.currentCCDate || 'TBD',
    currentCGDate: analytics.currentCGDate || 'TBD',
    currentPGDate: analytics.currentPGDate || 'TBD',
    riskCounts: analytics.riskCounts,
    p0BugsCount: analytics.p0BugsCount,
    featVsNonFeat: analytics.featVsNonFeat,
    milestones: analytics.milestones,
    generatedAt: new Date().toISOString(),
    version: version
  };
}

/**
 * Get Team Configurations for VooDoo Agent Platform - TEMPORARILY DISABLED FOR DEBUGGING
 * GET /api/jira/team-configurations
 */
router.get('/team-configurations', requireAuth('releaseVersions'), async (req, res) => {
  // TEMPORARILY DISABLED FOR DEBUGGING
  return res.json({
    success: true,
    data: {
      availableTeams: [],
      configurations: {},
      platformCapabilities: { message: 'Temporarily disabled for debugging' }
    }
  });
  try {
    const voodooService = require('../../services/voodooService');
    const teamConfigurations = require('../../config/teamConfigurations.json');
    
    return res.json({
      success: true,
      data: {
        availableTeams: Object.keys(teamConfigurations),
        configurations: teamConfigurations,
        platformCapabilities: {
          supportedTeams: ["NDB", "AOS", "Files", "Objects"],
          autoDetection: true,
          customConfigurable: true,
          universalPromptFramework: true
        }
      }
    });

  } catch (error) {
    console.error('Error in /api/jira/team-configurations:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve team configurations',
      message: error.message
    });
  }
});

/**
 * Create Universal VooDoo Agent Input
 * POST /api/jira/create-universal-agent-input
 * Body: { version, teamIdentifier? }
 */
router.post('/create-universal-agent-input', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const { version, teamIdentifier } = req.body;
    const jiraToken = req.jiraToken;

    if (!version) {
      return res.status(400).json({ success: false, error: 'version is required' });
    }

    console.log(`[Universal Agent Input] Processing request for version: ${version}, team: ${teamIdentifier || 'auto-detect'}`);

    // Get enhanced analytics data (reuse existing logic)
    const [featItems, allReleaseItems] = await Promise.all([
      fetchExecSummaryIssues(jiraToken, `fixVersion = "${version}" AND issuetype in (Feature, Initiative) AND status != Cancelled ORDER BY key ASC`),
      fetchExecSummaryIssues(jiraToken, `fixVersion = "${version}" AND status != Cancelled ORDER BY key ASC`)
    ]);

    const featKeys = new Set(featItems.map(item => item.key));
    const nonFeatItems = allReleaseItems.filter(item => !featKeys.has(item.key));

    const analytics = calculateEnhancedAnalytics(version, featItems, nonFeatItems);

    const releaseData = {
      version,
      analytics,
      projectCount: featItems.length,
      totalWorkItems: allReleaseItems.length,
      generatedAt: new Date().toISOString()
    };

    // Create universal agent input
    const voodooService = require('../../services/voodooService');
    const universalInput = voodooService.createUniversalAgentInput(releaseData, teamIdentifier || version);

    console.log(`[Universal Agent Input] Created for team: ${universalInput.teamName}`);

    return res.json({
      success: true,
      data: {
        universalInput,
        rawAnalytics: analytics,
        metadata: {
          teamDetected: universalInput.teamName,
          configurationUsed: universalInput.teamConfig?.teamName || 'Default',
          inputGenerated: new Date().toISOString(),
          platformVersion: '1.0.0'
        }
      }
    });

  } catch (error) {
    console.error('Error in /api/jira/create-universal-agent-input:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to create universal agent input',
      message: error.message
    });
  }
});

/**
 * Get P0 bug count for Executive Summary
 * GET /api/jira/p0-bugs?version=NDB-2.11
 */
router.get('/p0-bugs', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { version } = req.query;
    
    if (!version) {
      return res.status(400).json({ success: false, error: 'version parameter is required' });
    }

    console.log(`[p0-bugs] Getting P0 bug count for version: ${version}`);

    const jiraToken = req.headers.authorization?.replace('Bearer ', '');
    
    // Build JQL: filter=ndb-2.11-all and statusCategory != Done and priority = "P0 - Blocker"
    const filterName = `${version.toLowerCase()}-all`;
    const jqlQuery = `filter = "${filterName}" AND statusCategory != Done AND priority = "P0 - Blocker"`;
    
    console.log(`[p0-bugs] JQL: ${jqlQuery}`);
    
    const searchResponse = await axios.get(JIRA_API_V2.SEARCH, {
      headers: {
        'Authorization': `Bearer ${jiraToken}`,
        'Content-Type': 'application/json'
      },
      params: {
        jql: jqlQuery,
        fields: 'key', // We only need the count, not the full data
        maxResults: 1000 // Should be enough for P0 bugs
      },
      httpsAgent: createHttpsAgent(),
      timeout: 30000
    });

    const p0BugCount = searchResponse.data?.total || 0;
    
    console.log(`[p0-bugs] Found ${p0BugCount} P0 bugs for ${version}`);
    
    return res.json({
      success: true,
      count: p0BugCount,
      version: version,
      jql: jqlQuery
    });

  } catch (error) {
    console.error('Error in /api/jira/p0-bugs:', error.message);
    
    // If it's a JIRA API error, provide more details
    if (error.response) {
      console.error('JIRA API error status:', error.response.status);
      console.error('JIRA API error data:', error.response.data);
    }
    
    return res.status(500).json({
      success: false,
      error: 'Failed to get P0 bug count',
      message: error.message
    });
  }
});

/**
 * Unified Executive Summary Endpoint
 * GET /api/jira/executive-summary-unified?version=NDB-2.11
 * 
 * Handles all Executive Summary data processing server-side:
 * - Config dates and milestones
 * - P0 bug count 
 * - Risk breakdown from commit items
 * - Basic per-project details
 */
router.get('/executive-summary-unified', validateJiraTokenMiddleware, async (req, res) => {
  try {
    console.log('[executive-summary-unified] Request received with query:', req.query);
    // Handle both direct query params and nested params structure
    const version = req.query.version || req.query.params?.version;
    
    if (!version || version.trim() === '') {
      console.log('[executive-summary-unified] ERROR: No version parameter provided or empty version:', version);
      return res.status(400).json({ 
        success: false, 
        error: 'version parameter is required and cannot be empty' 
      });
    }

    console.log(`[executive-summary-unified] Processing Executive Summary for ${version}`);
    const jiraToken = req.headers.authorization?.replace('Bearer ', '');
    
    // 1. Process config dates using milestone processor
    let dateMetrics;
    try {
      const versionConfig = releaseVersionsEmailConfig.releaseGateDates[version];
      if (!versionConfig) {
        console.warn(`[executive-summary-unified] No config found for version: ${version}`);
        dateMetrics = {
          daysFromCutoff: null,
          currentCCDate: 'TBD',
          currentCGDate: 'TBD',
          currentPGDate: 'TBD',
          milestones: {
            codeComplete: [],
            commitGate: [],
            promotionGate: [],
            generalAvailability: []
          }
        };
      } else {
        dateMetrics = processAllMilestones(versionConfig);
      }
    } catch (error) {
      console.error('[executive-summary-unified] Error processing config dates:', error);
      dateMetrics = {
        daysFromCutoff: null,
        currentCCDate: 'TBD',
        currentCGDate: 'TBD', 
        currentPGDate: 'TBD',
        milestones: {
          codeComplete: [],
          commitGate: [],
          promotionGate: [],
          generalAvailability: []
        }
      };
    }

    // 2. Fetch P0 bugs count
    let p0BugsCount = 0;
    try {
      const filterName = `${version.toLowerCase()}-all`;
      const p0JqlQuery = `filter = "${filterName}" AND statusCategory != Done AND priority = "P0 - Blocker"`;
      
      console.log(`[executive-summary-unified] P0 JQL: ${p0JqlQuery}`);
      
      const p0Response = await axios.get(JIRA_API_V2.SEARCH, {
        headers: {
          'Authorization': `Bearer ${jiraToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          jql: p0JqlQuery,
          fields: 'key',
          maxResults: 1000
        },
        httpsAgent: createHttpsAgent(),
        timeout: 30000
      });

      p0BugsCount = p0Response.data?.total || 0;
      console.log(`[executive-summary-unified] Found ${p0BugsCount} P0 bugs`);
    } catch (error) {
      console.error('[executive-summary-unified] Error fetching P0 bugs:', error.message);
      // Continue with 0 count rather than failing entirely
    }

    // 3. Get commit items for risk breakdown and project details
    let commitItems = [];
    let riskCounts = { red: 0, yellow: 0, green: 0, notSet: 0 };
    let projectDetails = { green: [], yellow: [], red: [] };
    
    try {
      // Use existing commit items JQL
      const commitJQL = buildCommitItemsJQL(version);
      console.log(`[executive-summary-unified] Commit JQL: ${commitJQL}`);
      
      const commitResponse = await axios.get(JIRA_API_V2.SEARCH, {
        headers: {
          'Authorization': `Bearer ${jiraToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          jql: commitJQL,
          fields: 'key,summary,status,priority,assignee,customfield_23560,customfield_23073,customfield_45660,customfield_10860,customfield_11065,customfield_27764,customfield_11067,customfield_35863,customfield_35864,customfield_14463,customfield_31460', // Include all analysis fields
          maxResults: 1000
        },
        httpsAgent: createHttpsAgent(),
        timeout: 30000
      });

      const rawItems = commitResponse.data?.issues || [];
      
      // Process items for risk breakdown and project details
      rawItems.forEach(issue => {
        const key = issue.key;
        const summary = issue.fields?.summary || 'No summary';
        const status = issue.fields?.status?.name || 'Unknown';
        const priority = issue.fields?.priority?.name || 'N/A';
        
        // Process risk indicator
        const rawRiskIndicator = issue.fields?.customfield_23560;
        let riskValue = '';
        let riskLevel = 'notSet';
        
        if (rawRiskIndicator) {
          if (typeof rawRiskIndicator === 'object' && rawRiskIndicator !== null) {
            riskValue = rawRiskIndicator.value || rawRiskIndicator.name || '';
          } else {
            riskValue = String(rawRiskIndicator);
          }
          
          const riskStr = riskValue.toLowerCase().trim();
          if (riskStr.includes('red')) {
            riskLevel = 'red';
            riskCounts.red++;
          } else if (riskStr.includes('yellow')) {
            riskLevel = 'yellow';
            riskCounts.yellow++;
          } else if (riskStr.includes('green')) {
            riskLevel = 'green';
            riskCounts.green++;
          } else {
            riskCounts.notSet++;
          }
        } else {
          riskCounts.notSet++;
        }
        
        // Create basic project detail
        const projectDetail = {
          key: key,
          title: summary,
          priority: priority,
          status: status,
          riskIndicator: riskValue || 'Not Set',
          summary: summary
        };
        
        // Enhanced processing with automated analysis
        const automatedAnalysis = analyzeProjectForExecutiveSummary(issue);
        const projectInfo = {
          key: issue.key,
          summary: issue.fields?.summary || 'No summary',
          status: issue.fields?.status?.name || 'Unknown',
          priority: issue.fields?.priority?.name || 'Not Set',
          assignee: issue.fields?.assignee?.displayName || issue.fields?.assignee?.name || 'Unassigned',
          automatedAnalysis: automatedAnalysis
        };

        // Note: We don't include 'notSet' items in project details to keep it clean
        if (riskLevel !== 'notSet') {
          projectDetails[riskLevel].push(projectInfo);
        }
      });

      commitItems = rawItems;
      console.log(`[executive-summary-unified] Processed ${commitItems.length} commit items`);
      console.log(`[executive-summary-unified] Risk breakdown:`, riskCounts);
      
    } catch (error) {
      console.error('[executive-summary-unified] Error fetching commit items:', error.message);
      // Reset to completely empty data on error to prevent inconsistencies
      commitItems = [];
      riskCounts = { red: 0, yellow: 0, green: 0, notSet: 0 };
      projectDetails = { green: [], yellow: [], red: [] };
    }

    // 4. Calculate work distribution metrics and ensure data consistency
    const totalProjects = commitItems.length;
    
    // Ensure risk counts are consistent with total projects
    const actualRiskTotal = riskCounts.red + riskCounts.yellow + riskCounts.green + riskCounts.notSet;
    if (actualRiskTotal !== totalProjects) {
      console.warn(`[executive-summary-unified] Data inconsistency detected - totalProjects: ${totalProjects}, riskTotal: ${actualRiskTotal}. Resetting risk counts.`);
      if (totalProjects === 0) {
        // If no projects, reset all risk counts to 0
        riskCounts = { red: 0, yellow: 0, green: 0, notSet: 0 };
        projectDetails = { green: [], yellow: [], red: [] };
      } else {
        // If projects exist but counts are wrong, mark them as notSet
        riskCounts.notSet = totalProjects - (riskCounts.red + riskCounts.yellow + riskCounts.green);
      }
    }
    
    const workDistribution = {
      featTotal: totalProjects,
      featP0P1: 0,
      featPostCC: 0,
      featOverdue: 0,
      featInProgress: 0,
      nonFeatTotal: 0,
      nonFeatP0P1: 0, 
      nonFeatPostCC: 0,
      nonFeatOverdue: 0,
      nonFeatInProgress: 0
    };

    // Calculate FEAT metrics from commit items
    commitItems.forEach(issue => {
      const priority = issue.fields?.priority?.name || '';
      const status = issue.fields?.status?.name?.toLowerCase() || '';
      const dueDate = issue.fields?.duedate;
      
      // P0/P1 Outstanding
      const isHighPriority = priority === 'Highest' || priority === 'High' || priority === 'Blocker' ||
                            (priority && (priority.toLowerCase().includes('p0') || priority.toLowerCase().includes('p1')));
      const isOutstanding = !status.includes('resolved') && !status.includes('closed') && !status.includes('done');
      
      if (isHighPriority && isOutstanding) {
        workDistribution.featP0P1++;
      }
      
      // Overdue items
      if (dueDate && new Date(dueDate) < new Date()) {
        workDistribution.featOverdue++;
      }
      
      // In Progress
      if (status.includes('progress') || status.includes('development') || status.includes('review')) {
        workDistribution.featInProgress++;
      }
    });

    // 5. Build complete response
    const executiveSummaryData = {
      totalProjects: totalProjects,
      p0BugsCount: p0BugsCount,
      daysFromPG: dateMetrics.daysFromCutoff,
      currentPGDate: dateMetrics.currentPGDate,
      currentCCDate: dateMetrics.currentCCDate,
      currentCGDate: dateMetrics.currentCGDate,
      milestones: dateMetrics.milestones,
      riskCounts: riskCounts,
      workDistribution: workDistribution,
      projectDetails: projectDetails
    };

    console.log(`[executive-summary-unified] Successfully processed Executive Summary for ${version}`);
    
    return res.json({
      success: true,
      data: executiveSummaryData
    });

  } catch (error) {
    console.error('[executive-summary-unified] Unexpected error:', error.message);
    console.error('[executive-summary-unified] Stack:', error.stack);
    
    return res.status(500).json({
      success: false,
      error: 'Failed to generate executive summary',
      message: error.message
    });
  }
});

/**
 * Validate NAI API Key
 * POST /api/jira/validate-nai-key
 * 
 * Tests if the provided NAI API key works by making a simple API call
 */
router.post('/validate-nai-key', async (req, res) => {
  try {
    console.log('[validate-nai-key] Request received');
    
    const { apiKey } = req.body;

    if (!apiKey || apiKey.trim() === '') {
      console.log('[validate-nai-key] ERROR: No API key provided');
      return res.status(400).json({
        success: false,
        error: 'NAI API key is required'
      });
    }

    console.log('[validate-nai-key] Testing NAI API key...');
    
    // Test the API key with a simple request
    const testResponse = await axios.post(
      'https://dpro-nai.corp.p10y.ntnxdpro.com/enterpriseai/v1/chat/completions',
      {
        model: 'eng-pool-05', // Default model for Nutanix NAI, other APIs may ignore this
        messages: [
          {
            role: 'user',
            content: 'Test connection - respond with "OK"'
          }
        ],
        max_tokens: 10,
        temperature: 0.1
      },
      {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 10000,
        httpsAgent: createHttpsAgent()
      }
    );

    if (testResponse.status === 200 && testResponse.data?.choices?.length > 0) {
      console.log('[validate-nai-key] NAI API key validated successfully');
      return res.json({
        success: true,
        message: 'NAI API key is valid'
      });
    } else {
      console.log('[validate-nai-key] NAI API returned unexpected response:', testResponse.status);
      return res.status(400).json({
        success: false,
        error: 'NAI API key validation failed - unexpected response'
      });
    }

  } catch (error) {
    console.error('[validate-nai-key] Error validating NAI API key:', error.message);
    
    // Handle specific error types
    if (error.response?.status === 401) {
      return res.status(400).json({
        success: false,
        error: 'Invalid NAI API key - authentication failed'
      });
    } else if (error.response?.status === 403) {
      return res.status(400).json({
        success: false,
        error: 'NAI API key does not have required permissions'
      });
    } else if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
      return res.status(500).json({
        success: false,
        error: 'Unable to reach NAI API - network connectivity issue'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'NAI API key validation failed',
        message: error.message
      });
    }
  }
});

/**
 * Generate AI VP Report using NAI API
 * POST /api/jira/generate-ai-vp-report
 * 
 * Generates a comprehensive VP executive report using NAI LLM and existing executive summary data
 */
router.post('/generate-ai-vp-report', validateJiraTokenMiddleware, async (req, res) => {
  try {
    console.log('[generate-ai-vp-report] Request received');

    const { version, naiApiKey } = req.body;
    
    if (!version || version.trim() === '') {
      console.log('[generate-ai-vp-report] ERROR: No version parameter provided');
      return res.status(400).json({
        success: false,
        error: 'version parameter is required'
      });
    }

    if (!naiApiKey || naiApiKey.trim() === '') {
      console.log('[generate-ai-vp-report] ERROR: No NAI API key provided');
      return res.status(400).json({
        success: false,
        error: 'NAI API key is required'
      });
    }

    console.log(`[generate-ai-vp-report] Generating AI VP Report for ${version}`);
    const jiraToken = req.headers.authorization?.replace('Bearer ', '');

    // 1. Reuse the executive summary data logic
    console.log('[generate-ai-vp-report] Fetching executive summary data...');
    
    // Get config dates
    let dateMetrics;
    try {
      const versionConfig = releaseVersionsEmailConfig.releaseGateDates[version];
      if (!versionConfig) {
        dateMetrics = {
          daysFromCutoff: null,
          currentCCDate: 'TBD',
          currentCGDate: 'TBD', 
          currentPGDate: 'TBD',
          milestones: { codeComplete: [], commitGate: [], promotionGate: [], generalAvailability: [] }
        };
      } else {
        dateMetrics = processAllMilestones(versionConfig);
      }
    } catch (error) {
      console.error('[generate-ai-vp-report] Error processing config dates:', error);
      dateMetrics = {
        daysFromCutoff: null,
        currentCCDate: 'TBD',
        currentCGDate: 'TBD',
        currentPGDate: 'TBD', 
        milestones: { codeComplete: [], commitGate: [], promotionGate: [], generalAvailability: [] }
      };
    }

    // Get P0 bugs count
    let p0BugsCount = 0;
    try {
      const filterName = `${version.toLowerCase()}-all`;
      const p0JqlQuery = `filter = "${filterName}" AND statusCategory != Done AND priority = "P0 - Blocker"`;
      
      const p0Response = await axios.get(JIRA_API_V2.SEARCH, {
        headers: {
          'Authorization': `Bearer ${jiraToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          jql: p0JqlQuery,
          fields: 'key',
          maxResults: 1000
        },
        httpsAgent: createHttpsAgent(),
        timeout: 30000
      });

      p0BugsCount = p0Response.data?.total || 0;
    } catch (error) {
      console.error('[generate-ai-vp-report] Error fetching P0 bugs:', error.message);
    }

    // Get commit items for detailed project data with enhanced fields
    let commitItems = [];
    let riskCounts = { red: 0, yellow: 0, green: 0, notSet: 0 };
    let projectDetails = { green: [], yellow: [], red: [] };

    try {
      const commitJQL = buildCommitItemsJQL(version);
      
      const commitResponse = await axios.get(JIRA_API_V2.SEARCH, {
        headers: {
          'Authorization': `Bearer ${jiraToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          jql: commitJQL,
          fields: 'key,summary,status,priority,assignee,customfield_23560,customfield_11067,customfield_35863,customfield_35864,customfield_23073,customfield_45660,customfield_10860,customfield_11065,customfield_27764,customfield_14463,customfield_31460',
          maxResults: 1000
        },
        httpsAgent: createHttpsAgent(),
        timeout: 30000
      });

      const rawItems = commitResponse.data?.issues || [];
      
      // Enhanced processing with automated analysis
      rawItems.forEach(item => {
        const fields = item.fields || {};
        const riskField = fields.customfield_23560;
        let riskLevel = 'notSet';
        
        if (riskField) {
          const riskValue = typeof riskField === 'object' ? (riskField.value || riskField.name || '') : String(riskField);
          const riskColor = typeof riskField === 'object' ? (riskField.color || '').toLowerCase() : '';
          const v = (riskValue || '').toLowerCase();
          
          if (riskColor === '#dc3545' || riskColor === 'red' || v.includes('red') || v.includes('high') || v.includes('critical')) {
            riskLevel = 'red';
          } else if (riskColor === '#ffc107' || riskColor === 'yellow' || v.includes('yellow') || v.includes('medium') || v.includes('at risk')) {
            riskLevel = 'yellow';
          } else if (riskColor === '#28a745' || riskColor === 'green' || v.includes('green') || v.includes('on track') || v.includes('low')) {
            riskLevel = 'green';
          }
        }
        
        riskCounts[riskLevel]++;
        
        // Enhanced project info with automated analysis - use consistent function
        const automatedAnalysis = analyzeProjectForExecutiveSummary(item);
        const projectInfo = {
          key: item.key,
          summary: fields.summary || 'No summary',
          status: fields.status?.name || 'Unknown',
          priority: fields.priority?.name || 'Not Set',
          assignee: fields.assignee?.displayName || fields.assignee?.name || 'Unassigned',
          risk: riskLevel,
          codeCompleteDate: fields.customfield_11067 || null,
          commitGateDate: fields.customfield_35863 || null,
          promotionGateDate: fields.customfield_35864 || null,
          statusUpdate: fields.customfield_23073 || null,
          statusUpdateDate: fields.customfield_45660 || null,
          qaContact: fields.customfield_10860?.displayName || fields.customfield_10860?.name || null,
          testLead: fields.customfield_11065?.displayName || fields.customfield_11065?.name || null,
          tpmOwner: fields.customfield_27764?.displayName || fields.customfield_27764?.name || null,
          requirementsLink: fields.customfield_14463 || null,
          tcmsLink: fields.customfield_31460 || null,
          automatedAnalysis: automatedAnalysis
        };
        
        if (riskLevel !== 'notSet') {
          projectDetails[riskLevel].push(projectInfo);
        }
      });

      commitItems = rawItems;
    } catch (error) {
      console.error('[generate-ai-vp-report] Error fetching commit items:', error.message);
    }

    // 2. Build comprehensive data package for AI
    const releaseData = {
      version: version,
      totalProjects: commitItems.length,
      p0BugsCount: p0BugsCount,
      riskCounts: riskCounts,
      projectDetails: projectDetails,
      dateMetrics: dateMetrics,
      generatedAt: new Date().toISOString(),
      // Add percentage calculations
      riskPercentages: {
        red: commitItems.length > 0 ? Math.round((riskCounts.red / commitItems.length) * 100) : 0,
        yellow: commitItems.length > 0 ? Math.round((riskCounts.yellow / commitItems.length) * 100) : 0,
        green: commitItems.length > 0 ? Math.round((riskCounts.green / commitItems.length) * 100) : 0,
        notSet: commitItems.length > 0 ? Math.round((riskCounts.notSet / commitItems.length) * 100) : 0
      }
    };

    // 3. Build VP Report prompt with improved formatting instructions
    const vpPrompt = buildVPReportPrompt(releaseData);

    console.log('[generate-ai-vp-report] Calling NAI API...');

    // 4. Call NAI API
    const naiResponse = await axios.post(
      'https://dpro-nai.corp.p10y.ntnxdpro.com/enterpriseai/v1/chat/completions',
      {
        model: 'eng-pool-05',
        messages: [
          {
            role: 'system',
            content: 'You are a technical program analyst creating executive VP reports. Write in a HUMAN READABLE format that busy executives can quickly scan and understand. Use simple bullet points, clear language, and avoid dense tables. Focus on specific, actionable information from the actual JIRA data provided. NEVER invent fake names, percentages, dates, or generic corporate phrases. Skip generic risk categories like "slight risk to plan" - only mention specific, actionable issues. Reference actual JIRA tickets and real status data. Be factual, concise, and immediately actionable.'
          },
          {
            role: 'user',
            content: vpPrompt
          }
        ],
        max_tokens: 4000,
        temperature: 0.3,
        top_p: 0.9
      },
      {
        headers: {
          'Authorization': `Bearer ${naiApiKey}`,
          'Content-Type': 'application/json'
        },
        timeout: 60000,
        httpsAgent: createHttpsAgent()
      }
    );

    if (!naiResponse.data?.choices?.[0]?.message?.content) {
      throw new Error('NAI API returned no content');
    }

    const aiGeneratedReport = naiResponse.data.choices[0].message.content;

    console.log('[generate-ai-vp-report] AI VP Report generated successfully');

    return res.json({
      success: true,
      data: {
        vpReport: aiGeneratedReport,
        releaseData: releaseData,
        generatedAt: new Date().toISOString(),
        version: version
      }
    });

  } catch (error) {
    console.error('[generate-ai-vp-report] Error generating AI VP report:', error.message);
    
    if (error.response?.status === 401) {
      return res.status(400).json({
        success: false,
        error: 'Invalid NAI API key'
      });
    } else if (error.response?.status === 429) {
      return res.status(429).json({
        success: false,
        error: 'NAI API rate limit exceeded - please try again later'
      });
    } else {
      return res.status(500).json({
        success: false,
        error: 'Failed to generate AI VP report',
        message: error.message
      });
    }
  }
});

/**
 * Analyze individual project risk using JIRA field data
 */
function analyzeProjectRisk(jiraItem) {
  const fields = jiraItem.fields || {};
  const analysis = {
    resourceGaps: [],
    timelineIssues: [],
    qualityMetrics: null,
    riskReasons: null,
    documentationGaps: []
  };

  // Resource Gap Analysis - Handle Nutanix's dual QA structure
  if (!fields.assignee) analysis.resourceGaps.push('No assignee assigned');
  
  // Check for QA/Testing resources (either QA Contact or Test Lead)
  const hasQaContact = fields.customfield_10860?.displayName || fields.customfield_10860?.name;
  const hasTestLead = fields.customfield_11065?.displayName || fields.customfield_11065?.name;
  if (!hasQaContact && !hasTestLead) {
    analysis.resourceGaps.push('No QA/Testing resource assigned');
  }
  
  if (!fields.customfield_27764) analysis.resourceGaps.push('No TPM Owner assigned');

  // Timeline Analysis
  const today = new Date();
  if (fields.customfield_11067) {
    const codeCompleteDate = new Date(fields.customfield_11067);
    if (codeCompleteDate < today && !fields.status?.name?.toLowerCase().includes('complete')) {
      const daysOverdue = Math.ceil((today - codeCompleteDate) / (1000 * 60 * 60 * 24));
      analysis.timelineIssues.push(`Code Complete overdue by ${daysOverdue} days`);
    }
  }

  // Status Update Freshness
  if (fields.customfield_45660) {
    const statusUpdateDate = new Date(fields.customfield_45660);
    const daysSinceUpdate = Math.ceil((today - statusUpdateDate) / (1000 * 60 * 60 * 24));
    if (daysSinceUpdate > 7) {
      analysis.timelineIssues.push(`Status update stale (${daysSinceUpdate} days old)`);
    }
  }

  // Quality Metrics from Status Text
  if (fields.customfield_23073) {
    const statusText = fields.customfield_23073;
    const qiMatch = statusText.match(/QI[:\s]*(\d+)%/i);
    const bugMatch = statusText.match(/(\d+)\s*open\s*bugs?/i);
    const execMatch = statusText.match(/execution[:\s]*(\d+)%/i);
    
    analysis.qualityMetrics = {
      qi: qiMatch ? parseInt(qiMatch[1]) : null,
      openBugs: bugMatch ? parseInt(bugMatch[1]) : null,
      executionRate: execMatch ? parseInt(execMatch[1]) : null
    };

    // Extract risk reasons
    const riskPatterns = [
      /reason\s+for\s+(red|yellow|risk)[:\s]*([^.]+)/i,
      /blocked\s+by[:\s]*([^.]+)/i,
      /waiting\s+on[:\s]*([^.]+)/i,
      /concern[:\s]*([^.]+)/i
    ];
    
    for (const pattern of riskPatterns) {
      const match = statusText.match(pattern);
      if (match) {
        analysis.riskReasons = match[1] || match[2] || match[0];
        break;
      }
    }
  }

  // Documentation Analysis
  if (!fields.customfield_14463) analysis.documentationGaps.push('No requirements link');
  if (!fields.customfield_31460) analysis.documentationGaps.push('No TCMS link');

  return analysis;
}

/**
 * Build optimized VP Report prompt - maximum insight with minimal tokens
 */
function buildVPReportPrompt(releaseData) {
  const { version, totalProjects, p0BugsCount, riskCounts, projectDetails, dateMetrics, riskPercentages } = releaseData;
  
  // Intelligent risk classification with specific thresholds
  let riskLevel = 'LOW';
  let criticalFactors = [];
  
  if (riskPercentages.red > 60) {
    riskLevel = 'CRITICAL';
    criticalFactors.push(`${riskPercentages.red}% high-risk projects`);
  } else if (riskPercentages.red > 30 || riskPercentages.yellow > 60) {
    riskLevel = 'HIGH';
    criticalFactors.push(`${riskPercentages.red}% red, ${riskPercentages.yellow}% yellow projects`);
  } else if (riskPercentages.red > 15 || riskPercentages.yellow > 40) {
    riskLevel = 'MEDIUM';
  }
  
  if (p0BugsCount > 3) criticalFactors.push(`${p0BugsCount} P0 blockers`);
  
  // Extract systemic patterns efficiently (avoid detailed project enumeration)
  let resourceIssues = 0;
  let timelineIssues = 0;
  let qualityConcerns = 0;
  
  projectDetails.red?.forEach(project => {
    const analysis = project.automatedAnalysis;
    if (!analysis) return;
    
    if (analysis.resourceStatus?.some(r => r.includes('Unassigned'))) resourceIssues++;
    if (analysis.timelineStatus?.some(t => t.includes('overdue') || t.includes('stale'))) timelineIssues++;
    if (analysis.qualityIndicators?.some(q => q.match(/QI:\s*([0-6]\d)%/))) qualityConcerns++;
  });

  const systemicIssues = [];
  if (resourceIssues > 2) systemicIssues.push(`${resourceIssues} projects with resource gaps`);
  if (timelineIssues > 2) systemicIssues.push(`${timelineIssues} projects with timeline compression`);
  if (qualityConcerns > 1) systemicIssues.push(`${qualityConcerns} projects below quality thresholds`);

  // Build detailed project information for AI context
  const projectSummaries = [];
  
  // Add RED projects with detailed analysis
  if (projectDetails.red?.length > 0) {
    projectSummaries.push(`HIGH RISK PROJECTS (${projectDetails.red.length}):`);
    projectDetails.red.forEach(project => {
      const analysis = project.automatedAnalysis;
      const issues = [];
      
      if (analysis?.resourceStatus?.some(r => r.includes('Unassigned'))) {
        issues.push('missing resources');
      }
      if (analysis?.timelineStatus?.some(t => t.includes('overdue'))) {
        issues.push('overdue timeline');
      }
      if (analysis?.qualityIndicators?.some(q => q.includes('QI: 0%'))) {
        issues.push('critical quality (0% QI)');
      }
      if (analysis?.riskFactors?.length > 0) {
        issues.push(analysis.riskFactors[0]); // First risk factor
      }
      
      projectSummaries.push(`- ${project.key}: ${project.summary.substring(0, 40)}... Status: ${project.status} | Issues: ${issues.join(', ') || 'general concerns'}`);
    });
  }
  
  // Add YELLOW projects summary
  if (projectDetails.yellow?.length > 0) {
    projectSummaries.push(`\nMEDIUM RISK PROJECTS (${projectDetails.yellow.length}):`);
    projectDetails.yellow.slice(0, 3).forEach(project => {
      const analysis = project.automatedAnalysis;
      const concerns = [];
      
      // Use actual risk factors instead of generic categories
      if (analysis?.riskFactors?.length > 0) {
        // Add all specific risk factors, not just the first one
        concerns.push(...analysis.riskFactors.slice(0, 2)); // Limit to first 2 to avoid overly long lines
      } else {
        // Fallback to specific timeline/resource issues if no risk factors found
        if (analysis?.timelineStatus?.some(t => t.includes('stale'))) {
          concerns.push('stale status updates');
        }
        if (analysis?.resourceStatus?.some(r => r.includes('Unassigned'))) {
          concerns.push('missing resource assignments');
        }
        if (analysis?.qualityIndicators?.some(q => q.includes('QI:'))) {
          const qiMatch = analysis.qualityIndicators.find(q => q.includes('QI:'));
          if (qiMatch) concerns.push(qiMatch);
        }
      }
      
      projectSummaries.push(`- ${project.key}: ${project.summary.substring(0, 40)}... Issues: ${concerns.join(' | ') || 'monitoring needed'}`);
    });
    if (projectDetails.yellow.length > 3) {
      projectSummaries.push(`... and ${projectDetails.yellow.length - 3} more yellow projects`);
    }
  }

  // Ultra-detailed, data-driven prompt
  const prompt = `NDB ${version} RELEASE STATUS ANALYSIS

CURRENT METRICS:
- Total Projects: ${totalProjects}
- Risk Distribution: ${riskPercentages.red}% RED / ${riskPercentages.yellow}% YELLOW / ${riskPercentages.green}% GREEN
- P0 Blocker Bugs: ${p0BugsCount}
- Days to Promotion Gate: ${dateMetrics.daysFromCutoff || 'TBD'}
- Current Milestone: ${dateMetrics.currentPGDate || 'Not set'}

DETAILED PROJECT STATUS:
${projectSummaries.join('\n')}

SYSTEMIC ISSUES DETECTED:
- Resource Gaps: ${resourceIssues} projects missing assignments
- Timeline Pressure: ${timelineIssues} projects with schedule issues  
- Quality Concerns: ${qualityConcerns} projects below QI thresholds

CRITICAL FORMATTING AND CONTENT REQUIREMENTS:

1. **HUMAN READABLE FORMAT**: 
   - Use clear bullet points and simple language
   - Avoid dense tables and corporate jargon
   - Write as if explaining to a busy executive who needs to quickly understand the situation
   - Use short paragraphs and clear section headers

2. **EXECUTIVE SUMMARY SECTION**: 
   - Start with key numbers: Portfolio size, risk distribution percentages, critical blockers
   - List HIGH-RISK projects in simple bullet format with their specific issues
   - For YELLOW projects, only mention if they have specific, actionable concerns (not "slight risk to plan")
   - Identify systemic issues like resource gaps, timeline pressure, quality concerns

3. **PREDICTIONS SECTION**:
   - Focus on what will likely happen if no action is taken
   - Give specific timeline impacts (e.g., "gate could slip by 2-3 days")
   - Mention probability of projects moving between risk levels
   - Base predictions on actual data patterns, not invented confidence numbers

4. **ACTIONS SECTION**:
   - List concrete, actionable items with role-based owners (not fake names)
   - Include specific deadlines based on the timeline data
   - Reference actual JIRA tickets that need attention
   - Focus on actions that address the systemic issues identified

5. **CONTENT RULES**:
   - ONLY use the specific project data provided above
   - NEVER invent fake percentages, delivery confidence numbers, or made-up names
   - Reference actual JIRA tickets by their keys (FEAT-XXXXX, ERA-XXXXX)
   - Skip generic risk reasons like "slight risk to plan" - only mention specific, actionable issues
   - Be factual and data-driven, avoiding phrases like "cascade into schedule slips" or "erode confidence"

Generate a VP executive report that follows these requirements exactly.`;

  return prompt;
}

/**
 * Extract meaningful risk reasoning from Risk Indicator field and Status Update
 */
function extractRiskReasoning(jiraItem) {
  const fields = jiraItem.fields || {};
  const riskField = fields.customfield_23560;
  const statusUpdate = fields.customfield_23073;
  
  // Generic Nutanix risk categories that are not specific enough
  const genericCategories = [
    'slight risk to plan',
    'on track',
    'at risk', 
    'high risk',
    'critical',
    'green',
    'yellow',
    'red',
    'on plan',
    'slight risk'
  ];
  
  // First, try to extract from Risk Indicator field
  if (riskField) {
    // Handle both object and string formats
    let riskValue = '';
    if (typeof riskField === 'object' && riskField !== null) {
      riskValue = riskField.value || riskField.name || String(riskField);
    } else {
      riskValue = String(riskField);
    }
    
    // Extract reasoning after dash or colon
    const reasoningPatterns = [
      /(?:yellow|red|green)\s*[-:]\s*(.+)/i,
      /at\s+risk\s*[-:]\s*(.+)/i,
      /critical\s*[-:]\s*(.+)/i,
      /high\s+risk\s*[-:]\s*(.+)/i,
      /medium\s+risk\s*[-:]\s*(.+)/i
    ];
    
    for (const pattern of reasoningPatterns) {
      const match = riskValue.match(pattern);
      if (match && match[1] && match[1].trim().length > 5) {
        const reasoning = match[1].trim().toLowerCase();
        // Skip if it's just a generic category
        if (!genericCategories.some(cat => reasoning.includes(cat))) {
          return match[1].trim();
        }
      }
    }
  }
  
  // If Risk Indicator doesn't have specific reasoning, look in Status Update
  if (statusUpdate && typeof statusUpdate === 'string') {
    const statusText = statusUpdate.trim();
    
    // Look for explicit risk explanations in status update
    const statusRiskPatterns = [
      /(?:reason\s+for\s+(?:yellow|red|risk))[:\s]*([^.\n]{15,})/i,
      /(?:blocked\s+by)[:\s]*([^.\n]{10,})/i,
      /(?:waiting\s+(?:on|for))[:\s]*([^.\n]{10,})/i,
      /(?:concern|issue)[:\s]*([^.\n]{15,})/i,
      /(?:dependency\s+on)[:\s]*([^.\n]{10,})/i,
      /(?:resource\s+constraint)[:\s]*([^.\n]{10,})/i
    ];
    
    for (const pattern of statusRiskPatterns) {
      const match = statusText.match(pattern);
      if (match && match[1] && match[1].trim().length > 10) {
        const reasoning = match[1].trim();
        // Clean up the reasoning (remove extra whitespace, limit length)
        const cleanReasoning = reasoning.replace(/\s+/g, ' ').substring(0, 100).trim();
        if (cleanReasoning.length > 10) {
          return cleanReasoning;
        }
      }
    }
  }
  
  return null; // Only return meaningful, specific risk reasoning
}

/**
 * Analyze individual project for executive summary using JIRA field data
 */
function analyzeProjectForExecutiveSummary(jiraItem) {
  const fields = jiraItem.fields || {};
  const analysis = {
    resourceStatus: [],
    timelineStatus: [],
    qualityIndicators: [],
    riskFactors: [],
    documentationStatus: []
  };

  // Extract risk reasoning from Risk Indicator field first
  const riskReasoning = extractRiskReasoning(jiraItem);
  if (riskReasoning) {
    analysis.riskFactors.unshift(`Risk Reason: ${riskReasoning}`);
  }

  // Intelligent Resource Analysis - Smart role differentiation
  const qaContact = fields.customfield_10860?.displayName || fields.customfield_10860?.name;
  const testLead = fields.customfield_11065?.displayName || fields.customfield_11065?.name;
  const tpmOwner = fields.customfield_27764?.displayName || fields.customfield_27764?.name;
  const assignee = fields.assignee?.displayName || fields.assignee?.name;

  // Core development responsibility
  if (assignee) analysis.resourceStatus.push(`Dev: ${assignee}`);
  else analysis.resourceStatus.push('Dev: Unassigned');

  // QA/Testing coverage - intelligent handling of Nutanix's dual structure
  const primaryQA = qaContact || testLead;
  if (primaryQA) {
    // Use most appropriate label based on populated field
    const qaLabel = qaContact ? 'QA' : 'Test Lead';
    analysis.resourceStatus.push(`${qaLabel}: ${primaryQA}`);
    
    // Show secondary QA role only if both exist and are different people
    if (qaContact && testLead && qaContact !== testLead) {
      analysis.resourceStatus.push(`Test Lead: ${testLead}`);
    }
  } else {
    analysis.resourceStatus.push('QA: Unassigned');
  }
  
  // Program management oversight
  if (tpmOwner) analysis.resourceStatus.push(`TPM: ${tpmOwner}`);
  else analysis.resourceStatus.push('TPM: Unassigned');

  // Intelligent Timeline Analysis with validation
  const today = new Date();
  
  // Code Complete analysis with smart validation
  if (fields.customfield_11067) {
    try {
      const codeCompleteDate = new Date(fields.customfield_11067);
      // Validate date is reasonable (not in far future, not ancient)
      const yearDiff = codeCompleteDate.getFullYear() - today.getFullYear();
      if (yearDiff > -5 && yearDiff < 5 && !isNaN(codeCompleteDate.getTime())) {
        const status = fields.status?.name?.toLowerCase() || '';
        const isCompleteStatus = status.includes('complete') || status.includes('done') || status.includes('closed');
        const isOverdue = codeCompleteDate < today && !isCompleteStatus;
        
        if (isOverdue) {
          const daysOverdue = Math.ceil((today - codeCompleteDate) / (1000 * 60 * 60 * 24));
          if (daysOverdue > 90) {
            analysis.timelineStatus.push(`Code Complete severely overdue (${daysOverdue} days)`);
          } else {
            analysis.timelineStatus.push(`Code Complete overdue ${daysOverdue} days`);
          }
        } else if (codeCompleteDate > today) {
          const daysRemaining = Math.ceil((codeCompleteDate - today) / (1000 * 60 * 60 * 24));
          analysis.timelineStatus.push(`Code Complete in ${daysRemaining} days`);
        } else {
          analysis.timelineStatus.push(`Code Complete: ${codeCompleteDate.toLocaleDateString()}`);
        }
      }
    } catch (error) {
      console.warn(`Invalid Code Complete date for ${jiraItem.key}: ${fields.customfield_11067}`);
    }
  }

  // Status update freshness with intelligent categorization
  if (fields.customfield_45660) {
    try {
      const statusUpdateDate = new Date(fields.customfield_45660);
      if (!isNaN(statusUpdateDate.getTime())) {
        const daysSinceUpdate = Math.ceil((today - statusUpdateDate) / (1000 * 60 * 60 * 24));
        if (daysSinceUpdate < 0) {
          analysis.timelineStatus.push('Status update date in future (data issue)');
        } else if (daysSinceUpdate > 21) {
          analysis.timelineStatus.push(`Status severely stale (${daysSinceUpdate} days)`);
        } else if (daysSinceUpdate > 7) {
          analysis.timelineStatus.push(`Status stale (${daysSinceUpdate} days)`);
        } else if (daysSinceUpdate === 0) {
          analysis.timelineStatus.push('Updated today');
        } else {
          analysis.timelineStatus.push(`Updated ${daysSinceUpdate} days ago`);
        }
      }
    } catch (error) {
      console.warn(`Invalid status update date for ${jiraItem.key}: ${fields.customfield_45660}`);
    }
  } else {
    analysis.timelineStatus.push('No status update date available');
  }

  // Advanced Quality Analysis from Status Text with validation
  if (fields.customfield_23073 && typeof fields.customfield_23073 === 'string') {
    const statusText = fields.customfield_23073.trim();
    
    if (statusText.length > 0) {
      // Extract QI percentage with validation
      const qiMatch = statusText.match(/QI[:\s]*(\d+)%/i);
      if (qiMatch) {
        const qi = parseInt(qiMatch[1]);
        if (qi >= 0 && qi <= 100) {
          analysis.qualityIndicators.push(`QI: ${qi}%`);
          if (qi < 50) analysis.riskFactors.push(`Critical QI (${qi}%)`);
          else if (qi < 70) analysis.riskFactors.push(`Low QI (${qi}%)`);
        }
      }

      // Extract bug counts with intelligent parsing
      const bugPatterns = [
        /(\d+)\s*open\s*bugs?/i,
        /(\d+)\s*active\s*bugs?/i,
        /(\d+)\s*outstanding\s*(?:bugs?|issues?)/i,
        /bugs?[:\s]*(\d+)/i
      ];
      
      for (const pattern of bugPatterns) {
        const bugMatch = statusText.match(pattern);
        if (bugMatch) {
          const bugs = parseInt(bugMatch[1]);
          if (bugs >= 0 && bugs < 1000) { // Sanity check
            analysis.qualityIndicators.push(`${bugs} open bugs`);
            if (bugs > 10) analysis.riskFactors.push(`High bug count (${bugs})`);
            else if (bugs > 5) analysis.riskFactors.push(`Elevated bug count (${bugs})`);
            break; // Use first match found
          }
        }
      }

      // Extract execution rate with validation
      const execPatterns = [
        /execution[:\s]*(\d+)%/i,
        /(\d+)%\s*execution/i,
        /executed[:\s]*(\d+)%/i
      ];
      
      for (const pattern of execPatterns) {
        const execMatch = statusText.match(pattern);
        if (execMatch) {
          const exec = parseInt(execMatch[1]);
          if (exec >= 0 && exec <= 100) {
            analysis.qualityIndicators.push(`Execution: ${exec}%`);
            if (exec < 50) analysis.riskFactors.push(`Low execution rate (${exec}%)`);
            break;
          }
        }
      }

      // Intelligent risk reason extraction with context preservation
      const riskPatterns = [
        { pattern: /reason\s+for\s+(red|yellow|risk)[:\s]*([^.\n]{10,})/i, type: 'Risk Reason', minLength: 10 },
        { pattern: /blocked\s+by[:\s]*([^.\n]{5,})/i, type: 'Blocker', minLength: 5 },
        { pattern: /waiting\s+on[:\s]*([^.\n]{5,})/i, type: 'Dependency', minLength: 5 },
        { pattern: /concern[:\s]*([^.\n]{10,})/i, type: 'Concern', minLength: 10 },
        { pattern: /risk[:\s]*([^.\n]{10,})/i, type: 'Risk', minLength: 10 }
      ];
      
      for (const riskPattern of riskPatterns) {
        const match = statusText.match(riskPattern.pattern);
        if (match) {
          const reason = (match[2] || match[1] || match[0]).trim();
          if (reason.length >= riskPattern.minLength && reason.length < 200) {
            analysis.riskFactors.push(`${riskPattern.type}: ${reason}`);
            break; // Avoid multiple similar risk reasons
          }
        }
      }
    }
  }

  // Documentation Analysis
  if (fields.customfield_14463) analysis.documentationStatus.push('Requirements linked');
  else analysis.documentationStatus.push('Requirements missing');
  
  if (fields.customfield_31460) analysis.documentationStatus.push('TCMS linked');
  else analysis.documentationStatus.push('TCMS missing');

  return analysis;
}

module.exports = router;
