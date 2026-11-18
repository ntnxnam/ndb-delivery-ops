const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter } = require('../../middleware/security');
const { checkKpiViewAuthorization } = require('../../services/userService');
const systemTestScaleService = require('../../services/systemTestScaleService');
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

async function handleDashboard(req, res, { teamId, currentRelease, compareRelease }) {
  try {
    if (!requireKpiView(req, res)) return;
    const data = await systemTestScaleService.getDashboard({
      token: req.jiraToken,
      teamId,
      currentRelease,
      compareRelease,
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in /api/jira/system-test-scale:', apiError.message);
    return res.status(err.statusCode || apiError.statusCode || 500).json({
      success: false,
      error: apiError.message || err.message || 'System-Test scale dashboard failed',
    });
  }
}

/**
 * GET /api/jira/system-test-scale
 * Live System-Test scale dashboard — always hits JIRA.
 * Scoped by team → filter={teamCode}-System-Test
 */
router.get('/system-test-scale', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  return handleDashboard(req, res, {
    teamId: (req.query.teamId || '').trim() || undefined,
    currentRelease: (req.query.currentRelease || '').trim() || undefined,
    compareRelease: (req.query.compareRelease || '').trim() || undefined,
  });
});

/**
 * POST /api/jira/system-test-scale/refresh
 * Same as GET — live re-count from JIRA (explicit pull).
 */
router.post('/system-test-scale/refresh', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const body = req.body || {};
  return handleDashboard(req, res, {
    teamId: (body.teamId || '').trim() || undefined,
    currentRelease: (body.currentRelease || '').trim() || undefined,
    compareRelease: (body.compareRelease || '').trim() || undefined,
  });
});

module.exports = router;
