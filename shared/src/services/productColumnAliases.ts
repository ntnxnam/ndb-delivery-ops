/**
 * productColumnAliases — header alias map per productId for bin-packing CSV conversion.
 *
 * D1 product-agnostic: every canonical header (NDB Sheet1) has a list of accepted
 * synonyms. NDB default = Sheet1 names. Other products override via PRODUCT_COLUMN_ALIASES.
 * No NDB-specific strings live outside this file + binPackingSizing config.
 *
 * Canonical headers are the NDB Sheet1 26-col header (see apps/bin-packing/data/sheet1.csv).
 * Only FEAT NUMBER + SUMMARY are mandatory (csv-parser.js:128); others optional.
 */

export type ColumnAliasMap = Readonly<Record<string, readonly string[]>>;

/**
 * Canonical Sheet1 header → accepted aliases (case-insensitive, trimmed).
 * First entry is the canonical form itself; additional entries are synonyms.
 *
 * Examples: "Sl No" also accepts "Sl. No", "Row Number", "S.No"
 *           "FEAT NUMBER" also accepts "Issue Key", "Key", "FEAT", "Feature Key"
 *           "SUMMARY" also accepts "Summary", "Title", "Description"
 */
export const NDB_COLUMN_ALIASES = {
  'Sl No': ['Sl No', 'Sl. No', 'Sl. No.', 'S.No', 'S. No', 'Row Number', '#'],
  'FEAT NUMBER': ['FEAT NUMBER', 'Issue Key', 'Key', 'FEAT', 'Feature Key', 'Ticket Key', 'FEAT Number'],
  SUMMARY: ['SUMMARY', 'Summary', 'Title', 'Description', 'Name'],
  Priority: ['Priority', 'Prio', 'PRI'],
  STATUS: ['STATUS', 'Status', 'State'],
  'How much of this is Completed in % (do not add %, just put a number)': [
    'How much of this is Completed in % (do not add %, just put a number)',
    'Progress',
    'Completed %',
    'Completion %',
    '% Complete',
    'Percent Complete',
  ],
  '3.0 Commitment Status': ['3.0 Commitment Status', 'Commitment Status', 'Commitment', 'Commit Status'],
  'Target Month': ['Target Month', 'Target', 'Due Date', 'Target Date'],
  Comment: ['Comment', 'Comments', 'Notes', 'Remarks'],
  DRI: ['DRI', 'Owner', 'Assignee', 'Lead', 'DRI '],
  'Total Months Needed for 1 person by Dev (Everything from start to finish)': [
    'Total Months Needed for 1 person by Dev (Everything from start to finish)',
    'Total Months Needed for 1 person by Dev',
    'Total Person Months',
    'Person Months',
    'Total Months',
    'Effort (person-months)',
  ],
  'Dev Resources required for max parallization': [
    'Dev Resources required for max parallization',
    'Dev Resources',
    'Resources',
    'Dev Team Size',
  ],
  'Dev Resources required for max parallization and 60% productivity': [
    'Dev Resources required for max parallization and 60% productivity',
    'Dev Resources (60%)',
    'Resources (60%)',
  ],
  'Num of QA required(rule: 3:1, 1 QA for 3 dev)': [
    'Num of QA required(rule: 3:1, 1 QA for 3 dev)',
    'Num of QA required',
    'QA Resources',
    'QA Required',
  ],
  'Num of QA required(rule: 3:1, 1 QA for 3 dev) with 60% productivity': [
    'Num of QA required(rule: 3:1, 1 QA for 3 dev) with 60% productivity',
    'QA Resources (60%)',
  ],
  'Number of Months (Dev)': [
    'Number of Months (Dev)',
    'Duration (months)',
    'Months (Dev)',
    'Duration',
  ],
  'Total resources required': ['Total resources required', 'Total Resources', 'Resources Total'],
  'sizing (refer sheet 2 for guidance)': [
    'sizing (refer sheet 2 for guidance)',
    'Sizing',
    'Size',
    'T-Shirt Size',
    'Estimate',
  ],
  'Additional Resources': ['Additional Resources', 'Extra Resources', 'Other Resources'],
  'Sizing Comment': ['Sizing Comment', 'Sizing Notes', 'Estimate Comment'],
  'Dependency Numbers (Comma Separated List)': [
    'Dependency Numbers (Comma Separated List)',
    'Dependencies',
    'Depends On',
    'Dependency',
    'Depends',
  ],
  DEPENDENCY: ['DEPENDENCY', 'Dependency Text', 'Dependency Name'],
  'One line dependency description': [
    'One line dependency description',
    'Dependency Description',
    'Dep Description',
  ],
  'Resourcing done?': ['Resourcing done?', 'Resourced?', 'Staffed?'],
  'Any new software needed?': ['Any new software needed?', 'New Software?', 'Infra Needed?'],
  Comments: ['Comments', 'Extra Comments', 'Additional Comments'],
} as const satisfies ColumnAliasMap;

