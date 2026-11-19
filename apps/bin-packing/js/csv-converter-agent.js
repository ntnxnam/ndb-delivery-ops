/**
 * csv-converter-agent — "Convert any file (AI)" flow for the upload page.
 *
 * Responsibilities (minimal-architecture: JS module as service layer):
 *   - file → base64 (handles both text and binary, incl. XLSX/PDF/DOCX)
 *   - POST to /api/bin-packing/convert (preferred) with fallback to /api/ai/chat
 *   - derive origin without hardcoded localhost (window.location.origin + path)
 *   - preview model: { originalHeaders, mappedHeaders, stats, warnings, canonicalCsv, rows }
 *   - preview render: two tables + stats + warnings + CTA (Download CSV, Replace & Repack)
 *   - Replace & Repack: rowsToProjects → setProjects / setScheduleData → callback
 *
 * The caller (upload.js) owns DOM wiring; this module owns fetch + transform + preview render.
 * @module csv-converter-agent
 */

import { getEl, escapeHtml } from './utils.js';
import { logger } from './logger.js';

// eslint-disable-next-line import/no-unresolved
// rowsToProjects/parseCSV are lazy-imported to avoid circular init if not used
// but we import statically as they are needed for Replace & Repack.

// ── Constants ─────────────────────────────────────────────────────────

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB guard

/** Mandatory canonical columns (mirrors shared/src/services/productColumnAliases.ts). */
export const MANDATORY_CANONICALS = ['FEAT NUMBER', 'SUMMARY'];

/** Full canonical header list in Sheet1 order (26 cols). */
export const CANONICAL_HEADERS = [
  'Sl No',
  'FEAT NUMBER',
  'SUMMARY',
  'Priority',
  'STATUS',
  'How much of this is Completed in % (do not add %, just put a number)',
  '3.0 Commitment Status',
  'Target Month',
  'Comment',
  'DRI',
  'Total Months Needed for 1 person by Dev (Everything from start to finish)',
  'Dev Resources required for max parallization',
  'Dev Resources required for max parallization and 60% productivity',
  'Num of QA required(rule: 3:1, 1 QA for 3 dev)',
  'Num of QA required(rule: 3:1, 1 QA for 3 dev) with 60% productivity',
  'Number of Months (Dev)',
  'Total resources required',
  'sizing (refer sheet 2 for guidance)',
  'Additional Resources',
  'Sizing Comment',
  'Dependency Numbers (Comma Separated List)',
  'DEPENDENCY',
  'One line dependency description',
  'Resourcing done?',
  'Any new software needed?',
  'Comments',
];

// ── Origin helpers (no hardcoded localhost) ───────────────────────────

export function getApiOrigin() {
  if (typeof window === 'undefined' || !window.location) return '';
  // window.location.origin works in both prod and dev; no localhost literal needed.
  // In dev the hostname is localhost/127.0.0.1 but origin still resolves correctly
  // via whatever host the page was loaded from (covers port 3847 vs 8001 cases).
  return window.location.origin || `${window.location.protocol}//${window.location.host}`;
}

export function getConvertUrl() {
  return `${getApiOrigin()}/api/bin-packing/convert`;
}

export function getAiChatUrl() {
  return `${getApiOrigin()}/api/ai/chat`;
}

function getJiraAuthHeaders() {
  const headers = {};
  try {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('jiraToken') : null;
    if (token) headers.Authorization = `Bearer ${token}`;
    const username = typeof localStorage !== 'undefined'
      ? (localStorage.getItem('username') || localStorage.getItem('userEmail'))
      : null;
    if (username) {
      const norm = String(username).trim().toLowerCase().split('@')[0];
      if (norm) {
        headers['X-Username'] = norm;
        headers['X-User-Email'] = `${norm}@nutanix.com`;
      }
    }
  } catch (_) { /* ignore */ }
  return headers;
}

// ── File → base64 ─────────────────────────────────────────────────────

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('FileReader did not return a data URL'));
        return;
      }
      // data:<mime>;base64,<payload>
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error(reader.error ? reader.error.message : 'File read failed'));
    reader.readAsDataURL(file);
  });
}

// ── Server convert attempt (preferred) ────────────────────────────────

