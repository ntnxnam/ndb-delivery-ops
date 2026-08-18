const express = require('express');
const router = express.Router();

router.use('/', require('./diagnostic'));
router.use('/', require('./shared'));
router.use('/', require('./kpi'));
router.use('/', require('./changelog'));
router.use('/', require('./sprints'));
router.use('/', require('./versions'));
router.use('/', require('./setup'));
router.use('/', require('./exec-summary'));
router.use('/', require('./gantt'));
router.use('/', require('./misc'));
router.use('/', require('./ai-reports'));

module.exports = router;