/**
 * Per-product alias registry. NDB is the default; other products extend/override.
 * Product-agnostic D1: callers pass productId; unknown product falls back to NDB.
 */
export const PRODUCT_COLUMN_ALIASES: Readonly<Record<string, ColumnAliasMap>> = {
  ndb: NDB_COLUMN_ALIASES,
  default: NDB_COLUMN_ALIASES,
} as const;

/** Canonical headers in Sheet1 order (for convertToCanonicalCsv output). */
export const CANONICAL_HEADERS: readonly string[] = Object.keys(NDB_COLUMN_ALIASES) as readonly string[];

/** Mandatory columns — every valid CSV must provide these (case-insensitive). */
export const MANDATORY_CANONICALS: readonly string[] = ['FEAT NUMBER', 'SUMMARY'] as const;

// ── Helpers ────────────────────────────────────────────────────────────────

function norm(s: string): string {
  let t = (s ?? '').trim();
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1).trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) t = t.slice(1, -1).trim();
  return t.toLowerCase();
}

/**
 * Resolve the alias map for a productId. Unknown productId → NDB default.
 * Product-agnostic D1: never throws on unknown product; caller still gets a usable map.
 */
export function getColumnAliases(productId?: string | null): ColumnAliasMap {
  if (!productId) return NDB_COLUMN_ALIASES;
  const key = String(productId).trim().toLowerCase();
  return (PRODUCT_COLUMN_ALIASES as Record<string, ColumnAliasMap>)[key] ?? NDB_COLUMN_ALIASES;
}

/**
 * Map a raw header cell to its canonical form (or null if no alias matches).
 * Matching is case-insensitive, BOM/quote/trim tolerant, and tries exact alias
 * match first, then substring fallback for robustness with Excel export variations.
 */
export function canonicalHeaderFor(
  rawHeader: string,
  productId?: string | null
): string | null {
  const aliases = getColumnAliases(productId);
  const needle = norm(rawHeader);
  if (!needle) return null;
  // Exact alias match first
  for (const [canonical, syns] of Object.entries(aliases)) {
    for (const syn of syns as readonly string[]) {
      if (norm(syn) === needle) return canonical;
    }
  }
  // Substring fallback: header contains canonical or alias (Excel variations)
  for (const [canonical, syns] of Object.entries(aliases)) {
    if (needle.includes(norm(canonical))) return canonical;
    for (const syn of syns as readonly string[]) {
      const ns = norm(syn);
      if (ns.length >= 4 && needle.includes(ns)) return canonical;
    }
  }
  return null;
}

/**
 * Build a canonical → column-index map from a raw header row.
 * Only the first occurrence of each canonical wins; unmatched columns are ignored.
 */
export function buildHeaderIndex(
  headerRow: string[],
  productId?: string | null
): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < headerRow.length; i++) {
    const canonical = canonicalHeaderFor(headerRow[i]!, productId);
    if (canonical && !out.has(canonical)) out.set(canonical, i);
  }
  return out;
}

/**
 * Normalize a header row to canonical names (unmatched → original trimmed value).
 * Useful for debugging / preview of alias resolution.
 */
export function normalizeHeaders(
  headerRow: string[],
  productId?: string | null
): string[] {
  return headerRow.map((h) => {
    const c = canonicalHeaderFor(h, productId);
    if (c) return c;
    let s = (h ?? '').trim();
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1).trim();
    if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
    return s;
  });
}
