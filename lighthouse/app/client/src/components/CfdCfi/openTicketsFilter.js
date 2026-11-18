/**
 * Client-side filters for open-ticket drill modes (from pulse hero clicks).
 * Rows come from the KPI openTickets sample; counts may exceed sample (truncated).
 */

import { PULSE_PANEL_HERO_KEYS } from '../KpiPulse/pulsePanelHeroKeys';

const P0_RE = /blocker|p0/i;
const P1_RE = /critical|p1/i;

export const DRILL_MODES = {
  openNow: { title: 'Open now', match: () => true, hasOpenSample: true },
  agedOpen: {
    title: 'Aged open',
    match: (row, { agedDays = 14 } = {}) =>
      row.ageDays != null && row.ageDays >= agedDays,
    hasOpenSample: true,
  },
  p0Open: {
    title: 'P0 open',
    match: (row) => P0_RE.test(String(row.priority || '')),
    hasOpenSample: true,
  },
  p1Open: {
    title: 'P1 open',
    match: (row) => P1_RE.test(String(row.priority || '')),
    hasOpenSample: true,
  },
  tbv: {
    title: 'Awaiting QA',
    match: (row) => /^resolved$/i.test(String(row.status || '').trim()),
    hasOpenSample: true,
  },
  // Titles only — these heroes no longer open the drawer (count → JIRA in KpiPulseBand).
  createdWindow: { title: 'Created', match: null, hasOpenSample: false },
  resolvedWindow: { title: 'Resolved (resolutiondate)', match: null, hasOpenSample: false },
  mttrMedian: { title: 'Typical wait (resolved sample)', match: null, hasOpenSample: false },
  mttrP90: { title: 'Slow tail (resolved sample)', match: null, hasOpenSample: false },
};

/** Heroes that filter the openTickets sample in the drawer (= PULSE_PANEL_HERO_KEYS). */
export const CFD_DRILL_HERO_KEYS = [...PULSE_PANEL_HERO_KEYS];

export function filterOpenTickets(issues, mode, opts = {}) {
  const spec = DRILL_MODES[mode];
  if (!spec?.hasOpenSample || !spec.match) return [];
  const list = Array.isArray(issues) ? issues : [];
  return list.filter((row) => spec.match(row, opts));
}

export function drillTitle(mode, kpiName) {
  const spec = DRILL_MODES[mode];
  const title = spec?.title || String(mode || 'Hero');
  return `${title} — ${kpiName || 'KPI'}`;
}

export function modeHasOpenSample(mode) {
  return Boolean(DRILL_MODES[mode]?.hasOpenSample);
}
