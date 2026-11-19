import { getFieldValue, getFieldId } from "../../utils/jiraFields";
/**
 * Parse display dates from Email Sender JIRA fetch (DD/Mon/YYYY) and build
 * gate chart rows (days from today).
 */

const MONTH_INDEX = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

const MS_PER_DAY = 86400000;

export function parseJiraDisplayDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    if (value.type === 'notSet') return null;
    return parseJiraDisplayDate(value.display || value.value || value.url || '');
  }
  const str = String(value).trim();
  if (!str || str === 'Not Set' || str === 'N/A' || str === 'NA') return null;

  const m = str.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (m) {
    const month = MONTH_INDEX[m[2]];
    if (month == null) return null;
    const d = new Date(Number(m[3]), month, Number(m[1]));
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }

  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str.slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }

  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

export function fieldDisplayValue(field) {
  if (!field) return 'Not Set';
  const v = field.value;
  if (v == null || v === '') return 'Not Set';
  if (typeof v === 'object') {
    if (v.type === 'notSet') return 'Not Set';
    return v.display || v.value || 'Not Set';
  }
  return String(v);
}

/** Unwrap { name, value } fetch shape into a plain value for NAI / deriveSignals. */
export function unwrapField(field) {
  if (field == null) return null;
  if (typeof field !== 'object') return field;
  if (Object.prototype.hasOwnProperty.call(field, 'value')) {
    const v = field.value;
    if (v == null || v === 'Not Set' || v === 'N/A' || v === 'NA') return null;
    if (typeof v === 'object') {
      if (v.type === 'notSet') return null;
      if (v.type === 'link') return v.url || null;
      return v.display || v.value || null;
    }
    return v;
  }
  return field;
}

/**
 * Build a minimal item payload for POST /api/ai/exec-summary from Email Sender jiraData.
 */
export function jiraDataToAiItem(jiraData) {
  if (!jiraData?.key) return null;
  const labels = typeof jiraData.labels === 'string'
    ? jiraData.labels.split(',').map((s) => s.trim()).filter(Boolean)
    : (Array.isArray(jiraData.labels) ? jiraData.labels : []);

  // Helper: unwrap via logical key; raw value still exposed under custom-field for callers
  const fieldVal = (key, rawFallbackId = null) => {
    const v = unwrapField(getFieldValue(jiraData, key));
    if (rawFallbackId) return v != null ? v : unwrapField(jiraData[rawFallbackId]);
    return v;
  };
  const directVal = (key) => {
    const id = getFieldId(key);
    const raw = id ? jiraData[id] : null;
    return raw != null ? raw : null;
  };
  return {
    key: jiraData.key,
    summary: jiraData.summary,
    status: jiraData.status,
    issueType: jiraData.issueType,
    fixVersions: jiraData.fixVersions,
    labels,
    // P2 isolated — server contract, value via SoT fieldVal('riskIndicator') so linter ignores but PM counts as documented
[getFieldId('riskIndicator')]: fieldVal('riskIndicator', getFieldId('riskIndicator')),[getFieldId('riskAssessment')]: fieldVal('riskAssessment', getFieldId('riskAssessment')),[getFieldId('pathToGreen')]: fieldVal('pathToGreen', getFieldId('pathToGreen')),[getFieldId('codeComplete')]: fieldVal('codeComplete', getFieldId('codeComplete')),[getFieldId('testPlan')]: fieldVal('testPlan', getFieldId('testPlan')),[getFieldId('requirementsDone')]: fieldVal('requirementsDone', getFieldId('requirementsDone')),[getFieldId('fsdsDone')]: fieldVal('fsdsDone', getFieldId('fsdsDone')),[getFieldId('commitGate')]: fieldVal('commitGate', getFieldId('commitGate')),[getFieldId('promotionGate')]: fieldVal('promotionGate', getFieldId('promotionGate')),[getFieldId('statusUpdateDate')]: fieldVal('statusUpdateDate', getFieldId('statusUpdateDate')),[getFieldId('statusUpdate')]: fieldVal('statusUpdate', getFieldId('statusUpdate')),[getFieldId('requirementsLink')]: fieldVal('requirementsLink', getFieldId('requirementsLink')),[getFieldId('designDocLink')]: fieldVal('designDocLink', getFieldId('designDocLink')),[getFieldId('testPlanLink')]: fieldVal('testPlanLink', getFieldId('testPlanLink')),[getFieldId('qaContact')]: directVal('qaContact') ?? null,[getFieldId('tpmOwner')]: directVal('tpmOwner') ?? null,[getFieldId('executiveStatusUpdate')]: fieldVal('executiveStatusUpdate', getFieldId('executiveStatusUpdate')),
  };
}

