/**
 * Release management — multi-workspace support so the tool can run for a new release
 * without overwriting the previous one. Each release has its own isolated localStorage
 * namespace: `${baseKey}:${releaseId}` for every SCOPED_STORAGE_KEY.
 *
 * Legacy single-release users are auto-migrated: existing singleton data moves into a
 * default release "NDB 3.0" on first load.
 * @module releases
 */

import { RELEASES_REGISTRY_KEY, ACTIVE_RELEASE_KEY, SCOPED_STORAGE_KEYS, DEFAULT_RELEASE_NAME } from './config.js';
import { logger } from './logger.js';

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function nowIso() {
  return new Date().toISOString();
}

/** @returns {Array<{id:string,name:string,createdAt:string,updatedAt:string}>} */
export function _loadRegistry() {
  try {
    const raw = localStorage.getItem(RELEASES_REGISTRY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function _saveRegistry(registry) {
  try {
    localStorage.setItem(RELEASES_REGISTRY_KEY, JSON.stringify(registry));
  } catch (e) {
    logger.warn('releases._saveRegistry failed', e);
  }
}

export function getActiveReleaseId() {
  try {
    return localStorage.getItem(ACTIVE_RELEASE_KEY) || null;
  } catch (_) {
    return null;
  }
}

export function setActiveReleaseId(id) {
  try {
    if (id) localStorage.setItem(ACTIVE_RELEASE_KEY, id);
    else localStorage.removeItem(ACTIVE_RELEASE_KEY);
    const reg = _loadRegistry();
    const r = reg.find((x) => x.id === id);
    if (r) {
      r.updatedAt = nowIso();
      _saveRegistry(reg);
    }
    window.dispatchEvent(new CustomEvent('release:switched', { detail: { id } }));
    logger.info('releases.setActiveReleaseId', id);
  } catch (e) {
    logger.warn('releases.setActiveReleaseId failed', e);
  }
}

export function listReleases() {
  return _loadRegistry();
}

export function getActiveRelease() {
  const id = getActiveReleaseId();
  if (!id) return null;
  const reg = _loadRegistry();
  return reg.find((r) => r.id === id) || null;
}

export function getReleaseById(id) {
  return _loadRegistry().find((r) => r.id === id) || null;
}

/** Namespaced key for the active release, or legacy base key if no release. */
export function scopedKey(baseKey) {
  const activeId = getActiveReleaseId();
  if (!activeId) return baseKey;
  return `${baseKey}:${activeId}`;
}

function namespacedKeyFor(baseKey, releaseId) {
  return `${baseKey}:${releaseId}`;
}

/** Create a new release. @param {string} name @param {{cloneFromId?:string}} opts */
export function createRelease(name, opts = {}) {
  const clean = String(name || '').trim() || `Release ${new Date().toLocaleDateString()}`;
  const id = uid();
  const entry = { id, name: clean, createdAt: nowIso(), updatedAt: nowIso() };
  const reg = _loadRegistry();
  reg.push(entry);
  _saveRegistry(reg);
  const cloneFromId = opts.cloneFromId || null;
  if (cloneFromId) {
    for (const k of SCOPED_STORAGE_KEYS) {
      try {
        const srcKey = namespacedKeyFor(k, cloneFromId);
        const val = localStorage.getItem(srcKey);
        const fallback = val == null ? localStorage.getItem(k) : null;
        const toCopy = val != null ? val : fallback;
        if (toCopy != null) localStorage.setItem(namespacedKeyFor(k, id), toCopy);
      } catch (_) {}
    }
  }
  setActiveReleaseId(id);
  logger.info('releases.createRelease', entry);
  return entry;
}

export function renameRelease(id, newName) {
  const clean = String(newName || '').trim();
  if (!clean) throw new Error('Name cannot be empty');
  const reg = _loadRegistry();
  const r = reg.find((x) => x.id === id);
  if (!r) throw new Error('Release not found');
  r.name = clean;
  r.updatedAt = nowIso();
  _saveRegistry(reg);
  window.dispatchEvent(new CustomEvent('release:renamed', { detail: { id, name: clean } }));
  return r;
}

function _uniqueName(base) {
  const regs = _loadRegistry();
  const names = new Set(regs.map((r) => r.name));
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} (${n})`)) n++;
  return `${base} (${n})`;
}

export function duplicateRelease(id) {
  const src = getReleaseById(id);
  if (!src) throw new Error('Release not found');
  const base = `${src.name} (copy)`;
  return createRelease(_uniqueName(base), { cloneFromId: id });
}

export function deleteRelease(id) {
  const reg = _loadRegistry();
  const idx = reg.findIndex((x) => x.id === id);
  if (idx === -1) throw new Error('Release not found');
  if (reg.length <= 1) throw new Error('Cannot delete the last release');
  for (const k of SCOPED_STORAGE_KEYS) {
    try { localStorage.removeItem(namespacedKeyFor(k, id)); } catch (_) {}
  }
  reg.splice(idx, 1);
  _saveRegistry(reg);
  if (getActiveReleaseId() === id) setActiveReleaseId(reg[0].id);
  else window.dispatchEvent(new CustomEvent('release:deleted', { detail: { id } }));
  logger.info('releases.deleteRelease', id);
}

/** Prune active id if it points at deleted/missing release (cross-tab delete). */
function _pruneActiveIfMissing() {
  try {
    const active = getActiveReleaseId();
    if (!active) return;
    const reg = _loadRegistry();
    if (!reg.some((r) => r.id === active)) {
      if (reg.length) setActiveReleaseId(reg[0].id);
      else localStorage.removeItem(ACTIVE_RELEASE_KEY);
    }
  } catch (_) {}
}
if (typeof window !== 'undefined') {
  try { window.addEventListener('storage', (e) => { if (e.key === RELEASES_REGISTRY_KEY || e.key === ACTIVE_RELEASE_KEY) _pruneActiveIfMissing(); }); } catch (_) {}
}

export function ensureReleasesInitialized() {
  _pruneActiveIfMissing();
  const existing = _loadRegistry();
  if (existing.length > 0) return existing;
  let hasLegacy = false;
  try {
    for (const k of SCOPED_STORAGE_KEYS) {
      if (localStorage.getItem(k) != null) { hasLegacy = true; break; }
    }
  } catch (_) {}
  const id = uid();
  const entry = { id, name: DEFAULT_RELEASE_NAME, createdAt: nowIso(), updatedAt: nowIso() };
  const reg = [entry];
  _saveRegistry(reg);
  try { localStorage.setItem(ACTIVE_RELEASE_KEY, id); } catch (_) {}
  if (hasLegacy) {
    for (const k of SCOPED_STORAGE_KEYS) {
      try { const v = localStorage.getItem(k); if (v != null) localStorage.setItem(namespacedKeyFor(k, id), v); } catch (_) {}
    }
    logger.info('releases.migrated legacy singleton ->', id);
  } else logger.info('releases.initialized new registry ->', id);
  return reg;
}

/**
 * @typedef {{ release?: {name:string}, data: Record<string, unknown>, exportedAt?: string, version?: number }} ImportPayload
 */
export function exportRelease(id) {
  const rel = getReleaseById(id);
  if (!rel) throw new Error('Release not found');
  const data = {};
  for (const k of SCOPED_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(namespacedKeyFor(k, id));
      if (raw != null) data[k] = raw;
    } catch (_) {}
  }
  return { release: rel, data, exportedAt: nowIso(), version: 1 };
}

/** @param {ImportPayload} payload */
export function importRelease(payload, nameOverride) {
  if (!payload || !payload.data || typeof payload.data !== 'object') throw new Error('Invalid import payload');
  if (payload.version != null && payload.version !== 1) throw new Error(`Unsupported export version ${payload.version}`);
  const allowed = new Set(SCOPED_STORAGE_KEYS);
  for (const k of Object.keys(payload.data)) if (!allowed.has(k)) throw new Error(`Unknown key in import: ${k}`);
  const baseName = nameOverride || payload.release?.name || 'Imported release';
  const created = createRelease(_uniqueName(String(baseName).trim() || 'Imported release'));
  try {
    for (const k of SCOPED_STORAGE_KEYS) {
      if (payload.data[k] !== undefined) {
        const v = payload.data[k];
        const raw = typeof v === 'string' ? v : JSON.stringify(v);
        localStorage.setItem(namespacedKeyFor(k, created.id), raw);
      }
    }
  } catch (e) {
    // rollback on quota error
    try { deleteRelease(created.id); } catch (_) {}
    throw new Error(`Import failed, rolled back: ${e.message}`);
  }
  return created;
}
