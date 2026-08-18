const express = require('express');
const router = express.Router();
const axios = require('axios');
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
  constructParentProjectFilter,
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

  // Reuse shared formatter so all human-readable dates are consistent.
  const formatMilestoneDate = (date) => {
    if (!date) return null;
    return formatDate(date);
  };

  // Helper function to process milestone gates
  const processMilestones = (gatePrefix) => {
    const milestones = [];
    let currentDate = null;
    
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
      
      if (!gate) break;
      
      if (Array.isArray(gate)) {
        // Handle array format (multiple milestones in one gate)
        gate.forEach(milestone => {
          milestones.push({
            label: milestone.label,
            date: milestone.date,
            formattedDate: formatMilestoneDate(new Date(milestone.date)),
            isStrikeThrough: milestone.style === 'dotted',
            isCurrent: milestone.style === 'solid'
          });
          
          if (milestone.style === 'solid') {
            currentDate = formatMilestoneDate(new Date(milestone.date));
          }
        });
      } else {
        // Handle object format (single milestone)
        milestones.push({
          label: gate.label,
          date: gate.date,
          formattedDate: formatMilestoneDate(new Date(gate.date)),
          isStrikeThrough: gate.style === 'dotted',
          isCurrent: gate.style === 'solid'
        });
        
        if (gate.style === 'solid') {
          currentDate = formatMilestoneDate(new Date(gate.date));
        }
      }
      
      gateNum++;
    }
    
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
  if (currentPGMilestone) {
    const pgDate = new Date(currentPGMilestone.date);
    const diffTime = pgDate - now;
    daysToPG = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
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
  const getRiskFromItem = (item) => {
    // Handle both processed items (from APIs) and raw JIRA items
    let risk;
    if (item.riskIndicator) {
      // Processed item from existing APIs
      risk = item.riskIndicator;
    } else if (item.fields?.customfield_23560) {
      // Raw JIRA item
      risk = getFieldValue(item.fields, 'riskIndicator') || item.fields[RISK_FIELD_ID] || item.fields.customfield_23560;
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
    return risk.includes('not set') || risk === '' || !(item[RISK_FIELD_ID] || item.customfield_23560);
  });

  return {
    green: greens.length,
    yellow: yellows.length,
    red: reds.length,
    notSet: notSet.length,
    total: items.length
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
      const commitResponse = await axios.get(JIRA_API_V2.SEARCH, {
        headers: {
          'Authorization': `Bearer ${jiraToken}`,
          'Content-Type': 'application/json'
        },
        params: {
          jql: commitJQL,
          fields: `key,summary,status,priority,assignee,${buildFieldIdsString(EXEC_SUMMARY_FIELD_KEYS)}`,
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
