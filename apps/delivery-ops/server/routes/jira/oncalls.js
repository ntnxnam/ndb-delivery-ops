const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter } = require('../../middleware/security');
const { checkKpiViewAuthorization } = require('../../services/userService');
const oncallService = require('../../services/oncallService');
const { extractApiError } = require('../../utils/errorMessages');

function requireKpiView(req, res) {
  const username = req.username || req.headers['x-username'] || '';
  const { authorized } = checkKpiViewAuthorization(username);
  if (!authorized) {
    res.status(403).json({ error: 'Access denied. KPI view authorization required.' });
    return false;
  }
  return true;
}

async function handleDashboard(req, res, { teamId }) {
  try {
    if (!requireKpiView(req, res)) return;
    const data = await oncallService.getDashboard({
      token: req.jiraToken,
      teamId,
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in /api/jira/oncalls:', apiError.message);
    return res.status(err.statusCode || apiError.statusCode || 500).json({
      success: false,
      error: apiError.message || err.message || 'OnCalls dashboard failed',
    });
  }
}

/**
 * GET /api/jira/oncalls
 * Live OnCalls quantitative dashboard.
 */
router.get('/oncalls', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  return handleDashboard(req, res, {
    teamId: (req.query.teamId || '').trim() || undefined,
  });
});

/**
 * POST /api/jira/oncalls/refresh
 * Explicit Pull from JIRA — same as GET.
 */
router.post('/oncalls/refresh', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const body = req.body || {};
  return handleDashboard(req, res, {
    teamId: (body.teamId || '').trim() || undefined,
  });
});

module.exports = router;
