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
  constructParentProjectFilter,
  getConfigOverride,
  getReleaseBaseFilter,
  sendServiceError,
} = require('../../utils/jiraRouteHelpers');

// Use validateJiraTokenMiddleware consistently throughout this file

/**
 * Simple diagnostic endpoint to test basic JIRA connectivity
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
      const jira = await getJira(cleanToken);
      const response = await jira.get(issueUrl, {
        timeout: 30000,
        params: {
          expand: 'changelog',
          fields: `${checkpointFields.codeComplete},${checkpointFields.commitGate},${checkpointFields.promotionGate}`
        }
      });

      const issue = response.data;
      
      // Use pagination utility to fetch all changelog histories
      const paginationResult = await fetchAllChangelogHistories(
        baseUrl,
        jiraKey,
        issue.id || null, // Pass issue ID for Strategy 2
        cleanToken,
        null,
        null,
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

router.get('/test-changelog/:key', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { key } = req.params;
    const baseUrl = JIRA_API_V2.BASE_URL;
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
    
    const jira = await getJira(cleanToken);
    const responseWithFields = await jira.get(issueUrl, {
      timeout: 30000,
      params: {
        expand: 'changelog',
        fields: Object.values(checkpointFields).join(',')
      }
    });
    
    // Test 2: WITHOUT fields parameter
    const responseWithoutFields = await jira.get(issueUrl, {
      timeout: 30000,
      params: {
        expand: 'changelog'
      }
    });
    
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

module.exports = router;
