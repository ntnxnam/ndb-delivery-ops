/**
 * Nutanix fiscal quarters — Q1 starts 01-Aug.
 * Display/label helpers mirroring server/utils/nutanixQuarters.js.
 */

export function getQuarterRange(fiscalYear, quarter) {
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

export function quarterContaining(asOf = new Date()) {
  const d = asOf instanceof Date ? asOf : new Date(asOf);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 8 && m <= 10) {
    return { fiscalYear: y, quarter: 'Q1', ...getQuarterRange(y, 'Q1') };
  }
  if (m === 11 || m === 12) {
    return { fiscalYear: y, quarter: 'Q2', ...getQuarterRange(y, 'Q2') };
  }
  if (m === 1) {
    return { fiscalYear: y - 1, quarter: 'Q2', ...getQuarterRange(y - 1, 'Q2') };
  }
  if (m >= 2 && m <= 4) {
    return { fiscalYear: y - 1, quarter: 'Q3', ...getQuarterRange(y - 1, 'Q3') };
  }
  return { fiscalYear: y - 1, quarter: 'Q4', ...getQuarterRange(y - 1, 'Q4') };
}

function prevQuarter(fy, q) {
  const order = ['Q1', 'Q2', 'Q3', 'Q4'];
  const i = order.indexOf(q);
  if (i === 0) return { fiscalYear: fy - 1, quarter: 'Q4' };
  return { fiscalYear: fy, quarter: order[i - 1] };
}

function toIsoDate(d) {
  const x = d instanceof Date ? d : new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

/**
 * @param {number} [n=2]
 * @param {Date} [asOf]
 */
export function lastNQuartersWindow(n = 2, asOf = new Date()) {
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
  return {
    start: quarters[0].startDate,
    end,
    label: `Last ${count} Nutanix Qs (${quarters.map((x) => x.label).join(' · ')})`,
    quarters,
  };
}
