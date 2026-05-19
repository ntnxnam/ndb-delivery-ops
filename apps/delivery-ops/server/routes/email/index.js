/**
 * Email routes - composed from modular route files
 */

const express = require('express');
const router = express.Router();

require('./sendReleaseVersions').register(router);
require('./sendEmail').register(router);
require('./preview').register(router);
require('./sendGenericReminder').register(router);
require('./schedules').register(router);
require('./history').register(router);

module.exports = router;
