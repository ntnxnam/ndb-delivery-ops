/**
 * POST /api/email/send - general email with JIRA content
 */

const { emailLimiter } = require('../../middleware/security');
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const sendEmailHandler = require('./sendEmailHandler');

function register(router) {
  router.post('/send', emailLimiter, validateJiraTokenMiddleware, sendEmailHandler);
}

module.exports = { register };