async function tryServerConvert({ file, productId, base64 }) {
  const url = getConvertUrl();
  // Prefer multipart FormData (streaming, 10 MB guard, no b64 overhead). Server also accepts JSON.
  let res;
  try {
    const form = new FormData();
    form.append('file', file, file.name || 'upload');
    form.append('productId', productId || 'ndb');
    res = await fetch(url, {
      method: 'POST',
      headers: { ...getJiraAuthHeaders() },
      body: form,
    });
  } catch (formErr) {
    const payload = {
      filename: file.name || 'upload',
      contentBase64: base64,
      mimeType: file.type || 'application/octet-stream',
      productId: productId || 'ndb',
    };
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getJiraAuthHeaders() },
      body: JSON.stringify(payload),
    });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try { const j = JSON.parse(text); detail = j.error || j.message || text; } catch (_) { /* use text */ }
    const err = new Error(detail || `Server convert failed (${res.status})`);
    err.status = res.status;
    err.isNotFound = res.status === 404;
    throw err;
  }
  const data = await res.json();
  return data;
}

// ── Fallback: /api/ai/chat with convert_to_binpacking_csv tool ───────

async function fallbackViaAiChat({ file, productId, base64 }) {
  const url = getAiChatUrl();
  const message = [
    `Convert this file to bin-packing canonical CSV.`,
    `Product: ${productId || 'ndb'}`,
    `Filename: ${file.name || 'upload'}`,
    `MIME: ${file.type || 'application/octet-stream'}`,
    `Content (base64, truncated preview not needed — full payload in context):`,
    `Use the convert_to_binpacking_csv tool with the provided file.`,
  ].join('\n');

  // We send the base64 in a structured attachment field that the agent runtime
  // can pick up; if the server does not yet support attachments, include a hint.
  const body = {
    message,
    // Structured payload for tool routing — server may ignore unknown fields
    attachments: [{ filename: file.name, mimeType: file.type, contentBase64: base64 }],
    // Also include explicit routing hint
    toolHint: 'convert_to_binpacking_csv',
    productId: productId || 'ndb',
    filename: file.name,
    contentBase64: base64,
    audience: 'tpm',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getJiraAuthHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let detail = text;
    try { const j = JSON.parse(text); detail = j.error || j.message || text; } catch (_) { /* use text */ }
    throw new Error(detail || `AI chat fallback failed (${res.status})`);
  }
  const data = await res.json();
  // AI chat returns { reply, trace, ... } — extract structuredContent if present
  // Trace entries may carry tool output with CSV
  if (data.structuredContent && (data.structuredContent.canonicalCsv || data.structuredContent.rows)) {
    return data.structuredContent;
  }
  // Try to find CSV in trace tool outputs
  if (Array.isArray(data.trace)) {
    for (const entry of data.trace) {
      const sc = entry.structuredContent || entry.output;
      if (sc && (sc.canonicalCsv || sc.rows || sc.csv)) {
        return {
          canonicalCsv: sc.canonicalCsv || sc.csv || '',
          rows: sc.rows || null,
          originalHeaders: sc.originalHeaders || null,
          mappedHeaders: sc.mappedHeaders || sc.canonicalHeaders || null,
          warnings: sc.warnings || [],
          stats: sc.stats || null,
        };
      }
    }
  }
  // Last resort: treat reply text as CSV if it looks like one
  if (typeof data.reply === 'string' && data.reply.includes(',')) {
    return { canonicalCsv: data.reply, rows: null, warnings: [], originalHeaders: null, mappedHeaders: null };
  }
  throw new Error(data.reply || 'AI fallback returned no convertible content');
}

// ── Public: convert file → preview model ──────────────────────────────

