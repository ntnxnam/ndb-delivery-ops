const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { requireAuth } = require('../../middleware/authMiddleware');
const { releaseVersionsLimiter } = require('../../middleware/security');
const { JIRA_API_V2 } = require('../../config/api');
const sprintService = require('../../services/sprintService');

/**
 * Simple diagnostic endpoint to test basic JIRA connectivity
 */
router.get(/^\/sprints\/?$/, (req, res) => {
  res.status(405).json({
    error: 'Method Not Allowed',
    message: 'Use POST with body { teamId }. GET is not supported.'
  });
});

/**
 * List sprints for a team's board (for Sprint Report tab).
 * POST /api/jira/sprints  body: { teamId }
 * Returns { success: true, sprints: [ { id, name, state, startDate, endDate, completeDate } ] }
 * Also matches POST /api/jira/sprints/ (trailing slash) to avoid 404 from proxies.
 */

router.post(/^\/sprints\/?$/, releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  try {
    const sprints = await sprintService.getSprintList({ token: req.jiraToken, teamId: req.body?.teamId, state: req.body?.state });
    return res.json({ success: true, sprints });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: 'Failed to fetch sprints', message: error.message });
  }
});

/**
 * List Jira project components (Component field) for a team's project.
 * GET /api/jira/project-components?teamId=ndb
 * Returns { success: true, components: [ { id, name } ] }
 */

router.get('/project-components', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  try {
    const components = await sprintService.getProjectComponents({ token: req.jiraToken, teamId: req.query.teamId });
    return res.json({ success: true, components });
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: 'Failed to fetch project components', message: error.message });
  }
});

/**
 * Build JQL for issues in a sprint, scoped by the team sprint scope derived from baseFilter (project scope only; no statusCategory exclusion).
 * options.componentNames: optional string[] — when provided, appends AND component in ("A", "B").
 */


/**
 * Single sprint report with Scrum Master metrics.
 * POST /api/jira/sprint-report  body: { teamId, sprintId }
 * Returns metrics + issues list. Changelog is fetched for "added after start"; "removed" may be 0 (see docs).
 */

router.post('/sprint-report', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);

  try {
    const { teamId, sprintId } = req.body || {};
    if (!sprintId) return res.status(400).json({ success: false, error: 'sprintId is required' });
    const result = await sprintService.buildSprintReport({ token: req.jiraToken, teamId, sprintId });
    return res.json(result);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    if (statusCode === 400 && /Team has no board configured/i.test(error.message || '')) {
      return res.status(400).json({
        success: false,
        error: 'Team has no board configured',
        message: 'Select a team with a boardId in teamBoardConfig.json.'
      });
    }
    return res.status(statusCode).json({ success: false, error: 'Failed to build sprint report', message: error.message });
  }
});

/**
 * Past sprint report by date range: find closed sprints overlapping [startDate, endDate], run sprint report for each.
 * POST /api/jira/sprint-report-by-range  body: { teamId, startDate, endDate, componentNames?: string[] }
 * Returns { success, sprints, reports, jiraBaseUrl, aggregatedIssues }.
 */

router.post('/sprint-report-by-range', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);

  try {
    const result = await sprintService.buildSprintReportByRange({
      token: req.jiraToken,
      teamId: req.body?.teamId,
      startDate: req.body?.startDate,
      endDate: req.body?.endDate,
      componentNames: req.body?.componentNames
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: 'Failed to build sprint report by range', message: error.message });
  }
});

/**
 * Discover Jira fields — useful for finding the correct storyPointsFieldId.
 * GET /api/jira/fields?search=story
 * Returns all fields from /rest/api/2/field, optionally filtered by name.
 */

router.get('/fields', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const fields = await sprintService.getFields({ token: req.jiraToken, search: req.query.search });
    return res.json({ success: true, fields });
  } catch (err) {
    return res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

/**
 * NDB Team KPI breakdown for a sprint.
 * POST /api/jira/sprint-kpi-breakdown  body: { teamId, sprintId, sprintName }
 * Returns { success: true, kpiBreakdown: [ { kpiName, completed, pendingQA, inProgress, total, jqlByStatus } ] }
 *
 * "True sprint content" JQL per KPI:
 *   sprint in ("sprintName") AND NOT issueFunction in removedAfterSprintStart("boardId", "sprintName") AND <kpi.baseQuery>
 *
 * KPI queries run sequentially (concurrency=1) to avoid overloading Jira after the sprint-report call.
 * sprintName accepted from request body to skip the sprint map lookup entirely.
 */

router.post('/sprint-kpi-breakdown', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  req.setTimeout(120000);
  res.setTimeout(120000);
  try {
    const result = await sprintService.getSprintKpiBreakdown({
      token: req.jiraToken,
      teamId: req.body?.teamId,
      sprintId: req.body?.sprintId,
      sprintName: req.body?.sprintName
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: 'Failed to build KPI breakdown', message: error.message });
  }
});

/**
 * Sprint report trends: metrics for multiple sprints (same metrics as sprint-report).
 * POST /api/jira/sprint-report-trends  body: { teamId, sprintIds: number[] }
 * Returns { success: true, trends: [ { sprintId, sprintName, metrics } ] }
 */

router.post('/sprint-report-trends', releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport'), async (req, res) => {
  req.setTimeout(300000);
  res.setTimeout(300000);

  try {
    const result = await sprintService.getSprintReportTrends({
      token: req.jiraToken,
      teamId: req.body?.teamId,
      sprintIds: req.body?.sprintIds
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({ success: false, error: 'Failed to build sprint report trends', message: error.message });
  }
});

/**
 * Fetch items by fixVersion and labels
 * POST /api/jira/release-items
 */

module.exports = router;
