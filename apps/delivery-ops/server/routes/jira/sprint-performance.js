const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { requireAuth } = require('../../middleware/authMiddleware');
const { releaseVersionsLimiter } = require('../../middleware/security');
const reports = require('../../services/sprintPerformanceReportService');

const auth = [releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('sprintReport')];
const fail = (res, error, label) => res.status(error.statusCode || 500).json({ success: false, error: label, message: error.message });

router.get('/sprint-performance/reports', ...auth, (req, res) => {
  try {
    return res.json({ success: true, reports: reports.listReports(req.query.teamId || 'ndb'), job: reports.getJob(req.query.teamId || 'ndb') });
  } catch (error) {
    return fail(res, error, 'Failed to list sprint performance reports');
  }
});

router.get('/sprint-performance/report', ...auth, (req, res) => {
  try {
    const report = reports.readReport(req.query.teamId || 'ndb', req.query.file);
    if (!report) return res.status(404).json({ success: false, error: 'No sprint performance report generated yet' });
    if (req.query.download === '1') res.setHeader('Content-Disposition', `attachment; filename="${report.file}"`);
    return res.type('html').send(report.html);
  } catch (error) {
    return fail(res, error, 'Failed to read sprint performance report');
  }
});

router.post('/sprint-performance/generate', ...auth, (req, res) => {
  try {
    return res.status(202).json({ success: true, job: reports.startGeneration({ token: req.jiraToken, teamId: req.body?.teamId || 'ndb' }) });
  } catch (error) {
    return fail(res, error, 'Failed to start sprint performance generation');
  }
});

router.get('/sprint-performance/status', ...auth, (req, res) => {
  try {
    return res.json({ success: true, job: reports.getJob(req.query.teamId || 'ndb') });
  } catch (error) {
    return fail(res, error, 'Failed to read generation status');
  }
});

module.exports = router;
