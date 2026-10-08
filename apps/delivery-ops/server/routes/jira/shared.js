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
    
    const apiUrl = JIRA_API_V2.ISSUE(jiraKey);

    try {
      const jira = await getJira(cleanToken);
      const response = await jira.get(apiUrl, {
        timeout: 30000,
        params: {
          fields: 'issuetype,summary,status,fixVersions'
        }
      });

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
      
      const fixVersionNames = response.data.fields?.fixVersions;
      return res.json({
        valid: true,
        issueType: issueType,
        summary: response.data.fields?.summary || 'N/A',
        status: response.data.fields?.status?.name || 'N/A',
        key: response.data.key,
        fixVersions: Array.isArray(fixVersionNames) && fixVersionNames.length > 0
          ? fixVersionNames.map(v => v.name).filter(Boolean).join(', ')
          : 'N/A'
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

router.post('/fetch-all-jira-tickets', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { jiraKey, jiraData } = req.body;

    if (!jiraKey) {
      return res.status(400).json({ error: 'JIRA key is required' });
    }

    // Use validated token from middleware
    const cleanToken = req.jiraToken;
    const baseUrl = JIRA_API_V2.BASE_URL;
    const jira = await getJira(cleanToken);
    
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
        const mainTicketResponse = await jira.get(`${baseUrl}/rest/api/2/issue/${jiraKey}`, {
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
      const response = await jira.get(searchUrl, {
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
          const mainTicketResponse = await jira.get(`${baseUrl}/rest/api/2/issue/${jiraKey}`, {
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
          const fieldResponse = await jira.get(fieldMetadataUrl, {
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
    const jira = await getJira(cleanToken);
    
    // JIRA uses PAT (Personal Access Token) with Bearer authentication
    // Use only API v2 direct issue endpoint
    const apiUrl = `${baseUrl}/rest/api/2/issue/${jiraKey}`;
    
    logger.jira.fetch(jiraKey, 'FETCH_TICKET', `Fetching JIRA ticket using API v2`, { apiUrl, tokenLength: cleanToken.length });
    
    try {
      // For API v2, use expand=names to get custom field display names
      const response = await jira.get(apiUrl, {
        timeout: 30000,
        params: {
          fields: 'key,summary,status,issuetype,fixVersions,labels,reporter,assignee,watchers,customfield_11067,customfield_11068,customfield_13861,customfield_23073,customfield_35863,customfield_35864,customfield_45660,customfield_23560,customfield_47780,customfield_55664,customfield_14463,customfield_31460,customfield_14464,customfield_14465,customfield_55662,customfield_55663,customfield_11260,customfield_10860,customfield_11960,customfield_27764,customfield_38460',
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
        const fieldResponse = await jira.get(fieldMetadataUrl, {
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
        'customfield_55662': fields.customfield_55662,
        'customfield_55663': fields.customfield_55663,
        'customfield_47780': fields.customfield_47780,
        'customfield_55664': fields.customfield_55664,
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
        customfield_55662: {
          name: getFieldName('customfield_55662'),
          value: formatLinkField(customFields.customfield_55662)
        },
        customfield_55663: {
          name: getFieldName('customfield_55663'),
          value: formatLinkField(customFields.customfield_55663)
        },
        customfield_47780: {
          name: getFieldName('customfield_47780'),
          value: formatCustomFieldValue(customFields.customfield_47780)
        },
        customfield_55664: {
          name: getFieldName('customfield_55664'),
          value: formatCustomFieldValue(customFields.customfield_55664)
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

module.exports = router;
