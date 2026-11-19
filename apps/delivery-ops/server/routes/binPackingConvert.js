/**
 * binPackingConvert — POST /api/bin-packing/convert
 *
 * Multipart file→CSV conversion for bin-packing ingest.
 * Validates file presence, size (≤10 MB), MIME allowlist, and productId.
 * Delegates to shared/src/services/csvConverterService when compiled;
 * otherwise uses inline fallback (TODO: remove fallback once shared/dist ships csvConverterService).
 *
 * Security: temp dir via mkdtemp(os.tmpdir()/binpacking-convert-<uuid>/), cleanup in finally,
 * no writes outside tmp, no code exec from upload dir. Python extractors placeholder uses -I from isolated dir.
 */
'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const crypto = require('crypto');

const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { apiLimiter } = require('../middleware/security');

const router = express.Router();

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_PRODUCT_IDS = new Set(['ndb', 'datalens', 'generic']);
const ALLOWED_MIMES = new Set([
  'text/csv',
  'application/csv',
  'text/plain',
  'text/comma-separated-values',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  // Some browsers/clients send generic binary for xlsx/csv
  'application/octet-stream',
]);

const ALLOWED_EXTS = new Set(['.csv', '.xlsx', '.xls']);

// ── Shared service resolution (with inline fallback) ────────────────────────
// TODO(W-xxx): remove inline fallback once shared/dist is re-exported via
// shared/src/index.ts and consumed solely via the sharedAvailable path below.
// Owner: @portfolio-delivery-ops/shared maintainers. Fallback duplicates alias
// mapping in shared/src/services/productColumnAliases.ts to keep the route
// functional until the next shared build — do not extend it.

let CsvConverterService = null;
let sharedAvailable = false;
try {
  // Compiled shared dist (preferred — single source of truth).
  // eslint-disable-next-line import/no-unresolved, global-require
  const maybe = require('../../../../shared/dist/services/csvConverterService.js');
  if (maybe && maybe.CsvConverterService) {
    CsvConverterService = maybe.CsvConverterService;
    sharedAvailable = true;
  }
} catch (_e) {
  // Not compiled yet — try workspace package export below.
}
try {
  if (!CsvConverterService) {
    // Workspace package re-export (after `npm run build` in shared/).
    // eslint-disable-next-line global-require
    const sharedRoot = require('@portfolio-delivery-ops/shared');
    if (sharedRoot && sharedRoot.CsvConverterService) {
      CsvConverterService = sharedRoot.CsvConverterService;
      sharedAvailable = true;
    } else if (sharedRoot && sharedRoot.services && sharedRoot.services.CsvConverterService) {
      CsvConverterService = sharedRoot.services.CsvConverterService;
      sharedAvailable = true;
    }
  }
} catch (_e2) {
  // Not available — inline fallback below handles conversion.
}

// ── Fallback inline header-alias + CSV logic (see TODO above) ─────────────

