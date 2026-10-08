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

  return {
    key: jiraData.key,
    summary: jiraData.summary,
    status: jiraData.status,
    issueType: jiraData.issueType,
    fixVersions: jiraData.fixVersions,
    labels,
    customfield_23560: unwrapField(jiraData.customfield_23560),
    customfield_47780: unwrapField(jiraData.customfield_47780),
    customfield_55664: unwrapField(jiraData.customfield_55664),
    customfield_11067: unwrapField(jiraData.customfield_11067),
    customfield_11068: unwrapField(jiraData.customfield_11068),
    customfield_13861: unwrapField(jiraData.customfield_13861),
    customfield_35863: unwrapField(jiraData.customfield_35863),
    customfield_35864: unwrapField(jiraData.customfield_35864),
    customfield_45660: unwrapField(jiraData.customfield_45660),
    customfield_23073: unwrapField(jiraData.customfield_23073),
    customfield_14463: unwrapField(jiraData.customfield_14463),
    customfield_14464: unwrapField(jiraData.customfield_14464),
    customfield_14465: unwrapField(jiraData.customfield_14465),
    customfield_10860: jiraData.customfield_10860 || null,
    customfield_27764: jiraData.customfield_27764 || null,
    customfield_38460: unwrapField(jiraData.customfield_38460),
  };
}

/** Sequential milestones after EC (release EC is the timeline origin). */
const SEQUENTIAL_GATES = [
  { key: 'fsds', label: 'FS/DS Done', fieldId: 'customfield_13861', color: '#6c757d' },
  { key: 'testPlan', label: 'Test Plan', fieldId: 'customfield_11068', color: '#17a2b8' },
  { key: 'cc', label: 'Code Complete', fieldId: 'customfield_11067', color: '#1f77b4' },
  { key: 'cg', label: 'Commit Gate', fieldId: 'customfield_35863', color: '#ff7f0e' },
  { key: 'pg', label: 'Promotion Gate', fieldId: 'customfield_35864', color: '#2ca02c' },
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

/**
 * Sequential gate segments from EC → FS/DS → Test Plan → CC → CG → PG.
 * Each bar is the duration of one leg (waterfall offset from EC).
 *
 * @returns {{
 *   ecDate: Date|null,
 *   ecLabel: string,
 *   segments: Array<{
 *     key, label, fromLabel, toLabel, fromDateLabel, toDateLabel,
 *     offset, duration, color, inverted
 *   }>,
 *   missing: string[]
 * }}
 */
export function buildSequentialGateSegments(jiraData, ecDateInput) {
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

  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const rawDays = Math.round((to.date.getTime() - from.date.getTime()) / MS_PER_DAY);
    const inverted = rawDays < 0;
    const duration = Math.max(1, Math.abs(rawDays)); // min 1 day so a same-day leg still draws
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

  return {
    ecDate,
    ecLabel: formatShortDate(ecDate),
    segments,
    missing,
  };
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
