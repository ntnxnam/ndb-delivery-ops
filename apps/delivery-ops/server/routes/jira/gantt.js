const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const ganttService = require('../../services/ganttService');

/**
 * Simple diagnostic endpoint to test basic JIRA connectivity
 */
router.post('/sprint-gantt-data', validateJiraTokenMiddleware, async (req, res) => {
  try {
    const result = await ganttService.buildSprintGanttData({
      jiraKey: req.body?.jiraKey,
      jiraData: req.body?.jiraData,
      epics: req.body?.epics,
      token: req.jiraToken
    });
    return res.json(result);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      error: 'Failed to fetch sprint Gantt data',
      message: error.message,
      success: false
    });
  }
});

module.exports = router;
