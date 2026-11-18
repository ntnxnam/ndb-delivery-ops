/**
 * VooDoo AI Service
 * 
 * Handles integration with Nutanix VooDoo AI platform for generating
 * executive summaries and release predictions.
 */

const fetch = require('node-fetch');

const aiConfig = require('../config/aiConfig.json');
const VOODOO_CONFIG = {
  endpoint: (process.env.AI_API_BASE_URL || aiConfig.baseUrl).replace(/\/$/, '') + '/chat/completions',
  model: process.env.AI_DEFAULT_MODEL || aiConfig.defaultModel,
  maxTokens: parseInt(process.env.AI_MAX_TOKENS, 10) || aiConfig.maxTokens,
  temperature: 0.7
};

/**
 * Generate AI summary using VooDoo platform with team-agnostic architecture
 * @param {Object} releaseData - Comprehensive release data
 * @param {string} apiKey - User's VooDoo API key
 * @param {Object} teamConfig - Team-specific configuration (optional)
 * @returns {Object} AI-generated summary response
 */
async function generateAISummary(releaseData, apiKey, teamConfig = null) {
  if (!apiKey) {
    throw new Error('VooDoo API key is required');
  }

  const prompt = buildExecutivePrompt(releaseData, teamConfig);

  const response = await fetch(VOODOO_CONFIG.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: VOODOO_CONFIG.model,
      messages: [
        {
          role: 'user',
          content: prompt
        }
      ],
      max_tokens: VOODOO_CONFIG.maxTokens,
      temperature: VOODOO_CONFIG.temperature,
      stream: false
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`VooDoo API error: ${response.status} ${response.statusText}. ${errorText}`);
  }

  const result = await response.json();
  
  if (!result.choices || result.choices.length === 0) {
    throw new Error('No response received from VooDoo AI');
  }

  return {
    content: result.choices[0].message.content,
    usage: result.usage,
    model: result.model,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Build team-agnostic executive prompt for VooDoo AI
 * @param {Object} releaseData - Release analytics data  
 * @param {Object} teamConfig - Team-specific configuration (optional)
 * @returns {string} Formatted prompt
 */
function buildExecutivePrompt(releaseData, teamConfig = null) {
  // Extract team configuration or use defaults for NDB
  const config = teamConfig || {
    teamName: "NDB Team",
    productArea: "Database Services",
    projectType: "Release",
    strategicWorkLabel: "FEAT Projects",
    operationalWorkLabel: "Non-FEAT Work",
    communicationStyle: "DISC-optimized (concise for D-types, detailed for C-types)",
    gateTypes: ["Code Complete", "Commit Gate", "Promotion Gate"]
  };

  const { 
    version, 
    analytics: { riskCounts, featVsNonFeat, daysFromCutoff, currentCGDate, metrics, qualityIndex, gateReadiness }
  } = releaseData;

  return `Generate a concise executive summary for ${config.teamName}'s ${version} ${config.projectType.toLowerCase()} targeting data-oriented leadership.

TEAM CONTEXT:
- Product Area: ${config.productArea}
- Strategic Work Type: ${config.strategicWorkLabel} 
- Operational Work Type: ${config.operationalWorkLabel}
- Communication Style: ${config.communicationStyle}

RELEASE STATUS OVERVIEW:
- ${riskCounts.total} ${config.strategicWorkLabel.toLowerCase()} committed to ${version}
- Risk Distribution: ${riskCounts.green} Green, ${riskCounts.yellow} Yellow, ${riskCounts.red} Red, ${riskCounts.notSet} Not Set
- Timeline: ${daysFromCutoff ? (daysFromCutoff > 0 ? `${daysFromCutoff} days PAST` : `${Math.abs(daysFromCutoff)} days until`) : 'Unknown position relative to'} ${config.gateTypes[1] || 'Commit Gate'} (${currentCGDate})

WORK BREAKDOWN ANALYSIS:
- Strategic ${config.strategicWorkLabel}: ${featVsNonFeat.featTotal} items (${featVsNonFeat.featP0P1} P0/P1 outstanding)
- Operational ${config.operationalWorkLabel}: ${featVsNonFeat.nonFeatTotal} items (${featVsNonFeat.nonFeatP0P1} P0/P1 outstanding)
- Scope Creep Indicator: ${featVsNonFeat.featPostCC + featVsNonFeat.nonFeatPostCC} items created post-${config.gateTypes[0] || 'Code Complete'}
- Execution Velocity: ${featVsNonFeat.featInProgress + featVsNonFeat.nonFeatInProgress} items actively in progress

KEY PERFORMANCE INDICATORS:
${Object.entries(metrics).map(([key, metric]) => 
  `- ${metric.label}: ${config.strategicWorkLabel} ${metric.feat} | ${config.operationalWorkLabel} ${metric.nonFeat} | Total ${metric.total}`
).join('\n')}

QUALITY INDICATORS:
${qualityIndex ? `- ${config.strategicWorkLabel} Quality Index: ${qualityIndex.featProjects.score}/100 (${qualityIndex.featProjects.status})
- ${config.operationalWorkLabel} Quality Index: ${qualityIndex.nonFeatWork.score}/100 (${qualityIndex.nonFeatWork.status})` : '- Quality metrics not available'}

GATE READINESS ASSESSMENT:
${gateReadiness ? `- Overall Readiness Score: ${gateReadiness.overallScore}/100 (${gateReadiness.overallStatus})
- Development Readiness: ${gateReadiness.categories.developmentReadiness?.score || 'N/A'}/100
- Timeline Readiness: ${gateReadiness.categories.timelineReadiness?.score || 'N/A'}/100
- Documentation Readiness: ${gateReadiness.categories.documentationReadiness?.score || 'N/A'}/100
- Quality Readiness: ${gateReadiness.categories.qualityReadiness?.score || 'N/A'}/100` : '- Gate readiness assessment not available'}

CRITICAL FOCUS AREAS:
${riskCounts.red > 0 ? `- HIGH PRIORITY: ${riskCounts.red} red ${config.strategicWorkLabel.toLowerCase()} requiring immediate executive intervention` : ''}
${featVsNonFeat.featOverdue > 0 || featVsNonFeat.nonFeatOverdue > 0 ? `- TIMELINE RISK: ${featVsNonFeat.featOverdue + featVsNonFeat.nonFeatOverdue} overdue items impacting delivery` : ''}
${featVsNonFeat.featPostCC + featVsNonFeat.nonFeatPostCC > 10 ? `- SCOPE RISK: Significant post-${config.gateTypes[0] || 'Code Complete'} work creation indicating scope instability` : ''}
${gateReadiness && gateReadiness.overallScore < 70 ? `- READINESS RISK: Gate readiness score below threshold, review ${gateReadiness.recommendations?.[0]?.category || 'critical areas'}` : ''}

EXECUTIVE SUMMARY REQUIREMENTS:
Generate a 3-paragraph executive summary following this structure:

1. OVERALL RELEASE HEALTH (1-2 sentences):
   - Clear RED/YELLOW/GREEN status assessment
   - Timeline position and gate readiness
   - Strategic project execution confidence level

2. RESOURCE ALLOCATION & SCOPE MANAGEMENT (2-3 sentences):
   - ${config.strategicWorkLabel} vs ${config.operationalWorkLabel} distribution analysis
   - Resource pressure points and bottlenecks
   - Scope management effectiveness (post-${config.gateTypes[0] || 'Code Complete'} creation trends)
   - Quality Index trends and improvement areas

3. LEADERSHIP ACTION RECOMMENDATIONS (2-3 sentences):
   - Immediate decisions required for red ${config.strategicWorkLabel.toLowerCase()}
   - Resource reallocation suggestions based on gate readiness scores
   - Timeline risk mitigation strategies
   - Quality improvement initiatives based on QI analysis

COMMUNICATION ADAPTATION:
${config.communicationStyle.includes('DISC') ? 
  `- Provide executive summary in DISC format: key decisions first, then supporting data
  - Use specific metrics and concrete recommendations for data-oriented leadership` :
  `- Adapt communication style to: ${config.communicationStyle}`}

Focus on ACTIONABLE INSIGHTS that enable quick executive decision-making. Use data-driven language with specific numbers. Avoid generic statements - provide concrete recommendations based on the comprehensive metrics provided including quality indices and gate readiness assessments.`;
}

/**
 * Validate VooDoo API key by making a test call
 * @param {string} apiKey - API key to validate
 * @returns {Promise<boolean>} True if key is valid
 */
async function validateAPIKey(apiKey) {
  try {
    const response = await fetch(VOODOO_CONFIG.endpoint, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'accept': 'application/json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: VOODOO_CONFIG.model,
        messages: [
          {
            role: 'user',
            content: 'Test connection. Respond with "OK".'
          }
        ],
        max_tokens: 10,
        stream: false
      })
    });

    return response.ok;
  } catch (error) {
    console.error('VooDoo API key validation failed:', error.message);
    return false;
  }
}

