const express = require('express');
const tokenCache = require('../utils/tokenCache');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const axios = require('axios');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { checkFeatureAccess } = require('../services/authService');
const { createHttpsAgent, retryJiraCall } = require('../services/jiraService');

const TEAM_BOARD_CONFIG_PATH = path.join(__dirname, '../config/teamBoardConfig.json');
const ALLOWED_USERS_CONFIG_PATH = path.join(__dirname, '../config/allowedUsers.json');
const KPI_CONFIG_PATH = path.join(__dirname, '../config/kpiConfig.json');

/**
 * Require super admin authorization for all admin endpoints
 */
function requireSuperAdmin(req, res, next) {
  const username = req.username || req.headers['x-username'] || '';
  const { authorized, error } = checkFeatureAccess(username, 'config');
  
  if (!authorized) {
    return res.status(403).json({ 
      success: false, 
      error: 'Super admin access required',
      message: error || 'Only super administrators can access team management features.'
    });
  }
  
  next();
}

/**
 * Load configuration files safely
 */
function loadConfig(configPath) {
  try {
    const raw = fs.readFileSync(configPath, 'utf8');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch (e) {
    console.error(`Error loading config ${configPath}:`, e.message);
    return {};
  }
}

/**
 * Save configuration files safely
 */
function saveConfig(configPath, config) {
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    return true;
  } catch (e) {
    console.error(`Error saving config ${configPath}:`, e.message);
    return false;
  }
}

/**
 * Validate JIRA project exists and is accessible
 * POST /api/admin/validate-jira-project
 * Body: { projectKey, jiraToken }
 */
router.post('/validate-jira-project', requireSuperAdmin, async (req, res) => {
  try {
    const { projectKey, jiraToken } = req.body || {};
    
    if (!projectKey || !jiraToken) {
      return res.status(400).json({
        success: false,
        error: 'projectKey and jiraToken are required'
      });
    }

    const httpsAgent = createHttpsAgent();
    const JIRA_API_V2 = require('../config/api').JIRA_API_V2;

    // Test project access
    const projectResponse = await retryJiraCall(() => axios.get(
      JIRA_API_V2.PROJECT(projectKey),
      {
        headers: {
          'Authorization': `Bearer ${jiraToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 15000
      }
    ));

    // Get project versions to validate version access
    const versionsResponse = await retryJiraCall(() => axios.get(
      JIRA_API_V2.PROJECT_VERSIONS(projectKey),
      {
        headers: {
          'Authorization': `Bearer ${jiraToken}`,
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        httpsAgent: httpsAgent,
        timeout: 15000
      }
    ));

    const project = projectResponse.data;
    const versions = versionsResponse.data || [];
    const openVersions = versions.filter(v => v.name && v.released === false && v.archived !== true);

    return res.json({
      success: true,
      project: {
        key: project.key,
        name: project.name,
        projectTypeKey: project.projectTypeKey,
        lead: project.lead
      },
      versions: {
        total: versions.length,
        open: openVersions.length,
        openVersionNames: openVersions.map(v => v.name).slice(0, 10) // First 10 for preview
      }
    });

  } catch (error) {
    console.error('Error validating JIRA project:', error.message);
    return res.status(error.response?.status || 500).json({
      success: false,
      error: 'Failed to validate JIRA project',
      message: error.response?.data?.errorMessages?.join(', ') || error.message
    });
  }
});

/**
 * Validate JIRA filters exist and are accessible
 * POST /api/admin/validate-filters
 * Body: { filters: [{ name, filterQuery }], jiraToken }
 */
router.post('/validate-filters', requireSuperAdmin, async (req, res) => {
  try {
    const { filters, jiraToken } = req.body || {};
    
    if (!filters || !Array.isArray(filters) || !jiraToken) {
      return res.status(400).json({
        success: false,
        error: 'filters array and jiraToken are required'
      });
    }

    const httpsAgent = createHttpsAgent();
    const JIRA_API_V2 = require('../config/api').JIRA_API_V2;
    const validationResults = [];

    for (const filter of filters) {
      try {
        // Test filter by running a search with maxResults=1
        const searchResponse = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
          headers: {
            'Authorization': `Bearer ${jiraToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          httpsAgent: httpsAgent,
          timeout: 15000,
          params: {
            jql: filter.filterQuery || `filter=${filter.name}`,
            maxResults: 1
          }
        }));

        validationResults.push({
          name: filter.name,
          valid: true,
          issueCount: searchResponse.data.total || 0
        });
      } catch (filterError) {
        validationResults.push({
          name: filter.name,
          valid: false,
          error: filterError.response?.data?.errorMessages?.join(', ') || filterError.message
        });
      }
    }

    return res.json({
      success: true,
      results: validationResults
    });

  } catch (error) {
    console.error('Error validating filters:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to validate filters',
      message: error.message
    });
  }
});