const FALLBACK_CANONICAL_HEADERS = [
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

const FALLBACK_MANDATORY = ['FEAT NUMBER', 'SUMMARY'];

const FALLBACK_ALIASES = {
  'Sl No': ['sl no', 'sl. no', 'sl. no.', 's.no', 's. no', 'row number', '#'],
  'FEAT NUMBER': ['feat number', 'issue key', 'key', 'feat', 'feature key', 'ticket key', 'feat number'],
  SUMMARY: ['summary', 'title', 'description', 'name'],
  Priority: ['priority', 'prio', 'pri'],
  STATUS: ['status', 'state'],
  'How much of this is Completed in % (do not add %, just put a number)': [
    'how much of this is completed in % (do not add %, just put a number)',
    'progress',
    'completed %',
    'completion %',
    '% complete',
    'percent complete',
  ],
  '3.0 Commitment Status': ['3.0 commitment status', 'commitment status', 'commitment', 'commit status'],
  'Target Month': ['target month', 'target', 'due date', 'target date'],
  Comment: ['comment', 'comments', 'notes', 'remarks'],
  DRI: ['dri', 'owner', 'assignee', 'lead'],
  'Total Months Needed for 1 person by Dev (Everything from start to finish)': [
    'total months needed for 1 person by dev (everything from start to finish)',
    'total months needed for 1 person by dev',
    'total person months',
    'person months',
    'total months',
    'effort (person-months)',
  ],
  'Dev Resources required for max parallization': [
    'dev resources required for max parallization',
    'dev resources',
    'resources',
    'dev team size',
  ],
  'Dev Resources required for max parallization and 60% productivity': [
    'dev resources required for max parallization and 60% productivity',
    'dev resources (60%)',
    'resources (60%)',
  ],
  'Num of QA required(rule: 3:1, 1 QA for 3 dev)': [
    'num of qa required(rule: 3:1, 1 qa for 3 dev)',
    'num of qa required',
    'qa resources',
    'qa required',
  ],
  'Num of QA required(rule: 3:1, 1 QA for 3 dev) with 60% productivity': [
    'num of qa required(rule: 3:1, 1 qa for 3 dev) with 60% productivity',
    'qa resources (60%)',
  ],
  'Number of Months (Dev)': ['number of months (dev)', 'duration (months)', 'months (dev)', 'duration'],
  'Total resources required': ['total resources required', 'total resources', 'resources total'],
  'sizing (refer sheet 2 for guidance)': ['sizing (refer sheet 2 for guidance)', 'sizing', 'size', 't-shirt size', 'estimate'],
  'Additional Resources': ['additional resources', 'extra resources', 'other resources'],
  'Sizing Comment': ['sizing comment', 'sizing notes', 'estimate comment'],
  'Dependency Numbers (Comma Separated List)': [
    'dependency numbers (comma separated list)',
    'dependencies',
    'depends on',
    'dependency',
    'depends',
  ],
  DEPENDENCY: ['dependency', 'dependency text', 'dependency name'],
  'One line dependency description': ['one line dependency description', 'dependency description', 'dep description'],
  'Resourcing done?': ['resourcing done?', 'resourced?', 'staffed?'],
  'Any new software needed?': ['any new software needed?', 'new software?', 'infra needed?'],
  Comments: ['comments', 'extra comments', 'additional comments'],
};

function fallbackNorm(s) {
  let t = String(s ?? '').trim();
  if (t.charCodeAt(0) === 0xfeff) t = t.slice(1).trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).trim();
  return t.toLowerCase();
}

function fallbackCanonicalFor(raw) {
  const needle = fallbackNorm(raw);
  if (!needle) return null;
  for (const [canon, syns] of Object.entries(FALLBACK_ALIASES)) {
    for (const syn of syns) {
      if (fallbackNorm(syn) === needle) return canon;
    }
  }
  for (const [canon, syns] of Object.entries(FALLBACK_ALIASES)) {
    if (needle.includes(fallbackNorm(canon))) return canon;
    for (const syn of syns) {
      const ns = fallbackNorm(syn);
      if (ns.length >= 4 && needle.includes(ns)) return canon;
    }
  }
  return null;
}

function fallbackBuildHeaderIndex(headerRow) {
  const m = new Map();
  for (let i = 0; i < headerRow.length; i++) {
    const c = fallbackCanonicalFor(headerRow[i]);
    if (c && !m.has(c)) m.set(c, i);
  }
  return m;
}

function fallbackParseCSV(text) {
  const rows = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    const row = [];
    while (i < len) {
      if (text[i] === '"') {
        let cell = '';
        i++;
        while (i < len) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') { cell += '"'; i += 2; }
            else { i++; break; }
          } else { cell += text[i]; i++; }
        }
        row.push(cell);
        if (text[i] === ',') i++;
        else if (text[i] === '\n' || text[i] === '\r') {
          if (text[i] === '\r' && text[i + 1] === '\n') i += 2; else i++;
          break;
        } else if (i >= len) break;
      } else {
        let cell = '';
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') { cell += text[i]; i++; }
        row.push(cell.trim());
        if (text[i] === ',') i++;
        else { if (text[i] === '\r' && text[i + 1] === '\n') i += 2; else i++; break; }
      }
    }
    if (row.some((c) => c !== '')) rows.push(row);
  }
  return rows;
}

