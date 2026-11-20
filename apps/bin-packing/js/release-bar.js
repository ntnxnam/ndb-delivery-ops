/**
 * Release bar — mount point #releaseBar on every page.
 * Picker + New / Duplicate / Rename / Delete + Import/Export + UX feedback via toast.
 * @module release-bar
 */
import { listReleases, getActiveReleaseId, getActiveRelease, setActiveReleaseId, createRelease, duplicateRelease, renameRelease, deleteRelease, exportRelease, ensureReleasesInitialized } from './releases.js';
import { escapeHtml } from './utils.js';
import { logger } from './logger.js';

const byId = (id) => document.getElementById(id);

function toast(msg, kind = 'info') {
  let c = byId('releaseToastContainer');
  if (!c) {
    c = document.createElement('div');
    c.id = 'releaseToastContainer';
    c.className = 'release-toast-container';
    c.setAttribute('role', 'region');
    c.setAttribute('aria-label', 'Notifications');
    c.setAttribute('aria-live', 'polite');
    document.body.appendChild(c);
  }
  const t = document.createElement('div');
  t.className = `release-toast release-toast--${kind}`;
  t.setAttribute('role', 'status');
  t.setAttribute('aria-live', 'polite');
  t.setAttribute('aria-atomic', 'true');
  const msgEl = document.createElement('span');
  msgEl.className = 'release-toast__msg';
  msgEl.textContent = msg;
  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.className = 'release-toast__dismiss';
  dismiss.setAttribute('aria-label', 'Dismiss notification');
  dismiss.textContent = '×';
  t.appendChild(msgEl);
  t.appendChild(dismiss);
  c.appendChild(t);
  let timer = setTimeout(() => dismissToast(), 4200);
  function dismissToast() {
    t.classList.add('release-toast--out');
    setTimeout(() => t.remove(), 300);
  }
  dismiss.addEventListener('click', dismissToast);
  t.addEventListener('mouseenter', () => clearTimeout(timer));
  t.addEventListener('mouseleave', () => { timer = setTimeout(dismissToast, 1200); });
  t.addEventListener('focusin', () => clearTimeout(timer));
}

function refreshSelect() {
  const sel = byId('releaseSelect');
  if (!sel) return;
  const regs = listReleases();
  const active = getActiveReleaseId();
  sel.innerHTML = '';
  for (const r of regs) {
    const opt = document.createElement('option');
    opt.value = r.id;
    opt.textContent = r.name;
    opt.title = r.name;
    if (r.id === active) opt.selected = true;
    sel.appendChild(opt);
  }
  const countEl = byId('releaseCount');
  if (countEl) countEl.textContent = `${regs.length} release${regs.length !== 1 ? 's' : ''}`;
  const delBtn = byId('releaseDeleteBtn');
  if (delBtn) {
    const disabled = regs.length <= 1;
    delBtn.disabled = disabled;
    delBtn.title = disabled ? 'Delete disabled — keep at least one release' : 'Delete current release';
    delBtn.setAttribute('aria-disabled', String(disabled));
  }
}

function syncHeader(activeName) {
  const h1 = document.querySelector('h1');
  if (!h1 || !activeName) return;
  // Replace leading release name before "– Project bin packing", or prefix if no match
  if (/–\s*Project bin packing/i.test(h1.textContent)) {
    h1.textContent = `${activeName} – Project bin packing`;
  } else if (!h1.textContent.includes(activeName)) {
    h1.textContent = `${activeName} – Project bin packing`;
  }
  document.title = h1.textContent;
  h1.id = 'appTitle';
}