export async function convertFile({ file, productId }) {
  if (!file) throw new Error('No file provided');
  if (file.size > MAX_FILE_BYTES) {
    throw new Error(`File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max ${MAX_FILE_BYTES / 1024 / 1024} MB.`);
  }
  const base64 = await fileToBase64(file);
  let raw;
  let via = 'server';
  try {
    raw = await tryServerConvert({ file, productId, base64 });
  } catch (err) {
    // Only fallback on 404 / 501 / network failure; surface other errors directly
    const shouldFallback = err.isNotFound || err.status === 501 || err.message.includes('Failed to fetch') || err.message.includes('NetworkError');
    if (!shouldFallback) throw err;
    logger.info('csv-converter-agent: server route unavailable, falling back to AI chat', err.message);
    via = 'ai-chat';
    raw = await fallbackViaAiChat({ file, productId, base64 });
  }

  // Normalize response shape across server / AI paths
  const canonicalCsv = raw.canonicalCsv || raw.csv || '';
  const rows = raw.rows || null;
  const originalHeaders = raw.originalHeaders || (rows && rows[0] ? rows[0] : null) || null;
  const mappedHeaders = raw.mappedHeaders || raw.canonicalHeaders || null;
  const warnings = Array.isArray(raw.warnings) ? raw.warnings : [];
  const stats = raw.stats || null;
  const error = raw.error || null;

  if (error && !canonicalCsv && !rows) throw new Error(error);

  return {
    via,
    canonicalCsv,
    rows,
    originalHeaders,
    mappedHeaders,
    warnings,
    stats,
    error,
    raw,
  };
}

// ── Preview helpers ───────────────────────────────────────────────────

/**
 * Derive header mapping status for preview coloring.
 * Returns array of { header, canonical, status: 'mapped'|'unmapped'|'missing' }.
 */
export function deriveHeaderMapping(originalHeaders, mappedHeaders) {
  if (!originalHeaders || !originalHeaders.length) return [];
  const canonicalSet = new Set(CANONICAL_HEADERS.map((h) => h.toLowerCase()));
  const mandatorySet = new Set(MANDATORY_CANONICALS.map((h) => h.toLowerCase()));
  const mappedSet = new Set((mappedHeaders || []).map((h) => String(h || '').trim().toLowerCase()).filter(Boolean));

  return originalHeaders.map((h) => {
    const norm = String(h || '').trim();
    const lower = norm.toLowerCase();
    const isCanonical = canonicalSet.has(lower);
    const isMapped = mappedSet.has(lower) || isCanonical;
    if (mandatorySet.has(lower) && !isMapped) {
      // Mandatory header appears in original but not in mapped — should not happen; flag as mapped if present
      return { header: norm, canonical: norm, status: 'mapped' };
    }
    if (isMapped) return { header: norm, canonical: norm, status: 'mapped' };
    // Non-canonical header not mapped to any canonical
    return { header: norm, canonical: null, status: 'unmapped' };
  });
}

function missingRequiredHeaders(mappedHeaders) {
  if (!mappedHeaders || !mappedHeaders.length) return [...MANDATORY_CANONICALS];
  const mappedSet = new Set(mappedHeaders.map((h) => String(h || '').trim().toLowerCase()).filter(Boolean));
  return MANDATORY_CANONICALS.filter((req) => !mappedSet.has(req.toLowerCase()));
}

// ── Preview render (DOM) ──────────────────────────────────────────────

function headerCellClass(status) {
  if (status === 'mapped') return 'converter-header-cell converter-header--mapped';
  if (status === 'unmapped') return 'converter-header-cell converter-header--unmapped';
  return 'converter-header-cell converter-header--missing';
}

function buildHeaderRow(cells, getCellClass) {
  const tr = document.createElement('tr');
  cells.forEach((cell) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.className = typeof getCellClass === 'function' ? getCellClass(cell) : 'converter-header-cell';
    th.textContent = typeof cell === 'string' ? cell : (cell.header || String(cell));
    if (cell && cell.canonical) th.title = `→ ${cell.canonical}`;
    tr.appendChild(th);
  });
  return tr;
}

