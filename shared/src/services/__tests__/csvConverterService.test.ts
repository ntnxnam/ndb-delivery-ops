/**
 * csvConverterService.test — 10 blocks covering the bin-packing conversion contract.
 * Run via: npm --prefix shared run build && node --experimental-strip-types --test (or via tsc+node)
 * Uses node:test (no extra deps).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  getColumnAliases,
  canonicalHeaderFor,
  buildHeaderIndex,
  normalizeHeaders,
  NDB_COLUMN_ALIASES,
  CANONICAL_HEADERS,
  MANDATORY_CANONICALS,
} from '../productColumnAliases.ts';
import { SIZING_MONTHS, sizingToMonths } from '../../constants/binPackingSizing.ts';
import { CsvConverterService, parseCSV, parseDependencyNumbersAndBlockers } from '../csvConverterService.ts';

// helper: build minimal rows with given header + one data row
function rowsWith(header: string[], data: string[]): string[][] {
  return [header, data];
}
const SHEET1_HEADER = [...CANONICAL_HEADERS] as string[];
function dataRow(overrides: Record<string, string> = {}): string[] {
  const row = SHEET1_HEADER.map(() => '');
  const set = (col: string, v: string) => {
    const idx = SHEET1_HEADER.indexOf(col);
    if (idx >= 0) row[idx] = v;
  };
  set('Sl No', '1');
  set('FEAT NUMBER', 'FEAT-1');
  set('SUMMARY', 'Hello');
  for (const [k, v] of Object.entries(overrides)) set(k, v);
  return row;
}

describe('productColumnAliases — alias mapping', () => {
  it('NFD alias Sl. No maps to Sl No canonical', () => {
    assert.equal(canonicalHeaderFor('Sl. No', 'ndb'), 'Sl No');
    assert.equal(canonicalHeaderFor('Row Number', 'ndb'), 'Sl No');
  });
  it('FEAT NUMBER synonyms map', () => {
    assert.equal(canonicalHeaderFor('Issue Key', 'ndb'), 'FEAT NUMBER');
    assert.equal(canonicalHeaderFor('Key', 'ndb'), 'FEAT NUMBER');
  });
  it('SUMMARY synonyms map', () => {
    assert.equal(canonicalHeaderFor('Title', 'ndb'), 'SUMMARY');
  });
  it('unknown productId falls back to NDB', () => {
    assert.equal(getColumnAliases('unknown-xyz'), NDB_COLUMN_ALIASES);
    assert.equal(canonicalHeaderFor('Issue Key', 'unknown-xyz'), 'FEAT NUMBER');
  });
  it('normalizeHeaders canonicalizes known aliases', () => {
    const out = normalizeHeaders(['Sl. No', 'Issue Key', 'Title'], 'ndb');
    assert.deepEqual(out, ['Sl No', 'FEAT NUMBER', 'SUMMARY']);
  });
  it('buildHeaderIndex maps canonical → index', () => {
    const m = buildHeaderIndex(['Sl. No', 'Issue Key', 'Title'], 'ndb');
    assert.equal(m.get('Sl No'), 0);
    assert.equal(m.get('FEAT NUMBER'), 1);
    assert.equal(m.get('SUMMARY'), 2);
  });
});

describe('sizing — SIZING_MONTHS and sizingToMonths', () => {
  it('ceiling map matches spec', () => {
    assert.equal(SIZING_MONTHS['XS (1 month)'], 1);
    assert.equal(SIZING_MONTHS['S (1-3 months)'], 3);
    assert.equal(SIZING_MONTHS['M (3-5 months)'], 5);
    assert.equal(SIZING_MONTHS['L (5-8 months)'], 8);
    assert.equal(SIZING_MONTHS['XL (8-13 months)'], 13);
    assert.equal(SIZING_MONTHS['XXL (13+ months)'], 21);
    assert.equal(SIZING_MONTHS['3L (21+ months)'], 34);
    assert.equal(SIZING_MONTHS['4L (34+ months)'], 55);
    assert.equal(SIZING_MONTHS['None'], 0);
  });
  it('sizingToMonths trims and returns 0 for unknown', () => {
    assert.equal(sizingToMonths('  M (3-5 months)  '), 5);
    assert.equal(sizingToMonths('unknown'), 0);
    assert.equal(sizingToMonths(null), 0);
    assert.equal(sizingToMonths(''), 0);
  });
});

describe('dependency parsing — csv-parser.js:73 port', () => {
  it('splits by [,;] and dedups', () => {
    const { rowNumbers } = parseDependencyNumbersAndBlockers('33, 34; 33');
    assert.deepEqual(rowNumbers, [33, 34]);
  });
  it('detects dev-blocker and rel-blocker tags', () => {
    const { rowNumbers, devBlockers, relBlockers } = parseDependencyNumbersAndBlockers(
      '33 (dev-blocker), 5 (rel-blocker), 7'
    );
    assert.deepEqual(rowNumbers, [33, 5, 7]);
    assert.deepEqual(devBlockers, [33]);
    assert.deepEqual(relBlockers, [5]);
  });
  it('empty returns empty', () => {
    assert.deepEqual(parseDependencyNumbersAndBlockers(''), { rowNumbers: [], devBlockers: [], relBlockers: [] });
    // @ts-ignore intentional
    assert.deepEqual(parseDependencyNumbersAndBlockers(null), { rowNumbers: [], devBlockers: [], relBlockers: [] });
  });
});

describe('rowNumber fallback 9000+index', () => {
  it('uses 9000+projects.length when Sl No missing', () => {
    const svc = new CsvConverterService('ndb');
    const header = [...SHEET1_HEADER];
    const rowA = dataRow({ 'Sl No': '' }); // blank Sl No
    const rowB = dataRow({ 'Sl No': '' });
    rowB[SHEET1_HEADER.indexOf('FEAT NUMBER')] = 'FEAT-2';
    const rows = [header, rowA, rowB];
    const { projects } = svc.validateViaRowsToProjects(rows);
    assert.equal(projects.length, 2);
    assert.equal(projects[0]!.rowNumber, 9000);
    assert.equal(projects[1]!.rowNumber, 9001);
  });
});

describe('productId passthrough — construct + per-call', () => {
  it('constructor productId used as default', () => {
    const svc = new CsvConverterService('ndb');
    assert.equal(svc.productId, 'ndb');
    const out = svc.normalizeHeaders(['Issue Key'], undefined);
    assert.equal(out[0], 'FEAT NUMBER');
  });
  it('per-call productId overrides', () => {
    const svc = new CsvConverterService('ndb');
    const out = svc.normalizeHeaders(['Issue Key'], 'ndb');
    assert.equal(out[0], 'FEAT NUMBER');
  });
});

describe('mandatory validation — only FEAT NUMBER + SUMMARY required', () => {
  it('errors when mandatory cols missing', () => {
    const svc = new CsvConverterService('ndb');
    const rows = [['Priority', 'Status'], ['P0', 'Open']];
    const { error } = svc.validateViaRowsToProjects(rows);
    assert.ok(error && error.includes('FEAT NUMBER'));
  });
  it('skips row missing both FEAT and SUMMARY', () => {
    const svc = new CsvConverterService('ndb');
    const header = [...SHEET1_HEADER];
    const emptyRow = header.map(() => '');
    const rows = [header, emptyRow];
    const { projects, skipped } = svc.validateViaRowsToProjects(rows);
    assert.equal(projects.length, 0);
    assert.equal(skipped.length, 1);
  });
  it('accepts row with only FEAT or only SUMMARY (summary fallback)', () => {
    const svc = new CsvConverterService('ndb');
    const header = [...SHEET1_HEADER];
    const onlyFeat = dataRow({ SUMMARY: '' });
    const onlySummary = dataRow({ 'FEAT NUMBER': '' });
    onlySummary[SHEET1_HEADER.indexOf('SUMMARY')] = 'Just summary';
    const rows = [header, onlyFeat, onlySummary];
    const { projects } = svc.validateViaRowsToProjects(rows);
    assert.equal(projects.length, 2);
  });
});

describe('duration priority — Number of Months (Dev) > ceil(Total/DevResources) > sizing >0', () => {
  it('Number of Months (Dev) wins', () => {
    const svc = new CsvConverterService('ndb');
    const header = [...SHEET1_HEADER];
    const row = dataRow({
      'Number of Months (Dev)': '9',
      'Total Months Needed for 1 person by Dev (Everything from start to finish)': '20',
      'Dev Resources required for max parallization': '2',
      'sizing (refer sheet 2 for guidance)': 'M (3-5 months)',
    });
    const { projects } = svc.validateViaRowsToProjects([header, row]);
    assert.equal(projects[0]!.durationMonths, 9);
  });
  it('ceil(Total/DevResources) second', () => {
    const svc = new CsvConverterService('ndb');
    const header = [...SHEET1_HEADER];
    const row = dataRow({
      'Total Months Needed for 1 person by Dev (Everything from start to finish)': '10',
      'Dev Resources required for max parallization': '3',
      'sizing (refer sheet 2 for guidance)': 'M (3-5 months)',
    });
    const { projects } = svc.validateViaRowsToProjects([header, row]);
    assert.equal(projects[0]!.durationMonths, 4); // ceil(10/3)
  });
  it('sizing ceiling third', () => {
    const svc = new CsvConverterService('ndb');
    const header = [...SHEET1_HEADER];
    const row = dataRow({ 'sizing (refer sheet 2 for guidance)': 'L (5-8 months)' });
    const { projects } = svc.validateViaRowsToProjects([header, row]);
    assert.equal(projects[0]!.durationMonths, 8);
  });
  it('0 when nothing', () => {
    const svc = new CsvConverterService('ndb');
    const header = [...SHEET1_HEADER];
    const row = dataRow();
    const { projects } = svc.validateViaRowsToProjects([header, row]);
    assert.equal(projects[0]!.durationMonths, 0);
  });
});

describe('detectFileType — ext + magic sniff', () => {
  it('detects by extension', () => {
    const svc = new CsvConverterService();
    assert.equal(svc.detectFileType('/tmp/a.csv'), 'csv');
    assert.equal(svc.detectFileType('/tmp/b.xlsx'), 'xlsx');
    assert.equal(svc.detectFileType('/tmp/c.xls'), 'xlsx');
    assert.equal(svc.detectFileType('/tmp/d.json'), 'unknown');
  });
});

describe('convertToCanonicalCsv — header order + quoting', () => {
  it('outputs canonical header order', () => {
    const svc = new CsvConverterService('ndb');
    const header = [...SHEET1_HEADER];
    const row = dataRow({ 'FEAT NUMBER': 'FEAT-99', SUMMARY: 'hi, there' });
    const { canonicalCsv, error } = svc.convertToCanonicalCsv([header, row]);
    assert.equal(error, null);
    const lines = canonicalCsv.split('\n');
    assert.deepEqual(parseCSV(lines[0]!)[0], [...CANONICAL_HEADERS]);
    // comma in summary should be quoted
    assert.ok(lines[1]!.includes('"hi, there"'));
  });
});

describe('generateReport — counts and warnings', () => {
  it('reports converted/skipped and mandatory warnings', () => {
    const svc = new CsvConverterService('ndb');
    const rows = [['Priority'], ['P0']]; // missing mandatories
    const validated = svc.validateViaRowsToProjects(rows);
    const report = svc.generateReport({ fileType: 'csv', rows, validated, durationMs: 5 });
    assert.equal(report.totalDataRows, 1);
    assert.equal(report.converted, 0);
    assert.ok(report.warnings.some((w) => w.includes('FEAT NUMBER')));
    assert.equal(report.canonicalHeaders, CANONICAL_HEADERS);
    assert.equal(report.fileType, 'csv');
  });
});

describe('parseCSV — RFC4180 quoted fields', () => {
  it('handles quoted commas and escaped quotes', () => {
    const csv = 'a,"b, c","d ""quoted"" e"\n1,2,3';
    const rows = parseCSV(csv);
    assert.deepEqual(rows[0], ['a', 'b, c', 'd "quoted" e']);
    assert.deepEqual(rows[1], ['1', '2', '3']);
  });
});
