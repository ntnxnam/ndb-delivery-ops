/**
 * Feature Dashboard enrichment — flow modes, kick-off, inference (Specs B–F).
 * Deterministic JIRA-derived signals; LLM may narrate on top later.
 */

import type { FeatureDashboardIssue, FeatureTiming } from './featureDashboardService.js';
import { FEATURE_PORTFOLIO_TYPES } from './featureDashboardService.js';

const DONE = new Set(['done', 'resolved', 'closed', 'complete', 'fixed']);

export interface EnrichedFlowPoint {
  day: string;
  /** All work items */
  created: number;
  resolved: number;
  open: number;
  /** Bug+Improvement Closed that day (changelog → Closed = QA verification) */
  verified: number;
  /** Bugs */
  bugCreated: number;
  bugResolved: number;
  bugOpen: number;
  /** Improvements */
  impCreated: number;
  impResolved: number;
  impOpen: number;
  /** Test issue type */
  testCreated: number;
  testResolved: number;
  testOpen: number;
}

export type FlowMode = 'daily' | 'weekly' | 'cumulative';

export interface KickoffState {
  status: 'missing' | 'incomplete' | 'done_on_time' | 'done_late' | 'hygiene';
  epicKey: string | null;
  epicSummary: string | null;
  epicStatus: string | null;
  childrenTotal: number;
  childrenClosed: number;
  childrenOpen: number;
  doneDate: string | null;
  ecDate: string | null;
  pastEc: boolean;
  message: string;
  jql: string;
}

export interface InferenceDriver {
  id: string;
  severity: 'green' | 'yellow' | 'red';
  text: string;
  /** Exact JIRA query that reproduces this claim (click-through authenticity). */
  jql?: string;
}

export interface FeatureInference {
  rag: 'Green' | 'Yellow' | 'Red';
  summary: string;
  drivers: InferenceDriver[];
  codingByPg: { open: number; total: number; onTrack: boolean; jql: string };
  companionByGa: { open: number; total: number; onTrack: boolean; jql: string };
}

/** Build `key in (...)` for the exact tickets behind a count. Empty → ''. */
export function keysToJql(keys: string[]): string {
  const uniq = [...new Set(keys.filter(Boolean))];
  if (uniq.length === 0) return '';
  if (uniq.length === 1) return `key = ${uniq[0]}`;
  return `key in (${uniq.join(',')})`;
}

const COMPANION_PREFIXES = ['TECHPUBS', 'SDL', 'LEG', 'SR', 'NDBQUAL'];
const KICKOFF_RE = /kick[\s\-_/.:]*off/i;

function isDoneStatus(status: string): boolean {
  return DONE.has((status || '').toLowerCase());
}

