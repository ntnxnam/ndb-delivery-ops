const { getFieldId, getFieldValue } = require('./jiraFieldsConfig');
/**
 * Dual waterfall Prescribed vs Actual.
 * Code Complete: Prescribed = EC→release CC + ticket CC; Actual = coding start→end.
 */

const MS_PER_DAY = 86400000;

const PORTFOLIO_TYPES = new Set(['feature', 'initiative', 'epic', 'x-feat', 'capability']);

const TIMELINE_MILESTONES = [
  { key: 'rqmnts', label: 'Rqmnts Done', fieldId: getFieldId('requirementsDone'), actualKey: null },
  { key: 'fsds', label: 'FS/DS Done', fieldId: getFieldId('fsdsDone'), actualKey: null },
  { key: 'testPlan', label: 'Test Plan', fieldId: getFieldId('testPlan'), actualKey: null },
  { key: 'cc', label: 'Code Complete', fieldId: getFieldId('codeComplete'), actualKey: 'cc' },
  { key: 'cg', label: 'Commit Gate', fieldId: getFieldId('commitGate'), actualKey: 'cg' },
  { key: 'pg', label: 'Promotion Gate', fieldId: getFieldId('promotionGate'), actualKey: 'pg' },
  { key: 'ga', label: 'GA', fieldId: null, actualKey: 'ga' },
];

