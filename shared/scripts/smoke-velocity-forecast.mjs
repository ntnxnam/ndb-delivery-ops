/**
 * Smoke test for CONSOLIDATION #2 / #4 — 3-stream velocity + landing
 * forecast on the release-dataset trunk (no live JIRA).
 *
 * Run from monorepo root:
 *   npm --prefix shared run build && node shared/scripts/smoke-velocity-forecast.mjs
 */

import {
  computeSprintVelocityFromTickets,
  computeRecentSprintVelocityFromTickets,
  computeLandingForecastFromTickets,
  QA_VERIFICATION_EFFORT_RATIO,
  NDB_SPRINT_CALENDAR,
  sprintWindow,
} from '../dist/index.js';

let failures = 0;
let asserts = 0;
function assert(cond, msg) {
  asserts += 1;
  if (!cond) {
    failures += 1;
    console.error('  FAIL:', msg);
  } else {
    console.log('  ok:', msg);
  }
}

const CAL = NDB_SPRINT_CALENDAR;
const RELEASE = 'NDB-2.11';
const PROJECT = 'ERA';
const LABEL_PREFIX = 'ndb';
// S2 start — recent window covers S2 (empty) + S1 (fixture activity).
const NOW = new Date('2024-11-13T12:00:00Z');

function ticket(overrides) {
  return {
    'Issue Key': 'ERA-0',
    Summary: 'fixture',
    'Issue Type': 'Task',
    Status: 'Closed',
    'Status Category': 'Done',
    Resolution: 'Done',
    'Fix Version': RELEASE,
    'All Fix Versions': RELEASE,
    'Resolved Date': null,
    'Created Date': '2024-10-01',
    'Updated Date': '2024-10-30',
    'Closed Date': null,
    'Release Name': RELEASE,
    Labels: '',
    ...overrides,
  };
}

const tickets = [
  ticket({
    'Issue Key': 'ERA-1',
    'Issue Type': 'Task',
    'Resolved Date': '2024-10-30',
  }),
  ticket({
    'Issue Key': 'ERA-2',
    'Issue Type': 'Bug',
    'Resolved Date': '2024-10-30',
    'Closed Date': '2024-10-31',
  }),
  ticket({
    'Issue Key': 'ERA-3',
    'Issue Type': 'Test',
    'Resolved Date': '2024-10-30',
  }),
  ticket({
    'Issue Key': 'ERA-4',
    'Issue Type': 'Feature',
    'Resolved Date': '2024-10-30',
  }),
  ticket({
    'Issue Key': 'ERA-5',
    'Issue Type': 'Task',
    Status: 'Open',
    Resolution: '',
    'Resolved Date': null,
  }),
  ticket({
    'Issue Key': 'ERA-6',
    'Issue Type': 'Bug',
    Status: 'Resolved',
    Resolution: 'Fixed',
    'Resolved Date': null,
    'Closed Date': null,
  }),
  ticket({
    'Issue Key': 'ERA-7',
    'Issue Type': 'Test',
    Status: 'Open',
    Resolution: '',
    'Resolved Date': null,
  }),
  ticket({
    'Issue Key': 'ERA-8',
    'Issue Type': 'Task',
    Status: 'Open',
    Resolution: '',
    Labels: 'ndb-2.11-deferred',
  }),
];

console.log('1. 3-stream velocity from tickets (S1)');
const s1 = computeSprintVelocityFromTickets({
  tickets,
  projectKey: PROJECT,
  release: RELEASE,
  sprintCalendar: CAL,
  sprintNumber: 1,
  now: NOW,
});
assert(s1.sprintLabel === 'S1', `S1 label (got ${s1.sprintLabel})`);
assert(s1.dev.count === 2, `S1 Dev = 2 (Task+Bug, not Feature/Test) got ${s1.dev.count}`);
assert(s1.qaVerification.count === 1, `S1 QA-Verif = 1 (closed Bug) got ${s1.qaVerification.count}`);
assert(
  s1.qaVerification.adjustedCount ===
    Math.round(1 * QA_VERIFICATION_EFFORT_RATIO * 100) / 100,
  `QA-Verif adjustedCount = 0.33 got ${s1.qaVerification.adjustedCount}`
);
assert(s1.qaTestTasks.count === 1, `S1 QA-Test = 1 got ${s1.qaTestTasks.count}`);
assert(
  /issueType not in \(Feature, Initiative, Epic, X-FEAT, Capability, Test\)/.test(s1.dev.jql),
  'Dev click-through JQL still uses the live builder'
);
assert(
  /status changed to "Closed"/.test(s1.qaVerification.jql),
  'QA-Verif click-through JQL still uses status-changed-to-Closed'
);

