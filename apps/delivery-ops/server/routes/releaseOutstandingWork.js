/**
 * Release Outstanding Work API — thin routes; logic in releaseOutstandingDeferralService.
 */
const express = require('express');
const router = express.Router();
const { apiLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware, extractToken } = require('../middleware/auth/jira');
const { requireAuth } = require('../middleware/authMiddleware');
const { jiraTimeout } = require('../middleware/timeout');
const svc = require('../services/releaseOutstandingDeferralService');
const outstandingSvc = require('../services/outstandingWorkbenchService');

const auth = [apiLimiter, validateJiraTokenMiddleware, requireAuth('releaseVersions')];

function sendErr(res, e) {
  const status = e.statusCode || 500;
  const body = { success: false, error: e.message || 'Server error' };
  if (e.code) body.code = e.code;
  if (e.target) body.target = e.target;
  return res.status(status).json(body);
}

router.get('/workbench', jiraTimeout, auth, async (req, res) => {
  try {
    const token = extractToken(req);
    const teamId = req.query.teamId || req.query.team;
    const release = req.query.release;
    const data = await svc.getWorkbench({ token, teamId, release });
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[release-outstanding-work] workbench error:', e.message);
    return sendErr(res, e);
  }
});

router.post('/move', auth, async (req, res) => {
  try {
    const token = extractToken(req);
    const { teamId, release, issueKey, comment } = req.body || {};
    const data = await svc.moveFixVersion({ token, teamId, release, issueKey, comment });
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[release-outstanding-work] move error:', e.message);
    return sendErr(res, e);
  }
});

router.post('/defer', auth, async (req, res) => {
  try {
    const token = extractToken(req);
    const { release, issueKey, comment } = req.body || {};
    if (!release || !issueKey) {
      return res.status(400).json({ success: false, error: 'release and issueKey required' });
    }
    const data = await svc.addDeferralLabel({ token, release, issueKey, comment });
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[release-outstanding-work] defer error:', e.message);
    return sendErr(res, e);
  }
});

router.post('/mustfix', auth, async (req, res) => {
  try {
    const token = extractToken(req);
    const { release, issueKey, comment } = req.body || {};
    if (!release || !issueKey) {
      return res.status(400).json({ success: false, error: 'release and issueKey required' });
    }
    const data = await svc.addMustFixLabel({ token, release, issueKey, comment });
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[release-outstanding-work] mustfix error:', e.message);
    return sendErr(res, e);
  }
});

router.post('/comment', auth, async (req, res) => {
  try {
    const token = extractToken(req);
    const { release, issueKey, comment } = req.body || {};
    if (!issueKey) {
      return res.status(400).json({ success: false, error: 'issueKey required' });
    }
    const data = await svc.postComment({ token, release, issueKey, comment });
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[release-outstanding-work] comment error:', e.message);
    return sendErr(res, e);
  }
});

router.post('/chase-justification', auth, async (req, res) => {
  try {
    const token = extractToken(req);
    const { release, issueKey } = req.body || {};
    if (!issueKey) {
      return res.status(400).json({ success: false, error: 'issueKey required' });
    }
    const data = await svc.chaseMissingJustification({ token, release, issueKey });
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[release-outstanding-work] chase-justification error:', e.message);
    return sendErr(res, e);
  }
});

router.post('/chase-status-update', auth, async (req, res) => {
  try {
    const token = extractToken(req);
    const { release, issueKey } = req.body || {};
    if (!issueKey || !release) {
      return res.status(400).json({ success: false, error: 'release and issueKey required' });
    }
    const data = await svc.chaseMustFixStatusUpdate({ token, release, issueKey });
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[release-outstanding-work] chase-status-update error:', e.message);
    return sendErr(res, e);
  }
});

router.get('/outstanding', jiraTimeout, auth, async (req, res) => {
  try {
    const token = extractToken(req);
    const teamId = req.query.teamId || req.query.team;
    const release = req.query.release;
    const data = await outstandingSvc.getOutstandingBuckets({ token, teamId, release });
    return res.json({ success: true, data });
  } catch (e) {
    console.error('[release-outstanding-work] outstanding error:', e.message);
    return sendErr(res, e);
  }
});

router.post('/outstanding-report', jiraTimeout, auth, async (req, res) => {
  try {
    const token = extractToken(req);
    const { teamId, release, to, cc, previewOnly, outstandingData } = req.body || {};
    if (!release) {
      return res.status(400).json({ success: false, error: 'release required' });
    }
    const data = await outstandingSvc.previewOrSendOutstandingReport({
      token,
      teamId,
      release,
      to,
      cc,
      previewOnly: Boolean(previewOnly),
      // Prefer page snapshot so preview/send does not re-hit JIRA (timeout → 500).
      outstandingData:
        outstandingData && outstandingData.release === release ? outstandingData : undefined,
    });
    return res.json({ success: true, data });
  } catch (e) {
    console.error(
      '[release-outstanding-work] outstanding-report error:',
      e.message,
      e.stack || ''
    );
    return sendErr(res, e);
  }
});

module.exports = router;
