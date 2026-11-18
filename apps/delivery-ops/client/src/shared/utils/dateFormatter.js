/**
 * Client date formatter — mirrors shared/src/utils/dateFormatter.ts (canonical source).
 * Keep in sync with shared/src/utils/dateFormatter.ts — single source of truth.
 * Product-agnostic, no hardcoded product strings.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Normalize any date value to YYYY-MM-DD.
 * Handles: YYYY-MM-DD, ISO datetime with T, Date object, already-formatted DD/Mon/YYYY returns null (not reversible).
 */
export function normalizeDateStr(dateValue) {
  if (!dateValue) return null;
  let dateStr;
  if (typeof dateValue === 'string') {
    if (dateValue.includes('T')) {
      dateStr = dateValue.split('T')[0];
    } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      dateStr = dateValue;
    } else {
      const parsed = new Date(dateValue);
      if (!isNaN(parsed.getTime())) {
        dateStr = parsed.toISOString().split('T')[0];
      } else {
        return null;
      }
    }
  } else if (dateValue instanceof Date) {
    if (!isNaN(dateValue.getTime())) {
      dateStr = dateValue.toISOString().split('T')[0];
    } else {
      return null;
    }
  } else {
    return null;
  }
  return dateStr && dateStr !== 'null' && dateStr !== '' ? dateStr : null;
}

/**
 * Format date as DD/Mon/YYYY (e.g. 28/Feb/2026).
 * Returns 'Not Set' for falsy input to match server behaviour used in email tables.
 * Returns null for unparseable input (caller can fallback).
 */
export function formatDate(dateValue) {
  if (!dateValue) return 'Not Set';
  try {
    const dateStr = normalizeDateStr(dateValue);
    if (!dateStr) return null;
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (isNaN(date.getTime())) return null;
    const dayStr = String(date.getDate()).padStart(2, '0');
    const monthStr = MONTHS[date.getMonth()];
    const yearStr = date.getFullYear();
    return `${dayStr}/${monthStr}/${yearStr}`;
  } catch {
    return null;
  }
}

/**
 * Strict ISO-day formatter — only accepts YYYY-MM-DD (or prefix thereof).
 * Used when caller already has a sliced ISO day and wants no lenient parsing.
 */
export function formatDueDate(isoDay) {
  if (!isoDay || typeof isoDay !== 'string') return 'Not Set';
  const m = isoDay.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return 'Not Set';
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || !month || !day) return 'Not Set';
  const monthName = MONTHS[month - 1];
  if (!monthName) return 'Not Set';
  return `${String(day).padStart(2, '0')}/${monthName}/${year}`;
}
