/**
 * Status snapshots and trends API.
 * POST /api/status-snapshots - save snapshot
 * GET /api/status-snapshots - list snapshots (optional fixVersion)
 * GET /api/status-snapshots/trends - get trends for fixVersion
 */

const express = require('express');
const router = express.Router();
const { releaseVersionsLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { requireAuth } = require('../middleware/authMiddleware');
const { addSnapshot, listSnapshots, getTrends } = require('../utils/statusSnapshots');

const auth = [releaseVersionsLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions')];

router.post('/', auth, (req, res) => {
  try {
    const { fixVersion, items } = req.body || {};
    if (!fixVersion) {
      return res.status(400).json({ error: 'fixVersion is required' });
    }
    if (!Array.isArray(items)) {
      return res.status(400).json({ error: 'items must be an array' });
    }
    const result = addSnapshot(fixVersion, items);
    return res.json({ success: true, data: result });
  } catch (e) {
    console.error('[status-snapshots] POST error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/', auth, (req, res) => {
  try {
    const fixVersion = req.query.fixVersion || null;
    const list = listSnapshots(fixVersion || undefined);
    return res.json({ success: true, data: list });
  } catch (e) {
    console.error('[status-snapshots] GET error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.get('/trends', auth, (req, res) => {
  try {
    const fixVersion = req.query.fixVersion;
    if (!fixVersion) {
      return res.status(400).json({ error: 'fixVersion is required' });
    }
    const result = getTrends(fixVersion);
    return res.json({ success: true, data: result });
  } catch (e) {
    console.error('[status-snapshots] GET trends error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
