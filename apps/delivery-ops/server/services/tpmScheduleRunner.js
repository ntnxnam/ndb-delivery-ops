const cron = require('node-cron');
const path = require('path');
const fs = require('fs');
const store = require('../utils/tpmSchedulesStore');

function getNowInTz(tz) {
  const timezone = tz || 'UTC';
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, hour: 'numeric', minute: 'numeric', hour12: false, weekday: 'short',
  });
  const parts = fmt.formatToParts(now);
  let hour = 0, minute = 0, dow = 0;
  for (const p of parts) {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
    if (p.type === 'weekday') dow = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 }[p.value] ?? 0;
  }
  return { hour, minute, dayOfWeek: dow };
}

function isDue(schedule, now) {
  const s = schedule.schedule || {};
  if (s.cron) {
    // cron validated on save; evaluate via cron parser would need extra dep.
    // For MVP, cron schedules are evaluated by matching the cron's minute/hour/dow against now
    // — simple cron like "0 7 * * 1" or "30 7 * * *" handled; complex uses node-cron per-entry.
    // Fallback: use cron expression via cron-parser if available, else rely on scheduled cron jobs.
    return false; // cron entries use dedicated cron jobs (see start())
  }
  const day = s.dayOfWeek != null ? Number(s.dayOfWeek) : null;
  const hour = s.hour != null ? Number(s.hour) : 9;
  const minute = s.minute != null ? Number(s.minute) : 0;
  if (day != null && now.dayOfWeek !== day) return false;
  return now.hour === hour && now.minute === minute;
}

function isAfterPg(schedule) {
  if (!schedule.deferAfterPg) return false;
  const rel = schedule.tpmScope?.release;
  if (!rel) return false;
  try {
    const cfgPath = path.join(__dirname, '../config/releaseVersionsEmailConfig.json');
    const raw = fs.readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(raw);
    const relCfg = cfg.releaseGateDates?.[rel];
    if (!relCfg) return false;
    // Find latest promotionGate* date that is solid (current PG)
    let pgDate = null;
    for (let i = 1; i <= 5; i++) {
      const g = relCfg[`promotionGate${i}`];
      if (g?.date) pgDate = g.date;
    }
    if (!pgDate) return false;
    const pg = new Date(pgDate + 'T00:00:00');
    const today = new Date(); today.setHours(0,0,0,0);
    return today > pg;
  } catch { return false; }
}

async function invokeSkill(schedule) {
  // D26-safe: runner is server-side; D26 mutate HITL is not needed for fetch/report reads.
  // We log invocation and mark lastRun; actual skill execution is via shared agent runtime
  // or by emitting a digest email job. For now we record success and leave skill dispatch
  // to the consumer (tpmExecution/tpmAtRelease etc. read schedules and act).
  console.log(`[tpmScheduleRunner] invoking skill=${schedule.skill} scope=${JSON.stringify(schedule.tpmScope)} id=${schedule.id}`);

  // If deferAfterPg and past PG, skip
  if (isAfterPg(schedule)) {
    store.markRun(schedule.id, { lastRun: new Date().toISOString(), lastStatus: 'skipped', lastError: 'deferred after PG' });
    return;
  }

  // Placeholder: mark success. Real dispatch hooks (call tpm skill service) can be wired via
  // TPM_SKILL_DISPATCH env or by importing shared tpm services.
  try {
    const dispatch = global.__tpmSkillDispatch;
    if (typeof dispatch === 'function') {
      await dispatch(schedule);
    }
    store.markRun(schedule.id, { lastRun: new Date().toISOString(), lastStatus: 'success', lastError: '' });
  } catch (e) {
    store.markRun(schedule.id, { lastRun: new Date().toISOString(), lastStatus: 'error', lastError: e.message?.slice(0, 500) || 'invoke failed' });
  }
}

function describeSchedule(schedule) {
  const s = schedule.schedule || {};
  const tz = schedule.tz || s.tz || 'UTC';
  if (s.cron) return `cron ${s.cron} (${tz})`;
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const d = s.dayOfWeek != null ? days[s.dayOfWeek] : '—';
  const h = s.hour != null ? String(s.hour).padStart(2, '0') : '09';
  const m = s.minute != null ? String(s.minute).padStart(2, '0') : '00';
  return `${d} ${h}:${m} ${tz}`;
}

