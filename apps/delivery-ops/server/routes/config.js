const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { getUserPermissions } = require('../services/authService');
const { checkKpiViewAuthorization, checkKpiTabAuthorization, checkKpiAdminAuthorization } = require('../services/userService');

const KPI_CONFIG_PATH = path.join(__dirname, '../config/kpiConfig.json');
const TEAM_BOARD_CONFIG_PATH = path.join(__dirname, '../config/teamBoardConfig.json');
const RELEASE_VERSIONS_COLUMNS_CONFIG_PATH = path.join(__dirname, '../config/releaseVersionsColumnsConfig.json');
const RELEASE_VERSIONS_EMAIL_CONFIG_PATH = path.join(__dirname, '../config/releaseVersionsEmailConfig.json');
const releaseVersionsEmailConfig = require('../config/releaseVersionsEmailConfig.json');

function generateKpiId() {
  return 'kpi_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
}

/** Normalize teamId for consistent lookup (lowercase, trim). */
function normalizeTeamId(teamId) {
  if (teamId == null || typeof teamId !== 'string') return '';
  return String(teamId).trim().toLowerCase();
}

function loadKpiConfig() {
  try {
    delete require.cache[require.resolve(KPI_CONFIG_PATH)];
  } catch (e) {
    // Config not yet required
  }
  let config = { teams: {} };
  try {
    const raw = fs.readFileSync(KPI_CONFIG_PATH, 'utf8');
    if (raw && raw.trim()) config = JSON.parse(raw);
  } catch (e) {
    // Missing file, invalid JSON, or read error
  }
  if (!config.teams || typeof config.teams !== 'object') config.teams = {};
  // Ensure each KPI has a unique id and order (migrate legacy entries)
  Object.keys(config.teams).forEach((tid) => {
    if (!Array.isArray(config.teams[tid])) config.teams[tid] = [];
    config.teams[tid] = config.teams[tid].map((k, idx) => {
      const order = typeof k.order === 'number' ? k.order : idx;
      if (k && k.id) {
        return { id: k.id, name: k.name || '', baseQuery: k.baseQuery || '', displayType: k.displayType === 'list' ? 'list' : 'count', order };
      }
      return { id: generateKpiId(), name: k?.name || '', baseQuery: k?.baseQuery || '', displayType: 'count', order };
    });
  });
  return config;
}

function sortKpisByOrder(kpis) {
  if (!Array.isArray(kpis)) return kpis;
  return [...kpis].sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999));
}

