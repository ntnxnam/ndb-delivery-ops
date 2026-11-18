/**
 * binPackingSizing — single source of truth for sizing label → months.
 *
 * Port of `apps/bin-packing/js/sizing.js` `SIZING_MONTHS` (D1/D44).
 * Every consumer (bin-packing UI, shared services, MCP tools) imports from here.
 * Source of truth for the 8 sizing bands; do not duplicate.
 *
 * Map: XS (1 month)=1, S (1-3 months)=3, M (3-5 months)=5, L (5-8 months)=8,
 *      XL (8-13 months)=13, XXL (13+ months)=21, 3L (21+ months)=34, 4L (34+ months)=55,
 *      plus None=0.
 */

export const SIZING_MONTHS: Readonly<Record<string, number>> = {
  None: 0,
  'XS (1 month)': 1,
  'S (1-3 months)': 3,
  'M (3-5 months)': 5,
  'L (5-8 months)': 8,
  'XL (8-13 months)': 13,
  'XXL (13+ months)': 21,
  '3L (21+ months)': 34,
  '4L (34+ months)': 55,
} as const;

/** Ordered list of sizing labels (canonical order, None first). */
export const SIZING_LABELS: readonly string[] = Object.keys(SIZING_MONTHS);

/**
 * Normalize a sizing label and return its ceiling months.
 * Trims whitespace; unknown/empty labels return 0.
 */
export function sizingToMonths(label: string | null | undefined): number {
  if (label == null) return 0;
  const key = String(label).trim();
  if (!key) return 0;
  const v = (SIZING_MONTHS as Record<string, number>)[key];
  return v !== undefined ? v : 0;
}

export default SIZING_MONTHS;
