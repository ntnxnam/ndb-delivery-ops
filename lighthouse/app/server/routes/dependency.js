/**
 * Dependency View API.
 * GET  /api/dependency/overview
 * GET  /api/dependency/wishlist-config
 * PUT  /api/dependency/wishlist-config  — persist wishlist settings to dependencyViewConfig.json
 *
 * No JIRA mutates. Config write is local file only.
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

/**
 * GET /api/dependency/wishlist-config
 */
router.get('/wishlist-config', auth, (req, res) => {
  try {
    const wishlist = dependencyViewService.getWishlistConfig();
    return res.json({ success: true, wishlist });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in GET /api/dependency/wishlist-config:', apiError.message);
    return res.status(500).json({
      success: false,
      error: apiError.message || err.message || 'Failed to load wishlist config',
    });
  }
});

/**
 * PUT /api/dependency/wishlist-config
 * Body: { linkTypeFilter?, labelSuffix?, partnerLabelSuffixes? }
 * Writes apps/delivery-ops/server/config/dependencyViewConfig.json
 */
router.put('/wishlist-config', auth, (req, res) => {
  try {
    const body = req.body || {};
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'linkTypeFilter')) {
      patch.linkTypeFilter = body.linkTypeFilter;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'labelSuffix')) {
      patch.labelSuffix = body.labelSuffix;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'partnerLabelSuffixes')) {
      const raw = body.partnerLabelSuffixes;
      if (typeof raw === 'string') {
        patch.partnerLabelSuffixes = raw
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (Array.isArray(raw)) {
        patch.partnerLabelSuffixes = raw;
      } else {
        return res.status(400).json({
          success: false,
          error: 'partnerLabelSuffixes must be a string or string array',
        });
      }
    }
    if (!Object.keys(patch).length) {
      return res.status(400).json({
        success: false,
        error: 'Provide linkTypeFilter, labelSuffix, and/or partnerLabelSuffixes',
      });
    }
    const wishlist = dependencyViewService.saveWishlistConfig(patch);
    return res.json({ success: true, wishlist });
  } catch (err) {
    const apiError = extractApiError(err);
    console.error('Error in PUT /api/dependency/wishlist-config:', apiError.message);
    return res.status(500).json({
      success: false,
      error: apiError.message || err.message || 'Failed to save wishlist config',
    });
  }
});

module.exports = router;