function saveKpiConfig(config) {
  const teams = config.teams || {};
  const payload = {
    teams: Object.fromEntries(
      Object.entries(teams).map(([tid, kpis]) => [tid, sortKpisByOrder(Array.isArray(kpis) ? kpis : [])])
    )
  };
  fs.writeFileSync(KPI_CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function getUsername(req) {
  return req.headers['x-username'] || req.body?.username || req.query?.username || '';
}

function loadTeamBoardConfig() {
  let config = { teams: [], defaultTeamId: null };
  try {
    const raw = fs.readFileSync(TEAM_BOARD_CONFIG_PATH, 'utf8');
    if (raw && raw.trim()) config = JSON.parse(raw);
  } catch (e) {
    // ignore
  }
  if (!Array.isArray(config.teams)) config.teams = [];
  return config;
}

function saveTeamBoardConfig(config) {
  fs.writeFileSync(TEAM_BOARD_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

function loadReleaseDatesConfig() {
  let config = { releases: {} };
  try {
    delete require.cache[require.resolve(RELEASE_VERSIONS_EMAIL_CONFIG_PATH)];
    const raw = fs.readFileSync(RELEASE_VERSIONS_EMAIL_CONFIG_PATH, 'utf8');
    if (raw && raw.trim()) {
      const emailConfig = JSON.parse(raw);
      config.releases = emailConfig.releases || {};
    }
  } catch (e) {
    // Config file missing or invalid
  }
  return config;
}

function saveReleaseDatesConfig(config) {
  try {
    // Load existing email config
    delete require.cache[require.resolve(RELEASE_VERSIONS_EMAIL_CONFIG_PATH)];
    const raw = fs.readFileSync(RELEASE_VERSIONS_EMAIL_CONFIG_PATH, 'utf8');
    const emailConfig = raw && raw.trim() ? JSON.parse(raw) : {};
    
    // Update just the releases section
    emailConfig.releases = config.releases || {};
    
    // Save back to email config
    fs.writeFileSync(RELEASE_VERSIONS_EMAIL_CONFIG_PATH, JSON.stringify(emailConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving release dates config:', e);
  }
}

/**
 * Get release versions columns configuration
 * GET /api/config/release-versions-columns
 */
router.get('/release-versions-columns', (req, res) => {
  try {
    delete require.cache[require.resolve(RELEASE_VERSIONS_COLUMNS_CONFIG_PATH)];
    const columnsConfig = require(RELEASE_VERSIONS_COLUMNS_CONFIG_PATH);
    res.json(columnsConfig);
  } catch (err) {
    console.error('Error loading releaseVersionsColumnsConfig.json:', err);
    res.status(500).json({ error: 'Failed to load column configuration' });
  }
});

function getDefaultReleaseBaseFilter(releaseVersion) {
  if (!releaseVersion || typeof releaseVersion !== 'string') return null;
  const v = releaseVersion.trim();
  return v ? `filter=${v}-All` : null;
}

function loadReleaseBaseFilters() {
  let config = {};
  try {
    delete require.cache[require.resolve(RELEASE_VERSIONS_COLUMNS_CONFIG_PATH)];
    const raw = fs.readFileSync(RELEASE_VERSIONS_COLUMNS_CONFIG_PATH, 'utf8');
    if (raw && raw.trim()) config = JSON.parse(raw);
  } catch (e) {
    // ignore
  }
  return config.releaseBaseFilters || {};
}

/**
 * Get effective release base filter for a version (override or dynamic default).
 * GET /api/config/release-base-filter?releaseVersion=NDB-2.11
 */
router.get('/release-base-filter', (req, res) => {
  const releaseVersion = (req.query.releaseVersion || '').trim();
  if (!releaseVersion) {
    return res.status(400).json({ error: 'releaseVersion query is required' });
  }
  try {
    const map = loadReleaseBaseFilters();
    const override = map[releaseVersion] ? String(map[releaseVersion]).trim() : '';
    const isDefault = !override || override === 'filter=0';
    const baseFilter = isDefault ? getDefaultReleaseBaseFilter(releaseVersion) : override;
    res.json({ releaseVersion, baseFilter: baseFilter || '', isDefault });
  } catch (err) {
    console.error('Error loading release base filter:', err);
    res.status(500).json({ error: 'Failed to load release base filter' });
  }
});

/**
 * Set release base filter override for a version (empty to use dynamic default).
 * POST /api/config/release-base-filter  body: { releaseVersion, baseFilter }
 */
router.post('/release-base-filter', express.json(), (req, res) => {
  const username = getUsername(req);
  const { authorized } = checkKpiTabAuthorization(username);
  if (!authorized) {
    return res.status(403).json({ error: 'Access denied. You are not authorized to manage release config.' });
  }
  const { releaseVersion, baseFilter } = req.body || {};
  const version = releaseVersion != null ? String(releaseVersion).trim() : '';
  if (!version) {
    return res.status(400).json({ error: 'releaseVersion is required' });
  }
  try {
    const raw = fs.readFileSync(RELEASE_VERSIONS_COLUMNS_CONFIG_PATH, 'utf8');
    const config = raw && raw.trim() ? JSON.parse(raw) : {};
    if (!config.releaseBaseFilters || typeof config.releaseBaseFilters !== 'object') {
      config.releaseBaseFilters = {};
    }
    const value = baseFilter != null ? String(baseFilter).trim() : '';
    if (value && value !== 'filter=0') {
      config.releaseBaseFilters[version] = value;
    } else {
      delete config.releaseBaseFilters[version];
    }
    fs.writeFileSync(RELEASE_VERSIONS_COLUMNS_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
    const effective = value && value !== 'filter=0' ? value : getDefaultReleaseBaseFilter(version);
    res.json({ success: true, releaseVersion: version, baseFilter: effective || '', isDefault: !value || value === 'filter=0' });
  } catch (err) {
    console.error('Error saving release base filter:', err);
    res.status(500).json({ error: 'Failed to save release base filter' });
  }
});

/**
 * Get release versions email configuration
 * GET /api/config/release-versions
 */
router.get('/release-versions', (req, res) => {
  try {
    // Clear require cache to ensure we get the latest config
    const configPath = path.join(__dirname, '../config/releaseVersionsEmailConfig.json');
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    res.json(config);
  } catch (error) {
    console.error('Error loading release versions config:', error);
    res.status(500).json({ error: 'Failed to load config' });
  }
});

/**
 * Get permissions for the current user (requires JIRA auth).
 * Returns user-specific permissions only; does not expose full allowedUsers.json.
 * GET /api/config/allowed-users
 * Headers: Authorization: Bearer <jiraToken>, X-Username or body username.
 */
router.get('/allowed-users', validateJiraTokenMiddleware, (req, res) => {
  try {
    const username = req.username;
    if (!username) {
      return res.status(400).json({ error: 'Username is required. Provide X-Username header with the request.' });
    }
    const permissions = getUserPermissions(username);
    res.json(permissions);
  } catch (error) {
    console.error('Error getting user permissions:', error);
    res.status(500).json({ error: 'Failed to load permissions' });
  }
});

/**
 * Get JIRA configuration (base URL)
 * GET /api/config/jira
 */
router.get('/jira', (req, res) => {
  try {
    const jiraConfig = require(path.join(__dirname, '../config/jiraConfig.json'));
    res.json({
      baseUrl: jiraConfig.baseUrl,
      description: jiraConfig.description || 'Base JIRA URL for API requests and links'
    });
  } catch (error) {
    console.error('Error loading JIRA config:', error);
    res.status(500).json({ error: 'Failed to load JIRA configuration' });
  }
});

/**
 * Get JIRA fields configuration
 * GET /api/config/jira-fields
 */
router.get('/jira-fields', (req, res) => {
  try {
    // Clear require cache to ensure we get the latest config
    const configPath = path.join(__dirname, '../config/jiraFieldsConfig.json');
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    res.json(config);
  } catch (error) {
    console.error('Error loading JIRA fields config:', error);
    res.status(500).json({ error: 'Failed to load JIRA fields configuration' });
  }
});

/**
 * Get JIRA Emailer CC configuration (defaultCC, projectTeamFields)
 * GET /api/config/generic-emailer
 */
router.get('/generic-emailer', (req, res) => {
  try {
    const configPath = path.join(__dirname, '../config/genericEmailerCCConfig.json');
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    res.json(config);
  } catch (error) {
    console.error('Error loading JIRA emailer config:', error);
    res.status(500).json({ error: 'Failed to load JIRA emailer configuration' });
  }
});

/**
 * Get team/board configuration for Release Versions (sprint dropdown, board per team)
 * GET /api/config/teams
 */
router.get('/teams', (req, res) => {
  try {
    const config = loadTeamBoardConfig();
    res.json({
      sprintFieldId: config.sprintFieldId || 'customfield_10360',
      teams: config.teams || [],
      defaultTeamId: config.defaultTeamId || (config.teams && config.teams[0] && config.teams[0].id) || null
    });
  } catch (error) {
    console.error('Error loading team board config:', error);
    res.status(500).json({ error: 'Failed to load team configuration' });
  }
});

/**
 * Update team base filter (for KPI: query = team-base-filter AND kpi-filter)
 * POST /api/config/team-base-filter  body: { teamId, baseFilter }
 * Requires KPI tab permission.
 */
router.post('/team-base-filter', express.json(), (req, res) => {
  const username = getUsername(req);
  const { authorized } = checkKpiTabAuthorization(username);
  if (!authorized) {
    return res.status(403).json({ error: 'Access denied. You are not authorized to update team base filter.' });
  }
  const { teamId, baseFilter } = req.body || {};
  const { authorized: isAdmin } = checkKpiAdminAuthorization(username, teamId);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Access denied. You do not have admin permissions to update the team base filter.' });
  }
  if (!teamId) {
    return res.status(400).json({ error: 'teamId is required' });
  }
  try {
    const config = loadTeamBoardConfig();
    const team = config.teams && config.teams.find((t) => t.id === teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    team.baseFilter = baseFilter != null ? String(baseFilter).trim() : '';
    saveTeamBoardConfig(config);
    res.json({ success: true, teams: config.teams });
  } catch (err) {
    console.error('Error saving team base filter:', err);
    res.status(500).json({ error: 'Failed to save team base filter' });
  }
});

/**
 * Get KPIs for a team (viewable by all allowedUsers)
 * GET /api/config/kpi?teamId=ndb
 */
router.get('/kpi', (req, res) => {
  const username = getUsername(req);
  const { authorized } = checkKpiViewAuthorization(username);
  if (!authorized) {
    return res.status(403).json({ error: 'Access denied. You are not authorized to view KPIs.' });
  }
  const teamId = req.query.teamId;
  if (!teamId) {
    return res.status(400).json({ error: 'teamId is required' });
  }
  const normalizedTeamId = normalizeTeamId(teamId);
  try {
    const config = loadKpiConfig();
    const raw = (config.teams && config.teams[normalizedTeamId]) || [];
    const kpis = Array.isArray(raw) ? sortKpisByOrder(raw) : [];
    const { authorized: isAdmin } = checkKpiAdminAuthorization(username, teamId);
    res.json({ kpis, isAdmin });
  } catch (err) {
    console.error('Error loading KPI config:', err);
    res.status(500).json({ error: 'Failed to load KPI configuration' });
  }
});

/**
 * Add or update a KPI (requires KPI tab permission)
 * POST /api/config/kpi  body: { teamId, name, baseQuery, displayType? } for add, or { teamId, id, name, baseQuery, displayType? } for update
 * displayType: 'count' | 'list' (default 'count')
 */
router.post('/kpi', express.json(), (req, res) => {
  const username = getUsername(req);
  const { authorized } = checkKpiTabAuthorization(username);
  if (!authorized) {
    return res.status(403).json({ error: 'Access denied. You are not authorized to manage KPIs.' });
  }
  const { teamId, id: kpiId, name, baseQuery, displayType } = req.body || {};
  const normalizedTeamId = normalizeTeamId(teamId);
  const { authorized: isAdmin } = checkKpiAdminAuthorization(username, normalizedTeamId);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Access denied. You do not have admin permissions to add or edit KPIs for this team.' });
  }
  if (!normalizedTeamId || !name || baseQuery === undefined) {
    return res.status(400).json({ error: 'teamId, name, and baseQuery are required' });
  }
  const normalizedDisplayType = displayType === 'list' ? 'list' : 'count';
  try {
    const config = loadKpiConfig();
    if (!config.teams[normalizedTeamId]) config.teams[normalizedTeamId] = [];
    const trimmedName = String(name).trim();
    const trimmedQuery = String(baseQuery).trim();
    if (kpiId) {
      const existing = config.teams[normalizedTeamId].find((k) => k.id === kpiId);
      if (existing) {
        existing.name = trimmedName;
        existing.baseQuery = trimmedQuery;
        existing.displayType = normalizedDisplayType;
      } else {
        const maxOrder = config.teams[normalizedTeamId].length === 0 ? 0 : Math.max(...config.teams[normalizedTeamId].map((k) => k.order ?? 0));
        config.teams[normalizedTeamId].push({ id: kpiId, name: trimmedName, baseQuery: trimmedQuery, displayType: normalizedDisplayType, order: maxOrder + 1 });
      }
    } else {
      const maxOrder = config.teams[normalizedTeamId].length === 0 ? 0 : Math.max(...config.teams[normalizedTeamId].map((k) => k.order ?? 0));
      config.teams[normalizedTeamId].push({ id: generateKpiId(), name: trimmedName, baseQuery: trimmedQuery, displayType: normalizedDisplayType, order: maxOrder + 1 });
    }
    saveKpiConfig(config);
    res.json({ success: true, kpis: sortKpisByOrder(config.teams[normalizedTeamId]) });
  } catch (err) {
    console.error('Error saving KPI config:', err);
    res.status(500).json({ error: 'Failed to save KPI configuration' });
  }
});

/**
 * Delete a KPI by id for a team (requires KPI tab permission)
 * DELETE /api/config/kpi  body: { teamId, id }
 */
router.delete('/kpi', express.json(), (req, res) => {
  const username = getUsername(req);
  const { authorized } = checkKpiTabAuthorization(username);
  if (!authorized) {
    return res.status(403).json({ error: 'Access denied. You are not authorized to manage KPIs.' });
  }
  const { teamId, id: kpiId } = req.body || {};
  const normalizedTeamId = normalizeTeamId(teamId);
  const { authorized: isAdmin } = checkKpiAdminAuthorization(username, normalizedTeamId);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Access denied. You do not have admin permissions to delete KPIs for this team.' });
  }
  if (!normalizedTeamId || !kpiId) {
    return res.status(400).json({ error: 'teamId and id are required' });
  }
  try {
    const config = loadKpiConfig();
    if (!config.teams) config.teams = {};
    if (!Array.isArray(config.teams[normalizedTeamId])) config.teams[normalizedTeamId] = [];
    config.teams[normalizedTeamId] = config.teams[normalizedTeamId].filter((k) => k.id !== kpiId);
    saveKpiConfig(config);
    res.json({ success: true, kpis: sortKpisByOrder(config.teams[normalizedTeamId] || []) });
  } catch (err) {
    console.error('Error saving KPI config:', err);
    res.status(500).json({ error: 'Failed to delete KPI' });
  }
});

/**
 * Reorder a KPI up or down (requires KPI tab permission)
 * POST /api/config/kpi-reorder  body: { teamId, kpiId, direction: 'up' | 'down' }
 */
router.post('/kpi-reorder', express.json(), (req, res) => {
  const username = getUsername(req);
  const { authorized } = checkKpiTabAuthorization(username);
  if (!authorized) {
    return res.status(403).json({ error: 'Access denied. You are not authorized to manage KPIs.' });
  }
  const { teamId, kpiId, direction } = req.body || {};
  const normalizedTeamId = normalizeTeamId(teamId);
  const { authorized: isAdmin } = checkKpiAdminAuthorization(username, normalizedTeamId);
  if (!isAdmin) {
    return res.status(403).json({ error: 'Access denied. You do not have admin permissions to reorder KPIs for this team.' });
  }
  if (!normalizedTeamId || !kpiId || !direction) {
    return res.status(400).json({ error: 'teamId, kpiId, and direction are required' });
  }
  if (direction !== 'up' && direction !== 'down') {
    return res.status(400).json({ error: 'direction must be "up" or "down"' });
  }
  try {
    const config = loadKpiConfig();
    const kpis = (config.teams && config.teams[normalizedTeamId]) || [];
    const sorted = sortKpisByOrder(Array.isArray(kpis) ? kpis : []);
    const idx = sorted.findIndex((k) => k.id === kpiId);
    if (idx === -1) {
      return res.status(404).json({ error: 'KPI not found' });
    }
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sorted.length) {
      return res.json({ success: true, kpis: sorted });
    }
    const a = sorted[idx];
    const b = sorted[swapIdx];
    const orderA = a.order ?? idx;
    const orderB = b.order ?? swapIdx;
    a.order = orderB;
    b.order = orderA;
    saveKpiConfig(config);
    res.json({ success: true, kpis: sortKpisByOrder(config.teams[normalizedTeamId] || []) });
  } catch (err) {
    console.error('Error reordering KPI config:', err);
    res.status(500).json({ error: 'Failed to reorder KPI' });
  }
});

// The /release-dates endpoint below handles both cases now

/**
 * Get release dates for a specific release version
 * GET /api/config/release-dates/:version
 */
router.get('/release-dates/:version', (req, res) => {
  const { version } = req.params;
  if (!version) {
    return res.status(400).json({ error: 'Release version is required' });
  }
  
  try {
    const config = loadReleaseDatesConfig();
    const releaseConfig = config.releases[version];
    
    if (!releaseConfig) {
      return res.status(404).json({ error: `Release version ${version} not found` });
    }
    
    res.json({
      version,
      ...releaseConfig,
      dateTypes: config.dateTypes
    });
  } catch (error) {
    console.error('Error loading release dates for version:', error);
    res.status(500).json({ error: 'Failed to load release dates' });
  }
});

/**
 * Create or update release dates configuration
 * POST /api/config/release-dates
 * Body: { version, ecDate, ccm1Gate[], ccm2Gate[], codeFreeze, commitGate1, commitGate2, promotionGate1, promotionGate2, ga1, ga2 }
 */
router.post('/release-dates', express.json(), (req, res) => {
  const username = getUsername(req);
  const { authorized } = checkKpiTabAuthorization(username);
  if (!authorized) {
    return res.status(403).json({ error: 'Access denied. You are not authorized to manage release configuration.' });
  }

  const { version, ecDate, ccm1Gate, ccm2Gate, codeFreeze, commitGate1, commitGate2, promotionGate1, promotionGate2, ga1, ga2 } = req.body;
  
  if (!version) {
    return res.status(400).json({ error: 'Release version is required' });
  }

  try {
    const config = loadReleaseDatesConfig();
    
    // Create release configuration object
    const releaseConfig = {
      ecDate: ecDate || null,
      ccm1Gate: Array.isArray(ccm1Gate) ? ccm1Gate.filter(cc => cc.date) : [],
      ccm2Gate: Array.isArray(ccm2Gate) ? ccm2Gate.filter(cc => cc.date) : [],
      codeFreeze: codeFreeze || null,
      commitGate1: commitGate1 || null,
      commitGate2: commitGate2 || null,
      promotionGate1: promotionGate1 || null,
      promotionGate2: promotionGate2 || null,
      ga1: ga1 || null,
      ga2: ga2 || null
    };
    
    config.releases[version] = releaseConfig;
    saveReleaseDatesConfig(config);
    
    res.json({
      success: true,
      version,
      config: releaseConfig
    });
  } catch (error) {
    console.error('Error saving release dates config:', error);
    res.status(500).json({ error: 'Failed to save release dates configuration' });
  }
});

/**
 * Delete a release configuration
 * DELETE /api/config/release-dates/:version
 */
router.delete('/release-dates/:version', (req, res) => {
  const username = getUsername(req);
  const { authorized } = checkKpiTabAuthorization(username);
  if (!authorized) {
    return res.status(403).json({ error: 'Access denied. You are not authorized to manage release configuration.' });
  }

  const { version } = req.params;
  
  if (!version) {
    return res.status(400).json({ error: 'Release version is required' });
  }

  try {
    const config = loadReleaseDatesConfig();
    
    if (!config.releases[version]) {
      return res.status(404).json({ error: `Release version ${version} not found` });
    }
    
    delete config.releases[version];
    saveReleaseDatesConfig(config);
    
    res.json({
      success: true,
      message: `Release configuration for version ${version} deleted`
    });
  } catch (error) {
    console.error('Error deleting release dates config:', error);
    res.status(500).json({ error: 'Failed to delete release dates configuration' });
  }
});

/**
 * Get Release Config Dates 
 * GET /api/config/release-dates (all configs for ReleaseConfigPage)
 * GET /api/config/release-dates?version=NDB-2.11 (specific version for Executive Summary)
 */
router.get('/release-dates', (req, res) => {
  try {
    const { version } = req.query;
    
    // If no version parameter, return all configurations (for ReleaseConfigPage)
    if (!version) {
      const config = loadReleaseDatesConfig();
      return res.json(config);
    }

    console.log(`[release-dates] Getting config dates for version: ${version}`);

    // Get version config from email config (no JIRA calls needed)
    const versionConfig = releaseVersionsEmailConfig.releaseGateDates[version];
    
    console.log(`[release-dates] Version config found:`, JSON.stringify(versionConfig, null, 2));
    
    if (!versionConfig) {
      console.warn(`[release-dates] No config found for version: ${version}`);
      return res.json({
        success: true,
        dates: {
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
        }
      });
    }

    // Process milestone dates from config
    const now = new Date();
    
    const formatDate = (date) => {
      if (!date) return null;
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined 
      });
    };

    const processMilestones = (gatePrefix) => {
      const milestones = [];
      let currentDate = null;
      
      let gateNum = 1;
      while (true) {
        let gateKey;
        let gate;
        
        if (gatePrefix === 'ccm') {
          gateKey = `${gatePrefix}${gateNum}Gate`;
          gate = versionConfig[gateKey];
        } else {
          gateKey = `${gatePrefix}${gateNum}`;
          gate = versionConfig[gateKey];
        }
        
        if (!gate) break;
        
        if (Array.isArray(gate)) {
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
      
      return { milestones, currentDate };
    };

    // Process all milestone types with error handling
    let codeComplete, commitGate, promotionGate, generalAvailability;
    
    try {
      codeComplete = processMilestones('ccm');
      console.log(`[release-dates] Code Complete processed:`, codeComplete);
    } catch (error) {
      console.error(`[release-dates] Error processing code complete:`, error);
      codeComplete = { milestones: [], currentDate: 'TBD' };
    }
    
    try {
      commitGate = processMilestones('commitGate');
      console.log(`[release-dates] Commit Gate processed:`, commitGate);
    } catch (error) {
      console.error(`[release-dates] Error processing commit gate:`, error);
      commitGate = { milestones: [], currentDate: 'TBD' };
    }
    
    try {
      promotionGate = processMilestones('promotionGate');
      console.log(`[release-dates] Promotion Gate processed:`, promotionGate);
    } catch (error) {
      console.error(`[release-dates] Error processing promotion gate:`, error);
      promotionGate = { milestones: [], currentDate: 'TBD' };
    }
    
    try {
      generalAvailability = processMilestones('ga');
      console.log(`[release-dates] GA processed:`, generalAvailability);
    } catch (error) {
      console.error(`[release-dates] Error processing GA:`, error);
      generalAvailability = { milestones: [], currentDate: 'TBD' };
    }
    
    console.log(`[release-dates] Processed milestones:`, {
      codeComplete: codeComplete.milestones.length,
      commitGate: commitGate.milestones.length, 
      promotionGate: promotionGate.milestones.length,
      generalAvailability: generalAvailability.milestones.length
    });

    // Calculate days to current Promotion Gate
    let daysToPG = null;
    const currentPGMilestone = promotionGate.milestones.find(m => m.isCurrent);
    if (currentPGMilestone) {
      const pgDate = new Date(currentPGMilestone.date);
      const diffTime = pgDate - now;
      daysToPG = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }

    const dateMetrics = {
      daysFromCutoff: daysToPG,
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
    
    console.log(`[release-dates] Successfully processed config for ${version}:`, dateMetrics);
    
    return res.json({
      success: true,
      dates: dateMetrics
    });

  } catch (error) {
    console.error('Error in /api/config/release-dates:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to get release dates',
      message: error.message
    });
  }
});

module.exports = router;

