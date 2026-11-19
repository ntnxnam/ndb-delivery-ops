const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const store = require('../utils/tpmSchedulesStore');
const runner = require('../services/tpmScheduleRunner');

const SCHEDULABLE = new Set(['tpm-execution-fetch','tpm-at-release-fetch','tpm-post-release-fetch','tpm-report-compose']);

function requireAuth(req, res, next) {
  // D26: mutate requires JIRA auth; reuse existing middleware if present, else allow with x-username.
  // For reads, no auth needed. For writes, require x-username or Bearer.
  if (req.method === 'GET') return next();
  const hasCred = req.headers.authorization || req.headers['x-username'] || req.body?.username;
  if (!hasCred) return res.status(401).json({ error: 'Authentication required (x-username or Authorization)' });
  next();
}

function validatePayload(body, isUpdate = false) {
  const errors = [];
  if (!isUpdate || body.skill !== undefined) {
    if (!body.skill || !SCHEDULABLE.has(body.skill)) errors.push('skill must be one of: ' + [...SCHEDULABLE].join(', '));
  }
  if (!isUpdate || body.tpmScope !== undefined || body.productId !== undefined || body.release !== undefined) {
    const scope = body.tpmScope || { productId: body.productId, release: body.release };
    if (!scope.productId) errors.push('tpmScope.productId is required');
    if (!scope.release) errors.push('tpmScope.release is required');
  }
  if (body.schedule?.cron) {
    if (!cron.validate(body.schedule.cron)) errors.push('schedule.cron is invalid');
  }
  if (body.schedule?.dayOfWeek != null) {
    const d = Number(body.schedule.dayOfWeek);
    if (!Number.isInteger(d) || d < 0 || d > 6) errors.push('schedule.dayOfWeek must be 0-6');
  }
  if (body.tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: body.tz }); } catch { errors.push('tz is not a valid IANA timezone'); }
  }
  if (body.to !== undefined && body.to !== '' && !String(body.to).includes('@')) errors.push('to must be an email');
  return errors;
}

function toResponse(s) {
  // human phrase for "what runs when"
  const rec = s.schedule || {};
  let when = '';
  if (rec.cron) when = `cron ${rec.cron} (${s.tz})`;
  else {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const d = rec.dayOfWeek != null ? days[rec.dayOfWeek] : '—';
    const h = rec.hour != null ? String(rec.hour).padStart(2,'0') : '09';
    const m = rec.minute != null ? String(rec.minute).padStart(2,'0') : '00';
    when = `${d} ${h}:${m} ${s.tz}`;
  }
  return { ...s, when };
}

router.get('/', (req, res) => {
  const all = store.list();
  res.json({ schedules: all.map(toResponse) });
});

router.post('/', express.json(), requireAuth, (req, res) => {
  const body = req.body || {};
  const errors = validatePayload(body);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const createdBy = req.headers['x-username'] || body.username || body.createdBy || 'unknown';
  const rec = store.create({ ...body, createdBy });
  runner.rebuildCronJobs();
  res.status(201).json({ schedule: toResponse(rec) });
});

router.put('/:id', express.json(), requireAuth, (req, res) => {
  const id = req.params.id;
  const existing = store.getById(id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });
  const errors = validatePayload(req.body, true);
  if (errors.length) return res.status(400).json({ error: errors.join('; ') });
  const updated = store.update(id, req.body);
  runner.rebuildCronJobs();
  res.json({ schedule: toResponse(updated) });
});

router.delete('/:id', requireAuth, (req, res) => {
  const ok = store.remove(req.params.id);
  if (!ok) return res.status(404).json({ error: 'Schedule not found' });
  runner.rebuildCronJobs();
  res.json({ success: true });
});

module.exports = router;
