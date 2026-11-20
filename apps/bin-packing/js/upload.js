/**
 * Upload page: CSV, XLSX, or JSON file input; submit to persist; verification table; export JSON.
 * @module upload
 */

import { getEl, escapeHtml, formatNum } from './utils.js';
import { logger } from './logger.js';
import { getProjects, setProjects, setScheduleData, clearAllOverrides } from './state.js';
import { csvToProjects, rowsToProjects, detectResourceGroups } from './csv-parser.js';
import { parseXlsxToRows } from './xlsx-parser.js';
import { orderByDependencyAndSize, getDependentsCounts, getRankLabel } from './ranking.js';
import { prepareScheduleData } from './prepare-schedule.js';

// Converter agent — lazy-loaded to keep main bundle intact if module missing
let converterAgent = null;
let converterAgentLoadPromise = null;
function loadConverterAgent() {
  if (converterAgent) return Promise.resolve(converterAgent);
  if (converterAgentLoadPromise) return converterAgentLoadPromise;
  converterAgentLoadPromise = import('./csv-converter-agent.js')
    .then((m) => { converterAgent = m; return m; })
    .catch(() => null);
  return converterAgentLoadPromise;
}

/** Pending projects after file selection, before Submit. */
let pendingUploadProjects = null;

/** Pending converter file (selected in Convert any file card). */
let pendingConverterFile = null;
/** Is a converter request in flight. */
let converterBusy = false;

/**
 * Render the verification table (ordered by dependency and rank).
 * @param {Array<object>} projectList
 */
