const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { apiLimiter } = require('../../middleware/security');
const { checkKpiViewAuthorization } = require('../../services/userService');
const { runSearchByJql } = require('../../utils/jiraSearchByJql');
const { extractApiError } = require('../../utils/errorMessages');
const kpiService = require('../../services/kpiService');

router.post('/search-by-jql', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const { jql, maxResults: requestedMax } = req.body;
    if (!jql || typeof jql !== 'string' || !jql.trim()) {
      return res.status(400).json({ error: 'jql is required and must be a non-empty string' });
    }
    const maxResults = Math.min(Number(requestedMax) || 100, 500);
    const { issues, fieldsWithData } = await runSearchByJql(req.jiraToken, jql, maxResults);
    return res.json({ issues, fieldsWithData });
  } catch (error) {
    const apiError = extractApiError(error);
    console.error('Error in /api/jira/search-by-jql:', apiError.message);
    return res.status(apiError.statusCode || 500).json({
      error: 'JQL search failed',
      message: apiError.message,
      details: apiError.details
    });
  }
});


/**
 * Run a KPI query and return either count or list (key, summary, priority, assignee, status)
 * POST /api/jira/kpi-results  body: { teamId, kpiId }
 * Requires KPI tab authorization.
 */
router.post('/kpi-results', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const username = req.username || req.headers['x-username'] || '';
    const { authorized } = checkKpiViewAuthorization(username);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You are not authorized to view KPI results.' });
    }
    const { teamId, kpiId } = req.body || {};
    if (!teamId || !kpiId) {
      return res.status(400).json({ error: 'teamId and kpiId are required' });
    }
    const result = await kpiService.getKpiResult({ token: req.jiraToken, teamId, kpiId });
    if (result.error === 'TEAM_KPIS_NOT_FOUND') {
      return res.status(404).json({
        error: 'Team KPIs not found',
        message: `No KPI config for team "${teamId}". Add KPIs in KPI config or choose a team that has KPIs configured.`
      });
    }
    if (result.error === 'KPI_NOT_FOUND') {
      return res.status(404).json({ error: 'KPI not found', message: `KPI "${kpiId}" not found for team "${teamId}".` });
    }
    if (result.error === 'KPI_NO_BASE_QUERY') {
      return res.status(400).json({ error: 'KPI has no base query' });
    }
    if (result.error === 'KPI_JQL_UNRESOLVED') {
      return res.status(400).json({ error: 'Could not resolve KPI query' });
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error in /api/jira/kpi-results:', err?.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'KPI query failed';
    return res.status(statusCode).json({ success: false, error: message });
  }
});

/**
 * Run all KPI queries for a team in one request. One JIRA round-trip per KPI; response keyed by kpiId.
 * POST /api/jira/kpi-results-batch  body: { teamId }
 * Returns { success: true, results: { [kpiId]: { total } | { issues, total } } }
 */

router.post('/kpi-results-batch', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const username = req.username || req.headers['x-username'] || '';
    const { authorized } = checkKpiViewAuthorization(username);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You are not authorized to view KPI results.' });
    }
    const { teamId } = req.body || {};
    if (!teamId) {
      return res.status(400).json({ error: 'teamId is required' });
    }
    const results = await kpiService.getKpiResultBatch({ token: req.jiraToken, teamId });
    if (Object.keys(results).length === 0) {
      return res.json({ success: true, results: {} });
    }
    return res.json({ success: true, results });
  } catch (err) {
    console.error('Error in /api/jira/kpi-results-batch:', err?.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'KPI batch failed';
    return res.status(statusCode).json({ success: false, error: message });
  }
});

/**
 * Run a KPI query scoped by release version (release base filter + KPI filter). Same response shape as kpi-results including combinedJql.
 * POST /api/jira/release-kpi-results  body: { releaseVersion, teamId, kpiId }
 */

