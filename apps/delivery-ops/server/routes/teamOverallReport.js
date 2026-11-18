const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { requireAuth } = require('../middleware/authMiddleware');
const { apiLimiter } = require('../middleware/security');
const service = require('../services/teamOverallReportService');

router.get('/', validateJiraTokenMiddleware, apiLimiter, requireAuth('releaseVersions'), async (req, res) => {
  try {
    const params = {
      teamId: req.query.teamId || 'ndb',
      periodType: req.query.periodType || 'quarter',
      quarter: req.query.quarter,
      year: req.query.year,
      startDate: req.query.startDate,
      endDate: req.query.endDate,
      inclusionMode: req.query.inclusionMode || 'closed',
      groupBy: req.query.groupBy || 'issuetype',
      includeSubtasks: req.query.includeSubtasks === 'true',
      summarizeWithNAI: req.query.summarizeWithNAI !== 'false',
      forceRefresh: req.query.forceRefresh === 'true',
      username: req.username,
    };
    const dto = await service.generate(params, req.jiraToken);
    res.json({ success: true, ...dto });
  } catch (err) {
    res.status(err.statusCode || 500).json({ success: false, error: err.message });
  }
});

module.exports = router;