function toDate(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isBug(i: FeatureDashboardIssue): boolean {
  return (i.issueType || '').toLowerCase() === 'bug';
}

function isImprovement(i: FeatureDashboardIssue): boolean {
  return (i.issueType || '').toLowerCase() === 'improvement';
}

function isTestType(i: FeatureDashboardIssue): boolean {
  const t = (i.issueType || '').toLowerCase();
  return t === 'test' || t === 'unit test';
}

/**
 * QA verification = Bug/Improvement that transitioned to Closed (changelog).
 * Matches sprint-velocity-types / velocityService — not resolutiondate (dev resolve).
 */
function isQaVerificationCandidate(i: FeatureDashboardIssue): boolean {
  return isBug(i) || isImprovement(i);
}

function projectOf(key: string): string {
  const i = key.indexOf('-');
  return i > 0 ? key.slice(0, i).toUpperCase() : '';
}

export function isCompanionIssue(issue: FeatureDashboardIssue): boolean {
  const proj = projectOf(issue.key);
  if (COMPANION_PREFIXES.includes(proj)) return true;
  const t = (issue.issueType || '').toLowerCase();
  if (t === 'spike') return true;
  const labels = (issue.labels || []).map((l) => l.toLowerCase());
  if (labels.some((l) => l.includes('demo'))) return true;
  return false;
}

export function isCodingWorkItem(issue: FeatureDashboardIssue): boolean {
  if (FEATURE_PORTFOLIO_TYPES.has((issue.issueType || '').toLowerCase())) return false;
  if (isCompanionIssue(issue)) return false;
  if ((issue.issueType || '').toLowerCase() === 'test') return false;
  return true;
}

/** Daily enriched series — created/resolved are that-day counts; open is level. */
export function buildEnrichedFlowSeries(
  issues: FeatureDashboardIssue[],
  startIso: string,
  endIso: string
): EnrichedFlowPoint[] {
  const timeline: EnrichedFlowPoint[] = [];
  let cursor = toDate(startIso);
  const end = toDate(endIso);
  while (cursor <= end) {
    const day = isoDay(cursor);
    const created = issues.filter((i) => i.created === day).length;
    const resolved = issues.filter((i) => i.resolved === day).length;
    const open = issues.filter(
      (i) => (i.created || '') <= day && (!i.resolved || i.resolved > day)
    ).length;
    // Verified = QA closed that day (changelog → Closed), not resolutiondate.
    const verified = issues.filter(
      (i) => isQaVerificationCandidate(i) && i.closed === day
    ).length;

    const bugs = issues.filter(isBug);
    const imps = issues.filter(isImprovement);
    const tests = issues.filter(isTestType);

    timeline.push({
      day,
      created,
      resolved,
      open,
      verified,
      bugCreated: bugs.filter((i) => i.created === day).length,
      bugResolved: bugs.filter((i) => i.resolved === day).length,
      bugOpen: bugs.filter(
        (i) => (i.created || '') <= day && (!i.resolved || i.resolved > day)
      ).length,
      impCreated: imps.filter((i) => i.created === day).length,
      impResolved: imps.filter((i) => i.resolved === day).length,
      impOpen: imps.filter(
        (i) => (i.created || '') <= day && (!i.resolved || i.resolved > day)
      ).length,
      testCreated: tests.filter((i) => i.created === day).length,
      testResolved: tests.filter((i) => i.resolved === day).length,
      testOpen: tests.filter(
        (i) => (i.created || '') <= day && (!i.resolved || i.resolved > day)
      ).length,
    });
    cursor = new Date(cursor.getTime() + 86400000);
  }
  return timeline;
}

/** Roll daily points into ISO-week buckets (Mon-start). Point-in-time open = last day in bucket. */
export function aggregateFlowWeekly(daily: EnrichedFlowPoint[]): EnrichedFlowPoint[] {
  if (!daily.length) return [];
  const buckets = new Map<string, EnrichedFlowPoint[]>();
  for (const p of daily) {
    const d = toDate(p.day);
    const day = d.getUTCDay(); // 0 Sun
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const mon = new Date(d.getTime() + mondayOffset * 86400000);
    const key = isoDay(mon);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(p);
  }
  const out: EnrichedFlowPoint[] = [];
  for (const [weekStart, pts] of [...buckets.entries()].sort((a, b) =>
    a[0].localeCompare(b[0])
  )) {
    const last = pts[pts.length - 1]!;
    out.push({
      day: weekStart,
      created: pts.reduce((s, p) => s + p.created, 0),
      resolved: pts.reduce((s, p) => s + p.resolved, 0),
      open: last.open,
      verified: pts.reduce((s, p) => s + p.verified, 0),
      bugCreated: pts.reduce((s, p) => s + p.bugCreated, 0),
      bugResolved: pts.reduce((s, p) => s + p.bugResolved, 0),
      bugOpen: last.bugOpen,
      impCreated: pts.reduce((s, p) => s + p.impCreated, 0),
      impResolved: pts.reduce((s, p) => s + p.impResolved, 0),
      impOpen: last.impOpen,
      testCreated: pts.reduce((s, p) => s + p.testCreated, 0),
      testResolved: pts.reduce((s, p) => s + p.testResolved, 0),
      testOpen: last.testOpen,
    });
  }
  return out;
}

/** Cumulative sums for rate series; open/bugOpen/impOpen/testOpen stay as levels. */
export function toCumulativeFlow(points: EnrichedFlowPoint[]): EnrichedFlowPoint[] {
  let c = 0;
  let r = 0;
  let v = 0;
  let bc = 0;
  let br = 0;
  let ic = 0;
  let ir = 0;
  let tc = 0;
  let tr = 0;
  return points.map((p) => {
    c += p.created;
    r += p.resolved;
    v += p.verified;
    bc += p.bugCreated;
    br += p.bugResolved;
    ic += p.impCreated;
    ir += p.impResolved;
    tc += p.testCreated;
    tr += p.testResolved;
    return {
      day: p.day,
      created: c,
      resolved: r,
      open: p.open,
      verified: v,
      bugCreated: bc,
      bugResolved: br,
      bugOpen: p.bugOpen,
      impCreated: ic,
      impResolved: ir,
      impOpen: p.impOpen,
      testCreated: tc,
      testResolved: tr,
      testOpen: p.testOpen,
    };
  });
}

export function transformFlow(
  daily: EnrichedFlowPoint[],
  mode: FlowMode
): EnrichedFlowPoint[] {
  if (mode === 'weekly') return aggregateFlowWeekly(daily);
  if (mode === 'cumulative') return toCumulativeFlow(daily);
  return daily;
}

export function findKickoffEpic(
  issues: FeatureDashboardIssue[]
): FeatureDashboardIssue | null {
  const epics = issues.filter((i) => (i.issueType || '').toLowerCase() === 'epic');
  const hit = epics.find((e) => KICKOFF_RE.test(e.summary || ''));
  return hit || null;
}

export function evaluateKickoff(params: {
  epic: FeatureDashboardIssue | null;
  children: FeatureDashboardIssue[];
  ecDate: string | null;
  featureKey: string;
}): KickoffState {
  const { epic, children, ecDate, featureKey } = params;
  const baseJql = `issueFunction in issuesInEpics("issue = ${featureKey}") AND summary ~ "kickoff"`;

  if (!epic) {
    return {
      status: 'missing',
      epicKey: null,
      epicSummary: null,
      epicStatus: null,
      childrenTotal: 0,
      childrenClosed: 0,
      childrenOpen: 0,
      doneDate: null,
      ecDate,
      pastEc: Boolean(ecDate && isoDay(new Date()) > ecDate),
      message: 'No kick-off epic found (name should contain kickoff / kick-off).',
      jql: `issuetype = Epic AND summary ~ "kick" AND issueFunction in portfolioChildrenOf("issue = ${featureKey}")`,
    };
  }

  const kids = children.filter(
    (c) =>
      c.epicLink === epic.key ||
      // Parent link sometimes stored as epicLink for tasks
      false
  );
  // Prefer children linked via epicLink; if none, use all non-portfolio under same payload that mention epic in epicLink
  const linked =
    kids.length > 0
      ? kids
      : children.filter((c) => (c.epicLink || '') === epic.key);

  const closed = linked.filter((c) => isDoneStatus(c.status) && c.resolved);
  const openKids = linked.filter((c) => !isDoneStatus(c.status));
  const allChildrenClosed = linked.length > 0 && openKids.length === 0;
  const doneDate =
    allChildrenClosed && closed.length
      ? closed.map((c) => c.resolved!).sort().slice(-1)[0]!
      : null;

  const today = isoDay(new Date());
  const pastEc = Boolean(ecDate && today > ecDate);
  const epicStillOpen = !isDoneStatus(epic.status);

  let status: KickoffState['status'] = 'incomplete';
  let message = '';

  if (allChildrenClosed && epicStillOpen) {
    status = 'hygiene';
    message = `All ${linked.length} children closed but epic ${epic.key} is still ${epic.status}.`;
  } else if (allChildrenClosed && doneDate && ecDate && doneDate <= ecDate) {
    status = 'done_on_time';
    message = `Kick-off finished ${doneDate} (on/before EC ${ecDate}).`;
  } else if (allChildrenClosed && doneDate) {
    status = 'done_late';
    message = `Kick-off finished ${doneDate}${ecDate ? ` — after EC ${ecDate}` : ''}.`;
  } else if (pastEc) {
    status = 'incomplete';
    message = `Kick-off incomplete past EC${ecDate ? ` (${ecDate})` : ''}: ${openKids.length}/${linked.length || '?'} children open.`;
  } else {
    status = 'incomplete';
    message = `Kick-off in progress: ${openKids.length} of ${linked.length} children still open.`;
  }

  return {
    status,
    epicKey: epic.key,
    epicSummary: epic.summary,
    epicStatus: epic.status,
    childrenTotal: linked.length,
    childrenClosed: closed.length,
    childrenOpen: openKids.length,
    doneDate,
    ecDate,
    pastEc,
    message,
    // ScriptRunner: issuesInEpics(<jql that selects epics>). Inner must be real JQL
    // ("key = X"), not a bare key — bare key → parse error in JIRA search UI.
    jql: `issueFunction in issuesInEpics("key = ${epic.key}") OR key = ${epic.key}`,
  };
}

function daysUntil(iso: string | null): number | null {
  if (!iso) return null;
  return Math.round((toDate(iso).getTime() - Date.now()) / 86400000);
}

/**
 * Deterministic confidence: coding work by PG, companion/spoke by GA.
 * RAG + plain-English drivers for TPM skim.
 */
export function inferFeatureConfidence(params: {
  timing: FeatureTiming | null;
  kickoff: KickoffState | null;
  workItems: FeatureDashboardIssue[];
  gates: { ec?: string | null; pg?: string | null; ga?: string | null };
  hygieneWrongFixVersionCount?: number;
  /** Exact JQL for the hygiene count — must match wrongFixVersionKeys. */
  hygieneJql?: string;
  /** Optional scope JQL when a claim has no key list (e.g. not started). */
  workItemsScopeJql?: string;
}): FeatureInference {
  const { timing, kickoff, workItems, gates } = params;
  const drivers: InferenceDriver[] = [];
  const scopeJql = (params.workItemsScopeJql || '').trim();

  const coding = workItems.filter(isCodingWorkItem);
  const codingOpen = coding.filter((i) => !isDoneStatus(i.status));
  const companion = workItems.filter(isCompanionIssue);
  const companionOpen = companion.filter((i) => !isDoneStatus(i.status));
  const codingOpenJql = keysToJql(codingOpen.map((i) => i.key));
  const codingAllJql = keysToJql(coding.map((i) => i.key));
  const companionOpenJql = keysToJql(companionOpen.map((i) => i.key));
  const companionAllJql = keysToJql(companion.map((i) => i.key));
  const realStartJql = timing?.realStartKey ? keysToJql([timing.realStartKey]) : '';

  const daysToPg = daysUntil(gates.pg || null);
  const daysToGa = daysUntil(gates.ga || null);
  const pastPg = daysToPg != null && daysToPg < 0;
  const pastGa = daysToGa != null && daysToGa < 0;

  const codingOnTrack = codingOpen.length === 0 || (!pastPg && (daysToPg == null || daysToPg > 14 || codingOpen.length <= 5));
  const companionOnTrack =
    companionOpen.length === 0 || (!pastGa && (daysToGa == null || daysToGa > 14 || companionOpen.length <= 2));

  if (timing?.realStart == null) {
    drivers.push({
      id: 'not_started',
      severity: 'yellow',
      text: 'No work item has entered In Progress yet (real start missing).',
      jql: scopeJql || undefined,
    });
  } else if (timing.deltaDaysVsEc != null && timing.deltaDaysVsEc > 14) {
    drivers.push({
      id: 'late_start',
      severity: 'yellow',
      text: `Real start ${timing.realStart}${timing.realStartKey ? ` (${timing.realStartKey})` : ''} — ${timing.deltaDaysVsEc}d after release EC.`,
      jql: realStartJql || undefined,
    });
  } else if (timing.realStart) {
    drivers.push({
      id: 'started',
      severity: 'green',
      text: `Real start ${timing.realStart}${timing.realStartKey ? ` (${timing.realStartKey})` : ''}.`,
      jql: realStartJql || undefined,
    });
  }

  if (kickoff?.status === 'missing') {
    drivers.push({
      id: 'kickoff_missing',
      severity: 'yellow',
      text: kickoff.message,
      jql: kickoff.jql,
    });
  } else if (kickoff?.status === 'incomplete' && kickoff.pastEc) {
    drivers.push({
      id: 'kickoff_late',
      severity: 'red',
      text: kickoff.message,
      jql: kickoff.jql,
    });
  } else if (kickoff?.status === 'done_late') {
    drivers.push({
      id: 'kickoff_done_late',
      severity: 'yellow',
      text: kickoff.message,
      jql: kickoff.jql,
    });
  } else if (kickoff?.status === 'hygiene') {
    drivers.push({
      id: 'kickoff_hygiene',
      severity: 'yellow',
      text: kickoff.message,
      jql: kickoff.jql,
    });
  } else if (kickoff?.status === 'done_on_time') {
    drivers.push({
      id: 'kickoff_ok',
      severity: 'green',
      text: kickoff.message,
      jql: kickoff.jql,
    });
  }

  if (codingOpen.length > 0 && pastPg) {
    drivers.push({
      id: 'coding_past_pg',
      severity: 'red',
      text: `${codingOpen.length} coding items still open past PG.`,
      jql: codingOpenJql || undefined,
    });
  } else if (codingOpen.length > 0 && daysToPg != null && daysToPg <= 14) {
    drivers.push({
      id: 'coding_near_pg',
      severity: 'yellow',
      text: `${codingOpen.length} coding items open with ${daysToPg}d to PG.`,
      jql: codingOpenJql || undefined,
    });
  } else if (codingOpen.length === 0 && coding.length > 0) {
    drivers.push({
      id: 'coding_done',
      severity: 'green',
      text: 'Coding work items are closed (excludes Test / companion spokes).',
      jql: codingAllJql || undefined,
    });
  }

  const qaQueueItems = workItems.filter(
    (i) =>
      (isBug(i) || isImprovement(i)) &&
      (i.status || '').toLowerCase() === 'resolved'
  );
  if (qaQueueItems.length > 10) {
    drivers.push({
      id: 'qa_queue',
      severity: 'yellow',
      text: `${qaQueueItems.length} Bug/Improvement tickets awaiting QA close (Resolved).`,
      jql: keysToJql(qaQueueItems.map((i) => i.key)) || undefined,
    });
  }

  if (companionOpen.length > 0 && pastGa) {
    drivers.push({
      id: 'companion_past_ga',
      severity: 'red',
      text: `${companionOpen.length} companion/spoke items open past GA (SDL/LEG/TECHPUBS/SR/Spike).`,
      jql: companionOpenJql || undefined,
    });
  } else if (companionOpen.length > 0 && daysToGa != null && daysToGa <= 21) {
    drivers.push({
      id: 'companion_near_ga',
      severity: 'yellow',
      text: `${companionOpen.length} companion/spoke items open with ${daysToGa}d to GA.`,
      jql: companionOpenJql || undefined,
    });
  } else if (companion.length === 0) {
    drivers.push({
      id: 'companion_none',
      severity: 'yellow',
      text: 'No companion/spoke tickets detected under this feature yet.',
      jql: scopeJql || undefined,
    });
  } else if (companionOpen.length === 0) {
    drivers.push({
      id: 'companion_done',
      severity: 'green',
      text: 'Companion/spoke tickets are closed.',
      jql: companionAllJql || undefined,
    });
  }

  if ((params.hygieneWrongFixVersionCount || 0) > 0) {
    drivers.push({
      id: 'fixversion_hygiene',
      severity: 'yellow',
      text: `${params.hygieneWrongFixVersionCount} work items not on this release fixVersion (hygiene).`,
      jql: params.hygieneJql || undefined,
    });
  }

  const hasRed = drivers.some((d) => d.severity === 'red');
  const hasYellow = drivers.some((d) => d.severity === 'yellow');
  const rag: FeatureInference['rag'] = hasRed ? 'Red' : hasYellow ? 'Yellow' : 'Green';

  const top = drivers.filter((d) => d.severity === (hasRed ? 'red' : hasYellow ? 'yellow' : 'green'))[0];
  const summary =
    rag === 'Green'
      ? 'On track for timely completion on current signals.'
      : top?.text || `${rag} — review drivers.`;

  return {
    rag,
    summary,
    drivers,
    codingByPg: {
      open: codingOpen.length,
      total: coding.length,
      onTrack: codingOnTrack && !pastPg,
      jql: codingOpenJql || codingAllJql || '',
    },
    companionByGa: {
      open: companionOpen.length,
      total: companion.length,
      onTrack: companionOnTrack && !pastGa,
      jql: companionOpenJql || companionAllJql || '',
    },
  };
}