/**
 * Get all teams for admin management
 * GET /api/admin/teams
 */
router.get('/teams', requireSuperAdmin, (req, res) => {
  try {
    const teamBoardConfig = loadConfig(TEAM_BOARD_CONFIG_PATH);
    const allowedUsersConfig = loadConfig(ALLOWED_USERS_CONFIG_PATH);
    const kpiConfig = loadConfig(KPI_CONFIG_PATH);

    const teams = (teamBoardConfig.teams || []).map(team => ({
      ...team,
      userConfig: allowedUsersConfig.teams?.[team.id] || null,
      kpiCount: (kpiConfig.teams?.[team.id] || []).length
    }));

    return res.json({
      success: true,
      teams,
      defaultTeamId: teamBoardConfig.defaultTeamId
    });

  } catch (error) {
    console.error('Error loading teams:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to load teams',
      message: error.message
    });
  }
});

/**
 * Create a new team
 * POST /api/admin/teams
 */
router.post('/teams', requireSuperAdmin, (req, res) => {
  try {
    const { 
      id, 
      name, 
      projectKey, 
      projectType = 'dedicated',
      versionPatterns,
      boardId,
      baseFilter,
      sprintBaseFilter,
      userConfig 
    } = req.body || {};

    if (!id || !name || !projectKey) {
      return res.status(400).json({
        success: false,
        error: 'id, name, and projectKey are required'
      });
    }

    // Load current configs
    const teamBoardConfig = loadConfig(TEAM_BOARD_CONFIG_PATH);
    const allowedUsersConfig = loadConfig(ALLOWED_USERS_CONFIG_PATH);
    const kpiConfig = loadConfig(KPI_CONFIG_PATH);

    // Check if team already exists
    const existingTeam = (teamBoardConfig.teams || []).find(t => t.id === id);
    if (existingTeam) {
      return res.status(409).json({
        success: false,
        error: 'Team already exists',
        message: `Team with id "${id}" already exists`
      });
    }

    // Create team config
    const newTeam = {
      id,
      name,
      projectKey,
      projectType,
      ...(boardId && { boardId }),
      ...(baseFilter && { baseFilter }),
      ...(sprintBaseFilter && { sprintBaseFilter })
    };

    // Add version patterns for parent projects
    if (projectType === 'parent' && versionPatterns && Array.isArray(versionPatterns)) {
      newTeam.versionPatterns = versionPatterns;
    }

    // Update team board config
    if (!teamBoardConfig.teams) teamBoardConfig.teams = [];
    teamBoardConfig.teams.push(newTeam);

    // Update user config if provided
    if (userConfig) {
      if (!allowedUsersConfig.teams) allowedUsersConfig.teams = {};
      allowedUsersConfig.teams[id] = userConfig;
    }

    // Initialize empty KPI config
    if (!kpiConfig.teams) kpiConfig.teams = {};
    if (!kpiConfig.teams[id]) kpiConfig.teams[id] = [];

    // Save all configs
    const saveSuccess = saveConfig(TEAM_BOARD_CONFIG_PATH, teamBoardConfig) &&
                       saveConfig(ALLOWED_USERS_CONFIG_PATH, allowedUsersConfig) &&
                       saveConfig(KPI_CONFIG_PATH, kpiConfig);

    if (!saveSuccess) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save team configuration'
      });
    }

    return res.json({
      success: true,
      team: newTeam,
      message: `Team "${name}" created successfully`
    });

  } catch (error) {
    console.error('Error creating team:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to create team',
      message: error.message
    });
  }
});

