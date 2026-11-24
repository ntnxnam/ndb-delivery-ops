const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { getUserPermissions } = require('../services/authService');
const { checkKpiViewAuthorization, checkKpiTabAuthorization, checkKpiAdminAuthorization } = require('../services/userService');
const { sendEmailDirect } = require('../services/emailService');
const { JIRA_API_V2 } = require('../config/api');
const { getJira } = require('../utils/jiraClient');
const { formatDate } = require('../utils/dateFormatter');
const jiraConfig = require('../config/jiraConfig.json');
const releaseVersionsCCConfig = require('../config/releaseVersionsCCConfig.json');

const {
  loadTeamBoardConfig,
  saveTeamBoardConfig,
  getTeamById,
} = require('../utils/teamConfig');

const KPI_CONFIG_PATH = path.join(__dirname, '../config/kpiConfig.json');
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

function normalizeKpiEntry(k, idx) {
  const order = typeof k.order === 'number' ? k.order : idx;
  if (k && k.id) {
    return { id: k.id, name: k.name || '', baseQuery: k.baseQuery || '', displayType: k.displayType === 'list' ? 'list' : 'count', order, ...(k.lifecyclePhase ? { lifecyclePhase: k.lifecyclePhase } : {}), ...(k.isSuperImportant ? { isSuperImportant: true } : {}), ...(k.releaseScoped ? { releaseScoped: true } : {}), ...(k.locked ? { locked: true } : {}) };
  }
  return { id: generateKpiId(), name: k?.name || '', baseQuery: k?.baseQuery || '', displayType: 'count', order, ...(k?.lifecyclePhase ? { lifecyclePhase: k.lifecyclePhase } : {}), ...(k?.isSuperImportant ? { isSuperImportant: true } : {}), ...(k?.releaseScoped ? { releaseScoped: true } : {}) };
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
  if (!Array.isArray(config.standardKpis)) config.standardKpis = [];
  config.standardKpis = config.standardKpis.map((k, idx) => normalizeKpiEntry(k, idx));
  Object.keys(config.teams).forEach((tid) => {
    if (!Array.isArray(config.teams[tid])) config.teams[tid] = [];
    config.teams[tid] = config.teams[tid].map((k, idx) => normalizeKpiEntry(k, idx));
  });
  return config;
}

function sortKpisByOrder(kpis) {
  if (!Array.isArray(kpis)) return kpis;
  return [...kpis].sort((a, b) => (a.order ?? 999999) - (b.order ?? 999999));
}

function saveKpiConfig(config) {
  const teams = config.teams || {};
  const standardKpis = Array.isArray(config.standardKpis) ? config.standardKpis : [];
  const payload = {
    standardKpis: sortKpisByOrder(standardKpis),
    teams: Object.fromEntries(
      Object.entries(teams).map(([tid, kpis]) => [tid, sortKpisByOrder(Array.isArray(kpis) ? kpis : [])])
    )
  };
  fs.writeFileSync(KPI_CONFIG_PATH, JSON.stringify(payload, null, 2), 'utf8');
}

function isStandardKpiLocked(config, kpiId) {
  const std = config.standardKpis || [];
  return std.some((k) => k.id === kpiId);
}

function getUsername(req) {
  return req.headers['x-username'] || req.body?.username || req.query?.username || '';
}

function loadReleaseDatesConfig() {
  let config = { releases: {} };
  try {
    delete require.cache[require.resolve(RELEASE_VERSIONS_EMAIL_CONFIG_PATH)];
    const raw = fs.readFileSync(RELEASE_VERSIONS_EMAIL_CONFIG_PATH, 'utf8');
    if (raw && raw.trim()) {
      const emailConfig = JSON.parse(raw);
      // releaseGateDates is the single source of truth — all server services read it
      config.releases = emailConfig.releaseGateDates || {};
    }
  } catch (e) {
    // Config file missing or invalid
  }
  return config;
}

