const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter } = require('../../middleware/security');
const { checkKpiViewAuthorization } = require('../../services/userService');
const cfdcfiService = require('../../services/cfdcfiService');
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
    const data = await cfdcfiService.getDashboard({
      token: req.jiraToken,
      teamId,
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in /api/jira/cfdcfi:', apiError.message);
    return res.status(err.statusCode || apiError.statusCode || 500).json({
      success: false,
      error: apiError.message || err.message || 'CFD/CFI dashboard failed',
    });
  }
}

/**
 * GET /api/jira/cfdcfi
 * Live CFD/CFI KPI pulse dashboard.
 */
router.get('/cfdcfi', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  return handleDashboard(req, res, {
    teamId: (req.query.teamId || '').trim() || undefined,
  });
});

/**
 * POST /api/jira/cfdcfi/refresh
 * Explicit Pull from JIRA — same as GET.
 */
router.post('/cfdcfi/refresh', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const body = req.body || {};
  return handleDashboard(req, res, {
    teamId: (body.teamId || '').trim() || undefined,
  });
});

module.exports = router;
