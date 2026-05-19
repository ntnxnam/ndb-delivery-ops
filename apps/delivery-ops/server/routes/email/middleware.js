/**
 * Email routes authorization middleware
 * Delegates to centralized requireAuth from authMiddleware.
 */

const { requireAuth } = require('../../middleware/authMiddleware');

/** Required section headers that must appear in Highlights and Lowlights (must match client) */
const HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS = [
  'Highlights',
  'Lowlights',
  'Reason for risk indicator (if yellow or red)',
  'Path to green',
  'Support needed from leaders'
];

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
