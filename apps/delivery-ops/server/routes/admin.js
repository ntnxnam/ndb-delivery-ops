const express = require('express');
const tokenCache = require('../utils/tokenCache');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { checkFeatureAccess } = require('../services/authService');
const { getJira } = require('../utils/jiraClient');
const teamAdminService = require('../services/teamAdminService');
const teamInspectService = require('../services/teamInspectService');

const router = express.Router();

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

function sendError(res, error, fallback) {
  const status = error.statusCode || error.response?.status || 500;
  if (status >= 500) console.error(`${fallback}:`, error.message);
  return res.status(status).json({
    success: false,
    error: error.publicError || fallback,
    message: error.response?.data?.errorMessages?.join(', ') || error.message
  });
}

/**
 * Detect team settings from a base filter: main project, versions,
 * scrum board + sprint calendar, feature components.
 * POST /api/admin/inspect-base-filter
 */
router.post('/inspect-base-filter', requireSuperAdmin, validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { baseFilter, name, boardId } = req.body || {};
    const jira = await getJira(req.jiraToken);
    const detected = await teamInspectService.inspectBaseFilter(jira, {
      baseFilter,
      teamName: name,
      boardId
    });
    return res.json({ success: true, ...detected });
  } catch (error) {
    return sendError(res, error, 'Failed to inspect base filter');
  }
});

/**
 * Versions and scrum boards for the project the admin selected.
 * POST /api/admin/project-scope
 */
router.post('/project-scope', requireSuperAdmin, validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { projectKey, name } = req.body || {};
    const jira = await getJira(req.jiraToken);
    const scope = await teamInspectService.inspectProject(jira, { projectKey, teamName: name });
    return res.json({ success: true, ...scope });
  } catch (error) {
    return sendError(res, error, 'Failed to load project boards');
  }
});

/**
 * Sprint calendar for a specific board (when the detected board is wrong).
 * POST /api/admin/board-calendar
 */
router.post('/board-calendar', requireSuperAdmin, validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { boardId } = req.body || {};
    const jira = await getJira(req.jiraToken);
    const calendar = await teamInspectService.boardCalendar(jira, boardId);
    return res.json({ success: true, ...calendar });
  } catch (error) {
    return sendError(res, error, 'Failed to read board calendar');
  }
});

/**
 * GET /api/admin/teams
 */
router.get('/teams', requireSuperAdmin, (req, res) => {
  try {
    return res.json({ success: true, ...teamAdminService.listTeams() });
  } catch (error) {
    return sendError(res, error, 'Failed to load teams');
  }
});

/**
 * POST /api/admin/teams
 */
router.post('/teams', requireSuperAdmin, (req, res) => {
  try {
    const team = teamAdminService.createTeam(req.body || {});
    return res.json({ success: true, team, message: `Team "${team.name}" created successfully` });
  } catch (error) {
    return sendError(res, error, 'Failed to create team');
  }
});

/**
 * PUT /api/admin/teams/:teamId
 */
router.put('/teams/:teamId', requireSuperAdmin, (req, res) => {
  try {
    const team = teamAdminService.updateTeam(req.params.teamId, req.body || {});
    return res.json({ success: true, team, message: `Team "${team.id}" updated successfully` });
  } catch (error) {
    return sendError(res, error, 'Failed to update team');
  }
});

/**
 * POST /api/admin/test-team-config
 */
router.post('/test-team-config', requireSuperAdmin, validateJiraTokenMiddleware, async (req, res) => {
  try {
    const { teamId } = req.body || {};
    if (!teamId) return res.status(400).json({ success: false, error: 'teamId is required' });
    const jira = await getJira(req.jiraToken);
    return res.json(await teamAdminService.testTeamConfig(teamId, jira));
  } catch (error) {
    return sendError(res, error, 'Failed to test team configuration');
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

// ── Config Manager (self-serve JSON editor) ─────────────────────────────
const configAdminService = require('../services/configAdminService');

/**
 * GET /api/admin/configs — list allowlisted config files
 */
router.get('/configs', requireSuperAdmin, (req, res) => {
  try {
    return res.json({ success: true, configs: configAdminService.listConfigs() });
  } catch (error) {
    return sendError(res, error, 'Failed to list configs');
  }
});

/**
 * GET /api/admin/configs/:key — read a single config
 */
router.get('/configs/:key', requireSuperAdmin, (req, res) => {
  try {
    const result = configAdminService.getConfig(req.params.key);
    return res.json({ success: true, ...result });
  } catch (error) {
    return sendError(res, error, 'Failed to load config');
  }
});

/**
 * PUT /api/admin/configs/:key — replace full config (atomic save with .bak)
 * Body: { data: <object> }
 */
router.put('/configs/:key', requireSuperAdmin, (req, res) => {
  try {
    if (req.body?.data === undefined) {
      return res.status(400).json({ success: false, error: 'Body must be { data: <object> }' });
    }
    const payload = req.body.data;
    const result = configAdminService.saveConfig(req.params.key, payload);
    return res.json({ success: true, ...result, message: `${result.file} saved.` });
  } catch (error) {
    return sendError(res, error, 'Failed to save config');
  }
});

/**
 * PATCH /api/admin/configs/:key/field — upsert a single dotted field
 * Body: { fieldPath: "rag.redOpenP0", value: 2 }
 */
router.patch('/configs/:key/field', requireSuperAdmin, (req, res) => {
  try {
    const { fieldPath, value } = req.body || {};
    const result = configAdminService.patchField(req.params.key, fieldPath, value);
    return res.json({ success: true, ...result, message: `Field "${fieldPath}" updated.` });
  } catch (error) {
    return sendError(res, error, 'Failed to patch field');
  }
});

/**
 * DELETE /api/admin/configs/:key/field — remove a dotted field
 * Body: { fieldPath: "customFields.myNewField" }
 */
router.delete('/configs/:key/field', requireSuperAdmin, (req, res) => {
  try {
    const fieldPath = req.body?.fieldPath || req.query?.fieldPath;
    const result = configAdminService.deleteField(req.params.key, fieldPath);
    return res.json({ success: true, ...result, message: `Field "${fieldPath}" removed.` });
  } catch (error) {
    return sendError(res, error, 'Failed to delete field');
  }
});

module.exports = router;
