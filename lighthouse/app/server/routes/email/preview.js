/**
 * POST /api/email/preview
 * Returns email content (to, cc, subject, htmlBody, textBody) without sending.
 * Used by "Open in Outlook" fallback.
 */

const { emailLimiter } = require('../../middleware/security');
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const sendEmailHandler = require('./sendEmailHandler');

function register(router) {
  router.post('/preview', emailLimiter, validateJiraTokenMiddleware, async (req, res, next) => {
    req.previewOnly = true;
    try {
      await sendEmailHandler(req, res);
    } catch (err) {
      next(err);
    }
  });
}

module.exports = { register };