export function renderPreview(container, preview) {
  if (!container) return;
  const { originalHeaders, mappedHeaders, canonicalCsv, rows, warnings, stats, via } = preview;

  const original = originalHeaders || (rows && rows[0] ? rows[0] : []);
  const mapped = mappedHeaders || CANONICAL_HEADERS;
  const derivedStats = stats || {
    rows: rows ? Math.max(0, rows.length - 1) : (canonicalCsv ? canonicalCsv.split('\n').length - 1 : 0),
    cols: original.length || 0,
    mappedCols: mapped.filter((h) => h && String(h).trim()).length,
  };
  const derivedWarnings = warnings || [];
  const missing = missingRequiredHeaders(mappedHeaders || mapped);
  const headerMapping = deriveHeaderMapping(original, mappedHeaders || mapped);

  container.innerHTML = '';
  container.style.display = 'block';

  // Stats row
  const statsEl = document.createElement('div');
  statsEl.className = 'converter-stats';
  statsEl.setAttribute('role', 'status');
  const viaLabel = via === 'ai-chat' ? 'via AI chat' : 'via server';
  statsEl.innerHTML = `
    <span class="converter-stat"><strong>${escapeHtml(String(derivedStats.rows ?? 0))}</strong> rows</span>
    <span class="converter-stat"><strong>${escapeHtml(String(derivedStats.cols ?? 0))}</strong> cols</span>
    <span class="converter-stat"><strong>${escapeHtml(String(derivedStats.mappedCols ?? 0))}</strong> mapped cols</span>
    <span class="converter-stat converter-stat--via">${escapeHtml(viaLabel)}</span>
  `;
  container.appendChild(statsEl);

  // Original headers table
  if (original.length) {
    const origWrap = document.createElement('div');
    origWrap.className = 'converter-table-wrap';
    const origTitle = document.createElement('h4');
    origTitle.className = 'converter-table-title';
    origTitle.textContent = 'Original headers (raw)';
    origWrap.appendChild(origTitle);
    const origTable = document.createElement('table');
    origTable.className = 'converter-headers-table';
    const origThead = document.createElement('thead');
    origThead.appendChild(buildHeaderRow(headerMapping, (cell) => headerCellClass(cell.status)));
    origTable.appendChild(origThead);
    const origLegend = document.createElement('div');
    origLegend.className = 'converter-legend';
    origLegend.innerHTML = `
      <span class="converter-legend-item"><span class="converter-dot converter-dot--mapped"></span> mapped</span>
      <span class="converter-legend-item"><span class="converter-dot converter-dot--unmapped"></span> unmapped</span>
      <span class="converter-legend-item"><span class="converter-dot converter-dot--missing"></span> missing required</span>
    `;
    origWrap.appendChild(origTable);
    origWrap.appendChild(origLegend);
    container.appendChild(origWrap);
  }

  // Mapped canonical headers table
  if (mapped.length) {
    const mapWrap = document.createElement('div');
    mapWrap.className = 'converter-table-wrap';
    const mapTitle = document.createElement('h4');
    mapTitle.className = 'converter-table-title';
    mapTitle.textContent = 'Mapped canonical headers';
    mapWrap.appendChild(mapTitle);
    const mapTable = document.createElement('table');
    mapTable.className = 'converter-headers-table';
    const mapThead = document.createElement('thead');
    const canonicalSet = new Set(CANONICAL_HEADERS.map((h) => h.toLowerCase()));
    const mandatorySet = new Set(MANDATORY_CANONICALS.map((h) => h.toLowerCase()));
    mapThead.appendChild(buildHeaderRow(mapped, (h) => {
      const lower = String(h || '').trim().toLowerCase();
      if (!h || !String(h).trim()) return 'converter-header-cell converter-header--missing';
      if (mandatorySet.has(lower)) return 'converter-header-cell converter-header--mapped converter-header--mandatory';
      if (canonicalSet.has(lower)) return 'converter-header-cell converter-header--mapped';
      return 'converter-header-cell converter-header--unmapped';
    }));
    mapTable.appendChild(mapThead);
    mapWrap.appendChild(mapTable);
    container.appendChild(mapWrap);
  }

  // Missing required warning
  if (missing.length) {
    const missEl = document.createElement('div');
    missEl.className = 'converter-missing';
    missEl.setAttribute('role', 'alert');
    missEl.innerHTML = `<strong>Missing required:</strong> ${missing.map((m) => `<code>${escapeHtml(m)}</code>`).join(', ')}`;
    container.appendChild(missEl);
  }

  // Warnings list
  if (derivedWarnings.length) {
    const warnWrap = document.createElement('div');
    warnWrap.className = 'converter-warnings';
    const warnTitle = document.createElement('h4');
    warnTitle.className = 'converter-warnings-title';
    warnTitle.textContent = 'Warnings';
    warnWrap.appendChild(warnTitle);
    const ul = document.createElement('ul');
    ul.className = 'converter-warnings-list';
    derivedWarnings.forEach((w) => {
      const li = document.createElement('li');
      li.textContent = String(w);
      ul.appendChild(li);
    });
    warnWrap.appendChild(ul);
    container.appendChild(warnWrap);
  }

  // CTA buttons
  const ctaRow = document.createElement('div');
  ctaRow.className = 'converter-cta-row';
  ctaRow.innerHTML = `
    <button type="button" id="converterDownloadBtn" class="btn-submit">Download CSV</button>
    <button type="button" id="converterRepackBtn" class="btn-export">Replace &amp; Repack</button>
  `;
  container.appendChild(ctaRow);

  // Wire Download
  const dlBtn = ctaRow.querySelector('#converterDownloadBtn');
  if (dlBtn) {
    dlBtn.addEventListener('click', () => handleDownloadCsv(preview));
  }

  // Wire Replace & Repack — delegate to caller via custom event + direct fallback
  const repackBtn = ctaRow.querySelector('#converterRepackBtn');
  if (repackBtn) {
    if (missing.length) {
      repackBtn.disabled = true;
      repackBtn.title = `Missing required columns: ${missing.join(', ')}`;
      repackBtn.setAttribute('aria-disabled', 'true');
    } else {
      repackBtn.addEventListener('click', () => handleReplaceAndRepack(preview));
    }
  }
}

