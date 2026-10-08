const express = require('express');
const router = express.Router();

router.use('/', require('./diagnostic'));
router.use('/', require('./shared'));
router.use('/', require('./kpi'));
router.use('/', require('./system-test-scale'));
router.use('/', require('./changelog'));
router.use('/', require('./sprints'));
router.use('/', require('./sprint-performance'));
router.use('/', require('./versions'));
router.use('/', require('./setup'));
router.use('/', require('./exec-summary'));
router.use('/', require('./gantt'));
router.use('/', require('./misc'));
router.use('/', require('./ai-reports'));
router.use('/', require('./sos'));

module.exports = router;