function validateScheduleForTest(schedule) {
  const checks = [];
  const push = (id, label, ok, detail) => checks.push({ id, label, ok, detail });
  const cron = schedule.schedule?.cron;
  if (cron) {
    const ok = cron && typeof cron === 'string' && cron.trim().split(/\s+/).length === 5 && require('node-cron').validate(cron);
    push('cron', 'Cron expression', ok, ok ? cron : `Invalid cron: ${cron || '—'}`);
  } else {
    const d = schedule.schedule?.dayOfWeek;
    const h = schedule.schedule?.hour;
    const m = schedule.schedule?.minute;
    push('dayOfWeek', 'Day of week', d == null || (Number.isInteger(Number(d)) && Number(d) >= 0 && Number(d) <= 6), d != null ? String(d) : 'any');
    push('hour', 'Hour', h == null || (Number.isInteger(Number(h)) && Number(h) >= 0 && Number(h) <= 23), String(h ?? '09'));
    push('minute', 'Minute', m == null || (Number.isInteger(Number(m)) && Number(m) >= 0 && Number(m) <= 59), String(m ?? '00'));
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: schedule.tz || schedule.schedule?.tz || 'UTC' }); push('tz', 'Timezone', true, schedule.tz || schedule.schedule?.tz || 'UTC'); } catch { push('tz', 'Timezone', false, schedule.tz || 'unknown'); }
  const scope = schedule.tpmScope || {};
  push('scope', 'Scope (product/release)', !!(scope.productId && scope.release), scope.productId && scope.release ? `${scope.productId} / ${scope.release}` : 'productId and release required');
  push('skill', 'Skill', !!schedule.skill, schedule.skill || 'missing');
  const toOk = !schedule.to || String(schedule.to).includes('@');
  push('to', 'Recipients (To)', toOk, schedule.to ? schedule.to : 'none — will use defaults');
  return checks;
}

async function testSchedule(schedule, { triggeredBy } = {}) {
  const checks = validateScheduleForTest(schedule);
  const failed = checks.filter((c) => !c.ok);
  const wouldSkip = schedule.deferAfterPg && isAfterPg(schedule);
  const preview = {
    id: schedule.id || 'preview',
    name: schedule.name || '',
    skill: schedule.skill,
    tpmScope: schedule.tpmScope,
    when: describeSchedule(schedule),
    tz: schedule.tz || schedule.schedule?.tz || 'UTC',
    to: schedule.to || '',
    cc: schedule.cc || '',
    enabled: schedule.enabled !== false,
    wouldSkip: !!wouldSkip,
    wouldSkipReason: wouldSkip ? 'deferred after Promotion Gate' : null,
  };
  // If all checks pass and not skipped, optionally run dispatch in dry-run mode (no store mutation)
  let dispatchResult = null;
  if (failed.length === 0 && !wouldSkip) {
    try {
      const dispatch = global.__tpmSkillDispatch;
      if (typeof dispatch === 'function') {
        const maybe = await dispatch({ ...schedule, _test: true, _triggeredBy: triggeredBy });
        dispatchResult = typeof maybe === 'object' && maybe !== null ? maybe : { ok: true };
      }
    } catch (e) {
      const msg = e.message?.slice(0, 500) || 'dispatch failed';
      checks.push({ id: 'dispatch', label: 'Skill dispatch (dry-run)', ok: false, detail: msg });
      return { ok: false, checks, preview, dispatchResult: { ok: false, error: msg }, testedAt: new Date().toISOString() };
    }
  }
  const ok = failed.length === 0;
  return { ok: ok && !wouldSkip ? true : failed.length === 0 && wouldSkip ? true : false, checks, preview, dispatchResult, testedAt: new Date().toISOString(), warnings: wouldSkip ? ['Schedule would be skipped — past Promotion Gate with deferAfterPg enabled.'] : [] };
}

async function tick() {
  const all = store.list().filter(s => s.enabled);
  for (const s of all) {
    const tz = s.tz || s.schedule?.tz || 'UTC';
    // cron entries are handled by per-schedule cron jobs; skip here
    if (s.schedule?.cron) continue;
    const now = getNowInTz(tz);
    if (isDue(s, now)) await invokeSkill(s);
  }
}

let minuteJob = null;
let cronJobs = new Map(); // id -> cron job

function startCronForSchedule(s) {
  if (!s.schedule?.cron || !s.enabled) return;
  const expr = s.schedule.cron.trim();
  if (!cron.validate(expr)) return;
  const tz = s.tz || s.schedule.tz || 'UTC';
  const job = cron.schedule(expr, () => invokeSkill(s).catch(e => console.error('[tpmScheduleRunner] cron invoke error', e)), { timezone: tz });
  cronJobs.set(s.id, job);
}

function rebuildCronJobs() {
  for (const j of cronJobs.values()) j.stop();
  cronJobs.clear();
  for (const s of store.list()) startCronForSchedule(s);
}

function start() {
  if (minuteJob) return;
  rebuildCronJobs();
  minuteJob = cron.schedule('* * * * *', () => tick().catch(e => console.error('[tpmScheduleRunner] tick error', e)), { timezone: 'UTC' });
  console.log('[tpmScheduleRunner] started (minute tick + cron entries)');
}

function stop() {
  if (minuteJob) { minuteJob.stop(); minuteJob = null; }
  for (const j of cronJobs.values()) j.stop();
  cronJobs.clear();
  console.log('[tpmScheduleRunner] stopped');
}

module.exports = { start, stop, tick, isDue, getNowInTz, invokeSkill, rebuildCronJobs, testSchedule, describeSchedule, validateScheduleForTest, isAfterPg };
