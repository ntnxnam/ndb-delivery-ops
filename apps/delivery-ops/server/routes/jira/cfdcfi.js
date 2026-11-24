const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter } = require('../../middleware/security');
const { checkKpiViewAuthorization } = require('../../services/userService');
const cfdcfiService = require('../../services/cfdcfiService');
const cfdcfiDashboardV2 = require('../../services/cfdcfiDashboardV2');
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
    const data = await cfdcfiService.getDashboard({ token: req.jiraToken, teamId });
    return res.json({ success: true, ...data });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in /api/jira/cfdcfi:', apiError.message);
    return res.status(err.statusCode || apiError.statusCode || 500).json({ success: false, error: apiError.message || err.message || 'CFD/CFI dashboard failed' });
  }
}

async function handleDashboardV2(req, res, { teamId, timeframe }) {
  try {
    if (!requireKpiView(req, res)) return;
    const data = await cfdcfiDashboardV2.getDashboard({ token: req.jiraToken, teamId, timeframe });
    return res.json({ success: true, ...data });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in /api/jira/cfdcfi v2:', apiError.message);
    return res.status(err.statusCode || apiError.statusCode || 500).json({ success: false, error: apiError.message || err.message || 'CFD/CFI V2 dashboard failed' });
  }
}

router.get('/cfdcfi', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const teamId = (req.query.teamId || '').trim() || undefined;
  const timeframe = (req.query.timeframe || '').trim();
  const v2Flag = String(req.query.v2 || '').trim();
  if (timeframe || v2Flag === '1' || v2Flag === 'true') {
    return handleDashboardV2(req, res, { teamId, timeframe: timeframe || '7d' });
  }
  return handleDashboard(req, res, { teamId });
});

router.get('/cfdcfi/v2', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  return handleDashboardV2(req, res, { teamId: (req.query.teamId || '').trim() || undefined, timeframe: (req.query.timeframe || '').trim() || '7d' });
});

router.post('/cfdcfi/refresh', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const body = req.body || {};
  const teamId = (body.teamId || '').trim() || undefined;
  const timeframe = (body.timeframe || req.query.timeframe || '').trim();
  if (timeframe || String(body.v2 || '').trim() === '1') {
    return handleDashboardV2(req, res, { teamId, timeframe: timeframe || '7d' });
  }
  return handleDashboard(req, res, { teamId });
});

router.post('/cfdcfi/v2/refresh', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const body = req.body || {};
  return handleDashboardV2(req, res, { teamId: (body.teamId || '').trim() || undefined, timeframe: (body.timeframe || '').trim() || '7d' });
});

module.exports = router;