function fallbackEscapeCsvCell(v) {
  if (v == null) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fallbackConvert(rows, productId) {
  const started = Date.now();
  const rawHeader = rows && rows[0] ? rows[0] : [];
  const header = rawHeader.map((h) => {
    let s = String(h ?? '').trim();
    if (s.charCodeAt(0) === 0xfeff) s = s.slice(1).trim();
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
    return s;
  });
  const dataRows = rows && rows.length > 1 ? rows.slice(1) : [];

  const warnings = [];
  const skipped = [];

  if (!header.length || !dataRows.length) {
    return {
      csvText: '',
      report: {
        stats: { totalDataRows: 0, converted: 0, skipped: 0 },
        warnings: ['No header or data rows.'],
        validation: { error: 'No header or data rows.', skipped: [], invalidRows: [] },
      },
    };
  }

  const headerIdx = fallbackBuildHeaderIndex(rawHeader);
  // Generic allows any mapping — never hard-fail on alias miss; only mandatory check remains
  const isGeneric = String(productId || '').toLowerCase() === 'generic';
  if (!isGeneric) {
    for (const m of FALLBACK_MANDATORY) {
      if (!headerIdx.has(m)) warnings.push(`Mandatory column missing: "${m}"`);
    }
  } else {
    // Still warn, but don't block conversion
    for (const m of FALLBACK_MANDATORY) {
      if (!headerIdx.has(m)) warnings.push(`Mandatory column missing: "${m}" (generic: tolerated)`);
    }
  }

  const idxFor = (canon) => headerIdx.get(canon) ?? -1;

  // Build canonical CSV (always 26-col fallback header order)
  const canonicalHeader = [...FALLBACK_CANONICAL_HEADERS];
  const outRows = [canonicalHeader];
  let converted = 0;
  for (let r = 0; r < dataRows.length; r++) {
    const row = dataRows[r];
    // Skip entirely empty rows (already filtered by parse, but double-check)
    if (!row || row.every((c) => String(c ?? '').trim() === '')) {
      skipped.push({ index: r + 1, reason: 'Empty row', rawRow: row || [] });
      continue;
    }
    // Check mandatory FEAT+SUMMARY presence for counting
    const featIdx = idxFor('FEAT NUMBER');
    const sumIdx = idxFor('SUMMARY');
    const featVal = featIdx >= 0 ? String(row[featIdx] ?? '').trim() : '';
    const sumVal = sumIdx >= 0 ? String(row[sumIdx] ?? '').trim() : '';
    if (!isGeneric && !featVal && !sumVal && featIdx >= 0 && sumIdx >= 0) {
      skipped.push({ index: r + 1, reason: 'Missing FEAT NUMBER and SUMMARY', rawRow: [...row] });
      continue;
    }
    const out = [];
    for (const col of canonicalHeader) {
      const src = idxFor(col);
      out.push(src >= 0 ? (row[src] ?? '') : '');
    }
    outRows.push(out);
    converted++;
  }

  const csvText = outRows.map((r) => r.map(fallbackEscapeCsvCell).join(',')).join('\n');
  const totalDataRows = dataRows.length;

  // Mimic ConverterReport shape
  return {
    csvText,
    report: {
      stats: { totalDataRows, converted, skipped: skipped.length, durationMs: Date.now() - started },
      warnings: [
        ...warnings,
        ...(() => {
          const unmatched = header.filter((h) => !fallbackCanonicalFor(h) && String(h || '').trim() !== '');
          return unmatched.length ? [`Unrecognized headers (passed through as-is): ${unmatched.join(', ')}`] : [];
        })(),
      ],
      validation: {
        error: warnings.some((w) => w.startsWith('Mandatory column missing')) && !isGeneric ? 'Sheet must include "FEAT NUMBER" and "SUMMARY" columns.' : null,
        skipped,
        invalidRows: skipped.filter((s) => s.reason.includes('Missing')),
      },
    },
  };
}

// ── Multipart parser (no multer dependency) ─────────────────────────────────

function getBoundary(contentType) {
  if (!contentType) return null;
  const m = String(contentType).match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) return null;
  const b = (m[1] || m[2] || '').trim();
  return b || null;
}