function handleDownloadCsv(preview) {
  const csv = preview.canonicalCsv || '';
  if (!csv) {
    logger.warn('converter: no canonicalCsv to download');
    return;
  }
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'converted-binpacking.csv';
  a.click();
  URL.revokeObjectURL(url);
  logger.info('converter: downloaded converted CSV');
}

async function handleReplaceAndRepack(preview) {
  const statusEl = getEl('converterStatus');
  try {
    if (statusEl) {
      statusEl.textContent = 'Applying converted data…';
      statusEl.className = 'upload-status';
    }

    // Resolve rows: prefer preview.rows (already parsed), else parse canonicalCsv
    let rows = preview.rows || null;
    if (!rows && preview.canonicalCsv) {
      const { parseCSV } = await import('./csv-parser.js');
      rows = parseCSV(preview.canonicalCsv);
    }
    if (!rows || rows.length < 2) throw new Error('Converted data has no rows to apply');

    const { rowsToProjects } = await import('./csv-parser.js');
    const { setProjects, setScheduleData, clearAllOverrides } = await import('./state.js');
    const { prepareScheduleData } = await import('./prepare-schedule.js');

    const out = rowsToProjects(rows);
    if (out.error) throw new Error(out.error);
    const projects = out.projects;
    if (!projects.length) throw new Error('No projects after conversion');

    // Persist via same path as normal upload → Repack
    clearAllOverrides();
    setProjects(projects);
    const { projects: scheduleProjects } = prepareScheduleData(projects);
    setScheduleData(scheduleProjects);

    if (statusEl) {
      statusEl.textContent = `Replaced with ${projects.length} projects (${scheduleProjects.length} committed). Review below or open Schedule.`;
      statusEl.className = 'upload-status success';
    }

    // Dispatch event so upload.js can re-render verification table without tight coupling
    window.dispatchEvent(new CustomEvent('converter:repacked', { detail: { projects, scheduleProjects } }));

    // Fallback: if no listener, render a minimal success notice in preview area
    // The upload.js listener will handle table rendering; this is just for standalone robustness
    logger.info('converter: repacked', projects.length, 'projects');
  } catch (err) {
    logger.error('converter: repack failed', err);
    if (statusEl) {
      statusEl.textContent = `Repack failed: ${err.message}`;
      statusEl.className = 'upload-status error';
    }
  }
}

// ── Status helpers ──────────────────────────────────────────────────

export function setConverterStatus(message, kind) {
  const el = getEl('converterStatus');
  if (!el) return;
  el.textContent = message;
  el.className = kind === 'error' ? 'upload-status error' : kind === 'success' ? 'upload-status success' : 'upload-status';
}

export function clearConverterPreview() {
  const wrap = getEl('converterPreviewWrap');
  if (wrap) { wrap.innerHTML = ''; wrap.style.display = 'none'; }
}

// ── File validation ─────────────────────────────────────────────────

export function validateConverterFile(file) {
  if (!file) return 'No file selected';
  if (file.size === 0) return 'File is empty';
  if (file.size > MAX_FILE_BYTES) return `File too large (${(file.size / 1024 / 1024).toFixed(1)} MB). Max 10 MB.`;
  return null;
}
