#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  classifyRiskIndicator,
  computeReleaseHealthVerdict,
  countSelfReportedRisk,
  bucketCounts,
} from '../dist/services/riskIndicator.js';

assert.equal(classifyRiskIndicator({ value: 'Red - High' }), 'red');
assert.equal(classifyRiskIndicator('On Track'), 'green');
assert.equal(classifyRiskIndicator(null), 'not_set');

const counts = countSelfReportedRisk(['red', 'yellow', '', { name: 'Green' }]);
assert.deepEqual(counts, { red: 1, yellow: 1, green: 1, notSet: 1 });

assert.equal(
  computeReleaseHealthVerdict({
    openP0Blockers: 1,
    openMustFixTickets: 0,
    daysToPg: 40,
    gateLaggingCount: 0,
    darkCount: 0,
    committedCount: 10,
    complianceAtRiskCount: 0,
  }).verdict,
  'RED'
);

assert.equal(
  computeReleaseHealthVerdict({
    openP0Blockers: 0,
    openMustFixTickets: 2,
    daysToPg: 10,
    gateLaggingCount: 0,
    darkCount: 0,
    committedCount: 10,
    complianceAtRiskCount: 0,
  }).verdict,
  'RED'
);

assert.equal(
  computeReleaseHealthVerdict({
    openP0Blockers: 0,
    openMustFixTickets: 1,
    daysToPg: 30,
    gateLaggingCount: 0,
    darkCount: 0,
    committedCount: 10,
    complianceAtRiskCount: 0,
  }).verdict,
  'YELLOW'
);

assert.equal(
  computeReleaseHealthVerdict({
    openP0Blockers: 0,
    openMustFixTickets: 0,
    daysToPg: 40,
    gateLaggingCount: 0,
    darkCount: 0,
    committedCount: 10,
    complianceAtRiskCount: 0,
  }).verdict,
  'GREEN'
);

assert.deepEqual(bucketCounts({ a: [1], b: [] }), { a: 1, b: 0 });

console.log('riskIndicator ok');
