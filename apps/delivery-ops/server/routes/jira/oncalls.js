const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter } = require('../../middleware/security');
const { checkKpiViewAuthorization } = require('../../services/userService');
const oncallDashboardV2 = require('../../services/oncallDashboardV2');
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

async function handleDashboardV2(req, res, { teamId, timeframe }) {
  try {
    if (!requireKpiView(req, res)) return;
    const data = await oncallDashboardV2.getDashboard({
      token: req.jiraToken,
      teamId,
      timeframe,
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in /api/jira/oncalls v2:', apiError.message);
    return res.status(err.statusCode || apiError.statusCode || 500).json({
      success: false,
      error: apiError.message || err.message || 'OnCalls V2 dashboard failed',
    });
  }
}

/**
 * GET /api/jira/oncalls
 * OnCalls V2 — all requests go to V2 (timeframe-aware). Legacy v1 removed 2026-11-24.
 */
router.get('/oncalls', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const teamId = (req.query.teamId || '').trim() || undefined;
  const timeframe = (req.query.timeframe || '').trim() || '2Q';
  return handleDashboardV2(req, res, { teamId, timeframe });
});

/**
 * GET /api/jira/oncalls/v2 explicit route (kept for backward compat)
 */
router.get('/oncalls/v2', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  return handleDashboardV2(req, res, {
    teamId: (req.query.teamId || '').trim() || undefined,
    timeframe: (req.query.timeframe || '').trim() || '2Q',
  });
});

/**
 * POST /api/jira/oncalls/refresh — explicit Pull from JIRA (same as GET)
 */
router.post('/oncalls/refresh', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const body = req.body || {};
  const teamId = (body.teamId || '').trim() || undefined;
  const timeframe = (body.timeframe || req.query.timeframe || '').trim() || '2Q';
  return handleDashboardV2(req, res, { teamId, timeframe });
});

/**
 * POST /api/jira/oncalls/v2/refresh
 */
router.post('/oncalls/v2/refresh', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const body = req.body || {};
  return handleDashboardV2(req, res, {
    teamId: (body.teamId || '').trim() || undefined,
    timeframe: (body.timeframe || '').trim() || '2Q',
  });
});

/**
 * POST /api/jira/oncalls/report — preview or send HTML email report (reuses outstanding pattern)
 * Body: { teamId, timeframe, to?, cc?, previewOnly?, dashboard?, aiConcern? }
 * - dashboard: optional snapshot from client (avoids re-fetch); when missing, server fetches via getDashboard
 * - aiConcern: optional fused AI concern string to embed in email
 */
router.post('/oncalls/report', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    if (!requireKpiView(req, res)) return;
    const body = req.body || {};
    const teamId = (body.teamId || '').trim() || undefined;
    const timeframe = (body.timeframe || '').trim() || '7d';
    const to = Array.isArray(body.to) ? body.to : (body.to ? [body.to] : undefined);
    const cc = Array.isArray(body.cc) ? body.cc : (body.cc ? [body.cc] : undefined);
    const previewOnly = Boolean(body.previewOnly);
    const dashboard = body.dashboard && typeof body.dashboard === 'object' ? body.dashboard : null;
    const aiConcern = body.aiConcern ? String(body.aiConcern) : null;
    const oncallReportService = require('../../services/oncallReportService');
    const data = await oncallReportService.previewOrSendOncallReport({
      token: req.jiraToken,
      teamId,
      timeframe,
      to,
      cc,
      previewOnly,
      dashboard,
      aiConcern,
    });
    return res.json({ success: true, data });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('[oncalls/report] failed:', apiError.message);
    return res.status(err.statusCode || apiError.statusCode || 500).json({
      success: false,
      error: apiError.message || err.message || 'OnCalls report failed',
    });
  }
});

module.exports = router;