console.log('2. Closed Bug counts as both Dev and QA-Verif');
assert(
  s1.dev.count === 2 && s1.qaVerification.count === 1,
  'ERA-2 is in Dev and QA-Verif'
);

console.log('3. Recent window is most-recent first and S2 is empty');
const recent = computeRecentSprintVelocityFromTickets({
  tickets,
  projectKey: PROJECT,
  release: RELEASE,
  sprintCalendar: CAL,
  sprintsBack: 3,
  now: NOW,
});
assert(recent[0].sprintNumber === 2, `first sprint is S2 (got S${recent[0].sprintNumber})`);
assert(recent[0].dev.count === 0, 'S2 Dev = 0');
assert(recent[1].sprintNumber === 1 && recent[1].dev.count === 2, 'S1 follows with Dev=2');

console.log('4. Landing forecast from the same tickets');
const plannedGaIso = sprintWindow(2, CAL).endIso; // S2 end → 1 sprint of slip
const fc = computeLandingForecastFromTickets({
  tickets,
  projectKey: PROJECT,
  release: RELEASE,
  labelPrefix: LABEL_PREFIX,
  sprintCalendar: CAL,
  plannedGaIso,
  now: NOW,
});
assert(fc.dataSource === 'cache', `dataSource=cache (got ${fc.dataSource})`);
assert(fc.unresolved === 2, `unresolved = ERA-5+ERA-7 = 2 (deferred ERA-8 excluded) got ${fc.unresolved}`);
assert(fc.pendingVerification === 1, `pendingVerification = ERA-6 got ${fc.pendingVerification}`);
assert(fc.devUnresolved === 1, `devUnresolved = ERA-5 got ${fc.devUnresolved}`);
assert(fc.qaVerificationPending === 1, `qaVerificationPending = ERA-6 got ${fc.qaVerificationPending}`);
assert(fc.qaTestTasksUnresolved === 1, `qaTestTasksUnresolved = ERA-7 got ${fc.qaTestTasksUnresolved}`);
assert(fc.payloadTotal === 8, `payloadTotal = 8 got ${fc.payloadTotal}`);
assert(fc.forecastMethod === 'fallback_running', 'MVP method is fallback_running');
assert(typeof fc.forecastGaSprint === 'number', `forecastGaSprint is a number (got ${fc.forecastGaSprint})`);
assert(fc.forecastGaSprint === 3, `forecast lands S3 (got S${fc.forecastGaSprint})`);
assert(fc.gapSprints === 1, `gapSprints = 1 vs planned S2 (got ${fc.gapSprints})`);
assert(fc.verdict === 'slipping', `verdict=slipping (got ${fc.verdict})`);
assert(
  fc.weightedOutstanding === 2.33,
  `weightedOutstanding = 2.33 got ${fc.weightedOutstanding}`
);
assert(fc.weightedInflowPerSprint === 0, 'inflow stays 0 (no unscoped created-date query)');
assert(fc.jqlUnresolved.includes('resolution = Unresolved'), 'unresolved JQL extras unchanged');
assert(fc.oneLiner.includes(RELEASE), `one-liner cites ${RELEASE}`);

console.log('5. Empty trunk yields zeros, not a crash');
const empty = computeSprintVelocityFromTickets({
  tickets: [],
  projectKey: PROJECT,
  release: RELEASE,
  sprintCalendar: CAL,
  sprintNumber: 1,
  now: NOW,
});
assert(empty.dev.count === 0 && empty.qaTestTasks.count === 0, 'empty Dev/QA-Test = 0');

if (failures) {
  console.error(`\n${failures}/${asserts} assertions failed`);
  process.exit(1);
}
console.log(`\n${asserts} assertions passed`);
