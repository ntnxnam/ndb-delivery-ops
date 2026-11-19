const express = require('express');
const router = express.Router();
const cron = require('node-cron');
const store = require('../utils/tpmSchedulesStore');
const runner = require('../services/tpmScheduleRunner');

const SCHEDULABLE = new Set(['tpm-post-release','tpm-execution','tpm-at-release','tpm-overall','tpm-report']);

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
  if (body.schedule?.hour != null) {
    const h = Number(body.schedule.hour);
    if (!Number.isInteger(h) || h < 0 || h > 23) errors.push('schedule.hour must be 0-23');
  }
  if (body.schedule?.minute != null) {
    const m = Number(body.schedule.minute);
    if (!Number.isInteger(m) || m < 0 || m > 59) errors.push('schedule.minute must be 0-59');
  }
  if (body.tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: body.tz }); } catch { errors.push('tz is not a valid IANA timezone'); }
  }
  if (body.to !== undefined && body.to !== '' && !String(body.to).includes('@')) errors.push('to must be an email');
  return errors;
}

function toResponse(s) {
  return { ...s, when: runner.describeSchedule(s) };
}

router.get('/', (req, res) => {
  const all = store.list();
  res.json({ schedules: all.map(toResponse) });
});

router.post('/test-preview', express.json(), requireAuth, async (req, res) => {
  const body = req.body || {};
  const draft = {
    id: 'preview',
    name: body.name || '',
    skill: body.skill,
    tpmScope: body.tpmScope || { productId: body.productId || 'ndb', release: body.release || '' },
    schedule: body.schedule || {},
    tz: body.tz || body.schedule?.tz || 'UTC',
    enabled: body.enabled !== false,
    deferAfterPg: !!body.deferAfterPg,
    to: body.to || '',
    cc: body.cc || '',
  };
  // For preview, allow missing product/release but report as check failure via validateScheduleForTest, not 400
  try {
    const result = await runner.testSchedule(draft, { triggeredBy: req.headers['x-username'] || body.username || 'unknown' });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message?.slice(0, 500) || 'test failed' });
  }
});

router.post('/:id/test', express.json(), requireAuth, async (req, res) => {
  const id = req.params.id;
  const existing = store.getById(id);
  if (!existing) return res.status(404).json({ error: 'Schedule not found' });
  try {
    const result = await runner.testSchedule(existing, { triggeredBy: req.headers['x-username'] || req.body?.username || 'unknown' });
    // Do not mutate lastRun on test; keep separate audit if needed
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message?.slice(0, 500) || 'test failed' });
  }
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
