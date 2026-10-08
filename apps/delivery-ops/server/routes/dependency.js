/**
 * Dependency View API — read-only.
 * GET /api/dependency/overview
 */
const express = require('express');
const { apiLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { requireAuth } = require('../middleware/authMiddleware');
const dependencyViewService = require('../services/dependencyViewService');
const { extractApiError } = require('../utils/errorMessages');

const router = express.Router();
const auth = [apiLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions')];

/**
 * GET /api/dependency/overview
 * Query: teamId, release
 */
router.get('/overview', auth, async (req, res) => {
  try {
    const data = await dependencyViewService.getOverview({
      token: req.jiraToken,
      teamId: (req.query.teamId || '').trim() || undefined,
      release: (req.query.release || '').trim() || undefined,
    });
    return res.json({ success: true, ...data });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in /api/dependency/overview:', apiError.message);
    return res.status(err.statusCode || apiError.statusCode || 500).json({
      success: false,
      error: apiError.message || err.message || 'Dependency overview failed',
    });
  }
});

module.exports = router;