function renderUploadTable(projectList) {
  const container = getEl('uploadTableContainer');
  if (!container) return;

  const ordered = orderByDependencyAndSize(projectList || []);
  const counts = getDependentsCounts(projectList || []);
  const devBlockerSet = (p) => new Set(p.dependencyDevBlockers || []);
  const relBlockerSet = (p) => new Set(p.dependencyRelBlockers || []);

  container.innerHTML = '';
  const table = document.createElement('table');
  table.className = 'verify-table';
  table.setAttribute('role', 'table');
  table.innerHTML = `
    <thead>
      <tr>
        <th scope="col">Sl No</th>
        <th scope="col">Rank</th>
        <th scope="col">Status</th>
        <th scope="col">Summary</th>
        <th scope="col">Priority</th>
        <th scope="col">3.0 Commitment Status</th>
        <th scope="col">Total Months Needed for 1 person by Dev (Everything from start to finish)</th>
        <th scope="col">Dev Resources required for max parallization</th>
        <th scope="col">Num of QA required(rule: 3:1, 1 QA for 3 dev)</th>
        <th scope="col">Number of Months (Dev)</th>
        <th scope="col">sizing (refer sheet 2 for guidance)</th>
        <th scope="col">Additional Resources</th>
        <th scope="col">Sizing Comment</th>
        <th scope="col">Dependency Numbers (Comma Separated List)</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');
  ordered.forEach((p) => {
    const summaryVal = (p.summary || '').trim() || '—';
    const slNo = p.rowNumber != null ? p.rowNumber : '—';
    const totalPersonMonthsVal = (p.totalPersonMonths !== undefined && p.totalPersonMonths !== '') ? String(p.totalPersonMonths).trim() : '—';
    const internalDeps = (p.dependencyRowNumbers || []).filter(r => r !== p.rowNumber);
    const devBlockers = devBlockerSet(p);
    const relBlockers = relBlockerSet(p);
    const depParts = internalDeps.map(r => devBlockers.has(r) ? `${r} (Dev-blocker)` : relBlockers.has(r) ? `${r} (Rel-blocker)` : `${r}`);
    const depText = depParts.length === 0 ? '—' : depParts.join(', ');
    const rankText = getRankLabel(p, counts);
    const statusText = (p.status || '').trim() || '—';
    const tr = document.createElement('tr');
    if (p.inProgress) tr.style.background = 'rgba(210, 153, 34, 0.10)';
    if (p.isResourceGroupChild) tr.style.background = 'rgba(130, 160, 200, 0.08)';
    tr.innerHTML = `
      <td>${escapeHtml(String(slNo))}</td>
      <td>${escapeHtml(rankText)}</td>
      <td>${escapeHtml(statusText)}</td>
      <td>${escapeHtml(summaryVal)}</td>
      <td>${escapeHtml((p.priority || 'P0').trim() || '—')}</td>
      <td>${escapeHtml((p.commitment || '').trim() || '—')}</td>
      <td>${escapeHtml(totalPersonMonthsVal)}</td>
      <td>${formatNum(p.totalResources)}</td>
      <td>${formatNum(p.qaResources)}</td>
      <td>${formatNum(p.durationMonths)}</td>
      <td>${escapeHtml((p.sizingLabel || '').trim() || '—')}</td>
      <td>${escapeHtml((p.additionalResources || '').trim() || '—')}</td>
      <td>${escapeHtml((p.sizingComment || '').trim() || '—')}</td>
      <td>${escapeHtml(depText)}</td>
    `;
    tbody.appendChild(tr);
  });
  container.appendChild(table);
  logger.debug('upload.renderUploadTable: rendered', ordered.length, 'rows');
}

/**
 * Run submit: persist pending or current projects, render table, show export.
 */
function runUploadSubmit() {
  const uploadStatus = getEl('uploadStatus');
  const uploadTableWrap = getEl('uploadTableWrap');
  const listToShow = (pendingUploadProjects && pendingUploadProjects.length > 0) ? pendingUploadProjects : getProjects();

  if (!listToShow || listToShow.length === 0) {
    if (uploadStatus) {
      uploadStatus.textContent = 'No project data. Upload a CSV, XLSX, or JSON above, or add data/projects.json and reload.';
      uploadStatus.className = 'upload-status error';
    }
    return;
  }

  try {
    if (listToShow === pendingUploadProjects) {
      clearAllOverrides();
      setProjects(pendingUploadProjects);
      logger.info('upload.submit: persisted', pendingUploadProjects.length, 'raw projects');
    }

    const { projects: scheduleProjects, dropped, total } = prepareScheduleData(listToShow);
    setScheduleData(scheduleProjects);
    logger.info('upload.submit: prepared', scheduleProjects.length, 'committed projects for schedule (dropped', dropped, 'of', total, ')');

    renderUploadTable(scheduleProjects);
    if (uploadTableWrap) {
      uploadTableWrap.style.display = 'block';
      uploadTableWrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    if (uploadStatus) {
      uploadStatus.textContent = `${total} rows imported → ${scheduleProjects.length} Committed projects ready for schedule (${dropped} non-committed rows excluded). Verify the table below, then go to the Schedule tab.`;
      uploadStatus.className = 'upload-status success';
    }
    showExportRow();
  } catch (err) {
    logger.error('upload.runUploadSubmit', err);
    if (uploadStatus) {
      uploadStatus.textContent = `Error: ${err.message}`;
      uploadStatus.className = 'upload-status error';
    }
  }
}

function showExportRow() {
  const row = getEl('exportRow');
  const projects = getProjects();
  if (row) row.style.display = projects.length > 0 ? 'flex' : 'none';
}

function updateSubmitButtonState() {
  const btn = getEl('uploadSubmitBtn');
  if (!btn) return;
  const hasPending = pendingUploadProjects && pendingUploadProjects.length > 0;
  const hasSaved = getProjects().length > 0;
  const canSubmit = hasPending || hasSaved;
  /* Keep button always clickable; handler shows message if nothing to submit */
  btn.title = canSubmit ? 'Persist and show project table' : 'Select a CSV, XLSX, or JSON file above first';
}

function showUploadSubmitRow() {
  updateSubmitButtonState();
}

/**
 * Handle selected file: parse CSV, XLSX, or JSON; detect resource groups; show Submit row.
 * @param {File} file
 */
async function handleFile(file) {
  const uploadStatus = getEl('uploadStatus');
  const uploadTableWrap = getEl('uploadTableWrap');
  const fileInput = getEl('csvFileInput');

  if (uploadTableWrap) uploadTableWrap.style.display = 'none';

  const name = (file.name || '').toLowerCase();
  const isJson = name.endsWith('.json');
  const isXlsx = name.endsWith('.xlsx');

  try {
    let next;

    if (isJson) {
      const text = await file.text();
      if (!text || !text.trim()) {
        if (uploadStatus) { uploadStatus.textContent = 'File is empty.'; uploadStatus.className = 'upload-status error'; }
        if (fileInput) fileInput.value = '';
        return;
      }
      const parsed = JSON.parse(text);
      if (!Array.isArray(parsed)) throw new Error('JSON must be an array of projects');
      detectResourceGroups(parsed);
      next = parsed;
      logger.debug('upload.handleFile: parsed JSON', next.length, 'projects');
    } else if (isXlsx) {
      const arrayBuffer = await file.arrayBuffer();
      const { rows, error: xlsxError } = await parseXlsxToRows(arrayBuffer);
      if (xlsxError) {
        if (uploadStatus) { uploadStatus.textContent = xlsxError; uploadStatus.className = 'upload-status error'; }
        return;
      }
      const out = rowsToProjects(rows);
      if (out.error) {
        if (uploadStatus) { uploadStatus.textContent = out.error; uploadStatus.className = 'upload-status error'; }
        return;
      }
      next = out.projects;
      logger.debug('upload.handleFile: parsed XLSX', next.length, 'projects');
    } else {
      const text = await file.text();
      if (!text || !text.trim()) {
        if (uploadStatus) { uploadStatus.textContent = 'File is empty.'; uploadStatus.className = 'upload-status error'; }
        if (fileInput) fileInput.value = '';
        return;
      }
      const out = csvToProjects(text);
      if (out.error) {
        if (uploadStatus) { uploadStatus.textContent = out.error; uploadStatus.className = 'upload-status error'; }
        return;
      }
      next = out.projects;
      logger.debug('upload.handleFile: parsed CSV', next.length, 'projects');
    }

    pendingUploadProjects = next;
    if (uploadStatus) {
      uploadStatus.textContent = `Accepted ${next.length} projects. Click Submit to review.`;
      uploadStatus.className = 'upload-status success';
    }
    updateSubmitButtonState();
    const submitBtnEl = getEl('uploadSubmitBtn');
    if (submitBtnEl) requestAnimationFrame(() => submitBtnEl.focus({ preventScroll: true }));
    if (fileInput) fileInput.blur();
  } catch (err) {
    logger.error('upload.handleFile', err);
    if (uploadStatus) {
      uploadStatus.textContent = `Error: ${err.message}`;
      uploadStatus.className = 'upload-status error';
    }
  }
  if (fileInput) fileInput.value = '';
}

// ── Converter (AI) flow ───────────────────────────────────────────────

function updateConverterConvertBtn() {
  const btn = getEl('converterConvertBtn');
  if (!btn) return;
  btn.disabled = !pendingConverterFile || converterBusy;
  btn.title = converterBusy ? 'Converting…' : pendingConverterFile ? 'Convert to canonical CSV' : 'Select a file first';
}

async function runConverterConvert() {
  const mod = await loadConverterAgent();
  if (!mod) {
    const s = getEl('converterStatus');
    if (s) { s.textContent = 'Converter module not available.'; s.className = 'upload-status error'; }
    return;
  }
  if (!pendingConverterFile) {
    mod.setConverterStatus('Select a file first.', 'error');
    return;
  }
  const validation = mod.validateConverterFile(pendingConverterFile);
  if (validation) {
    mod.setConverterStatus(validation, 'error');
    return;
  }
  const productPicker = getEl('converterProductPicker');
  const productId = productPicker ? productPicker.value : 'ndb';
  const statusEl = getEl('converterStatus');
  const previewWrap = getEl('converterPreviewWrap');
  const convertBtn = getEl('converterConvertBtn');

  converterBusy = true;
  updateConverterConvertBtn();
  if (convertBtn) convertBtn.textContent = 'Converting…';
  mod.setConverterStatus('Converting…', null);
  if (previewWrap) { previewWrap.innerHTML = ''; previewWrap.style.display = 'none'; }

  try {
    const preview = await mod.convertFile({ file: pendingConverterFile, productId });
    mod.setConverterStatus(`Converted via ${preview.via}. Review the preview below.`, 'success');
    if (previewWrap) mod.renderPreview(previewWrap, preview);
    // Clear file input after successful convert so re-selecting same file fires change
    const fileInput = getEl('converterFileInput');
    if (fileInput) fileInput.value = '';
    logger.info('upload.converter: converted', preview.via, preview.canonicalCsv ? `${preview.canonicalCsv.length} chars` : 'no csv');
  } catch (err) {
    logger.error('upload.converter: convert failed', err);
    mod.setConverterStatus(err.message || 'Conversion failed', 'error');
  } finally {
    converterBusy = false;
    if (convertBtn) convertBtn.textContent = 'Convert';
    updateConverterConvertBtn();
  }
}

function bindConverterControls() {
  const fileInput = getEl('converterFileInput');
  const productPicker = getEl('converterProductPicker');
  const convertBtn = getEl('converterConvertBtn');
  const statusEl = getEl('converterStatus');

  // No converter card in DOM (e.g. old HTML) → no-op
  if (!fileInput || !convertBtn) return;

  // Load agent eagerly so preview styles/helpers are ready on first click
  void loadConverterAgent();

  fileInput.addEventListener('click', () => {
    if (statusEl && !converterBusy) {
      statusEl.textContent = 'Select a file…';
      statusEl.className = 'upload-status';
    }
  });

  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0] || null;
    pendingConverterFile = file || null;
    const previewWrap = getEl('converterPreviewWrap');
    if (!file) {
      if (statusEl) statusEl.textContent = 'No file chosen. Select a file above and click Convert.';
      if (previewWrap) { previewWrap.innerHTML = ''; previewWrap.style.display = 'none'; }
      updateConverterConvertBtn();
      return;
    }
    const mod = await loadConverterAgent();
    if (mod) {
      const validation = mod.validateConverterFile(file);
      if (validation) {
        mod.setConverterStatus(validation, 'error');
        updateConverterConvertBtn();
        return;
      }
      mod.setConverterStatus(`Ready: ${file.name} (${(file.size / 1024).toFixed(1)} KB) — click Convert.`, null);
      if (previewWrap) { previewWrap.innerHTML = ''; previewWrap.style.display = 'none'; }
    } else if (statusEl) {
      statusEl.textContent = `Ready: ${file.name} — click Convert.`;
    }
    updateConverterConvertBtn();
    // Keyboard: focus Convert button for quick action
    requestAnimationFrame(() => convertBtn.focus({ preventScroll: true }));
  });

  convertBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    void runConverterConvert();
  });

  // Keyboard: Enter in product picker triggers convert
  if (productPicker) {
    productPicker.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        void runConverterConvert();
      }
    });
  }

  // Repacked event from converter agent → update verification table + status
  window.addEventListener('converter:repacked', (e) => {
    const detail = e.detail || {};
    const scheduleProjects = detail.scheduleProjects || detail.projects || [];
    const projects = detail.projects || [];
    try {
      // Reflect in main upload status as well
      const uploadStatus = getEl('uploadStatus');
      if (uploadStatus) {
        uploadStatus.textContent = `${projects.length} rows converted → ${scheduleProjects.length} committed projects ready. Verify below or open Schedule.`;
        uploadStatus.className = 'upload-status success';
      }
      // Render verification table from committed set
      const listToRender = scheduleProjects.length ? scheduleProjects : projects;
      if (listToRender.length) {
        renderUploadTable(listToRender);
        const wrap = getEl('uploadTableWrap');
        if (wrap) {
          wrap.style.display = 'block';
          wrap.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        showExportRow();
        showUploadSubmitRow();
      }
    } catch (err) {
      logger.error('upload.converter: repacked handler', err);
    }
  });
}

function bindControls() {
  const fileInput = getEl('csvFileInput');
  const uploadStatus = getEl('uploadStatus');
  const uploadSubmitBtn = getEl('uploadSubmitBtn');
  const exportJsonBtn = getEl('exportJsonBtn');

  if (fileInput && uploadStatus) {
    fileInput.addEventListener('click', () => {
      uploadStatus.textContent = 'Select a file…';
      uploadStatus.className = 'upload-status';
    });
    const onFileChosen = (e) => {
      const file = e.target.files?.[0];
      if (!file) {
        uploadStatus.textContent = 'No file chosen. Select a .csv, .xlsx, or .json file above.';
        return;
      }
      uploadStatus.textContent = 'Loading…';
      uploadStatus.className = 'upload-status';
      void handleFile(file);
    };
    fileInput.addEventListener('change', onFileChosen);
    fileInput.addEventListener('input', onFileChosen);
  }

  if (uploadSubmitBtn) {
    uploadSubmitBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      try {
        const hasPending = pendingUploadProjects && pendingUploadProjects.length > 0;
        const hasSaved = getProjects().length > 0;
        if (!hasPending && !hasSaved) {
          if (uploadStatus) {
            uploadStatus.textContent = 'Select a CSV, XLSX, or JSON file above first.';
            uploadStatus.className = 'upload-status error';
          }
          return;
        }
        if (uploadStatus) {
          uploadStatus.textContent = 'Submitting…';
          uploadStatus.className = 'upload-status';
        }
        runUploadSubmit();
      } catch (err) {
        logger.error('upload.submit click error', err);
        if (uploadStatus) {
          uploadStatus.textContent = 'Submit failed: ' + (err && err.message ? err.message : String(err));
          uploadStatus.className = 'upload-status error';
        }
      }
    });
  }

  if (exportJsonBtn) {
    exportJsonBtn.addEventListener('click', () => {
      const projects = getProjects();
      if (!projects || projects.length === 0) return;
      const blob = new Blob([JSON.stringify(projects, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'projects.json';
      a.click();
      URL.revokeObjectURL(url);
      logger.debug('upload.export: downloaded projects.json');
    });
  }
}

function renderEmptyState() {
  const uploadStatus = getEl('uploadStatus');
  const wrap = getEl('uploadTableWrap');
  let displayName = null;
  let countTxt = '';
  try {
    const rawActive = localStorage.getItem('ndb-active-release');
    const rawRegs = localStorage.getItem('ndb-releases-registry');
    if (rawRegs) {
      const regs = JSON.parse(rawRegs);
      const active = regs.find((r) => r.id === rawActive);
      displayName = active ? active.name : (regs[0]?.name || null);
      countTxt = regs.length ? ` — ${regs.length} release${regs.length!==1?'s':''} kept` : '';
    }
  } catch (_) {}
  if (uploadStatus) {
    if (displayName) uploadStatus.textContent = `No projects in Active: ${displayName}${countTxt} — Upload a CSV above to start. Old releases are kept; switch via the Release bar.`;
    else uploadStatus.textContent = 'No project data. Upload a CSV, XLSX, or JSON above, or add data/projects.json and reload.';
    uploadStatus.className = 'upload-status';
  }
  if (wrap) wrap.style.display = 'none';
}

/**
 * On load: if we have projects in state, show export and optionally table.
 */
function init() {
  const uploadStatus = getEl('uploadStatus');
  try {
    bindControls();
    bindConverterControls();
    const projects = getProjects();
    if (projects.length > 0) {
      showExportRow();
      showUploadSubmitRow();
      renderUploadTable(projects);
      const wrap = getEl('uploadTableWrap');
      if (wrap) wrap.style.display = 'block';
    } else {
      renderEmptyState();
      showExportRow();
      showUploadSubmitRow();
    }
  } catch (err) {
    logger.error('upload.init', err);
    if (uploadStatus) {
      uploadStatus.textContent = 'Page error: ' + (err && err.message ? err.message : String(err));
      uploadStatus.className = 'upload-status error';
    }
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
