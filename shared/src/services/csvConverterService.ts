/**
 * csvConverterService — shared bin-packing CSV conversion (D1 product-agnostic).
 *
 * Wraps deterministic logic from apps/bin-packing/js/{csv-parser,sizing,resource-groups}
 * without reimplementing parsers. Provides:
 *   - detectFileType        (extension + magic sniff)
 *   - extractRawRows        (CSV/XLSX via absolute path; isolated temp for XLSX)
 *   - normalizeHeaders      (alias-aware via productColumnAliases)
 *   - validateViaRowsToProjects (port of csv-parser rowsToProjects — duration priority,
 *                                dep syntax, 9000+index fallback)
 *   - convertToCanonicalCsv (canonical Sheet1 header output)
 *   - generateReport        (counts, skipped, warnings)
 *
 * Security: never exec from upload dir; reads via absolute path; Python extractors
 * with -I from isolated mkdtemp (for future XLSX extraction if needed).
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { SIZING_MONTHS, sizingToMonths } from '../constants/binPackingSizing.js';
import {
  buildHeaderIndex,
  canonicalHeaderFor,
  CANONICAL_HEADERS,
  MANDATORY_CANONICALS,
  normalizeHeaders as aliasNormalizeHeaders,
  type ColumnAliasMap,
} from './productColumnAliases.js';

// ── Types ─────────────────────────────────────────────────────────────────

export type FileType = 'csv' | 'xlsx' | 'unknown';

export interface ExtractResult {
  rows: string[][];
  error: string | null;
  fileType: FileType;
}

export interface SkippedRow {
  index: number;
  reason: string;
  rawRow: string[];
}

export interface ValidateResult {
  projects: BinPackingProject[];
  error: string | null;
  skipped: SkippedRow[];
  invalidRows: SkippedRow[];
}

export interface ConvertOptions {
  productId?: string | null;
}

export interface ConvertResult {
  canonicalCsv: string;
  projects: BinPackingProject[];
  skipped: SkippedRow[];
  error: string | null;
}

export interface ConverterReport {
  productId: string | null;
  fileType: FileType;
  canonicalHeaders: readonly string[];
  totalDataRows: number;
  converted: number;
  skipped: SkippedRow[];
  invalidRows: SkippedRow[];
  warnings: string[];
  durationMs: number;
  error: string | null;
}

export interface BinPackingProject {
  id: string;
  rowNumber: number;
  feat: string;
  summary: string;
  dri: string;
  priority: string;
  status: string;
  inProgress: boolean;
  completedPct: number;
  commitment: string;
  totalResources: number;
  qaResources: number | null;
  sizingLabel: string;
  durationMonths: number;
  dependencyRowNumbers: number[];
  dependencyDevBlockers: number[];
  dependencyRelBlockers: number[];
  totalPersonMonths: string;
  totalPersonMonthsNum: number | null;
  totalResources60: number | null;
  additionalResources: string;
  sizingComment: string;
  requestedStartDate: string | null;
  resourceGroupId?: string;
  resourceGroupName?: string;
  resourceGroupChildRows?: number[];
  isResourceGroupChild?: boolean;
  resourceGroupParentRow?: number;
  resourceGroupRole?: string;
  _pool?: unknown;
  _originalTotalResources?: number;
  _originalTotalPersonMonthsNum?: number | null;
  _originalDurationMonths?: number;
}

// ── CSV parsing (ported from apps/bin-packing/js/csv-parser.js parseCSV) ──

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let i = 0;
  const len = text.length;
  while (i < len) {
    const row: string[] = [];
    while (i < len) {
      if (text[i] === '"') {
        let cell = '';
        i++;
        while (i < len) {
          if (text[i] === '"') {
            if (text[i + 1] === '"') {
              cell += '"';
              i += 2;
            } else {
              i++;
              break;
            }
          } else {
            cell += text[i]!;
            i++;
          }
        }
        row.push(cell);
        if (text[i] === ',') i++;
        else if (text[i] === '\n' || text[i] === '\r') {
          if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
          else i++;
          break;
        } else if (i >= len) break;
      } else {
        let cell = '';
        while (i < len && text[i] !== ',' && text[i] !== '\n' && text[i] !== '\r') {
          cell += text[i]!;
          i++;
        }
        row.push(cell.trim());
        if (text[i] === ',') i++;
        else {
          if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
          else i++;
          break;
        }
      }
    }
    if (row.some((c) => c !== '')) rows.push(row);
  }
  return rows;
}

// ── Dependency parsing (csv-parser.js:73) ─────────────────────────────────

function parseDependencyNumbersAndBlockers(
  raw: string | null | undefined
): { rowNumbers: number[]; devBlockers: number[]; relBlockers: number[] } {
  if (!raw || typeof raw !== 'string') return { rowNumbers: [], devBlockers: [], relBlockers: [] };
  const rowNumbers: number[] = [];
  const devBlockers: number[] = [];
  const relBlockers: number[] = [];
  const parts = raw.split(/[,;]/);
  for (const part of parts) {
    const trimmed = part.trim();
    const numMatch = trimmed.match(/\d+/);
    if (numMatch) {
      const num = parseInt(numMatch[0]!, 10);
      rowNumbers.push(num);
      if (/\d+\s*\(\s*dev-blocker\s*\)/i.test(trimmed)) devBlockers.push(num);
      else if (/\d+\s*\(\s*rel-blocker\s*\)/i.test(trimmed)) relBlockers.push(num);
    }
  }
  return {
    rowNumbers: [...new Set(rowNumbers)],
    devBlockers: [...new Set(devBlockers)],
    relBlockers: [...new Set(relBlockers)],
  };
}

function normalizeHeaderCell(h: unknown): string {
  let s = (h != null ? String(h) : '').trim();
  if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1).trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  return s;
}

// ── Inline resource-groups port (subset of resource-groups.js) ─────────────

function monthsFromSizingBand(sizingLabel: string): number {
  const BAND: Record<string, { lower: number; mid: number; higher: number }> = {
    None: { lower: 0, mid: 0, higher: 0 },
    'XS (1 month)': { lower: 1, mid: 1, higher: 1 },
    'S (1-3 months)': { lower: 1, mid: 2, higher: 3 },
    'M (3-5 months)': { lower: 3, mid: 4, higher: 5 },
    'L (5-8 months)': { lower: 5, mid: 6, higher: 8 },
    'XL (8-13 months)': { lower: 8, mid: 10, higher: 13 },
    'XXL (13+ months)': { lower: 13, mid: 17, higher: 21 },
    '3L (21+ months)': { lower: 21, mid: 27, higher: 34 },
    '4L (34+ months)': { lower: 34, mid: 44, higher: 55 },
  };
  const band = (sizingLabel || '').trim();
  const range = BAND[band];
  if (!range) return 0;
  if (band === 'L (5-8 months)' || band === 'XL (8-13 months)') return range.mid;
  const max = (SIZING_MONTHS as Record<string, number>)[band];
  if (max == null) return 0;
  if (max <= 5) return range.lower;
  if (max >= 21) return range.higher;
  return range.mid;
}

function detectResourceGroupsInline(projects: BinPackingProject[]): void {
  for (const p of projects) {
    const rec = p as unknown as Record<string, unknown>;
    if (rec._originalTotalResources != null) {
      p.totalResources = rec._originalTotalResources as number;
      p.totalPersonMonthsNum =
        (rec._originalTotalPersonMonthsNum as number | null) ?? p.totalPersonMonthsNum;
      p.durationMonths = (rec._originalDurationMonths as number) ?? p.durationMonths;
    }
    delete rec._originalTotalResources;
    delete rec._originalTotalPersonMonthsNum;
    delete rec._originalDurationMonths;
    delete rec.resourceGroupId;
    delete rec.resourceGroupName;
    delete rec.resourceGroupChildRows;
    delete rec.isResourceGroupChild;
    delete rec.resourceGroupParentRow;
    delete rec.resourceGroupRole;
    delete rec._pool;
  }
  let lastFeatKey = '';
  const bucketByFeat = new Map<string, BinPackingProject[]>();
  for (const p of projects) {
    const featVal = (p.feat || '').trim();
    const isContinuationRow = p.rowNumber >= 9000;
    const featKey = featVal ? featVal.toLowerCase() : isContinuationRow ? lastFeatKey : '';
    if (featVal) lastFeatKey = featKey;
    if (!featKey) continue;
    if (!bucketByFeat.has(featKey)) bucketByFeat.set(featKey, []);
    bucketByFeat.get(featKey)!.push(p);
  }
  for (const [featKey, members] of bucketByFeat) {
    if (members.length < 2) continue;
    const withResources = members.filter((p) => Number(p.totalResources || 0) > 0);
    const withoutResources = members.filter((p) => Number(p.totalResources || 0) <= 0);
    const bucketName = (members[0]!.feat || '').trim() || featKey;
    const hasChildren = withoutResources.length > 0;
    const hasParent = withResources.length >= 1;
    if (hasParent && hasChildren) {
      const poolRow =
        withResources.length === 1
          ? withResources[0]!
          : withResources.reduce((a, b) =>
              Number(a.totalResources || 0) >= Number(b.totalResources || 0) ? a : b
            );
      const peers = withResources.filter((p) => p !== poolRow);
      const subProjects = [poolRow, ...withoutResources];
      const subProjectRows = subProjects.map((c) => c.rowNumber);
      const groupId = `pool-${poolRow.rowNumber}`;
      const pool = {
        totalResources: Number(poolRow.totalResources || 0),
        totalPersonMonthsNum: poolRow.totalPersonMonthsNum ?? null,
        durationMonths: poolRow.durationMonths ?? 0,
      };
      const pr = poolRow as unknown as Record<string, unknown>;
      pr._originalTotalResources = pool.totalResources;
      pr._originalTotalPersonMonthsNum = pool.totalPersonMonthsNum;
      pr._originalDurationMonths = pool.durationMonths;
      const poolRowSizingMonths = monthsFromSizingBand(poolRow.sizingLabel);
      poolRow.totalResources = 0;
      poolRow.totalPersonMonthsNum = null;
      poolRow.durationMonths = poolRowSizingMonths > 0 ? poolRowSizingMonths : (poolRow.durationMonths ?? 0);
      poolRow.resourceGroupId = groupId;
      poolRow.resourceGroupName = bucketName;
      poolRow.resourceGroupRole = 'pool-parent';
      poolRow.resourceGroupChildRows = subProjectRows.filter((r) => r !== poolRow.rowNumber);
      pr._pool = pool;
      for (const sub of withoutResources) {
        sub.resourceGroupId = groupId;
        sub.resourceGroupName = bucketName;
        sub.isResourceGroupChild = true;
        sub.resourceGroupParentRow = poolRow.rowNumber;
      }
      for (const peer of peers) {
        peer.resourceGroupId = groupId;
        peer.resourceGroupName = bucketName;
      }
    } else {
      const groupId =
        'bucket-' +
          (bucketName || featKey).replace(/\s+/g, '-').replace(/[^\w-]/g, '').slice(0, 60) ||
        `bucket-${members[0]!.rowNumber}`;
      for (const p of members) {
        p.resourceGroupId = groupId;
        p.resourceGroupName = bucketName;
      }
    }
  }
}

// ── Core row→projects port (csv-parser rowsToProjects) ──────────────────

function rowsToProjectsCore(rows: string[][], productId?: string | null): {
  projects: BinPackingProject[];
  error: string | null;
  skipped: SkippedRow[];
  invalidRows: SkippedRow[];
} {
  const skipped: SkippedRow[] = [];
  const invalidRows: SkippedRow[] = [];
  const rawHeader = rows && rows[0] ? rows[0] : [];
  const header = rawHeader.map((h) => normalizeHeaderCell(h));
  const dataRows = rows && rows.length > 1 ? rows.slice(1) : [];

  if (!header.length || !dataRows.length) {
    return { projects: [], error: 'No header or data rows.', skipped, invalidRows };
  }

  // Alias-aware header resolution via productColumnAliases (D1). Uses canonical index
  // so aliases like "Issue Key"/"Title" resolve correctly; falls back to substring
  // only for Sl No which has no canonical ambiguity.
  const headerIndex = buildHeaderIndex(rawHeader, productId ?? null);
  const idx = (canonical: string): number => headerIndex.get(canonical) ?? -1;
  const idxContains = (sub: string): number =>
    header.findIndex((h) => (h || '').trim().indexOf(sub) !== -1);

  const iSlNo = idx('Sl No') >= 0 ? idx('Sl No') : idxContains('Sl No');
  const iFirstCol = iSlNo >= 0 ? iSlNo : 0;
  const iFeat = idx('FEAT NUMBER');
  const iSummary = idx('SUMMARY');

  if (iFeat < 0 || iSummary < 0) {
    return {
      projects: [],
      error: 'Sheet must include "FEAT NUMBER" and "SUMMARY" columns. Check the header row.',
      skipped,
      invalidRows,
    };
  }

  const iPriority = idx('Priority');
  const iStatus = idx('STATUS');
  const iCommit = idx('3.0 Commitment Status');
  const iDevResources = idx('Dev Resources required for max parallization');
  const iDevResources60 = header.findIndex(
    (h) => (h || '').trim().indexOf('Dev Resources required for max parallization and 60% productivity') !== -1
  );
  const iSizing = idx('sizing (refer sheet 2 for guidance)');
  const iDri = idx('DRI');
  const iDependencyNumbers = idx('Dependency Numbers (Comma Separated List)');
  const iNumberMonthsDev = idx('Number of Months (Dev)');
  const iTotalPersonMonthsByName = idx('Total Months Needed for 1 person by Dev (Everything from start to finish)');
  const iTotalPersonMonthsStartsWith = header.findIndex(
    (h) => (h || '').trim().indexOf('Total Months Needed for 1 person by Dev') === 0
  );
  const iTotalPersonMonthsContains = header.findIndex((h) => {
    const t = (h || '').trim().toLowerCase();
    return (
      t.includes('total months needed') &&
      (t.includes('1 person') || t.includes('person by dev')) &&
      (t.includes('start to finish') || t.includes('everything'))
    );
  });
  const _totalPersonMonthsCol =
    iTotalPersonMonthsByName >= 0
      ? iTotalPersonMonthsByName
      : iTotalPersonMonthsStartsWith >= 0
        ? iTotalPersonMonthsStartsWith
        : iTotalPersonMonthsContains;
  const iQAResources = header.findIndex((h) => (h || '').trim().indexOf('Num of QA required') === 0);
  const iStartDate = idx('Start Date');
  const iAdditionalResources = idx('Additional Resources');
  const iSizingComment = idx('Sizing Comment');
  const iCompletedPctExact = idx('How much of this is Completed in % (do not add %, just put a number)');
  const iCompletedPctByKeyword = header.findIndex((h) => {
    const t = (h || '').trim().toLowerCase();
    return (
      (t.indexOf('completed') !== -1 && (t.indexOf('%') !== -1 || t.indexOf('percent') !== -1)) ||
      t.indexOf('progress') !== -1
    );
  });
  const iCompletedPct = iCompletedPctExact >= 0 ? iCompletedPctExact : iCompletedPctByKeyword;
  const iCompletedPctFallback = iCompletedPct >= 0 ? iCompletedPct : 5;

  const projects: BinPackingProject[] = [];

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx]!;

    const feat = (row[iFeat] || '').trim();
    const summary = (row[iSummary] || '').trim().replace(/\s+/g, ' ') || feat || '';

    if (!feat && !summary) {
      skipped.push({ index: rowIdx + 1, reason: 'Missing FEAT NUMBER and SUMMARY', rawRow: [...row] });
      invalidRows.push({ index: rowIdx + 1, reason: 'Missing mandatory FEAT NUMBER and SUMMARY', rawRow: [...row] });
      continue;
    }

    const commitment = (row[iCommit] || '').trim();
    const sizingRaw = (row[iSizing] || '').trim();
    const monthsFromSizing = sizingToMonths(sizingRaw);

    let devResources = parseFloat(String(row[iDevResources] || '').replace(/,/g, ''));
    if (Number.isNaN(devResources) || devResources < 0) devResources = 0;

    let devResources60: number | null = null;
    if (iDevResources60 >= 0 && row[iDevResources60]) {
      const val = parseFloat(String(row[iDevResources60]).replace(/,/g, ''));
      if (!Number.isNaN(val) && val >= 0) devResources60 = Math.round(val * 100) / 100;
    }

    const dri = (row[iDri] || '').trim();
    const priority = (row[iPriority] || '').trim();
    const status = iStatus >= 0 ? (row[iStatus] || '').trim() : '';

    const rowNumRaw = (row[iFirstCol] || '').trim();
    const parsedRowNum = parseInt(rowNumRaw, 10);
    const rowNumber = rowNumRaw && !Number.isNaN(parsedRowNum) ? parsedRowNum : null;
    const {
      rowNumbers: dependencyRowNumbers,
      devBlockers: dependencyDevBlockers,
      relBlockers: dependencyRelBlockers,
    } = parseDependencyNumbersAndBlockers(row[iDependencyNumbers]);

    const assignedRowNumber = rowNumber != null ? rowNumber : 9000 + projects.length;

    const totalPersonMonthsRaw = _totalPersonMonthsCol >= 0 ? (row[_totalPersonMonthsCol] || '').trim() : '';
    const additionalResources = iAdditionalResources >= 0 ? (row[iAdditionalResources] || '').trim() : '';
    const sizingComment = iSizingComment >= 0 ? (row[iSizingComment] || '').trim() : '';
    const requestedStartDate = iStartDate >= 0 ? (row[iStartDate] || '').trim() || null : null;

    let qaResources: number | null = null;
    if (iQAResources >= 0 && row[iQAResources]) {
      const parsed = parseFloat(String(row[iQAResources]).replace(/,/g, ''));
      if (!Number.isNaN(parsed) && parsed >= 0) qaResources = Math.round(parsed * 100) / 100;
    }

    const numMonthsDev =
      iNumberMonthsDev >= 0 && row[iNumberMonthsDev]
        ? parseFloat(String(row[iNumberMonthsDev]).replace(/,/g, ''))
        : NaN;
    const totalPersonMonthsNum = totalPersonMonthsRaw ? parseFloat(String(totalPersonMonthsRaw).replace(/,/g, '')) : NaN;

    let durationMonths: number;
    if (!Number.isNaN(numMonthsDev) && numMonthsDev > 0) {
      durationMonths = numMonthsDev;
    } else if (!Number.isNaN(totalPersonMonthsNum) && totalPersonMonthsNum > 0 && devResources > 0) {
      durationMonths = Math.ceil(totalPersonMonthsNum / devResources);
    } else if (!Number.isNaN(totalPersonMonthsNum) && totalPersonMonthsNum > 0) {
      durationMonths = Math.ceil(totalPersonMonthsNum);
      if (devResources === 0) devResources = 1;
    } else if (monthsFromSizing > 0) {
      durationMonths = monthsFromSizing;
    } else {
      durationMonths = 0;
    }

    const inProgress = /in\s*progress/i.test(status);
    const completedPctRaw = (iCompletedPct >= 0 ? row[iCompletedPct] : row[iCompletedPctFallback]) || '';
    let completedPct = parseFloat(String(completedPctRaw).replace(/,/g, '').trim());
    if (Number.isNaN(completedPct) || completedPct < 0) completedPct = 0;
    completedPct = Math.min(100, Math.max(0, completedPct));

    projects.push({
      id: `row-${assignedRowNumber}`,
      rowNumber: assignedRowNumber,
      feat: feat || '',
      summary: summary.slice(0, 120),
      dri,
      priority: priority || 'P0',
      status,
      inProgress,
      completedPct,
      commitment,
      totalResources: Math.round(devResources * 100) / 100,
      qaResources,
      sizingLabel: sizingRaw,
      durationMonths,
      dependencyRowNumbers,
      dependencyDevBlockers: dependencyDevBlockers || [],
      dependencyRelBlockers: dependencyRelBlockers || [],
      totalPersonMonths: totalPersonMonthsRaw,
      totalPersonMonthsNum: Number.isNaN(totalPersonMonthsNum) ? null : totalPersonMonthsNum,
      totalResources60: devResources60,
      additionalResources,
      sizingComment,
      requestedStartDate,
    });
  }

  try {
    detectResourceGroupsInline(projects);
  } catch {
    // resource grouping is best-effort; don't fail the whole conversion
  }

  return { projects, error: null, skipped, invalidRows };
}

// ── CSV serialization ──────────────────────────────────────────────────────

function escapeCsvCell(v: string): string {
  if (v == null) return '';
  const s = String(v);
  if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function findHeaderIndex(header: string[], canonical: string): number {
  const n = canonical.trim();
  const found = header.findIndex((h) => (h || '').trim() === n);
  if (found >= 0) return found;
  return header.findIndex((h) => (h || '').trim().toLowerCase() === n.toLowerCase());
}

// ── Service class ─────────────────────────────────────────────────────────

export class CsvConverterService {
  readonly productId: string | null;

  constructor(productId?: string | null) {
    this.productId = productId ? String(productId).trim() || null : null;
  }

  detectFileType(absolutePath: string): FileType {
    const abs = resolve(String(absolutePath || ''));
    const ext = extname(abs).toLowerCase();
    if (ext === '.csv') return 'csv';
    if (ext === '.xlsx' || ext === '.xls') return 'xlsx';
    try {
      if (existsSync(abs)) {
        const head = readFileSync(abs).subarray(0, 4);
        if (head[0] === 0x50 && head[1] === 0x4b) return 'xlsx';
      }
    } catch {
      // ignore
    }
    return 'unknown';
  }

  extractRawRows(absolutePath: string): ExtractResult {
    const abs = resolve(String(absolutePath || ''));
    if (!abs || abs === resolve('.')) {
      return { rows: [], error: 'extractRawRows: absolutePath is required', fileType: 'unknown' };
    }
    if (!abs.startsWith('/')) {
      return { rows: [], error: 'extractRawRows: path must be absolute', fileType: 'unknown' };
    }
    if (!existsSync(abs)) {
      return { rows: [], error: `File not found: ${abs}`, fileType: 'unknown' };
    }

    const fileType = this.detectFileType(abs);

    if (fileType === 'csv') {
      try {
        const text = readFileSync(abs, 'utf8');
        const rows = parseCSV(text);
        if (!rows.length) return { rows: [], error: 'CSV is empty or unreadable', fileType };
        return { rows, error: null, fileType };
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return { rows: [], error: `CSV read failed: ${msg}`, fileType };
      }
    }

    if (fileType === 'xlsx') {
      return {
        rows: [],
        error:
          'XLSX extraction requires a browser or isolated extractor (SheetJS CDN / python -I). ' +
          'Use extractRawRowsFromBuffer() with pre-extracted rows, or convert XLSX to CSV first.',
        fileType,
      };
    }

    return { rows: [], error: `Unsupported file type for: ${abs}`, fileType };
  }

  extractRawRowsFromBuffer(rows: string[][]): ExtractResult {
    if (!rows || !rows.length) return { rows: [], error: 'No rows provided', fileType: 'unknown' };
    return { rows, error: null, fileType: 'xlsx' };
  }

  normalizeHeaders(headerRow: string[], productId?: string | null): string[] {
    const pid = productId !== undefined ? productId : this.productId;
    return aliasNormalizeHeaders(headerRow, pid);
  }

  validateViaRowsToProjects(rows: string[][], _productId?: string | null): ValidateResult {
    if (!rows || !rows.length) {
      return { projects: [], error: 'No rows to validate.', skipped: [], invalidRows: [] };
    }
    const { projects, error, skipped, invalidRows } = rowsToProjectsCore(rows, _productId ?? this.productId ?? null);
    return { projects, error, skipped, invalidRows };
  }

  convertToCanonicalCsv(rows: string[][]): ConvertResult {
    if (!rows || !rows.length) {
      return { canonicalCsv: '', projects: [], skipped: [], error: 'No rows to convert.' };
    }
    const rawHeader = rows[0] ?? [];
    const header = rawHeader.map((h) => normalizeHeaderCell(h));

    const pid = this.productId;
    const canonicalToSource = new Map<string, number>();
    for (let i = 0; i < header.length; i++) {
      const canonical = canonicalHeaderFor(rawHeader[i]!, pid) ?? normalizeHeaderCell(rawHeader[i]!);
      if (!canonicalToSource.has(canonical)) canonicalToSource.set(canonical, i);
      const lower = canonical.toLowerCase();
      if (!canonicalToSource.has(lower)) canonicalToSource.set(lower, i);
    }

    const canonicalCsvHeader = [...CANONICAL_HEADERS];
    const outRows: string[][] = [canonicalCsvHeader];

    for (const row of rows.slice(1)) {
      const out: string[] = [];
      for (const col of canonicalCsvHeader) {
        let srcIdx = canonicalToSource.get(col) ?? canonicalToSource.get(col.toLowerCase()) ?? -1;
        if (srcIdx === -1) {
          const idxMap = buildHeaderIndex(rawHeader, pid);
          srcIdx = idxMap.get(col) ?? -1;
        }
        if (srcIdx === -1) {
          srcIdx = findHeaderIndex(header, col);
        }
        out.push(srcIdx >= 0 ? (row[srcIdx] ?? '') : '');
      }
      outRows.push(out);
    }

    const csv = outRows.map((r) => r.map(escapeCsvCell).join(',')).join('\n');

    const validated = this.validateViaRowsToProjects(rows, pid ?? null);
    return {
      canonicalCsv: csv,
      projects: validated.projects,
      skipped: validated.skipped,
      error: validated.error,
    };
  }

  generateReport(input: {
    fileType: FileType;
    rows: string[][];
    validated: ValidateResult;
    durationMs?: number;
    productId?: string | null;
    warnings?: string[];
  }): ConverterReport {
    const pid = input.productId !== undefined ? input.productId : this.productId;
    const header = input.rows && input.rows[0] ? input.rows[0].map((h) => normalizeHeaderCell(h)) : [];
    const totalDataRows = input.rows && input.rows.length > 1 ? input.rows.length - 1 : 0;
    const headerIdx = buildHeaderIndex(input.rows[0] ?? [], pid);
    const warnings: string[] = [...(input.warnings ?? [])];

    const usefulOptionals = [
      'Dev Resources required for max parallization',
      'sizing (refer sheet 2 for guidance)',
      'Dependency Numbers (Comma Separated List)',
    ];
    for (const col of usefulOptionals) {
      if (!headerIdx.has(col)) warnings.push(`Optional column missing: "${col}" — related features will use defaults.`);
    }
    for (const m of MANDATORY_CANONICALS) {
      if (!headerIdx.has(m)) warnings.push(`Mandatory column missing: "${m}"`);
    }
    const unmatched = header.filter((h) => !canonicalHeaderFor(h, pid) && h.trim() !== '');
    if (unmatched.length > 0) warnings.push(`Unrecognized headers (passed through as-is): ${unmatched.join(', ')}`);

    return {
      productId: pid ?? null,
      fileType: input.fileType,
      canonicalHeaders: CANONICAL_HEADERS,
      totalDataRows,
      converted: input.validated.projects.length,
      skipped: input.validated.skipped,
      invalidRows: input.validated.invalidRows,
      warnings,
      durationMs: input.durationMs ?? 0,
      error: input.validated.error,
    };
  }

  convertFile(
    absolutePath: string,
    productId?: string | null
  ): {
    result: ConvertResult;
    report: ConverterReport;
  } {
    const pid = productId !== undefined ? productId : this.productId;
    const started = Date.now();
    const extracted = this.extractRawRows(absolutePath);
    if (extracted.error) {
      const validated: ValidateResult = { projects: [], error: extracted.error, skipped: [], invalidRows: [] };
      return {
        result: { canonicalCsv: '', projects: [], skipped: [], error: extracted.error },
        report: this.generateReport({
          fileType: extracted.fileType,
          rows: extracted.rows,
          validated,
          durationMs: Date.now() - started,
          productId: pid,
        }),
      };
    }
    const result = this.convertToCanonicalCsv(extracted.rows);
    const validated = this.validateViaRowsToProjects(extracted.rows, pid);
    const report = this.generateReport({
      fileType: extracted.fileType,
      rows: extracted.rows,
      validated,
      durationMs: Date.now() - started,
      productId: pid,
    });
    return { result, report };
  }
}

export { parseCSV, parseDependencyNumbersAndBlockers, normalizeHeaderCell, CANONICAL_HEADERS as CANONICAL_CSV_HEADERS, MANDATORY_CANONICALS as MANDATORY_COLUMNS };
export type { ColumnAliasMap };