/**
 * Update an existing team
 * PUT /api/admin/teams/:teamId
 */
router.put('/teams/:teamId', requireSuperAdmin, (req, res) => {
  try {
    const { teamId } = req.params;
    const updateData = req.body || {};

    // Load current configs
    const teamBoardConfig = loadConfig(TEAM_BOARD_CONFIG_PATH);
    const allowedUsersConfig = loadConfig(ALLOWED_USERS_CONFIG_PATH);

    // Find team
    const teamIndex = (teamBoardConfig.teams || []).findIndex(t => t.id === teamId);
    if (teamIndex === -1) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
        message: `Team with id "${teamId}" not found`
      });
    }

    // Update team config (preserve existing values, override with new ones)
    const updatedTeam = {
      ...teamBoardConfig.teams[teamIndex],
      ...updateData,
      id: teamId // Ensure ID cannot be changed
    };

    // Remove userConfig from team object (it goes in allowedUsersConfig)
    const { userConfig, ...teamConfigOnly } = updatedTeam;
    teamBoardConfig.teams[teamIndex] = teamConfigOnly;

    // Update user config if provided
    if (userConfig) {
      if (!allowedUsersConfig.teams) allowedUsersConfig.teams = {};
      allowedUsersConfig.teams[teamId] = userConfig;
    }

    // Save configs
    const saveSuccess = saveConfig(TEAM_BOARD_CONFIG_PATH, teamBoardConfig) &&
                       saveConfig(ALLOWED_USERS_CONFIG_PATH, allowedUsersConfig);

    if (!saveSuccess) {
      return res.status(500).json({
        success: false,
        error: 'Failed to save team configuration'
      });
    }

    return res.json({
      success: true,
      team: teamConfigOnly,
      message: `Team "${teamId}" updated successfully`
    });

  } catch (error) {
    console.error('Error updating team:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to update team',
      message: error.message
    });
  }
});

/**
 * Test team configuration end-to-end
 * POST /api/admin/test-team-config
 * Body: { teamId, jiraToken }
 */
