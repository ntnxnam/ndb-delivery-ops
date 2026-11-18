/**
 * Unified authorization middleware.
 * Use after validateJiraTokenMiddleware; reads username from req and checks feature access via authService.
 */

const { checkFeatureAccess } = require('../services/authService');

/**
 * Get username from request (prefer validated req.username, then body/headers).
 */
function getUsernameFromRequest(req) {
  return req.username || req.body?.username || req.body?.userEmail || req.headers['x-user-email'] || req.headers['x-username'];
}

/**
 * Require that the current user has access to the given feature.
 * Must be used after validateJiraTokenMiddleware so req.username can be set.
 *
 * @param {string} feature - One of: releaseVersions, releaseVersionsEmail, sprintReport, kpiView, kpiEdit, kpiAdmin, emailHistory, emailHistoryStrict, genericEmailer, releaseSetup, config
 * @param {{ teamId?: string }} options - Optional; teamId for kpiAdmin
 * @returns {function} Express middleware
 */
function requireAuth(feature, options = {}) {
  return (req, res, next) => {
    const username = getUsernameFromRequest(req);
    const authResult = checkFeatureAccess(username, feature, options);

    if (!authResult.authorized) {
      const status = authResult.error && authResult.error.includes('required') ? 400 : 403;
      return res.status(status).json({ error: authResult.error || 'Access denied.' });
    }

    req.username = authResult.normalizedUsername;
    if (authResult.userEmail) req.userEmail = authResult.userEmail;
    next();
  };
}

module.exports = {
  requireAuth,
  getUsernameFromRequest
};
