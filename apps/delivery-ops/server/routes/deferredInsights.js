const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { apiLimiter } = require('../middleware/security');
const { checkKpiViewAuthorization } = require('../services/userService');
const svc = require('../services/deferredInsightsService');
const { extractApiError } = require('../utils/errorMessages');

function requireKpiView(req, res) {
  const username = req.username || req.headers['x-username'] || '';
  const { authorized } = checkKpiViewAuthorization(username);
  if (!authorized) {
    res.status(403).json({ error: 'Access denied. KPI view authorization required.' });
    return false;
  }
  return true;
}

async function handleDashboard(req, res, { teamId, releases, priority, component, bypassCache }) {
  try {
    if (!requireKpiView(req, res)) return;
    const data = await svc.getDashboard({ token: req.jiraToken, teamId, releases, priority, component, bypassCache });
    return res.json({ success: true, data });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in /api/deferred-insights:', apiError.message);
    return res.status(err.statusCode || apiError.statusCode || 500).json({ success: false, error: apiError.message || err.message || 'Deferred Insights failed' });
  }
}

// Shared handler — accepts teamId from query or body + releases as CSV or array
function parseReleases(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw.map((s) => String(s).trim()).filter(Boolean);
  return String(raw).split(',').map((s) => String(s).trim()).filter(Boolean);
}

router.get('/insights', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const teamId = (req.query.teamId || req.query.team || '').trim() || undefined;
  const releases = parseReleases(req.query.releases || req.query.release);
  const priority = (req.query.priority || '').trim() || undefined;
  const component = (req.query.component || '').trim() || undefined;
  const bypassCache = String(req.query.refresh || req.query.bypassCache || '') === '1' || String(req.query.refresh || '') === 'true';
  return handleDashboard(req, res, { teamId, releases, priority, component, bypassCache });
});

router.post('/insights/refresh', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const body = req.body || {};
  const teamId = (body.teamId || body.team || req.query.teamId || '').trim() || undefined;
  const releases = parseReleases(body.releases || body.release || req.query.releases);
  const priority = (body.priority || req.query.priority || '').trim() || undefined;
  const component = (body.component || req.query.component || '').trim() || undefined;
  return handleDashboard(req, res, { teamId, releases, priority, component, bypassCache: true });
});

// Back-compat: also mount at /api/jira/deferred-insights/* via alias in server/index.js
router.get('/', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  const teamId = (req.query.teamId || req.query.team || '').trim() || undefined;
  const releases = parseReleases(req.query.releases || req.query.release);
  const priority = (req.query.priority || '').trim() || undefined;
  const component = (req.query.component || '').trim() || undefined;
  const bypassCache = String(req.query.refresh || req.query.bypassCache || '') === '1' || String(req.query.refresh || '') === 'true';
  return handleDashboard(req, res, { teamId, releases, priority, component, bypassCache });
});

module.exports = router;
