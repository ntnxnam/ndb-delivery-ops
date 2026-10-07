#!/usr/bin/env node
/**
 * Generate the standalone Sprint Performance leadership report (HTML).
 *
 * Usage (from apps/delivery-ops/server):
 *   node scripts/generateSprintPerformanceReport.js [--team ndb] [--cache /tmp/sprint-perf.json] [--json]
 *
 * Reads JIRA_PAT from server/.env. Writes to apps/delivery-ops/reports/.
 */

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { collectSprintPerformance, computeFromRaw } = require('../services/sprintPerformanceService');
const { writeReport, REPORTS_DIR } = require('../services/sprintPerformanceReportService');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}

(async () => {
  const token = process.env.JIRA_PAT;
  if (!token) throw new Error('JIRA_PAT is not set in server/.env');
  const teamId = arg('team', 'ndb');
  const raw = await collectSprintPerformance({
    token,
    teamId,
    cachePath: arg('cache', null),
    log: (m) => console.log(m),
  });
  const model = computeFromRaw(raw);
  const file = writeReport(model);
  if (process.argv.includes('--json')) {
    const jsonPath = path.join(REPORTS_DIR, file.replace(/\.html$/, '.json'));
    fs.writeFileSync(jsonPath, JSON.stringify(model, null, 2));
    console.log(`Wrote ${jsonPath}`);
  }
  console.log(`Wrote ${path.join(REPORTS_DIR, file)}`);
})().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