function saveReleaseDatesConfig(config) {
  try {
    delete require.cache[require.resolve(RELEASE_VERSIONS_EMAIL_CONFIG_PATH)];
    const raw = fs.readFileSync(RELEASE_VERSIONS_EMAIL_CONFIG_PATH, 'utf8');
    const emailConfig = raw && raw.trim() ? JSON.parse(raw) : {};

    // Write back to releaseGateDates — the single source of truth
    emailConfig.releaseGateDates = config.releases || {};

    // Remove the shadow `releases` key so there is only one copy
    delete emailConfig.releases;

    fs.writeFileSync(RELEASE_VERSIONS_EMAIL_CONFIG_PATH, JSON.stringify(emailConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('Error saving release dates config:', e);
  }
}

/** Parse Dev/QA DRI list from UI (comma/semicolon/newline) or array → unique usernames. */
function normalizeDriList(value) {
  const parts = Array.isArray(value)
    ? value
    : String(value || '').split(/[,;\n]+/);
  const seen = new Set();
  const out = [];
  for (const p of parts) {
    let s = String(p || '').trim().toLowerCase();
    if (!s) continue;
    if (s.includes('@')) s = s.split('@')[0];
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

const RELEASE_VERSIONS_CC_CONFIG_PATH = path.join(__dirname, '../config/releaseVersionsCCConfig.json');

/** Keep email versionDRIs in sync with releaseGateDates.devDRIs (emails for CC). */
function syncVersionDrisFromReleaseConfig(version, devDRIs) {
  try {
    delete require.cache[require.resolve(RELEASE_VERSIONS_CC_CONFIG_PATH)];
    const raw = fs.readFileSync(RELEASE_VERSIONS_CC_CONFIG_PATH, 'utf8');
    const cc = raw && raw.trim() ? JSON.parse(raw) : { defaultCC: [], versionDRIs: {} };
    if (!cc.versionDRIs || typeof cc.versionDRIs !== 'object') cc.versionDRIs = {};
    const emails = (devDRIs || []).map((u) =>
      String(u).includes('@') ? String(u).toLowerCase() : `${String(u).toLowerCase()}@nutanix.com`
    );
    if (emails.length) cc.versionDRIs[version] = emails;
    else delete cc.versionDRIs[version];
    fs.writeFileSync(RELEASE_VERSIONS_CC_CONFIG_PATH, JSON.stringify(cc, null, 2), 'utf8');
  } catch (e) {
    console.warn('[config] syncVersionDrisFromReleaseConfig failed:', e.message);
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
const { getFieldId, getFieldValue } = require('../utils/jiraFieldsConfig');
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
 * Get Email Sender optional CC list (defaultCC shown as checkboxes; off by default)
 * GET /api/config/email-sender
 */
router.get('/email-sender', (req, res) => {
  try {
    const configPath = path.join(__dirname, '../config/emailSenderCCConfig.json');
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    res.json({
      defaultCC: Array.isArray(config.defaultCC) ? config.defaultCC : [],
      defaultTO: Array.isArray(config.defaultTO) ? config.defaultTO : [],
      projectTeamFields: Array.isArray(config.projectTeamFields) ? config.projectTeamFields : []
    });
  } catch (error) {
    console.error('Error loading Email Sender CC config:', error);
    res.status(500).json({ error: 'Failed to load Email Sender configuration' });
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
      sprintFieldId: config.sprintFieldId || getFieldId('sprintNdb'),
      teams: config.teams || [],
      defaultTeamId: config.defaultTeamId || (config.teams && config.teams[0] && config.teams[0].id) || null
    });
  } catch (error) {
    console.error('Error loading team board config:', error);
    res.status(500).json({ error: 'Failed to load team configuration' });
  }
});

/**
 * NDB engineering leader org map (Assignee Manager → SoS leader sections)
 * GET /api/config/ndb-leader-org
 */
router.get('/ndb-leader-org', (req, res) => {
  try {
    const configPath = path.join(__dirname, '../config/ndbLeaderOrgConfig.json');
    delete require.cache[require.resolve(configPath)];
    const config = require(configPath);
    res.json(config);
  } catch (error) {
    console.error('Error loading NDB leader org config:', error);
    res.status(500).json({ error: 'Failed to load NDB leader org configuration' });
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
    const team = getTeamById(teamId);
    if (!team) {
      return res.status(404).json({ error: 'Team not found' });
    }
    team.baseFilter = baseFilter != null ? String(baseFilter).trim() : '';
    const saved = saveTeamBoardConfig(config);
    res.json({ success: true, teams: saved.teams, team });
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
    const standard = Array.isArray(config.standardKpis) ? config.standardKpis : [];
    const raw = (config.teams && config.teams[normalizedTeamId]) || [];
    const merged = sortKpisByOrder([...standard, ...raw]);
    const { authorized: isAdmin } = checkKpiAdminAuthorization(username, teamId);
    res.json({ kpis: merged, isAdmin });
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
    if (kpiId && isStandardKpiLocked(config, kpiId)) {
      return res.status(403).json({ error: 'This KPI is a company-standard metric and cannot be edited. Its JQL is fixed across all teams (team scope comes from team.baseFilter).' });
    }
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
        const maxOrder = config.teams[normalizedTeamId].length === 0 ? 0 : Math.max(...config.teams[normalizedTeamId].map((k) => k.order ?? 0), ...(config.standardKpis || []).map((k) => k.order ?? 0));
        config.teams[normalizedTeamId].push({ id: kpiId, name: trimmedName, baseQuery: trimmedQuery, displayType: normalizedDisplayType, order: maxOrder + 1 });
      }
    } else {
      const maxOrder = [...(config.teams[normalizedTeamId] || []), ...(config.standardKpis || [])].length === 0 ? 0 : Math.max(...[...(config.teams[normalizedTeamId] || []), ...(config.standardKpis || [])].map((k) => k.order ?? 0));
      config.teams[normalizedTeamId].push({ id: generateKpiId(), name: trimmedName, baseQuery: trimmedQuery, displayType: normalizedDisplayType, order: maxOrder + 1 });
    }
    saveKpiConfig(config);
    const merged = sortKpisByOrder([...(config.standardKpis || []), ...(config.teams[normalizedTeamId] || [])]);
    res.json({ success: true, kpis: merged });
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
    if (isStandardKpiLocked(config, kpiId)) {
      return res.status(403).json({ error: 'This KPI is a company-standard metric and cannot be deleted. It is fixed across all teams.' });
    }
    if (!config.teams) config.teams = {};
    if (!Array.isArray(config.teams[normalizedTeamId])) config.teams[normalizedTeamId] = [];
    config.teams[normalizedTeamId] = config.teams[normalizedTeamId].filter((k) => k.id !== kpiId);
    saveKpiConfig(config);
    const merged = sortKpisByOrder([...(config.standardKpis || []), ...(config.teams[normalizedTeamId] || [])]);
    res.json({ success: true, kpis: merged });
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
    if (isStandardKpiLocked(config, kpiId)) {
      return res.status(403).json({ error: 'Company-standard KPIs cannot be reordered from team scope. Reordering is only for team-specific KPIs.' });
    }
    const rawTeam = (config.teams && config.teams[normalizedTeamId]) || [];
    const standard = config.standardKpis || [];
    const sortedTeam = sortKpisByOrder(Array.isArray(rawTeam) ? rawTeam : []);
    const idx = sortedTeam.findIndex((k) => k.id === kpiId);
    if (idx === -1) {
      return res.status(404).json({ error: 'KPI not found (or it is a standard KPI)' });
    }
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= sortedTeam.length) {
      const merged = sortKpisByOrder([...standard, ...sortedTeam]);
      return res.json({ success: true, kpis: merged });
    }
    const a = sortedTeam[idx];
    const b = sortedTeam[swapIdx];
    const orderA = a.order ?? idx;
    const orderB = b.order ?? swapIdx;
    a.order = orderB;
    b.order = orderA;
    saveKpiConfig(config);
    const merged = sortKpisByOrder([...(config.standardKpis || []), ...(config.teams[normalizedTeamId] || [])]);
    res.json({ success: true, kpis: merged });
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

// ── GA date side-effect helpers ─────────────────────────────────────────────

function getConfigJiraToken() {
  return process.env.JIRA_TOKEN || jiraConfig.token;
}

/**
 * Find the JIRA version ID for a given project + version name.
 * Returns null if not found.
 */
async function findJiraVersionId(projectKey, versionName) {
  try {
    const jira = await getJira(getConfigJiraToken());
    const { data } = await jira.get(JIRA_API_V2.PROJECT_VERSIONS(projectKey), { timeout: 10000 });
    const match = (data || []).find(v => v.name === versionName);
    return match ? match.id : null;
  } catch (e) {
    console.warn(`[config] findJiraVersionId ${projectKey}/${versionName}:`, e.message);
    return null;
  }
}

/**
 * Update the releaseDate on a JIRA version.
 */
async function updateJiraVersionReleaseDate(versionId, releaseDate) {
  try {
    const jira = await getJira(getConfigJiraToken());
    await jira.put(JIRA_API_V2.VERSION(versionId), { releaseDate }, { timeout: 10000 });
    return true;
  } catch (e) {
    console.warn(`[config] updateJiraVersionReleaseDate ${versionId}:`, e.message);
    return false;
  }
}

/**
 * Fire-and-forget: update JIRA FEAT + ERA project versions when GA date changes.
 * Does not block the API response.
 */
async function triggerGaJiraUpdate(version, newGaDate) {
  const projects = ['FEAT', 'ERA'];
  for (const proj of projects) {
    const versionId = await findJiraVersionId(proj, version);
    if (versionId) {
      await updateJiraVersionReleaseDate(versionId, newGaDate);
    }
  }
}

/**
 * Send GA date change notification email.
 */
async function sendGaChangedEmail({ version, oldGaDate, newGaDate, reason, changedBy }) {
  try {
    const recipients = [
      ...(releaseVersionsCCConfig.defaultCC || []),
      ...((releaseVersionsCCConfig.versionDRIs || {})[version] || []),
    ].filter(Boolean);

    if (!recipients.length) return;

    const fmtDate = d => d || 'TBD';
    const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto">
  <h2 style="color:#333;border-bottom:2px solid #007bff;padding-bottom:8px">
    GA Date Updated — ${version}
  </h2>
  <table style="width:100%;border-collapse:collapse;margin:16px 0">
    <tr>
      <td style="padding:8px;background:#f8f9fa;font-weight:bold;width:140px">Release</td>
      <td style="padding:8px">${version}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f8f9fa;font-weight:bold">Previous GA</td>
      <td style="padding:8px;color:#dc3545">${fmtDate(oldGaDate)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f8f9fa;font-weight:bold">New GA</td>
      <td style="padding:8px;color:#28a745">${fmtDate(newGaDate)}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f8f9fa;font-weight:bold">Changed by</td>
      <td style="padding:8px">${changedBy || 'unknown'}</td>
    </tr>
    <tr>
      <td style="padding:8px;background:#f8f9fa;font-weight:bold;vertical-align:top">Reason</td>
      <td style="padding:8px">${reason || '(no reason provided)'}</td>
    </tr>
  </table>
  <p style="color:#6c757d;font-size:12px">
    JIRA version release dates in FEAT and ERA projects have been updated automatically.
  </p>
</div>`;

    await sendEmailDirect({
      to: recipients.join(', '),
      subject: `[${version}] GA Date Updated: ${fmtDate(oldGaDate)} → ${fmtDate(newGaDate)}`,
      html,
    });
  } catch (e) {
    console.warn('[config] sendGaChangedEmail failed:', e.message);
  }
}

/**
 * Create or update release dates configuration
 * POST /api/config/release-dates
 * Body: { version, ecDate, ccm1Gate[], ccm2Gate[], codeFreeze, commitGate1, commitGate2, promotionGate1, promotionGate2, ga1, ga2, reason, ...anyExtraGateFields }
 */
router.post('/release-dates', express.json(), (req, res) => {
  const username = getUsername(req);
  const { authorized } = checkKpiTabAuthorization(username);
  if (!authorized) {
    return res.status(403).json({ error: 'Access denied. You are not authorized to manage release configuration.' });
  }

  // Pull out non-gate fields; everything else in the body is treated as a gate/date field.
  const { version, reason, dateHistory: _ignoreClientHistory, ...gateFields } = req.body || {};

  if (!version) {
    return res.status(400).json({ error: 'Release version is required' });
  }

  // Destructure known gates for validation/side-effects — still accept any unknown ones below.
  const { ecDate, ccm1Gate, ccm2Gate, ga1, ga2, ga3 } = gateFields;

  try {
    const config = loadReleaseDatesConfig();
    const previousConfig = config.releases[version] || {};

    // Normalise a gate value: accept either an object or a single-element array from legacy callers.
    function normaliseGate(val) {
      if (!val) return null;
      if (Array.isArray(val)) {
        const filtered = val.filter(x => x?.date);
        return filtered.length > 0 ? filtered[filtered.length - 1] : null;
      }
      return val.date ? val : null;
    }

    // Persisted extra keys that are not gates but per-release metadata
    const EXTRA_PERSISTED_KEYS = new Set(['notes', 'releaseNotes', 'info', '_jira', '_source', '_syncedAt', 'jiraMeta']);

    // Build release config:
    // 1. Start from the existing saved config so unknown fields (ga4, ccm3Gate, overflow, etc.) survive.
    // 2. Apply all gate fields sent by the client on top (null-safe).
    // 3. Normalise ccm* which may arrive as arrays from legacy callers.
    const SKIP_KEYS = new Set(['version', 'reason', 'dateHistory']);
    const releaseConfig = { ...previousConfig };
    for (const [key, val] of Object.entries(gateFields)) {
      if (SKIP_KEYS.has(key)) continue;
      if (EXTRA_PERSISTED_KEYS.has(key)) {
        if (key === 'notes' || key === 'releaseNotes' || key === 'info') {
          releaseConfig.notes = String(val ?? '').slice(0, 2000);
          // Keep alias keys in sync so either read path works
          if (key !== 'notes') releaseConfig[key] = String(val ?? '').slice(0, 2000);
        } else if (key === '_jira' || key === 'jiraMeta') {
          // Validate shape before persisting — only known fields
          if (val && typeof val === 'object') {
            const sanitized = {};
            if (val.projectKey) sanitized.projectKey = String(val.projectKey);
            if (val.name) sanitized.name = String(val.name);
            if (val.released != null) sanitized.released = !!val.released;
            if (val.archived != null) sanitized.archived = !!val.archived;
            if (val.releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(String(val.releaseDate))) sanitized.releaseDate = String(val.releaseDate);
            if (val.id) sanitized.id = String(val.id);
            if (val.syncedAt) sanitized.syncedAt = String(val.syncedAt);
            if (val.description) sanitized.description = String(val.description).slice(0, 2000);
            releaseConfig._jira = sanitized;
            if (key === 'jiraMeta') releaseConfig.jiraMeta = sanitized;
          }
        } else if (key === '_source' || key === '_syncedAt') {
          releaseConfig[key] = String(val ?? '').slice(0, 500);
        }
        continue;
      }
      if (key === 'ccm1Gate' || key === 'ccm2Gate') {
        releaseConfig[key] = normaliseGate(val);
      } else {
        releaseConfig[key] = val ?? null;
      }
    }
    // Normalize notes alias — ensure `notes` is canonical even if client sent releaseNotes/info
    if (gateFields.releaseNotes != null && releaseConfig.notes === undefined) {
      releaseConfig.notes = String(gateFields.releaseNotes ?? '').slice(0, 2000);
    }
    if (gateFields.info != null && releaseConfig.notes === undefined) {
      releaseConfig.notes = String(gateFields.info ?? '').slice(0, 2000);
    }

    // Carry forward existing date history and append any dates that changed
    const prevDateHistory = previousConfig.dateHistory || {};
    const newDateHistory = { ...prevDateHistory };

    function recordHistory(fieldKey, prevVal, nextVal) {
      if (prevVal && nextVal && prevVal !== nextVal) {
        if (!newDateHistory[fieldKey]) newDateHistory[fieldKey] = [];
        if (!newDateHistory[fieldKey].includes(prevVal)) {
          newDateHistory[fieldKey] = [...newDateHistory[fieldKey], prevVal];
        }
      }
    }

    // Record history for all gate fields present in the incoming payload
    recordHistory('ecDate', previousConfig.ecDate, ecDate);
    Object.keys(gateFields).filter(k => k !== 'ecDate').forEach(key => {
      recordHistory(key, previousConfig[key]?.date, releaseConfig[key]?.date);
    });

    releaseConfig.dateHistory = newDateHistory;

    // Release DRIs (Dev / QA) — main release setup; usernames without domain
    if (Object.prototype.hasOwnProperty.call(gateFields, 'devDRIs')) {
      releaseConfig.devDRIs = normalizeDriList(gateFields.devDRIs);
    } else if (!Array.isArray(releaseConfig.devDRIs)) {
      releaseConfig.devDRIs = normalizeDriList(previousConfig.devDRIs);
    }
    if (Object.prototype.hasOwnProperty.call(gateFields, 'qaDRIs')) {
      releaseConfig.qaDRIs = normalizeDriList(gateFields.qaDRIs);
    } else if (!Array.isArray(releaseConfig.qaDRIs)) {
      releaseConfig.qaDRIs = normalizeDriList(previousConfig.qaDRIs);
    }

    config.releases[version] = releaseConfig;
    saveReleaseDatesConfig(config);
    syncVersionDrisFromReleaseConfig(version, releaseConfig.devDRIs);

    // Detect GA date change and fire side-effects asynchronously
    const oldGaDate = previousConfig.ga1?.date || previousConfig.ga2?.date || null;
    const newGaDate = ga1?.date || ga2?.date || null;
    if (newGaDate && newGaDate !== oldGaDate) {
      const changedBy = getUsername(req);
      // Fire and forget — don't block the response
      Promise.all([
        triggerGaJiraUpdate(version, newGaDate),
        sendGaChangedEmail({ version, oldGaDate, newGaDate, reason, changedBy }),
      ]).catch(e => console.warn('[config] GA side-effects error:', e.message));
    }
    
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

    // Read from releaseGateDates — the single source of truth (busts require cache)
    const allConfig = loadReleaseDatesConfig();
    const versionConfig = allConfig.releases[version];
    
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
    const formatMilestoneDate = (date) => {
      if (!date) return null;
      return formatDate(date);
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
              formattedDate: formatMilestoneDate(new Date(milestone.date)),
              isStrikeThrough: milestone.style === 'dotted',
              isCurrent: milestone.style === 'solid'
            });
            
            if (milestone.style === 'solid') {
              currentDate = formatMilestoneDate(new Date(milestone.date));
            }
          });
        } else {
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

    // Process all milestone types with error handling
    let codeComplete, commitGate, promotionGate, generalAvailability;
    
    try {
      codeComplete = processMilestones('ccm');
    } catch (error) {
      console.error(`[release-dates] Error processing code complete:`, error);
      codeComplete = { milestones: [], currentDate: 'TBD' };
    }
    
    try {
      commitGate = processMilestones('commitGate');
    } catch (error) {
      console.error(`[release-dates] Error processing commit gate:`, error);
      commitGate = { milestones: [], currentDate: 'TBD' };
    }
    
    try {
      promotionGate = processMilestones('promotionGate');
    } catch (error) {
      console.error(`[release-dates] Error processing promotion gate:`, error);
      promotionGate = { milestones: [], currentDate: 'TBD' };
    }
    
    try {
      generalAvailability = processMilestones('ga');
    } catch (error) {
      console.error(`[release-dates] Error processing GA:`, error);
      generalAvailability = { milestones: [], currentDate: 'TBD' };
    }

    // Calculate days to current Promotion Gate
    let daysToPG = null;
    const currentPGMilestone = promotionGate.milestones.find(m => m.isCurrent);
    if (currentPGMilestone) {
      const pgDate = new Date(currentPGMilestone.date);
      const diffTime = pgDate - new Date();
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

/**
 * Mark release as Released — preview.
 * GET /api/config/releases/:version/release-preview?teamId=ndb
 */
router.get('/releases/:version/release-preview', async (req, res) => {
  try {
    const { version } = req.params; const { teamId } = req.query;
    const username = getUsername(req);
    const svc = require('../services/releaseFinalizeService');
    if (!svc.isAuthorized(username, teamId)) return res.status(403).json({ error: 'Only admins/team-admins may preview release.' });
    const token = req.headers.authorization ? String(req.headers.authorization).replace(/^Bearer\s+/i,'') : (process.env.JIRA_TOKEN || require('../config/jiraConfig.json').token || '');
    const data = await svc.previewRelease({ version, teamId, jiraToken: token });
    // Attach announcement draft recipient (logged-in user) — product-aware subject matches send path
    try {
      const { usernameToEmail } = require('../services/userService');
      const draftTo = username ? usernameToEmail(username) : null;
      data.announcementDraftTo = draftTo || null;
      if (draftTo) {
        const { resolveTeamForRelease } = require('../services/releaseFinalizeService');
        const team = resolveTeamForRelease ? resolveTeamForRelease(version, teamId) : null;
        const product = team?.branding?.shortName || team?.name || String(version).split(/[- ]/)[0] || version;
        data.announcementDraftSubject = `[DRAFT] Announcing ${product} ${version} — Official Release is Live 🎉`;
      }
    } catch {}
    res.json(data);
  } catch (e) { res.status(e.statusCode||500).json({ error: e.message }); }
});
router.post('/releases/:version/mark-released', express.json(), async (req, res) => {
  try {
    const { version } = req.params; const { teamId, note } = req.body || {}; const username = getUsername(req);
    const svc = require('../services/releaseFinalizeService');
    if (!svc.isAuthorized(username, teamId)) return res.status(403).json({ error: 'Only admins/team-admins may mark a release as released.' });
    const token = req.headers.authorization ? String(req.headers.authorization).replace(/^Bearer\s+/i,'') : (process.env.JIRA_TOKEN || require('../config/jiraConfig.json').token || '');
    const data = await svc.markReleased({ version, teamId, jiraToken: token, username, note });
    res.json({ success: true, ...data });
  } catch (e) { res.status(e.statusCode||500).json({ error: String(e.message).split('\n')[0].slice(0, 500) }); }
});

/**
 * Preview release announcement draft (no send) — returns html + subject + recipient.
 * GET /api/config/releases/:version/announcement-preview?teamId=ndb
 */
router.get('/releases/:version/announcement-preview', async (req, res) => {
  try {
    const { version } = req.params; const { teamId } = req.query;
    const username = getUsername(req);
    const svc = require('../services/releaseFinalizeService');
    if (!svc.isAuthorized(username, teamId)) return res.status(403).json({ error: 'Only admins/team-admins may preview announcement.' });
    const token = req.headers.authorization ? String(req.headers.authorization).replace(/^Bearer\s+/i,'') : (process.env.JIRA_TOKEN || require('../config/jiraConfig.json').token || '');
    const ann = require('../services/releaseAnnouncementService');
    const { usernameToEmail } = require('../services/userService');
    const to = username ? usernameToEmail(username) : null;
    const gen = await ann.generateAnnouncementHtml({ version, teamId, jiraToken: token });
    const product = gen.product || String(version).split(/[- ]/)[0] || 'Product';
    const subject = `[DRAFT] Announcing ${product} ${version} — Official Release is Live 🎉`;
    const todayDate = new Date().toISOString().slice(0, 10);
    const draftNotice = `<div style="background:#fff3cd;border:1px solid #ffc107;padding:10px 12px;margin-bottom:16px;font-family:Arial,sans-serif;font-size:13px;border-radius:4px;">⚠️ <b>DRAFT</b> — Auto-generated for <b>${version}</b> on ${todayDate} for ${username || 'unknown'} (${to || '—'}).<br><span style="color:#6c757d">AI ${gen.aiUsed ? 'generated' : 'fallback template'} • ${gen.featureCount} feature(s) • GA ${gen.gaDate || 'TBD'}</span></div>`;
    const html = draftNotice + gen.html;
    res.json({ version, teamId: gen.teamId, product, subject, to, html, aiUsed: gen.aiUsed, aiError: gen.aiError ? String(gen.aiError).split('\n')[0].slice(0, 300) : null, featureCount: gen.featureCount, gaDate: gen.gaDate });
  } catch (e) { res.status(e.statusCode||500).json({ error: String(e.message).split('\n')[0].slice(0, 500) }); }
});

/**
 * Send edited announcement draft to the actor (after review).
 * POST /api/config/releases/:version/announcement-send  body: { teamId, html, subject, to? }
 */
router.post('/releases/:version/announcement-send', express.json({ limit: '2mb' }), async (req, res) => {
  try {
    const { version } = req.params; const { teamId, html, subject, to } = req.body || {};
    const username = getUsername(req);
    const svc = require('../services/releaseFinalizeService');
    if (!svc.isAuthorized(username, teamId)) return res.status(403).json({ error: 'Only admins/team-admins may send announcement.' });
    if (!html || !String(html).trim()) return res.status(400).json({ error: 'html is required (reviewed announcement)' });
    const ann = require('../services/releaseAnnouncementService');
    const result = await ann.sendEditedAnnouncement({ version, username, html: String(html), subject: subject ? String(subject) : null, toOverride: to ? String(to) : null });
    if (result.error) return res.status(500).json({ error: String(result.error).split('\n')[0].slice(0, 500), to: result.to, subject: result.subject });
    res.json({ success: true, ...result });
  } catch (e) { res.status(e.statusCode||500).json({ error: String(e.message).split('\n')[0].slice(0, 500) }); }
});

/**
 * Sync missing JIRA versions into runtime config (append-only).
 * POST /api/config/sync-releases  body: { teamId?, projectKeys? }
 * Requires JIRA auth (Bearer PAT).
 */
router.post('/sync-releases', express.json(), validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { teamId, projectKeys } = req.body || {};
    const releaseConfigSyncService = require('../services/releaseConfigSyncService');
    const result = await releaseConfigSyncService.syncMissingReleases(req.jiraToken, { teamId, projectKeys });
    res.json({ success: true, ...result });
  } catch (error) {
    console.error('[config] POST /sync-releases failed:', error.message);
    const status = error.statusCode || 500;
    res.status(status).json({ success: false, error: error.publicError || error.message || 'Sync failed' });
  }
});

module.exports = router;

