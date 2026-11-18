/**
 * Email routes authorization middleware
 * Delegates to centralized requireAuth from authMiddleware.
 */

const { requireAuth } = require('../../middleware/authMiddleware');
const { HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS } = require('../../utils/emailHighlights');

function checkReleaseVersionsAuthorization(req, res, next) {
  return requireAuth('releaseVersions')(req, res, next);
}

function checkEmailHistoryAuthorization(req, res, next) {
  return requireAuth('emailHistoryStrict')(req, res, next);
}

module.exports = {
  HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS,
  checkReleaseVersionsAuthorization,
  checkEmailHistoryAuthorization
};