async function parseMultipart(req, maxBytes) {
  const contentType = req.headers['content-type'] || req.headers['Content-Type'] || '';
  const boundary = getBoundary(contentType);
  if (!boundary) {
    const err = new Error('Content-Type must be multipart/form-data with boundary');
    err.status = 400;
    throw err;
  }

  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength && contentLength > maxBytes) {
    const err = new Error(`File too large. Max ${MAX_BYTES} bytes.`);
    err.status = 413;
    err.code = 'LIMIT_FILE_SIZE';
    throw err;
  }

  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > maxBytes) {
      const err = new Error(`File too large. Max ${MAX_BYTES} bytes.`);
      err.status = 413;
      err.code = 'LIMIT_FILE_SIZE';
      throw err;
    }
    chunks.push(buf);
  }
  const body = Buffer.concat(chunks);
  if (!body.length) return { file: null, fields: {} };

  const boundaryBuf = Buffer.from(`--${boundary}`);
  const endBoundaryBuf = Buffer.from(`--${boundary}--`);

  // Find all boundary positions
  const parts = [];
  let searchFrom = 0;
  const indices = [];
  while (searchFrom < body.length) {
    const idx = body.indexOf(boundaryBuf, searchFrom);
    if (idx === -1) break;
    indices.push(idx);
    searchFrom = idx + boundaryBuf.length;
  }

  const fields = {};
  let file = null;

  for (let p = 0; p < indices.length; p++) {
    const start = indices[p] + boundaryBuf.length;
    // Skip CRLF after boundary
    let partStart = start;
    if (body[partStart] === 0x0d && body[partStart + 1] === 0x0a) partStart += 2;
    else if (body[partStart] === 0x0a) partStart += 1;
    else if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) {
      // reached --boundary-- terminator
      break;
    }

    // End is next boundary start minus trailing CRLF, or body end
    let partEnd;
    if (p + 1 < indices.length) {
      partEnd = indices[p + 1];
      // Trim trailing CRLF before boundary
      if (partEnd >= 2 && body[partEnd - 2] === 0x0d && body[partEnd - 1] === 0x0a) partEnd -= 2;
      else if (partEnd >= 1 && body[partEnd - 1] === 0x0a) partEnd -= 1;
    } else {
      // Last part — look for endBoundary
      const endIdx = body.indexOf(endBoundaryBuf, partStart);
      partEnd = endIdx !== -1 ? endIdx : body.length;
      if (partEnd >= 2 && body[partEnd - 2] === 0x0d && body[partEnd - 1] === 0x0a) partEnd -= 2;
    }

    if (partEnd <= partStart) continue;
    const partBuf = body.subarray(partStart, partEnd);

    // Split headers / body at \r\n\r\n
    let headerEnd = partBuf.indexOf(Buffer.from('\r\n\r\n'));
    let headerDelimLen = 4;
    if (headerEnd === -1) {
      headerEnd = partBuf.indexOf(Buffer.from('\n\n'));
      headerDelimLen = 2;
    }
    if (headerEnd === -1) continue;

    const headerText = partBuf.subarray(0, headerEnd).toString('utf8');
    const dataBuf = partBuf.subarray(headerEnd + headerDelimLen);

    const dispMatch = headerText.match(/Content-Disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (!dispMatch) continue;
    const fieldName = dispMatch[1];
    const filename = dispMatch[2] || '';

    const typeMatch = headerText.match(/Content-Type:\s*([^\r\n;]+)/i);
    const contentTypePart = typeMatch ? typeMatch[1].trim().toLowerCase() : '';

    if (fieldName === 'file') {
      file = {
        originalname: filename,
        mimetype: contentTypePart || 'application/octet-stream',
        buffer: dataBuf,
        size: dataBuf.length,
      };
    } else {
      fields[fieldName] = dataBuf.toString('utf8').trim();
    }
  }

  return { file, fields };
}

// ── Route handler (authenticated — same pattern as ai, jiraDigging, dateMover) ──