router.post('/test-team-config', requireSuperAdmin, validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { teamId } = req.body || {};
    
    if (!teamId) {
      return res.status(400).json({
        success: false,
        error: 'teamId is required'
      });
    }

    const teamBoardConfig = loadConfig(TEAM_BOARD_CONFIG_PATH);
    const team = (teamBoardConfig.teams || []).find(t => t.id === teamId);
    
    if (!team) {
      return res.status(404).json({
        success: false,
        error: 'Team not found',
        message: `Team with id "${teamId}" not found`
      });
    }

    const httpsAgent = createHttpsAgent();
    const cleanToken = req.jiraToken;
    const JIRA_API_V2 = require('../config/api').JIRA_API_V2;

    const testResults = {
      teamConfig: { valid: true },
      projectAccess: { valid: false },
      versionAccess: { valid: false },
      filterTests: { valid: false }
    };

    // Test 1: Project access
    try {
      const projectResponse = await retryJiraCall(() => axios.get(
        JIRA_API_V2.PROJECT(team.projectKey),
        {
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          httpsAgent: httpsAgent,
          timeout: 15000
        }
      ));

      testResults.projectAccess = {
        valid: true,
        projectName: projectResponse.data.name
      };
    } catch (error) {
      testResults.projectAccess = {
        valid: false,
        error: error.response?.data?.errorMessages?.join(', ') || error.message
      };
    }

    // Test 2: Version access
    try {
      const versionsResponse = await retryJiraCall(() => axios.get(
        JIRA_API_V2.PROJECT_VERSIONS(team.projectKey),
        {
          headers: {
            'Authorization': `Bearer ${cleanToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          httpsAgent: httpsAgent,
          timeout: 15000
        }
      ));

      let versions = (versionsResponse.data || [])
        .filter(v => v.name && v.released === false && v.archived !== true)
        .map(v => v.name);

      // Apply version patterns for parent projects
      if (team.projectType === 'parent' && team.versionPatterns) {
        const originalCount = versions.length;
        const patterns = team.versionPatterns.map(p => new RegExp(p, 'i'));
        versions = versions.filter(v => patterns.some(pattern => pattern.test(v)));
        
        testResults.versionAccess = {
          valid: true,
          totalVersions: originalCount,
          filteredVersions: versions.length,
          sampleVersions: versions.slice(0, 5)
        };
      } else {
        testResults.versionAccess = {
          valid: true,
          totalVersions: versions.length,
          sampleVersions: versions.slice(0, 5)
        };
      }
    } catch (error) {
      testResults.versionAccess = {
        valid: false,
        error: error.response?.data?.errorMessages?.join(', ') || error.message
      };
    }

    // Test 3: Filter tests
    const filtersToTest = [];
    if (team.baseFilter) filtersToTest.push({ name: 'baseFilter', query: team.baseFilter });
    if (team.sprintBaseFilter) filtersToTest.push({ name: 'sprintBaseFilter', query: team.sprintBaseFilter });

    if (filtersToTest.length > 0) {
      const filterResults = [];
      for (const filter of filtersToTest) {
        try {
          const searchResponse = await retryJiraCall(() => axios.get(JIRA_API_V2.SEARCH, {
            headers: {
              'Authorization': `Bearer ${cleanToken}`,
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            httpsAgent: httpsAgent,
            timeout: 15000,
            params: {
              jql: filter.query,
              maxResults: 1
            }
          }));

          filterResults.push({
            name: filter.name,
            valid: true,
            issueCount: searchResponse.data.total || 0
          });
        } catch (error) {
          filterResults.push({
            name: filter.name,
            valid: false,
            error: error.response?.data?.errorMessages?.join(', ') || error.message
          });
        }
      }

      testResults.filterTests = {
        valid: filterResults.every(f => f.valid),
        results: filterResults
      };
    } else {
      testResults.filterTests = {
        valid: true,
        message: 'No filters configured to test'
      };
    }

    const overallSuccess = Object.values(testResults).every(test => test.valid);

    return res.json({
      success: overallSuccess,
      teamId,
      teamName: team.name,
      results: testResults
    });

  } catch (error) {
    console.error('Error testing team config:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to test team configuration',
      message: error.message
    });
  }
});

// Token cache statistics endpoint
router.get('/token-cache-stats', (req, res) => {
  try {
    const stats = tokenCache.getStats();
    res.json({
      success: true,
      data: stats,
      message: `Token cache contains ${stats.active} active entries (${stats.expired} expired)`
    });
  } catch (error) {
    console.error('Error getting token cache stats:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get token cache statistics',
      message: error.message
    });
  }
});

// Clear token cache endpoint (for debugging/maintenance)
router.post('/clear-token-cache', (req, res) => {
  try {
    tokenCache.clear();
    res.json({
      success: true,
      message: 'Token cache cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing token cache:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to clear token cache',
      message: error.message
    });
  }
});

// JIRA cache statistics endpoint
router.get('/jira-cache-stats', (req, res) => {
  try {
    const { jiraCache } = require('../utils/simpleCache');
    const stats = {
      size: jiraCache.size(),
      ttl: jiraCache.defaultTTL,
      maxSize: 'unlimited' // SimpleCache doesn't have a maxSize limit currently
    };
    
    res.json({
      success: true,
      data: stats,
      message: `JIRA cache contains ${stats.size} active entries`
    });
  } catch (error) {
    console.error('Error fetching JIRA cache stats:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch JIRA cache stats',
      message: error.message
    });
  }
});

// Clear JIRA cache endpoint (for debugging/maintenance)
router.post('/clear-jira-cache', (req, res) => {
  try {
    const { jiraCache } = require('../utils/simpleCache');
    jiraCache.clear();
    
    res.json({
      success: true,
      message: 'JIRA cache cleared successfully'
    });
  } catch (error) {
    console.error('Error clearing JIRA cache:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to clear JIRA cache',
      message: error.message
    });
  }
});

module.exports = router;