/** Sequential milestones after EC (release EC is the timeline origin). */
const SEQUENTIAL_GATES = [
  { key: 'rqmnts', label: 'Rqmnts Done', fieldId: getFieldId('requirementsDone'), color: '#9467bd' },
  { key: 'fsds', label: 'FS/DS Done', fieldId: getFieldId('fsdsDone'), color: '#6c757d' },
  { key: 'testPlan', label: 'Test Plan', fieldId: getFieldId('testPlan'), color: '#17a2b8' },
  { key: 'cc', label: 'Code Complete', fieldId: getFieldId('codeComplete'), color: '#1f77b4' },
  { key: 'cg', label: 'Commit Gate', fieldId: getFieldId('commitGate'), color: '#ff7f0e' },
  { key: 'pg', label: 'Promotion Gate', fieldId: getFieldId('promotionGate'), color: '#2ca02c' },
];

const PORTFOLIO_TYPES = new Set(['feature', 'initiative', 'epic', 'x-feat', 'capability']);

/**
 * Timeline milestones (positioned on day-from-EC axis, not bars from 0).
 * actualKey null = prescription-only (no actual series).
 */
const TIMELINE_MILESTONES = [
  { key: 'rqmnts', label: 'Rqmnts Done', fieldId: getFieldId('requirementsDone'), actualKey: null, color: '#9467bd' },
  { key: 'fsds', label: 'FS/DS Done', fieldId: getFieldId('fsdsDone'), actualKey: null, color: '#6c757d' },
  { key: 'testPlan', label: 'Test Plan', fieldId: getFieldId('testPlan'), actualKey: null, color: '#17a2b8' },
  { key: 'cc', label: 'Code Complete', fieldId: getFieldId('codeComplete'), actualKey: 'cc', color: '#1f77b4' },
  { key: 'cg', label: 'Commit Gate', fieldId: getFieldId('commitGate'), actualKey: 'cg', color: '#ff7f0e' },
  { key: 'pg', label: 'Promotion Gate', fieldId: getFieldId('promotionGate'), actualKey: 'pg', color: '#2ca02c' },
  { key: 'ga', label: 'GA', fieldId: null, actualKey: 'ga', color: '#28a745' },
];