router.post('/convert', apiLimiter, validateJiraTokenMiddleware, async (req, res) => {
  let tmpDir = null;
  try {
    let file = null;
    let productId = 'ndb';

    const ct = String(req.headers['content-type'] || '').toLowerCase();
    const isJson = ct.includes('application/json');

    if (isJson) {
      // JSON path: { filename, contentBase64, mimeType, productId } — from bodyParser (15 MB limit)
      const body = req.body || {};
      const filename = String(body.filename || body.fileName || body.originalFileName || 'upload.csv').trim() || 'upload.csv';
      const contentBase64 = body.contentBase64 || body.fileContentBase64 || body.content || '';
      const mimeType = String(body.mimeType || body.mime || '').trim() || 'application/octet-stream';
      const pidRaw = body.productId || body.product_id || '';
      productId = String(pidRaw || '').trim().toLowerCase() || 'ndb';

      if (!contentBase64 || typeof contentBase64 !== 'string') {
        return res.status(400).json({ error: 'file is required (JSON field "contentBase64")' });
      }
      let b64 = contentBase64.trim();
      const commaIdx = b64.indexOf(',');
      if (b64.startsWith('data:') && commaIdx !== -1) b64 = b64.slice(commaIdx + 1);
      const b64Clean = b64.replace(/\s/g, '');
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64Clean)) {
        return res.status(400).json({ error: 'Invalid base64 in contentBase64' });
      }
      if (b64Clean.length % 4 !== 0) {
        return res.status(400).json({ error: 'Invalid base64 in contentBase64 (length not multiple of 4)' });
      }
      const buffer = Buffer.from(b64Clean, 'base64');
      if (!buffer.length) return res.status(400).json({ error: 'file is required (decoded base64 is empty)' });
      if (buffer.length > MAX_BYTES) {
        return res.status(413).json({ error: `File too large. Max ${MAX_BYTES} bytes (${MAX_BYTES / (1024 * 1024)} MB).` });
      }
      file = { originalname: filename, mimetype: mimeType.toLowerCase(), buffer, size: buffer.length };
    } else {
      // Multipart path (primary for browser FormData)
      let parsed;
      try {
        parsed = await parseMultipart(req, MAX_BYTES);
      } catch (e) {
        if (e.status === 413 || e.code === 'LIMIT_FILE_SIZE') {
          return res.status(413).json({ error: e.message || `File too large. Max ${MAX_BYTES} bytes.` });
        }
        throw e;
      }
      file = parsed.file;
      const productIdRaw = parsed.fields.productId || parsed.fields.product_id || '';
      productId = String(productIdRaw || '').trim().toLowerCase() || 'ndb';
    }

    // ── Validations ──
    if (!file || !file.buffer || file.size === 0) {
      return res.status(400).json({ error: 'file is required (multipart field "file")' });
    }

    if (file.size > MAX_BYTES) {
      return res.status(413).json({ error: `File too large. Max ${MAX_BYTES} bytes (${MAX_BYTES / (1024 * 1024)} MB).` });
    }

    // D1 alias: 'default' historically means generic — accept and normalize.
    if (productId === 'default') productId = 'generic';
    // D1 alias: 'default' historically means generic — accept and normalize.
    if (productId === 'default') productId = 'generic';
    if (productId && !ALLOWED_PRODUCT_IDS.has(productId)) {
      return res.status(400).json({
        error: `Invalid productId "${productId}". Allowed: ${[...ALLOWED_PRODUCT_IDS].join(', ')}`,
      });
    }

    const ext = path.extname(file.originalname || '').toLowerCase();
    const mime = String(file.mimetype || '').toLowerCase().trim();

    // MIME / extension allowlist — octet-stream accepted only when extension is known.
    // If neither mime nor ext is present, allow through to content-sniff fallback below.
    if (mime && !ALLOWED_MIMES.has(mime)) {
      return res.status(422).json({
        error: `Unsupported file type "${mime}". Allowed: ${[...ALLOWED_MIMES].join(', ')}`,
      });
    }
    if (ext && !ALLOWED_EXTS.has(ext)) {
      return res.status(422).json({
        error: `Unsupported file extension "${ext}". Allowed: ${[...ALLOWED_EXTS].join(', ')}`,
      });
    }

    // ── Temp dir (os.tmpdir()/binpacking-convert-<rand>/) ──
    tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'binpacking-convert-'));
    // mkdtemp creates unique suffix; normalize to the returned dir.

    const safeName = path.basename(file.originalname || 'upload.csv') || 'upload.csv';
    const tmpFile = path.join(tmpDir, safeName);
    // Extra guard: ensure tmpFile stays inside tmpDir (path.resolve + sep hardens basename guard)
    const resolvedTmpFile = path.resolve(tmpFile);
    const resolvedTmpDir = path.resolve(tmpDir) + path.sep;
    if (!resolvedTmpFile.startsWith(resolvedTmpDir)) {
      return res.status(400).json({ error: 'Invalid file name.' });
    }
    await fsp.writeFile(tmpFile, file.buffer);

    // ── XLSX placeholder: if xlsx, signal via service; shared service handles guidance.
    // No code exec from upload dir. Python extractors (if needed) would be invoked as:
    //   spawn('python3', ['-I', path.join(isolatedExtractorDir, 'extract.py'), tmpFile])
    // where isolatedExtractorDir is a separate mkdtemp outside the upload dir, with -I to ignore user site.
    // Current implementation delegates xlsx to shared service's guidance error.

    // ── Conversion ──
    let csvText;
    let report;

    if (CsvConverterService && sharedAvailable) {
      try {
        const svc = new CsvConverterService(productId);
        const { result, report: svcReport } = svc.convertFile(tmpFile, productId);
        if (svcReport && svcReport.error && !result.canonicalCsv) {
          // Surface as validation error (e.g. xlsx guidance, missing mandatory cols)
          // For missing mandatory cols we return 400; for xlsx unsupported we return 422 if mime indicates xlsx
          const isXlsx = ext === '.xlsx' || ext === '.xls' || mime.includes('spreadsheetml') || mime.includes('ms-excel');
          if (isXlsx && svcReport.error.toLowerCase().includes('xlsx')) {
            return res.status(422).json({ error: svcReport.error, productId, originalFileName: file.originalname });
          }
          // Missing mandatory -> 400
          if (svcReport.error.toLowerCase().includes('feat number') || svcReport.error.toLowerCase().includes('summary')) {
            return res.status(400).json({ error: svcReport.error, productId, originalFileName: file.originalname });
          }
        }
        csvText = result.canonicalCsv;
        report = {
          stats: {
            totalDataRows: svcReport.totalDataRows,
            converted: svcReport.converted,
            skipped: Array.isArray(svcReport.skipped) ? svcReport.skipped.length : 0,
            durationMs: svcReport.durationMs,
          },
          warnings: svcReport.warnings || [],
          validation: {
            error: svcReport.error || result.error || null,
            skipped: svcReport.skipped || [],
            invalidRows: svcReport.invalidRows || [],
          },
          // Preserve full report for debugging
          _raw: undefined,
        };
        // Attach fileType/productId for observability
        report.fileType = svcReport.fileType;
      } catch (e) {
        // Fall through to fallback
        const msg = e && e.message ? e.message : String(e);
        // Use fallback instead of failing
        const fallback = fallbackConvert(fallbackParseCSV(file.buffer.toString('utf8')), productId);
        csvText = fallback.csvText;
        report = { ...fallback.report, fallbackError: msg, fallbackUsed: true };
      }
    } else {
      // Inline fallback (see TODO at top of file) — duplicates shared alias mapping
      const text = file.buffer.toString('utf8');
      // Quick xlsx magic sniff: PK\x03\x04 zip header
      const isXlsxMagic = file.buffer[0] === 0x50 && file.buffer[1] === 0x4b;
      if ((ext === '.xlsx' || ext === '.xls' || isXlsxMagic) && !text.trim().startsWith('Sl No')) {
        // Heuristic: binary xlsx without extractor
        // Return 422 with guidance, matching shared service behavior
        return res.status(422).json({
          error:
            'XLSX extraction requires a browser or isolated extractor (SheetJS CDN / python -I). ' +
            'Convert XLSX to CSV first or use extractRawRowsFromBuffer() with pre-extracted rows.',
          productId,
          originalFileName: file.originalname,
        });
      }
      const rows = fallbackParseCSV(text);
      const fallback = fallbackConvert(rows, productId);
      if (fallback.report.validation.error) {
        return res.status(400).json({
          error: fallback.report.validation.error,
          productId,
          originalFileName: file.originalname,
          report: fallback.report,
        });
      }
      csvText = fallback.csvText;
      report = fallback.report;
    }

    // csvText may be empty only on error (handled above); still guard
    if (csvText == null) {
      return res.status(400).json({ error: 'Conversion produced no output.', productId, originalFileName: file.originalname });
    }

    return res.status(200).json({
      csvText,
      report,
      productId,
      originalFileName: file.originalname,
    });
  } catch (err) {
    // File too large already handled; remaining errors -> 400 or 500
    if (err && (err.status === 413 || err.code === 'LIMIT_FILE_SIZE')) {
      return res.status(413).json({ error: err.message || `File too large. Max ${MAX_BYTES} bytes.` });
    }
    if (err && err.status === 422) {
      return res.status(422).json({ error: err.message || 'Unsupported file type.' });
    }
    if (err && err.status === 400) {
      return res.status(400).json({ error: err.message || 'Bad request.' });
    }
    const msg = err && err.message ? err.message : String(err);
    return res.status(500).json({ error: msg || 'Conversion failed.' });
  } finally {
    if (tmpDir) {
      try {
        await fsp.rm(tmpDir, { recursive: true, force: true });
      } catch (_e) {
        // best-effort cleanup
      }
    }
  }
});

module.exports = router;
