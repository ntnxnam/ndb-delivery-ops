const express = require('express');
const router = express.Router();
const { JIRA_API_V2 } = require('../../config/api');
const logger = require('../../utils/logger');
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

const { getAllFields, getFieldId, getFieldValue, buildFieldIdsString } = require('../../utils/jiraFieldsConfig');
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
const execSummaryService = require('../../services/execSummaryService');

const NODE_ENV = process.env.NODE_ENV || 'development';
const RISK_FIELD_ID = getFieldId('riskIndicator');
const EXEC_SUMMARY_FIELD_KEYS = execSummaryService.EXEC_FIELD_KEYS || [
  'riskIndicator',
  'statusUpdate',
  'statusUpdateDate',
  'qaContact',
  'testLead',
  'tpmOwner',
  'codeComplete',
  'commitGate',
  'promotionGate',
  'requirementsLink',
  'tcmsLink'
];

// RELEASE_ITEMS_CONFIG now lives in server/services/releaseItemsService.js
// (re-exported via releaseItemsService._internals.RELEASE_ITEMS_CONFIG for any
// route helper that still needs to read the limits directly).

const SPRINT_REPORT_CHANGELOG_CONCURRENCY = 5;
const SPRINT_TRENDS_SPRINT_CONCURRENCY = 3;
const SPRINT_TRENDS_CHANGELOG_CONCURRENCY = 5;

// Standard JIRA field names for search (excluding key which is on issue root)
const STANDARD_FIELD_NAMES = 'summary,status,assignee,reporter,issuetype,priority,fixVersions,labels,duedate,watchers,resolution,created,updated,description';

const { formatDate } = require('../../utils/dateFormatter');
const {
  calculateEnhancedAnalytics: calculateEnhancedAnalyticsShared,
  generateEnhancedExecutiveSummary,
} = require('../../../../../shared/src/domain/execSummaryAnalytics.cjs');
const { extractTextFieldValue } = require('../../utils/adfText');
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

    // Generate executive summary using Team Executive report logic
    const execSummary = execSummaryService.generateExecutiveSummary(version, commitItems, riskCounts, breakdownData);

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

    // Reuse existing release APIs instead of duplicate JIRA calls
    
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

function calculateEnhancedAnalytics(version, featItems, nonFeatItems) {
  return calculateEnhancedAnalyticsShared(version, featItems, nonFeatItems, {
    gateDates: releaseVersionsEmailConfig.releaseGateDates?.[version] || null,
    formatDate,
    now: new Date(),
    riskFieldId: RISK_FIELD_ID,
  });
}

/**
 * Get Team Configurations for VooDoo Agent Platform - TEMPORARILY DISABLED FOR DEBUGGING
 * GET /api/jira/team-configurations
 */

router.post('/create-universal-agent-input', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const { version, teamIdentifier } = req.body;
    const jiraToken = req.jiraToken;

    if (!version) {
      return res.status(400).json({ success: false, error: 'version is required' });
    }

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

router.get('/executive-summary-unified', validateJiraTokenMiddleware, async (req, res) => {
  try {
    // Handle both direct query params and nested params structure
    const version = req.query.version || req.query.params?.version;
    
    if (!version || version.trim() === '') {
      return res.status(400).json({ 
        success: false, 
        error: 'version parameter is required and cannot be empty' 
      });
    }

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
      
      const jira = await getJira(jiraToken);
      p0BugsCount = await jira.searchCount(p0JqlQuery);
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
      const jira = await getJira(jiraToken);
      const commitResponse = await jira.get(JIRA_API_V2.SEARCH, {
        timeout: 30000,
        params: {
          jql: commitJQL,
          fields: `key,summary,status,priority,assignee,${buildFieldIdsString(EXEC_SUMMARY_FIELD_KEYS)}`,
          maxResults: 1000
        },
      });

      const rawItems = commitResponse.data?.issues || [];
      
      // Process items for risk breakdown and project details
      rawItems.forEach(issue => {
        const key = issue.key;
        const summary = issue.fields?.summary || 'No summary';
        const status = issue.fields?.status?.name || 'Unknown';
        const priority = issue.fields?.priority?.name || 'N/A';
        
        // Process risk indicator
        const rawRiskIndicator = getFieldValue(issue.fields, 'riskIndicator') || issue.fields?.[RISK_FIELD_ID];
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

module.exports = router;
