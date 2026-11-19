/**
 * Tool: convert_to_bin_packing_csv
 *
 * Normalise an arbitrary prioritization spreadsheet (CSV) into the canonical
 * bin-packing CSV that `apps/bin-packing/` consumes. The canonical format
 * is the Sheet1 header from `apps/bin-packing/data/sheet1.csv`:
 *   Sl No, FEAT NUMBER, SUMMARY, Priority, STATUS, % completed,
 *   3.0 Commitment Status, Total Months (1 person), Dev Resources, QA,
 *   Number of Months (Dev), sizing, DRI, Dependency Numbers, Start Date,
 *   Additional Resources, Sizing Comment, etc.
 *
 * This is a pure READ-ONLY tool — it returns `csvText` in the response and
 * never writes to disk (D26 HITL for writes). The caller decides where to
 * persist the result.
 *
 * Design (D44): lives in `mcp/shared/tools/` and is imported by
 * `mcp/lighthouse` (product surface). `mcp/loom` (builder) stays at 8 shared
 * tools. Conversion delegates to `CsvConverterService` in
 * `shared/services/csvConverterService.ts` — product-agnostic via
 * `productColumnAliases` (D1), sizing from `shared/constants/binPackingSizing`.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

import { CsvConverterService } from '@portfolio-delivery-ops/shared';
import { canonicalHeaderFor } from '@portfolio-delivery-ops/shared';

// ---------------------------------------------------------------------------
// Security constants
// ---------------------------------------------------------------------------

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

const MIME_ALLOWLIST = [
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/pdf',
  'text/plain',
  'application/vnd.ms-excel',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
] as const;

// ---------------------------------------------------------------------------
// Input schema — exactly as specified
// ---------------------------------------------------------------------------

const inputSchema = {
  filePath: z
    .string()
    .optional()
    .describe(
      'Absolute or workspace-relative path to the source file on the MCP host. Either filePath or fileContentBase64 is required.'
    ),
  fileContentBase64: z
    .string()
    .optional()
    .describe(
      'Base64-encoded file bytes. Alternative to filePath for clients that already hold the file in memory.'
    ),
  fileName: z
    .string()
    .min(1)
    .describe(
      'Original file name including extension, e.g. "Prioritization_Q2.xlsx". Used to infer type and to sanitize.'
    ),
  productId: z
    .string()
    .optional()
    .describe('Optional product scope (e.g. "NDB", "DataLens"). Passed through for downstream routing.'),
  mimeType: z
    .string()
    .optional()
    .describe('MIME type of the source file. If provided it must be in the allowlist; otherwise inferred from fileName.'),
  originalHeaders: z
    .array(z.string())
    .optional()
    .describe(
      'Caller-supplied header row override. When given, these headers are used instead of the first row of the file.'
    ),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sanitizeFileName(raw: string): string {
  let s = raw.replace(/\0/g, '').trim();
  s = path.basename(s);
  s = s.replace(/[/\\]+/g, '_');
  s = s.replace(/[\x00-\x1F\x7F]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s || s === '.' || s === '..') s = 'upload.csv';
  if (s.length > 255) s = s.slice(0, 255);
  return s;
}

function inferMimeType(fileName: string, explicit?: string): string | undefined {
  if (explicit && explicit.trim()) return explicit.trim().toLowerCase();
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.csv':
      return 'text/csv';
    case '.txt':
      return 'text/plain';
    case '.xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case '.xls':
      return 'application/vnd.ms-excel';
    case '.pdf':
      return 'application/pdf';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    default:
      return undefined;
  }
}

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

function rejectTraversal(filePath: string): string | null {
  if (filePath.includes('..')) return `Security: filePath must not contain ".." (path traversal). Got "${filePath}"`;
  const normalized = path.normalize(filePath);
  if (normalized.includes('..')) return `Security: filePath resolves to a traversal path after normalization: "${normalized}"`;
  return null;
}

function base64DecodedBytes(b64: string): number {
  const clean = b64.replace(/\s/g, '');
  try {
    return Buffer.byteLength(clean, 'base64');
  } catch {
    return Math.ceil(clean.length * 3 / 4);
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerConvertToBinPackingCsv(server: McpServer): void {
  server.registerTool(
    'convert_to_bin_packing_csv',
    {
      title: 'Convert to Bin-Packing CSV',
      description:
        'Normalise a CSV/XLSX export into the canonical bin-packing CSV consumed by apps/bin-packing. Accepts a file path or base64 payload plus fileName; returns normalized csvText, mapping warnings, stats (rows/cols/mapped/unmapped), and validation results. Read-only — never writes to disk (D26 HITL for writes). Delegates to CsvConverterService in shared/. Use when the user says "convert this sheet for bin-packing", "prepare bin-packing CSV", or uploads a prioritization file for allocation planning.',
      inputSchema,
      annotations: {
        title: 'Convert to Bin-Packing CSV',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ filePath, fileContentBase64, fileName, productId, mimeType, originalHeaders }) => {
      const warnings: string[] = [];

      // ---- required field checks ---------------------------------------
      if (!filePath && !fileContentBase64) {
        return {
          content: [{ type: 'text', text: 'Either filePath or fileContentBase64 is required.' }],
          isError: true,
        };
      }
      if (!fileName || !fileName.trim()) {
        return {
          content: [{ type: 'text', text: 'fileName is required (include extension, e.g. "priorities.csv").' }],
          isError: true,
        };
      }

      const safeFileName = sanitizeFileName(fileName);
      if (safeFileName !== fileName) {
        warnings.push(`fileName sanitized: "${fileName}" -> "${safeFileName}"`);
      }

      // ---- mime allowlist ----------------------------------------------
      const effectiveMime = inferMimeType(safeFileName, mimeType);
      if (mimeType && !MIME_ALLOWLIST.includes(mimeType.toLowerCase() as (typeof MIME_ALLOWLIST)[number])) {
        return {
          content: [
            { type: 'text', text: `mimeType "${mimeType}" is not in the allowlist: ${MIME_ALLOWLIST.join(', ')}` },
          ],
          isError: true,
        };
      }
      const mimeForCheck = (mimeType ?? effectiveMime ?? '').toLowerCase();
      if (mimeForCheck && !MIME_ALLOWLIST.includes(mimeForCheck as (typeof MIME_ALLOWLIST)[number])) {
        return {
          content: [
            { type: 'text', text: `Inferred mimeType "${mimeForCheck}" is not in the allowlist: ${MIME_ALLOWLIST.join(', ')}` },
          ],
          isError: true,
        };
      }

      // ---- load raw text -----------------------------------------------
      let rawText = '';
      let rawBytesLength = 0;

      try {
        if (filePath) {
          const traversalError = rejectTraversal(filePath);
          if (traversalError) {
            return { content: [{ type: 'text', text: traversalError }], isError: true };
          }
          const normalized = path.normalize(filePath);
          let stat: fs.Stats;
          try {
            stat = fs.statSync(normalized);
          } catch {
            return {
              content: [{ type: 'text', text: `filePath not found or not readable: "${normalized}"` }],
              isError: true,
            };
          }
          if (stat.size > MAX_BYTES) {
            return {
              content: [{ type: 'text', text: `File at "${normalized}" is ${(stat.size / (1024 * 1024)).toFixed(1)} MB; limit is 10 MB.` }],
              isError: true,
            };
          }
          if (!stat.isFile()) {
            return {
              content: [{ type: 'text', text: `filePath is not a regular file: "${normalized}"` }],
              isError: true,
            };
          }
          rawBytesLength = stat.size;
          rawText = fs.readFileSync(normalized, 'utf8');
        } else if (fileContentBase64) {
          // Strip data: URL prefix if present (parity with server route)
          let b64 = fileContentBase64.trim();
          const commaIdx = b64.indexOf(',');
          if (b64.startsWith('data:') && commaIdx !== -1) b64 = b64.slice(commaIdx + 1);
          const b64Clean = b64.replace(/\s/g, '');
          if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64Clean)) {
            return {
              content: [{ type: 'text', text: 'fileContentBase64 is not valid base64.' }],
              isError: true,
            };
          }
          if (b64Clean.length % 4 !== 0) {
            return {
              content: [{ type: 'text', text: 'fileContentBase64 is not valid base64 (length not multiple of 4).' }],
              isError: true,
            };
          }
          const approxBytes = base64DecodedBytes(b64Clean);
          if (approxBytes > MAX_BYTES) {
            return {
              content: [{ type: 'text', text: `Decoded file would be ~${(approxBytes / (1024 * 1024)).toFixed(1)} MB; limit is 10 MB.` }],
              isError: true,
            };
          }
          const buf = Buffer.from(b64Clean, 'base64');
          if (buf.length > MAX_BYTES) {
            return {
              content: [{ type: 'text', text: `Decoded file is ${(buf.length / (1024 * 1024)).toFixed(1)} MB; limit is 10 MB.` }],
              isError: true,
            };
          }
          rawBytesLength = buf.length;
          const lowerName = safeFileName.toLowerCase();
          const isBinaryExt =
            lowerName.endsWith('.xlsx') ||
            lowerName.endsWith('.xls') ||
            lowerName.endsWith('.pdf') ||
            lowerName.endsWith('.doc') ||
            lowerName.endsWith('.docx');
          if (isBinaryExt) {
            rawText = buf.toString('utf8');
            const nonPrintable = (rawText.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g) || []).length;
            if (nonPrintable > 20 || rawText.includes('PK\x03\x04') || rawText.startsWith('%PDF')) {
              warnings.push(
                `"${safeFileName}" appears to be a binary format (${mimeForCheck || 'inferred'}). Server-side XLSX/PDF/DOCX parsing is not yet available in this tool — treating content as text fallback. For reliable XLSX parsing, upload a CSV export instead.`
              );
            }
          } else {
            rawText = buf.toString('utf8');
          }
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Failed to load source file: ${err instanceof Error ? err.message : String(err)}` }],
          isError: true,
        };
      }

      // ---- service -----------------------------------------------------
      const svc = new CsvConverterService(productId ?? null);

      if (!rawText || !rawText.trim()) {
        const emptyResult = {
          csvText: '',
          warnings,
          stats: { rows: 0, cols: 0, mappedCols: 0, unmappedCols: 0 },
          validation: { projectsParsed: 0, errors: ['File is empty or contains only whitespace.'], warnings: [] as string[] },
        };
        return {
          content: [{ type: 'text', text: `No data to convert — file "${safeFileName}" is empty.\nWarnings: ${warnings.join('; ') || 'none'}` }],
          structuredContent: emptyResult,
        };
      }

      // ---- parse input rows --------------------------------------------
      let inputHeader: string[] = [];
      let allRows: string[][] = [];

      if (originalHeaders && originalHeaders.length > 0) {
        inputHeader = [...originalHeaders];
        const parsed = parseCSV(rawText);
        // If first row matches the supplied headers, drop it to avoid duplication
        if (
          parsed.length > 0 &&
          parsed[0]!.length === inputHeader.length &&
          parsed[0]!.every((c, i) => (c || '').trim().toLowerCase() === (inputHeader[i] || '').trim().toLowerCase())
        ) {
          allRows = [inputHeader, ...parsed.slice(1)];
        } else {
          allRows = [inputHeader, ...parsed];
        }
        warnings.push('Using caller-supplied originalHeaders as header row.');
      } else {
        allRows = parseCSV(rawText);
        if (allRows.length === 0) {
          return {
            content: [{ type: 'text', text: `Parse failed for "${safeFileName}": no rows produced — file may be malformed or not CSV.` }],
            isError: true,
            structuredContent: {
              csvText: '',
              warnings,
              stats: { rows: 0, cols: 0, mappedCols: 0, unmappedCols: 0 },
              validation: { projectsParsed: 0, errors: ['CSV parser produced no rows'], warnings: [] as string[] },
            },
          };
        }
        inputHeader = allRows[0]!;
      }

      if (!inputHeader.length) {
        return {
          content: [{ type: 'text', text: 'Header row is empty — cannot map columns.' }],
          isError: true,
          structuredContent: {
            csvText: '',
            warnings,
            stats: { rows: 0, cols: 0, mappedCols: 0, unmappedCols: 0 },
            validation: { projectsParsed: 0, errors: ['Header row is empty'], warnings: [] as string[] },
          },
        };
      }

      // ---- header mapping stats (via shared productColumnAliases) -------
      const cols = inputHeader.length;
      let mappedCols = 0;
      for (const h of inputHeader) {
        if (canonicalHeaderFor(h, productId ?? null)) mappedCols++;
      }
      const unmappedCols = cols - mappedCols;

      // ---- delegate conversion + validation to shared service -------------
      const convertResult = svc.convertToCanonicalCsv(allRows);
      const validated = svc.validateViaRowsToProjects(allRows, productId ?? null);
      const fileType = svc.detectFileType(safeFileName);
      const report = svc.generateReport({
        fileType: fileType === 'unknown' ? 'csv' : fileType,
        rows: allRows,
        validated,
        productId: productId ?? null,
      });

      const validation = {
        projectsParsed: validated.projects.length,
        errors: [
          ...(validated.error ? [validated.error] : []),
          ...validated.invalidRows.map((r: { index: number; reason: string }) => `Row ${r.index}: ${r.reason}`),
        ],
        warnings: [...validated.skipped.map((r: { index: number; reason: string }) => `Row ${r.index}: ${r.reason}`), ...report.warnings],
      };

      const stats = {
        rows: allRows.length - 1,
        cols,
        mappedCols,
        unmappedCols,
      };

      const csvText: string = convertResult.canonicalCsv;

      if (mimeForCheck === 'application/pdf') {
        warnings.push('PDF input was decoded as text fallback; table extraction from PDF requires additional extraction. Results may be incomplete.');
      }
      if (productId) {
        warnings.push(`productId "${productId}" acknowledged for downstream routing (alias map via productColumnAliases, D1).`);
      }
      // Merge service warnings that aren't already in validation.warnings
      for (const w of report.warnings) {
        if (!validation.warnings.includes(w)) warnings.push(w);
      }

      // ---- markdown summary (truncated csv preview) --------------------
      const previewLimit = 6000;
      const preview = csvText.length > previewLimit ? csvText.slice(0, previewLimit) + '\n…(truncated)' : csvText;
      const lines: string[] = [];
      lines.push(`# Convert to Bin-Packing CSV — ${safeFileName}${productId ? ` (${productId})` : ''}`);
      lines.push('');
      lines.push(`**Source**: ${rawBytesLength} bytes, ${cols} cols × ${stats.rows} data rows → **${validation.projectsParsed}** projects`);
      lines.push(`**Mapping**: ${mappedCols} mapped, ${unmappedCols} unmapped`);
      if (warnings.length) {
        lines.push('');
        lines.push(`Warnings (${warnings.length}):`);
        for (const w of warnings) lines.push(`- ${w}`);
      }
      if (validation.errors.length) {
        lines.push('');
        lines.push(`Validation errors (${validation.errors.length}):`);
        for (const e of validation.errors) lines.push(`- ${e}`);
      }
      if (validation.warnings.length) {
        lines.push('');
        lines.push(`Validation warnings (${validation.warnings.length}):`);
        for (const w of validation.warnings) lines.push(`- ${w}`);
      }
      lines.push('');
      lines.push(`Output: ${csvText.length} chars. Read-only — not written to disk (D26 HITL).`);
      if (preview) {
        lines.push('');
        lines.push('```csv');
        lines.push(preview);
        lines.push('```');
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          csvText,
          warnings,
          stats,
          validation,
        },
      };
    }
  );
}