/**
 * Get team configuration based on version or team name
 * @param {string} identifier - Version string or team name
 * @returns {Object|null} Team configuration or null if not found
 */
function getTeamConfiguration(identifier) {
  const teamConfigurations = require('../config/teamConfigurations.json');
  
  // Direct team name lookup
  if (teamConfigurations[identifier]) {
    return teamConfigurations[identifier];
  }
  
  // Auto-detect from version pattern
  const versionUpper = identifier.toUpperCase();
  if (versionUpper.includes('NDB')) return teamConfigurations.NDB;
  if (versionUpper.includes('AOS')) return teamConfigurations.AOS;
  if (versionUpper.includes('FILES')) return teamConfigurations.Files;
  if (versionUpper.includes('OBJECTS')) return teamConfigurations.Objects;
  
  return null;
}

/**
 * Create team-agnostic VooDoo agent input structure
 * @param {Object} releaseData - Release analytics data
 * @param {string} teamIdentifier - Team name or version string
 * @returns {Object} Standardized agent input
 */
function createUniversalAgentInput(releaseData, teamIdentifier) {
  const teamConfig = getTeamConfiguration(teamIdentifier) || {
    teamName: "Unknown Team",
    productArea: "General",
    strategicWorkLabel: "Strategic Work",
    operationalWorkLabel: "Operational Work"
  };

  const { version, analytics } = releaseData;

  return {
    // Team/Project Context
    teamName: teamConfig.teamName,
    productArea: teamConfig.productArea,
    projectType: teamConfig.projectTypes?.[0] || "Release",
    version: version,
    
    // Configurable Work Categories  
    strategicWork: {
      label: teamConfig.strategicWorkLabel,
      items: analytics.featVsNonFeat?.featTotal || 0,
      criteria: `Strategic initiatives and ${teamConfig.strategicWorkLabel.toLowerCase()}`
    },
    operationalWork: {
      label: teamConfig.operationalWorkLabel,
      items: analytics.featVsNonFeat?.nonFeatTotal || 0,
      criteria: `${teamConfig.operationalWorkLabel} including operational tasks, bugs, and maintenance`
    },
    
    // Team-Configurable Gate Templates
    gateTemplates: {
      gates: teamConfig.gateTypes || ["Code Complete", "Commit Gate", "Promotion Gate"],
      weights: teamConfig.gateReadinessWeights || {}
    },
    
    // Communication Preferences
    communicationStyle: teamConfig.communicationStyle || "Executive briefing",
    
    // Computed Analytics
    riskBreakdown: analytics.riskCounts || {},
    timeline: analytics.timeline || {},
    readinessScores: analytics.gateReadiness || {},
    qualityMetrics: analytics.qualityIndex || {},
    
    // Configuration Metadata
    teamConfig: teamConfig
  };
}

module.exports = {
  generateAISummary,
  validateAPIKey,
  getTeamConfiguration,
  createUniversalAgentInput,
  VOODOO_CONFIG
};