export function mountReleaseBar() {
  try { ensureReleasesInitialized(); } catch (_) {}
  const mount = byId('releaseBar');
  if (!mount) return;
  const active = getActiveRelease();
  const regs = listReleases();
  syncHeader(active?.name || null);
  mount.innerHTML = `
    <div class="release-bar" role="region" aria-label="Release workspaces">
      <div class="release-bar__left">
        <label class="release-bar-label" for="releaseSelect">Release</label>
        <select id="releaseSelect" class="release-select" aria-label="Active release"></select>
        <span id="releaseCount" class="release-meta">${regs.length} release${regs.length !== 1 ? 's' : ''}</span>
        <span id="releaseActiveName" class="release-active-name" title="${active ? escapeHtml(active.name) : ''}">${active ? escapeHtml(active.name) : ''}</span>
      </div>
      <div class="release-actions">
        <button type="button" id="releaseNewBtn" class="btn-export" title="Create a new empty release">+ New</button>
        <button type="button" id="releaseDupBtn" class="btn-export" title="Duplicate current release (copies all data)">Duplicate</button>
        <button type="button" id="releaseRenameBtn" class="btn-export" title="Rename current release">Rename</button>
        <button type="button" id="releaseDeleteBtn" class="btn-export" title="${regs.length <= 1 ? 'Delete disabled — keep at least one release' : 'Delete current release'}" ${regs.length <= 1 ? 'disabled aria-disabled="true"' : ''}>Delete</button>
        <button type="button" id="releaseExportBtn" class="btn-export" title="Download this release as JSON">Export</button>
        <button type="button" id="releaseImportBtn" class="btn-export" title="Import a previously exported release JSON">Import</button>
        <input type="file" id="releaseImportInput" accept=".json,application/json" hidden aria-hidden="true" tabindex="-1">
      </div>
    </div>
    <div id="releaseFeedback" class="release-feedback" aria-live="polite" aria-atomic="true"></div>
  `;
  function setFeedback(msg) { const el = byId('releaseFeedback'); if (el) el.textContent = msg; }
  const feedbackMsg = active
    ? regs.length === 1
      ? `Active: ${active.name} — 1 release. Use + New or Duplicate to keep old planning items for next release.`
      : `Active: ${active.name} — ${regs.length} releases kept. Switching preserves old planning items.`
    : '';
  setFeedback(feedbackMsg);
  refreshSelect();
  const sel = byId('releaseSelect');
  if (sel) sel.addEventListener('change', (e) => {
    const id = e.target.value;
    if (!id || id === getActiveReleaseId()) return;
    const prev = getActiveRelease()?.name || '';
    setActiveReleaseId(id);
    const next = getActiveRelease()?.name || '';
    toast(`Switched from "${prev}" to "${next}" — old items kept`, 'success');
    setFeedback(`Active: ${next}`);
    setTimeout(() => location.reload(), 400);
  });
  const newBtn = byId('releaseNewBtn');
  if (newBtn) newBtn.addEventListener('click', () => {
    const prevEl = newBtn;
    const name = window.prompt('New release name:', `Release ${new Date().getFullYear() + 1}`);
    if (name == null) { prevEl.focus(); return; }
    const clean = String(name).trim();
    if (!clean) { toast('Name cannot be empty', 'error'); prevEl.focus(); return; }
    createRelease(clean);
    toast(`Created "${clean}" — empty, old releases kept`, 'success');
    setTimeout(() => location.reload(), 400);
  });
  const dupBtn = byId('releaseDupBtn');
  if (dupBtn) dupBtn.addEventListener('click', () => {
    const cur = getActiveRelease(); if (!cur) return;
    try { const dup = duplicateRelease(cur.id); toast(`Duplicated "${cur.name}" → "${dup.name}"`, 'success'); setTimeout(() => location.reload(), 400); } catch (err) { toast(err.message, 'error'); }
  });
  const renameBtn = byId('releaseRenameBtn');
  if (renameBtn) renameBtn.addEventListener('click', () => {
    const cur = getActiveRelease(); if (!cur) return;
    const next = window.prompt('Rename release:', cur.name); if (next == null) { renameBtn.focus(); return; }
    const clean = String(next).trim(); if (!clean || clean === cur.name) { renameBtn.focus(); return; }
    try {
      renameRelease(cur.id, clean);
      refreshSelect();
      const meta = byId('releaseActiveName'); if (meta) { meta.textContent = clean; meta.title = clean; }
      setFeedback(`Active: ${clean}`);
      toast(`Renamed to "${clean}"`, 'success');
      syncHeader(clean);
      renameBtn.focus();
    } catch (err) { toast(err.message, 'error'); }
  });
  const delBtn = byId('releaseDeleteBtn');
  if (delBtn) delBtn.addEventListener('click', () => {
    const cur = getActiveRelease(); if (!cur) return;
    if (!window.confirm(`Delete release "${cur.name}"? All its uploads and overrides will be removed. Cannot undo.`)) { delBtn.focus(); return; }
    try { deleteRelease(cur.id); toast(`Deleted "${cur.name}"`, 'info'); setTimeout(() => location.reload(), 400); } catch (err) { toast(err.message, 'error'); delBtn.focus(); }
  });
  const exportBtn = byId('releaseExportBtn');
  if (exportBtn) exportBtn.addEventListener('click', () => {
    const cur = getActiveRelease(); if (!cur) return;
    try {
      const payload = exportRelease(cur.id);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `binpacking-${cur.name.replace(/[^a-z0-9_-]+/gi, '-').slice(0, 40)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(`Exported "${cur.name}"`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
  const importBtn = byId('releaseImportBtn');
  const importInput = byId('releaseImportInput');
  if (importBtn && importInput) {
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      try { const text = await file.text(); const payload = JSON.parse(text); const { importRelease } = await import('./releases.js'); const created = importRelease(payload); toast(`Imported as "${created.name}"`, 'success'); setTimeout(() => location.reload(), 500); } catch (err) { toast('Import failed: ' + (err.message || String(err)), 'error'); }
      e.target.value = '';
      importBtn.focus();
    });
  }
  window.addEventListener('release:switched', () => { refreshSelect(); setFeedback(`Active: ${getActiveRelease()?.name || ''}`); });
  window.addEventListener('release:renamed', () => { refreshSelect(); setFeedback(`Active: ${getActiveRelease()?.name || ''}`); });
  logger.debug('release-bar mounted', active?.name);
}
if (typeof document !== 'undefined') { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountReleaseBar); else mountReleaseBar(); }
