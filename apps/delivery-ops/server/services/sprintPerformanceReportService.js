/**
 * Sprint Performance report store + background generation jobs.
 * Reports are written to apps/delivery-ops/reports/ as
 * Sprint-{Team}-{FirstSlot}-{LastSlot}-{YYYY-MM-DD}.html (documentation-consistency).
 */

const fs = require('fs');
const path = require('path');
const { collectSprintPerformance, computeFromRaw } = require('./sprintPerformanceService');
const { renderSprintPerformanceHtml } = require('../utils/sprintPerformanceHtml');
const { enrichModelAsksWithAi } = require('./sprintLeadershipAsksService');
const { getTeamById } = require('../utils/teamConfig');

const REPORTS_DIR = path.join(__dirname, '..', '..', 'reports');
const FILE_RE = /^Sprint-(.+)-S(\d+)-S(\d+)-(\d{4}-\d{2}-\d{2})\.html$/;
const jobs = new Map();

function resolveTeam(teamId) {
  const team = getTeamById(teamId);
  if (!team) throw Object.assign(new Error(`Unknown team "${teamId}"`), { statusCode: 400 });
  return team;
}

function listReports(teamId) {
  const team = resolveTeam(teamId);
  if (!fs.existsSync(REPORTS_DIR)) return [];
  return fs.readdirSync(REPORTS_DIR)
    .map((file) => ({ file, m: FILE_RE.exec(file) }))
    .filter(({ m }) => m && m[1] === team.name)
    .map(({ file, m }) => {
      const stat = fs.statSync(path.join(REPORTS_DIR, file));
      return { file, window: `S${m[2]}–S${m[3]}`, date: m[4], modifiedAt: stat.mtime.toISOString(), bytes: stat.size };
    })
    .sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

function readReport(teamId, file) {
  const reports = listReports(teamId);
  const entry = file ? reports.find((r) => r.file === file) : reports[0];
  if (!entry) return null;
  return { ...entry, html: fs.readFileSync(path.join(REPORTS_DIR, entry.file), 'utf8') };
}

function writeReport(model) {
  const slots = model.meta.slots;
  const date = model.meta.generatedAt.slice(0, 10);
  const file = `Sprint-${model.meta.teamName}-${slots[0].name}-${slots[slots.length - 1].name}-${date}.html`;
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  fs.writeFileSync(path.join(REPORTS_DIR, file), renderSprintPerformanceHtml(model));
  return file;
}

function jobView(job) {
  if (!job) return { state: 'idle' };
  const { token, ...rest } = job;
  return rest;
}

function startGeneration({ token, teamId }) {
  const team = resolveTeam(teamId);
  const current = jobs.get(team.id);
  if (current?.state === 'running') return jobView(current);
  const job = { state: 'running', teamId: team.id, startedAt: new Date().toISOString(), progress: 'Starting…', token };
  jobs.set(team.id, job);
  collectSprintPerformance({ token, teamId: team.id, log: (m) => { job.progress = String(m).trim(); } })
    .then(async (raw) => {
      job.progress = 'Computing metrics…';
      const model = computeFromRaw(raw);
      job.progress = 'AI: Asks of leadership…';
      await enrichModelAsksWithAi(model);
      job.file = writeReport(model);
      job.state = 'done';
      job.asksSource = model.asksSource || 'rules';
    })
    .catch((err) => {
      job.state = 'error';
      job.error = err.message;
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
      delete job.token;
    });
  return jobView(job);
}

function getJob(teamId) {
  return jobView(jobs.get(resolveTeam(teamId).id));
}

module.exports = { listReports, readReport, writeReport, startGeneration, getJob, REPORTS_DIR };
