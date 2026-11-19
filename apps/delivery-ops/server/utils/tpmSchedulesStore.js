const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const CONFIG_PATH = path.join(__dirname, '../config/schedules.json');

function loadRaw() {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return [];
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
    if (!raw) return [];
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.warn('[tpmSchedulesStore] load error:', e.message);
    return [];
  }
}

function saveRaw(arr) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(arr, null, 2), 'utf8');
}

function computeNextRun(schedule) {
  try {
    const s = schedule.schedule || {};
    const tz = schedule.tz || s.tz || 'UTC';
    // If cron present, next tick is ~1 min granularity; compute via naive next minute check is done by runner.
    // Here we just estimate nextRun as now + interval hint for display: next matching minute.
    // Simple: return null and let runner fill it; UI shows human phrase from recurrence.
    return null;
  } catch { return null; }
}

function list() { return loadRaw(); }

function getById(id) {
  return loadRaw().find(s => s.id === id) || null;
}

function create(payload) {
  const arr = loadRaw();
  const now = new Date().toISOString();
  const rec = {
    id: randomUUID(),
    name: payload.name || '',
    skill: payload.skill,
    tpmScope: payload.tpmScope || { productId: payload.productId || 'ndb', release: payload.release || '' },
    schedule: payload.schedule || {},
    tz: payload.tz || payload.schedule?.tz || 'UTC',
    enabled: payload.enabled !== false,
    deferAfterPg: !!payload.deferAfterPg,
    to: payload.to || '',
    cc: payload.cc || '',
    createdBy: payload.createdBy || 'unknown',
    createdAt: now,
    lastRun: null,
    nextRun: null,
    lastStatus: undefined,
    lastError: undefined,
  };
  if (rec.schedule && rec.tz) rec.schedule.tz = rec.tz;
  arr.push(rec);
  saveRaw(arr);
  return rec;
}

function update(id, patch) {
  const arr = loadRaw();
  const idx = arr.findIndex(s => s.id === id);
  if (idx === -1) return null;
  const allowed = ['name', 'skill', 'tpmScope', 'schedule', 'tz', 'enabled', 'deferAfterPg', 'to', 'cc'];
  for (const k of allowed) if (patch[k] !== undefined) arr[idx][k] = patch[k];
  if (patch.tz && arr[idx].schedule) arr[idx].schedule.tz = patch.tz;
  saveRaw(arr);
  return arr[idx];
}

function markRun(id, { lastRun, lastStatus, lastError, nextRun }) {
  const arr = loadRaw();
  const idx = arr.findIndex(s => s.id === id);
  if (idx === -1) return null;
  if (lastRun !== undefined) arr[idx].lastRun = lastRun;
  if (lastStatus !== undefined) arr[idx].lastStatus = lastStatus;
  if (lastError !== undefined) arr[idx].lastError = lastError;
  if (nextRun !== undefined) arr[idx].nextRun = nextRun;
  saveRaw(arr);
  return arr[idx];
}

function remove(id) {
  const arr = loadRaw();
  const next = arr.filter(s => s.id !== id);
  if (next.length === arr.length) return false;
  saveRaw(next);
  return true;
}

module.exports = { loadRaw, saveRaw, list, getById, create, update, markRun, remove, CONFIG_PATH };