router.post('/release-kpi-results', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const username = req.username || req.headers['x-username'] || '';
    const { authorized } = checkKpiViewAuthorization(username);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You are not authorized to view KPI results.' });
    }
    const { releaseVersion, teamId, kpiId } = req.body || {};
    if (!releaseVersion || !teamId || !kpiId) {
      return res.status(400).json({ error: 'releaseVersion, teamId and kpiId are required' });
    }
    const result = await kpiService.getReleaseKpiResult({ token: req.jiraToken, releaseVersion, teamId, kpiId });
    if (result.error === 'TEAM_KPIS_NOT_FOUND') {
      return res.status(404).json({
        error: 'Team KPIs not found',
        message: `No KPI config for team "${teamId}". Add KPIs in KPI config or choose a team that has KPIs configured.`
      });
    }
    if (result.error === 'KPI_NOT_FOUND') {
      return res.status(404).json({ error: 'KPI not found', message: `KPI "${kpiId}" not found for team "${teamId}".` });
    }
    if (result.error === 'KPI_NO_BASE_QUERY') {
      return res.status(400).json({ error: 'KPI has no base query' });
    }
    if (result.error === 'KPI_JQL_UNRESOLVED') {
      return res.status(400).json({ error: 'Could not resolve release KPI query (check release base filter config)' });
    }
    return res.json({ success: true, ...result });
  } catch (err) {
    console.error('Error in /api/jira/release-kpi-results:', err?.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'Release KPI query failed';
    return res.status(statusCode).json({ success: false, error: message });
  }
});

/**
 * Run all KPIs for a team scoped by release version. Same response shape as kpi-results-batch including combinedJql per result.
 * POST /api/jira/release-kpi-results-batch  body: { releaseVersion, teamId }
 */

router.post('/release-kpi-results-batch', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const username = req.username || req.headers['x-username'] || '';
    const { authorized } = checkKpiViewAuthorization(username);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You are not authorized to view KPI results.' });
    }
    const { releaseVersion, teamId } = req.body || {};
    if (!releaseVersion || !teamId) {
      return res.status(400).json({ error: 'releaseVersion and teamId are required' });
    }
    const results = await kpiService.getReleaseKpiResultBatch({ token: req.jiraToken, releaseVersion, teamId });
    if (Object.keys(results).length === 0) {
      return res.json({ success: true, results: {} });
    }
    return res.json({ success: true, results });
  } catch (err) {
    console.error('Error in /api/jira/release-kpi-results-batch:', err?.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'Release KPI batch failed';
    return res.status(statusCode).json({ success: false, error: message });
  }
});


/**
 * Run all team KPIs scoped by release version, split by resolution
 * (total / done / open). Powers the retrospective cross-release comparison.
 * POST /api/jira/release-kpi-breakdown-batch  body: { releaseVersion, teamId, jqlExtra? }
 * Optional jqlExtra is AND-ed onto every bucket (e.g. Assignee Manager scope for leader SoS).
 * Returns { success: true, results: { [kpiId]: { name, total, done, open, links } | { error } } }
 */

router.post('/release-kpi-breakdown-batch', validateJiraTokenMiddleware, apiLimiter, async (req, res) => {
  try {
    const username = req.username || req.headers['x-username'] || '';
    const { authorized } = checkKpiViewAuthorization(username);
    if (!authorized) {
      return res.status(403).json({ error: 'Access denied. You are not authorized to view KPI results.' });
    }
    const { releaseVersion, teamId, jqlExtra } = req.body || {};
    if (!releaseVersion || !teamId) {
      return res.status(400).json({ error: 'releaseVersion and teamId are required' });
    }
    const results = await kpiService.getReleaseKpiResolutionBreakdown({
      token: req.jiraToken,
      releaseVersion,
      teamId,
      jqlExtra: typeof jqlExtra === 'string' ? jqlExtra : null,
    });
    return res.json({ success: true, results });
  } catch (err) {
    console.error('Error in /api/jira/release-kpi-breakdown-batch:', err?.response?.data || err.message);
    const statusCode = err.response?.status || 500;
    const message = err.response?.data?.errorMessages?.[0] || err.response?.data?.message || err.message || 'Release KPI breakdown failed';
    return res.status(statusCode).json({ success: false, error: message });
  }
});

/**
 * Get issue breakdown statistics (optimized for single and bulk requests)  
 * POST /api/jira/issue-breakdown
 */

router.post('/issue-breakdown', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const result = await kpiService.getIssueBreakdown({
      token: req.jiraToken,
      jiraKey: req.body?.jiraKey,
      jiraKeys: req.body?.jiraKeys
    });
    return res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    return res.status(statusCode).json({
      error: statusCode === 500 ? 'Failed to fetch issue breakdown' : error.message,
      message: error.message
    });
  }
});

/**
 * Get checkpoint history for a JIRA issue
 * POST /api/jira/checkpoint-history
 */

module.exports = router;
