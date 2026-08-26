#!/usr/bin/env node
/**
 * Wave 3: domain derives live in shared; app files are shims or CRA copies.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assembleReleaseIntelligence,
  classifyFeature,
  getSprintMetrics,
} from '../dist/index.js';

const require = createRequire(import.meta.url);
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const signals = require('../src/domain/execSummarySignals.cjs');
if (typeof signals.deriveSignals !== 'function' || !signals.PHASE_RELEVANCE) {
  console.error('wave3 failed: execSummarySignals missing deriveSignals / PHASE_RELEVANCE');
  process.exit(1);
}

const analytics = require('../src/domain/execSummaryAnalytics.cjs');
for (const name of [
  'calculateEnhancedAnalytics',
  'calculateDateMetrics',
  'calculateFeatVsNonFeatBreakdown',
  'calculateRiskBreakdown',
  'generateEnhancedExecutiveSummary',
]) {
  if (typeof analytics[name] !== 'function') {
    console.error(`wave3 failed: execSummaryAnalytics missing ${name}`);
    process.exit(1);
  }
}

const cjsMetrics = require('../src/domain/sprintMetrics.cjs').getSprintMetrics({
  totalInSprint: 10,
  addedAfterStart: 2,
  inProgress: 2,
  pendingQA: 1,
  completedInSprint: 7,
  removedFromSprint: 1,
});
const tsMetrics = getSprintMetrics({
  totalInSprint: 10,
  addedAfterStart: 2,
  inProgress: 2,
  pendingQA: 1,
  completedInSprint: 7,
  removedFromSprint: 1,
});
if (cjsMetrics.completionRate !== 70 || tsMetrics.scopeCreepRate !== 25) {
  console.error('wave3 failed: sprint metrics mismatch', cjsMetrics, tsMetrics);
  process.exit(1);
}

const buckets = classifyFeature({
  phase: 'Coding',
  criticalRisks: ['MISSED GATE CG'],
  statusUpdate: { ageDays: 20 },
});
if (!buckets.includes('gate-lagging') || !buckets.includes('dark')) {
  console.error('wave3 failed: classifyFeature buckets', buckets);
  process.exit(1);
}

const intel = assembleReleaseIntelligence({
  version: 'REL-1.0',
  featureRecords: [
    {
      key: 'ERA-1',
      summary: 'x',
      status: 'In Progress',
      jiraRisk: 'Green',
      phase: 'Coding',
      criticalRisks: [],
      assignee: 'A',
      tpmOwner: null,
      statusUpdateAgeDays: 2,
      dates: { codeComplete: null, commitGate: null, promotionGate: null },
      buckets: ['watching'],
    },
  ],
  p0Bugs: [],
  mustFixTickets: [],
  dateMetrics: { daysFromCutoff: 30 },
});
if (intel.health.verdict !== 'GREEN' || intel.totalFeatures !== 1) {
  console.error('wave3 failed: assembleReleaseIntelligence', intel.health);
  process.exit(1);
}

function exportedNames(source) {
  return [...source.matchAll(/^export function (\w+)/gm)].map((m) => m[1]).sort();
}

const sharedBundle = readFileSync(join(repoRoot, 'shared/src/domain/bundleDerive.js'), 'utf8');
const clientBundle = readFileSync(
  join(repoRoot, 'apps/delivery-ops/client/src/release/utils/bundleUtils.js'),
  'utf8'
);
const sharedNames = exportedNames(sharedBundle);
const clientNames = exportedNames(clientBundle);
if (JSON.stringify(sharedNames) !== JSON.stringify(clientNames)) {
  console.error('wave3 failed: bundle export names drifted');
  console.error(' shared', sharedNames.join(','));
  console.error(' client', clientNames.join(','));
  process.exit(1);
}

const shim = readFileSync(
  join(repoRoot, 'apps/delivery-ops/server/utils/execSummarySignals.js'),
  'utf8'
);
if (!shim.includes('shared/src/domain/execSummarySignals.cjs')) {
  console.error('wave3 failed: execSummarySignals.js is not a shared shim');
  process.exit(1);
}

console.log(
  `wave3 ok: signals + analytics + sprintMetrics + releaseIntelligence; ${sharedNames.length} bundle exports match`
);
