/**
 * Nutanix fiscal quarters — Q1 starts 01-Aug.
 * Shared by KPI Pulse and (eventually) Sprint Report period pickers.
 */

/**
 * @param {number|string} fiscalYear — year of the Aug 1 that starts Q1
 * @param {'Q1'|'Q2'|'Q3'|'Q4'} quarter
 * @returns {{ startDate: string, endDate: string } | null} YYYY-MM-DD
 */
function getQuarterRange(fiscalYear, quarter) {
  const y = Number(fiscalYear);
  if (Number.isNaN(y) || !quarter) return null;
  switch (String(quarter).toUpperCase()) {
    case 'Q1':
      return { startDate: `${y}-08-01`, endDate: `${y}-10-31` };
    case 'Q2':
      return { startDate: `${y}-11-01`, endDate: `${y + 1}-01-31` };
    case 'Q3':
      return { startDate: `${y + 1}-02-01`, endDate: `${y + 1}-04-30` };
    case 'Q4':
      return { startDate: `${y + 1}-05-01`, endDate: `${y + 1}-07-31` };
    default:
      return null;
  }
}

/**
 * Which Nutanix fiscal quarter contains `asOf` (local calendar date).
 * @returns {{ fiscalYear: number, quarter: 'Q1'|'Q2'|'Q3'|'Q4', startDate: string, endDate: string }}
 */
function quarterContaining(asOf = new Date()) {
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  const y = d.getFullYear();
  const m = d.getMonth() + 1; // 1–12
  const day = d.getDate();
  // FY labeled by Aug-start year: Aug–Jul
  // Aug–Oct → Q1 of year y; Nov–Jan → Q2 (Nov–Dec: y, Jan: y-1 for FY start)
  if (m >= 8 && m <= 10) {
    const range = getQuarterRange(y, 'Q1');
    return { fiscalYear: y, quarter: 'Q1', ...range };
  }
  if (m === 11 || m === 12) {
    const range = getQuarterRange(y, 'Q2');
    return { fiscalYear: y, quarter: 'Q2', ...range };
  }
  if (m === 1) {
    const range = getQuarterRange(y - 1, 'Q2');
    return { fiscalYear: y - 1, quarter: 'Q2', ...range };
  }
  if (m >= 2 && m <= 4) {
    const range = getQuarterRange(y - 1, 'Q3');
    return { fiscalYear: y - 1, quarter: 'Q3', ...range };
  }
  // May–Jul → Q4 of FY that started previous Aug
  const range = getQuarterRange(y - 1, 'Q4');
  return { fiscalYear: y - 1, quarter: 'Q4', ...range };
}

function prevQuarter(fy, q) {
  const order = ['Q1', 'Q2', 'Q3', 'Q4'];
  const i = order.indexOf(q);
  if (i === 0) return { fiscalYear: fy - 1, quarter: 'Q4' };
  return { fiscalYear: fy, quarter: order[i - 1] };
}

/**
 * Window covering the last `n` Nutanix quarters including the current one,
 * from start of the oldest quarter through `asOf` (not past today).
 *
 * @param {number} [n=2]
 * @param {Date|string} [asOf]
 * @returns {{
 *   start: string, end: string, label: string,
 *   quarters: Array<{ fiscalYear: number, quarter: string, startDate: string, endDate: string, label: string }>
 * }}
 */
function lastNQuartersWindow(n = 2, asOf = new Date()) {
  const count = Math.max(1, Math.min(8, Number(n) || 2));
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  const end = toIsoDate(d);
  const cur = quarterContaining(d);

  const quarters = [];
  let fy = cur.fiscalYear;
  let q = cur.quarter;
  for (let i = 0; i < count; i++) {
    const range = getQuarterRange(fy, q);
    quarters.unshift({
      fiscalYear: fy,
      quarter: q,
      startDate: range.startDate,
      endDate: range.endDate,
      label: `${q} FY${String(fy).slice(-2)}`,
    });
    const p = prevQuarter(fy, q);
    fy = p.fiscalYear;
    q = p.quarter;
  }

  const start = quarters[0].startDate;
  const label = `Last ${count} Nutanix Qs (${quarters.map((x) => x.label).join(' · ')})`;
  return { start, end, label, quarters };
}

function toIsoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, '0');
  const day = String(x.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Monday-aligned week buckets from start..end inclusive (local dates as YYYY-MM-DD).
 * @returns {Array<{ weekStart: string, weekEnd: string }>}
 */
function weekBucketsInRange(startIso, endIso) {
  const start = parseLocalDate(startIso);
  const end = parseLocalDate(endIso);
  if (!start || !end || start > end) return [];

  const cursor = mondayOf(start);
  const buckets = [];
  while (cursor <= end) {
    const weekStart = new Date(cursor);
    const weekEnd = new Date(cursor);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const ws = toIsoDate(weekStart);
    const we = toIsoDate(weekEnd > end ? end : weekEnd);
    if (we >= startIso) {
      buckets.push({
        weekStart: ws < startIso ? startIso : ws,
        weekEnd: we,
        bucketStart: ws,
      });
    }
    cursor.setDate(cursor.getDate() + 7);
  }
  return buckets;
}

function parseLocalDate(iso) {
  if (!iso || typeof iso !== 'string') return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function mondayOf(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + offset);
  return d;
}

module.exports = {
  getQuarterRange,
  quarterContaining,
  lastNQuartersWindow,
  weekBucketsInRange,
  toIsoDate,
  mondayOf,
};