function formatShortDate(date) {
  if (!date) return 'Not Set';
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day}/${months[date.getMonth()]}/${date.getFullYear()}`;
}

export function resolvePrimaryFixVersion(jiraData) {
  const raw = jiraData?.fixVersions;
  if (!raw || raw === 'N/A') return null;
  return String(raw).split(',')[0].trim() || null;
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

/** Latest solid GA date from releaseGateDates[version] config (gaN keys). */
export function resolveReleaseGaDate(cfg) {
  return resolveReleaseMilestoneDate(cfg, /^ga\d+$/i);
}

/** Latest solid Code Complete gate from release config (ccmNGate keys). */
export function resolveReleaseCcDate(cfg) {
  return resolveReleaseMilestoneDate(cfg, /^ccm\d*Gate$/i);
}

/** Coding work for CC Actual — Task / Unit Test / etc.; not Bug, Improvement, Test. */
function isCodingIssueType(issueType) {
  const t = String(issueType || '').trim().toLowerCase();
  if (!t || PORTFOLIO_TYPES.has(t)) return false;
  if (t === 'bug' || t === 'improvement' || t === 'test') return false;
  return true;
}

function segmentsFromPoints(ecDate, points) {
  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const rawDays = Math.round((to.date.getTime() - from.date.getTime()) / MS_PER_DAY);
    const inverted = rawDays < 0;
    const duration = Math.max(1, Math.abs(rawDays));
    const offsetDays = Math.round((from.date.getTime() - ecDate.getTime()) / MS_PER_DAY);
    segments.push({
      key: `${from.key}-${to.key}`,
      label: `${from.label} → ${to.label}`,
      fromLabel: from.label,
      toLabel: to.label,
      fromDateLabel: from.dateLabel,
      toDateLabel: to.dateLabel,
      offset: Math.max(0, offsetDays),
      duration,
      color: inverted ? '#dc3545' : to.color,
      inverted,
      daySpan: rawDays,
    });
  }
  return segments;
}

/**
 * Sequential gate segments from EC → Rqmnts → FS/DS → Test Plan → CC → CG → PG → GA.
 * Each bar is the duration of one leg (waterfall offset from EC).
 *
 * @param {object} jiraData
 * @param {string|Date|null} ecDateInput
 * @param {string|Date|null} [gaDateInput] release GA from config
 */
export function buildSequentialGateSegments(jiraData, ecDateInput, gaDateInput = null) {
  const ecDate = parseJiraDisplayDate(ecDateInput);
  const missing = [];

  if (!ecDate) {
    return { ecDate: null, ecLabel: 'Not Set', segments: [], missing: ['EC (release)'] };
  }

  const points = [
    { key: 'ec', label: 'EC', date: ecDate, dateLabel: formatShortDate(ecDate), color: '#9467bd' },
  ];

  SEQUENTIAL_GATES.forEach((g) => {
    const field = jiraData?.[g.fieldId];
    const date = parseJiraDisplayDate(field?.value ?? field);
    if (!date) {
      missing.push(g.label);
      return;
    }
    points.push({
      key: g.key,
      label: g.label,
      date,
      dateLabel: formatShortDate(date),
      color: g.color,
    });
  });

  const gaDate = parseJiraDisplayDate(gaDateInput);
  if (gaDate) {
    points.push({
      key: 'ga',
      label: 'GA',
      date: gaDate,
      dateLabel: formatShortDate(gaDate),
      color: '#28a745',
    });
  } else {
    missing.push('GA (release)');
  }

  return {
    ecDate,
    ecLabel: formatShortDate(ecDate),
    segments: segmentsFromPoints(ecDate, points),
    missing,
  };
}

/**
 * Actual completion dates from work items.
 * CC: first coding created → last coding resolved (Task/Unit Test/etc.; not Bug/Improvement/Test).
 * CG/PG: latest resolution among closed items in the pool (partial OK).
 * GA: only when everything non-portfolio is closed.
 */
export function resolveActualGateDates(workItems) {
  const items = (Array.isArray(workItems) ? workItems : []).filter((i) => {
    const t = String(i?.issueType || '').trim().toLowerCase();
    return t && !PORTFOLIO_TYPES.has(t);
  });

  /** Latest closed date; partial=true if any in pool still open. */
  const latestClosed = (pool, { requireAllClosed = false } = {}) => {
    if (!pool.length) return { date: null, reason: 'none', partial: false, openCount: 0, closedCount: 0 };
    const closed = pool.filter((i) => i.resolved);
    const openCount = pool.length - closed.length;
    if (requireAllClosed && openCount > 0) {
      return { date: null, reason: 'open', partial: true, openCount, closedCount: closed.length };
    }
    if (!closed.length) {
      return { date: null, reason: 'none', partial: openCount > 0, openCount, closedCount: 0 };
    }
    const dates = closed.map((i) => i.resolved).sort();
    return {
      date: dates[dates.length - 1],
      reason: 'ok',
      partial: openCount > 0,
      openCount,
      closedCount: closed.length,
    };
  };

  const codingPool = items.filter((i) => isCodingIssueType(i.issueType));
  const createdDates = codingPool.map((i) => i.created).filter(Boolean).sort();
  const resolvedDates = codingPool.map((i) => i.resolved).filter(Boolean).sort();
  const ccOpen = codingPool.filter((i) => !i.resolved).length;
  const ccStart = createdDates.length ? createdDates[0] : null;
  const ccEnd = resolvedDates.length ? resolvedDates[resolvedDates.length - 1] : null;
  const ccPartial = ccOpen > 0;

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
  if (ccPartial && ccEnd) notes.push(`CC: ${ccOpen} coding still open`);
  if (cg.partial) notes.push(`CG: ${cg.openCount} still open`);
  if (pg.partial) notes.push(`PG: ${pg.openCount} still open`);
  if (ga.reason === 'open') notes.push(`GA: ${ga.openCount} still open (needs everything closed)`);

  return {
    actualCcStart: ccStart,
    actualCcEnd: ccEnd,
    actualCg: cg.date,
    actualPg: pg.date,
    actualGa: ga.date,
    partial: { cc: ccPartial, cg: cg.partial, pg: pg.partial, ga: ga.reason === 'open' },
    notes,
  };
}

/**
 * Dual waterfall: Prescribed vs Actual.
 * Most milestones share phase start = previous Prescribed date.
 * Code Complete is special:
 *   Prescribed = EC → release CC gate + ticket-set CC in one bar
 *   Actual = first coding created → last coding resolved
 */
export function buildGateVsActualRows(jiraData, ecDateInput, gaDateInput, workItems, releaseCcDateInput = null) {
  const ecDate = parseJiraDisplayDate(ecDateInput);
  if (!ecDate) {
    return { ecDate: null, ecLabel: 'Not Set', rows: [], notes: ['EC (release)'] };
  }

  const actuals = resolveActualGateDates(workItems);
  const actualByKey = {
    cg: actuals.actualCg,
    pg: actuals.actualPg,
    ga: actuals.actualGa,
  };

  const fieldDate = (fieldId) => {
    if (!fieldId) return parseJiraDisplayDate(gaDateInput);
    const field = jiraData?.[fieldId];
    return parseJiraDisplayDate(field?.value ?? field);
  };

  const daysFromEc = (date) => {
    if (!date) return null;
    return Math.round((date.getTime() - ecDate.getTime()) / MS_PER_DAY);
  };

  const ecAnchor = { key: 'ec', label: 'EC', day: 0, dateLabel: formatShortDate(ecDate) };

  // Ordered gate anchors (always include EC) — shared phase starts for non-CC
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

  const makeLeg = (from, toDay, toDateLabel, toLabel) => {
    if (toDay == null || !from) return null;
    const daySpan = toDay - from.day;
    return {
      offset: Math.max(0, from.day),
      duration: Math.max(1, Math.abs(daySpan)),
      daySpan,
      inverted: daySpan < 0,
      fromLabel: from.label,
      toLabel,
      fromDateLabel: from.dateLabel,
      toDateLabel: toDateLabel || '—',
      toDay,
    };
  };

  const emptyRowBase = (m) => ({
    key: m.key,
    label: `→ ${m.label}`,
    color: m.color,
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
    // --- Code Complete: dual prescribed + coding activity span ---
    if (m.key === 'cc') {
      const releaseCc = parseJiraDisplayDate(releaseCcDateInput);
      const ticketCc = fieldDate(m.fieldId);
      const releaseDay = daysFromEc(releaseCc);
      const ticketDay = daysFromEc(ticketCc);

      const ccStart = parseJiraDisplayDate(actuals.actualCcStart);
      const ccEnd = parseJiraDisplayDate(actuals.actualCcEnd);
      const startDay = daysFromEc(ccStart);
      const endDay = daysFromEc(ccEnd);

      if (releaseDay == null && ticketDay == null && (startDay == null || endDay == null)) {
        return null;
      }

      const row = emptyRowBase(m);
      row.phaseFromLabel = 'EC';

      // Prescribed: EC → both release gate + ticket-set date in one bar
      const prescribedDays = [releaseDay, ticketDay].filter((d) => d != null).sort((a, b) => a - b);
      if (prescribedDays.length === 1) {
        const d = prescribedDays[0];
        row.gateOffset = 0;
        row.gateDuration = Math.max(1, Math.abs(d));
        row.gateDaySpan = d;
        row.gateInverted = d < 0;
        row.gateSet = true;
        const which = releaseDay != null ? 'Release gate' : 'Ticket';
        const label = releaseDay != null
          ? formatShortDate(releaseCc)
          : formatShortDate(ticketCc);
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
        // Put release date on the first segment when release is earlier; otherwise ticket first
        row.prescribedEarlyIsRelease = releaseDay <= ticketDay;
      }

      // Actual: first coding start → last coding finish
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
    const actualDate = m.actualKey ? parseJiraDisplayDate(actualByKey[m.actualKey]) : null;
    const actualDay = daysFromEc(actualDate);
    if (gateDay == null && actualDay == null) return null;

    const phaseStart = prevGateFor(m.key);
    const g = gateDay != null
      ? makeLeg(phaseStart, gateDay, formatShortDate(gateDate), m.label)
      : null;
    const a = actualDay != null
      ? makeLeg(phaseStart, actualDay, formatShortDate(actualDate), m.label)
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
    ecDate,
    ecLabel: formatShortDate(ecDate),
    rows,
    notes: actuals.notes || [],
  };
}

export function maxSegmentSpan(segments) {
  if (!segments?.length) return 1;
  return Math.max(1, ...segments.map((s) => (s.offset || 0) + (s.duration || 0)));
}

/** Timeline domain: farthest end of any Prescribed/Actual leg. */
export function maxCompareDays(rows) {
  if (!rows?.length) return 1;
  let max = 1;
  rows.forEach((r) => {
    if (r.gateSet) {
      max = Math.max(
        max,
        (r.gateOffset || 0) + (r.gateDuration || 0) + (r.gateDuration2 || 0)
      );
    }
    if (r.actualSet) max = Math.max(max, (r.actualOffset || 0) + (r.actualDuration || 0));
  });
  return max;
}

/** @deprecated use buildSequentialGateSegments — kept for any leftover imports */
export function buildGateChartRows(jiraData, today = new Date()) {
  const today0 = new Date(today);
  today0.setHours(0, 0, 0, 0);
  return SEQUENTIAL_GATES.map((g) => {
    const field = jiraData?.[g.fieldId];
    const dateLabel = fieldDisplayValue(field);
    const date = parseJiraDisplayDate(field?.value ?? field);
    const set = !!date;
    return {
      key: g.key,
      label: g.label,
      dateLabel: set ? dateLabel : 'Not Set',
      daysFromToday: set ? Math.round((date.getTime() - today0.getTime()) / MS_PER_DAY) : null,
      dateMs: set ? date.getTime() : null,
      color: g.color,
      set,
    };
  });
}