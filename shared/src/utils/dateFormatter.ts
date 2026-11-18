/**
 * Shared date formatter — single source for DD/Mon/YYYY formatting.
 * Used by server (via shared import) and client (via re-export or direct).
 * Mirrors server/utils/dateFormatter.js logic exactly.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function normalizeDateStr(dateValue: unknown): string | null {
  if (!dateValue) return null;
  let dateStr: string | null = null;
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

export function formatDate(dateValue: unknown): string | null {
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

export function formatDueDate(isoDay: unknown): string {
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