const MONTH_INDEX = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const d = new Date(value);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (typeof value === 'object') {
    if (value.type === 'notSet') return null;
    return parseDate(value.display || value.value || '');
  }
  const str = String(value).trim();
  if (!str || str === 'Not Set' || str === 'N/A' || str === 'NA') return null;
  const m = str.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (m && MONTH_INDEX[m[2]] != null) {
    const d = new Date(Number(m[3]), MONTH_INDEX[m[2]], Number(m[1]));
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(`${str.slice(0, 10)}T00:00:00`);
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatShortDate(date) {
  if (!date) return '—';
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day}/${months[date.getMonth()]}/${date.getFullYear()}`;
}

function resolveReleaseMilestoneDate(cfg, keyPattern) {
  if (!cfg || typeof cfg !== 'object') return null;
  const entries = Object.entries(cfg)
    .filter(([k, v]) => keyPattern.test(k) && v)
    .map(([k, v]) => ({
      key: k,
      date: typeof v === 'string' ? v : v.date,
      style: typeof v === 'object' ? (v.style || 'solid') : 'solid',
      num: parseInt(String(k).replace(/\D/g, ''), 10) || 0,
    }))
    .filter((e) => e.date);
  if (!entries.length) return null;
  const solid = entries.filter((e) => e.style === 'solid');
  const pool = (solid.length ? solid : entries).slice().sort((a, b) => b.num - a.num);
  return pool[0].date;
}

function resolveReleaseGaDate(cfg) {
  return resolveReleaseMilestoneDate(cfg, /^ga\d+$/i);
}

function resolveReleaseCcDate(cfg) {
  return resolveReleaseMilestoneDate(cfg, /^ccm\d*Gate$/i);
}

function isCodingIssueType(issueType) {
  const t = String(issueType || '').trim().toLowerCase();
  if (!t || PORTFOLIO_TYPES.has(t)) return false;
  if (t === 'bug' || t === 'improvement' || t === 'test') return false;
  return true;
}

function resolveActualGateDates(workItems) {
  const items = (Array.isArray(workItems) ? workItems : []).filter((i) => {
    const t = String(i?.issueType || '').trim().toLowerCase();
    return t && !PORTFOLIO_TYPES.has(t);
  });

  const latestClosed = (pool, { requireAllClosed = false } = {}) => {
    if (!pool.length) return { date: null, reason: 'none', partial: false, openCount: 0 };
    const closed = pool.filter((i) => i.resolved);
    const openCount = pool.length - closed.length;
    if (requireAllClosed && openCount > 0) {
      return { date: null, reason: 'open', partial: true, openCount };
    }
    if (!closed.length) return { date: null, reason: 'none', partial: openCount > 0, openCount };
    const dates = closed.map((i) => i.resolved).sort();
    return { date: dates[dates.length - 1], reason: 'ok', partial: openCount > 0, openCount };
  };

  const codingPool = items.filter((i) => isCodingIssueType(i.issueType));
  const createdDates = codingPool.map((i) => i.created).filter(Boolean).sort();
  const resolvedDates = codingPool.map((i) => i.resolved).filter(Boolean).sort();
  const ccOpen = codingPool.filter((i) => !i.resolved).length;
  const ccStart = createdDates.length ? createdDates[0] : null;
  const ccEnd = resolvedDates.length ? resolvedDates[resolvedDates.length - 1] : null;

  const cgPool = items.filter((i) => {
    const t = String(i.issueType || '').toLowerCase();
    return t === 'bug' || t === 'improvement';
  });
  const pgPool = items.filter((i) => {
    const t = String(i.issueType || '').toLowerCase();
    return t === 'test' || t === 'bug';
  });

  const cg = latestClosed(cgPool);
  const pg = latestClosed(pgPool);
  const ga = latestClosed(items, { requireAllClosed: true });

  const notes = [];
  if (!codingPool.length) notes.push('CC: no coding work items');
  else if (!ccStart) notes.push('CC: coding items missing created dates');
  else if (!ccEnd) notes.push('CC: no coding closures yet');
  if (ccOpen > 0 && ccEnd) notes.push(`CC: ${ccOpen} coding still open`);
  if (cg.partial) notes.push(`CG: ${cg.openCount} still open`);
  if (pg.partial) notes.push(`PG: ${pg.openCount} still open`);
  if (ga.reason === 'open') notes.push(`GA: ${ga.openCount} still open`);

  return {
    actualCcStart: ccStart,
    actualCcEnd: ccEnd,
    actualCg: cg.date,
    actualPg: pg.date,
    actualGa: ga.date,
    partial: { cc: ccOpen > 0, cg: cg.partial, pg: pg.partial, ga: ga.reason === 'open' },
    notes,
  };
}

function buildGateVsActualRows(jiraData, ecDateInput, gaDateInput, workItems, releaseCcDateInput = null) {
  const ecDate = parseDate(ecDateInput);
  if (!ecDate) return { rows: [], notes: ['EC (release)'], ecLabel: 'Not Set' };

  const actuals = resolveActualGateDates(workItems);
  const actualByKey = {
    cg: actuals.actualCg,
    pg: actuals.actualPg,
    ga: actuals.actualGa,
  };

  const fieldDate = (fieldId) => {
    if (!fieldId) return parseDate(gaDateInput);
    const field = jiraData?.[fieldId];
    return parseDate(field?.value ?? field);
  };

  const daysFromEc = (date) => {
    if (!date) return null;
    return Math.round((date.getTime() - ecDate.getTime()) / MS_PER_DAY);
  };

  const ecAnchor = { key: 'ec', label: 'EC', day: 0, dateLabel: formatShortDate(ecDate) };
  const gateAnchors = [ecAnchor];
  TIMELINE_MILESTONES.forEach((m) => {
    const gateDate = fieldDate(m.fieldId);
    const gateDay = daysFromEc(gateDate);
    if (gateDay == null) return;
    gateAnchors.push({
      key: m.key,
      label: m.label,
      day: gateDay,
      dateLabel: formatShortDate(gateDate),
    });
  });

  const prevGateFor = (milestoneKey) => {
    const idx = gateAnchors.findIndex((a) => a.key === milestoneKey);
    if (idx > 0) return gateAnchors[idx - 1];
    let prev = gateAnchors[0];
    for (let i = 0; i < TIMELINE_MILESTONES.length; i += 1) {
      const m = TIMELINE_MILESTONES[i];
      if (m.key === milestoneKey) break;
      const found = gateAnchors.find((a) => a.key === m.key);
      if (found) prev = found;
    }
    return prev;
  };

  const makeLeg = (from, toDay, toDateLabel) => {
    if (toDay == null || !from) return null;
    const daySpan = toDay - from.day;
    return {
      offset: Math.max(0, from.day),
      duration: Math.max(1, Math.abs(daySpan)),
      daySpan,
      inverted: daySpan < 0,
      fromDateLabel: from.dateLabel,
      toDateLabel: toDateLabel || '—',
    };
  };

  const emptyRowBase = (m) => ({
    key: m.key,
    label: `→ ${m.label}`,
    gateOffset: 0,
    gateDuration: 0,
    gateDuration2: 0,
    actualOffset: 0,
    actualDuration: 0,
    gateSet: false,
    actualSet: false,
    gateDaySpan: null,
    actualDaySpan: null,
    gateInverted: false,
    actualInverted: false,
    gateDateLabel: '—',
    actualDateLabel: '—',
    phaseFromLabel: 'EC',
    partial: false,
    hasTicketSegment: false,
  });

  const rows = TIMELINE_MILESTONES.map((m) => {
    if (m.key === 'cc') {
      const releaseCc = parseDate(releaseCcDateInput);
      const ticketCc = fieldDate(m.fieldId);
      const releaseDay = daysFromEc(releaseCc);
      const ticketDay = daysFromEc(ticketCc);

      const ccStart = parseDate(actuals.actualCcStart);
      const ccEnd = parseDate(actuals.actualCcEnd);
      const startDay = daysFromEc(ccStart);
      const endDay = daysFromEc(ccEnd);

      if (releaseDay == null && ticketDay == null && (startDay == null || endDay == null)) {
        return null;
      }

      const row = emptyRowBase(m);
      row.phaseFromLabel = 'EC';

      const prescribedDays = [releaseDay, ticketDay].filter((d) => d != null).sort((a, b) => a - b);
      if (prescribedDays.length === 1) {
        const d = prescribedDays[0];
        row.gateOffset = 0;
        row.gateDuration = Math.max(1, Math.abs(d));
        row.gateDaySpan = d;
        row.gateInverted = d < 0;
        row.gateSet = true;
        const which = releaseDay != null ? 'Release gate' : 'Ticket';
        const label = releaseDay != null ? formatShortDate(releaseCc) : formatShortDate(ticketCc);
        row.gateDateLabel = `EC → ${label} (${which})`;
      } else if (prescribedDays.length === 2) {
        const [early, late] = prescribedDays;
        row.gateOffset = 0;
        row.gateDuration = Math.max(1, Math.abs(early));
        row.gateDuration2 = Math.max(1, Math.abs(late - early));
        row.gateDaySpan = late;
        row.gateInverted = late < 0 || early < 0;
        row.gateSet = true;
        row.hasTicketSegment = true;
        row.gateDateLabel = `EC → Release ${formatShortDate(releaseCc)} · Ticket ${formatShortDate(ticketCc)}`;
      }

      if (startDay != null && endDay != null) {
        const daySpan = endDay - startDay;
        row.actualOffset = Math.max(0, startDay);
        row.actualDuration = Math.max(1, Math.abs(daySpan));
        row.actualDaySpan = daySpan;
        row.actualInverted = daySpan < 0;
        row.actualSet = true;
        row.actualDateLabel = `${formatShortDate(ccStart)} → ${formatShortDate(ccEnd)}`;
        row.partial = !!actuals.partial?.cc;
      }

      return row;
    }

    const gateDate = fieldDate(m.fieldId);
    const gateDay = daysFromEc(gateDate);
    const actualDate = m.actualKey ? parseDate(actualByKey[m.actualKey]) : null;
    const actualDay = daysFromEc(actualDate);
    if (gateDay == null && actualDay == null) return null;

    const phaseStart = prevGateFor(m.key);
    const g = gateDay != null
      ? makeLeg(phaseStart, gateDay, formatShortDate(gateDate))
      : null;
    const a = actualDay != null
      ? makeLeg(phaseStart, actualDay, formatShortDate(actualDate))
      : null;

    return {
      ...emptyRowBase(m),
      gateOffset: g ? g.offset : 0,
      gateDuration: g ? g.duration : 0,
      actualOffset: a ? a.offset : 0,
      actualDuration: a ? a.duration : 0,
      gateSet: !!g,
      actualSet: !!a,
      gateDaySpan: g ? g.daySpan : null,
      actualDaySpan: a ? a.daySpan : null,
      gateInverted: g ? g.inverted : false,
      actualInverted: a ? a.inverted : false,
      gateDateLabel: g ? `${g.fromDateLabel} → ${g.toDateLabel}` : '—',
      actualDateLabel: a ? `${a.fromDateLabel} → ${a.toDateLabel}` : '—',
      phaseFromLabel: phaseStart.label,
      partial: m.actualKey ? !!actuals.partial?.[m.actualKey] : false,
    };
  }).filter(Boolean);

  return {
    rows,
    notes: actuals.notes || [],
    ecLabel: formatShortDate(ecDate),
  };
}

module.exports = {
  resolveReleaseGaDate,
  resolveReleaseCcDate,
  resolveActualGateDates,
  buildGateVsActualRows,
  parseDate,
  formatShortDate,
};
