/**
 * Date Mover API — D30 in DECISIONS.md.
 *
 * POST /api/date-mover/move-gate-date
 *   { ticketKey, fieldId, newDate, reason, audit: { confluencePageId, tableAnchorId } }
 *
 * Authorization: requireAuth('dateMover') — RM + TPM only.
 *
 * This file is intentionally thin per `minimal-architecture.mdc` (rule
 * #2: routes route, business logic lives in services). All real work
 * is in `shared/services/dateMoverService.ts`.
 *
 * Interop note: shared/ is ESM, this server is CommonJS. We import
 * lazily on first use via `await import(...)`, cache the module, and
 * reuse. The latency cost is ~5ms on first call, negligible thereafter.
 */

const express = require('express');
const router = express.Router();
const { apiLimiter } = require('../middleware/security');
const { validateJiraTokenMiddleware, extractToken } = require('../middleware/auth/jira');
const { requireAuth } = require('../middleware/authMiddleware');

const auth = [apiLimiter, validateJiraTokenMiddleware, requireAuth('dateMover')];

// ── Lazy-import the ESM shared package (one-shot, cached) ────────────────────

let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    _sharedPromise = import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.get('/gate-date-fields', auth, async (req, res) => {
  try {
    const { GATE_DATE_FIELDS } = await getShared();
    const fields = Object.entries(GATE_DATE_FIELDS).map(([id, label]) => ({
      id,
      label,
    }));
    return res.json({ success: true, data: fields });
  } catch (e) {
    console.error('[date-mover] gate-date-fields error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

router.post('/move-gate-date', auth, async (req, res) => {
  try {
    const { ticketKey, fieldId, newDate, reason, audit } = req.body || {};

    // Surface-level validation so the service boundary returns clean
    // structured errors rather than middleware 400s.
    const missing = [];
    if (!ticketKey) missing.push('ticketKey');
    if (!fieldId) missing.push('fieldId');
    if (!newDate) missing.push('newDate');
    if (!reason) missing.push('reason');
    if (!audit?.confluencePageId) missing.push('audit.confluencePageId');
    if (!audit?.tableAnchorId) missing.push('audit.tableAnchorId');
    if (missing.length > 0) {
      return res
        .status(400)
        .json({ success: false, error: `Missing required fields: ${missing.join(', ')}` });
    }

    const shared = await getShared();
    const { JiraConnector, ConfluenceConnector, DateMoverService, loadEnv } = shared;

    // Per-request JIRA token: each user acts under their own PAT so the
    // change shows up in the JIRA changelog as them (the actor in the
    // Confluence audit row is set from the same context).
    const userJiraPat = extractToken(req);
    if (!userJiraPat) {
      return res
        .status(401)
        .json({ success: false, error: 'JIRA Bearer token required in Authorization header' });
    }

    const baseEnv = loadEnv();
    // Inject the user's PAT for both connectors. Confluence reuses JIRA PAT
    // when they share SSO (most Atlassian deployments).
    const env = {
      ...baseEnv,
      jiraPat: userJiraPat,
      confluencePat: process.env.CONFLUENCE_PAT || userJiraPat,
    };

    const jira = new JiraConnector(env);
    const confluence = new ConfluenceConnector(env);
    const service = new DateMoverService({
      jira,
      confluence,
      jiraBaseUrl: env.jiraBaseUrl,
    });

    const result = await service.moveGateDate({
      ticketKey,
      fieldId,
      newDate,
      reason,
      actor: {
        displayName: req.userEmail || req.username,
        ldap: req.username,
      },
      audit: {
        confluencePageId: audit.confluencePageId,
        tableAnchorId: audit.tableAnchorId,
      },
    });

    if (result.ok) {
      return res.json({ success: true, data: result });
    }

    // Map service error codes to HTTP statuses.
    const httpStatus =
      result.code === 'invalid_field' ||
      result.code === 'invalid_date' ||
      result.code === 'empty_reason'
        ? 400
        : result.code === 'ticket_not_found'
        ? 404
        : result.code === 'inconsistent_state'
        ? 500
        : 502;
    return res.status(httpStatus).json({ success: false, ...result });
  } catch (e) {
    console.error('[date-mover] move-gate-date unexpected error:', e);
    return res.status(500).json({ success: false, error: e.message });
  }
});

module.exports = router;
