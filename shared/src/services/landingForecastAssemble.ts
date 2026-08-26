/**
 * landingForecastAssemble — pure forecast math shared by the live-JIRA
 * and trunk (cached-ticket) landing-forecast paths.
 *
 * Algorithms kept identical to Streamlit:
 *   - classifyConfidence  ← `_classify_confidence`
 *   - classifyVerdict     ← `_classify_verdict`
 *   - gapPhrase           ← `_gap_phrase`
 *   - buildForecastOneLiner ← `_build_one_liner`
 *
 * Inflow stays at 0 (TODO(parity): release-scoped inflow). Do not
 * reintroduce an unscoped created-date inflow query.
 */

import {
  NDB_SPRINT_CALENDAR,
  type SprintCalendar,
  currentSprint as currentSprintNumber,
  sprintFor,
  sprintWindow,
} from './sprintsService.js';
import {
  QA_VERIFICATION_EFFORT_RATIO,
  type SprintVelocityResult,
} from './velocityService.js';

export const FORECAST_VERDICT_COLORS: Record<ForecastVerdict, string> = {
  on_time: '#15803D',
  slipping: '#D97706',
  at_risk: '#B91C1C',
  shipped: '#6B7280',
  not_started: '#1F4E79',
  unknown: '#6B7280',
};

export const FORECAST_VERDICT_LABELS: Record<ForecastVerdict, string> = {
  on_time: 'ON TIME',
  slipping: 'SLIPPING',
  at_risk: 'AT RISK',
  shipped: 'SHIPPED',
  not_started: 'NOT STARTED',
  unknown: 'UNKNOWN',
};

export const FORECAST_CONFIDENCE_LABELS: Record<ForecastConfidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  insufficient: 'Not enough data yet',
};

export type ForecastVerdict =
  | 'on_time'
  | 'slipping'
  | 'at_risk'
  | 'shipped'
  | 'not_started'
  | 'unknown';

export type ForecastConfidence = 'high' | 'medium' | 'low' | 'insufficient';

export interface LandingForecastResult {
  release: string;
  plannedGaDate: string | null;
  plannedGaSprint: number | null;
  forecastGaDate: string | null;
  forecastGaSprint: number | null;
  gapSprints: number | null;
  gapWeeks: number | null;

  unresolved: number;
  pendingVerification: number;
  recentVelocity: number;
  elapsedSprints: number;
  velocityCv: number | null;

  verdict: ForecastVerdict;
  confidence: ForecastConfidence;
  oneLiner: string;
  recommendedAction: string;

  jqlUnresolved: string;
  jqlPendingVerification: string;
  forecastMethod: 'fallback_running' | 'curve_based' | 'curve_with_inflow';

  netInflowPerSprint: number;
  effectiveVelocity: number;
  daysRemainingToday: number;
  todayCapacityItems: number;

  devUnresolved: number;
  jqlDevUnresolved: string;
  qaVerificationPending: number;
  jqlQaVerificationPending: string;
  qaTestTasksUnresolved: number;
  jqlQaTestTasksUnresolved: string;

  baselineVelocity: number;
  velocityVsBaselinePct: number | null;
  payloadTotal: number;

  weightedOutstanding: number;
  weightedInflowPerSprint: number;
  sprintsRemaining: number | null;
  requiredVelocity: number | null;

  errors: string[];
  /** `cache` = release-dataset trunk; `live` = JIRA searchCount. */
  dataSource: 'cache' | 'live';
}

export interface LandingForecastCounts {
  unresolved: number;
  pendingVerification: number;
  payloadTotal: number;
  recentSprints: SprintVelocityResult[];
  devUnresolved: number;
  qaVerificationPending: number;
  qaTestTasksUnresolved: number;
  jqlUnresolved: string;
  jqlPendingVerification: string;
  jqlDevUnresolved: string;
  jqlQaVerificationPending: string;
  jqlQaTestTasksUnresolved: string;
  errors: string[];
}

export interface AssembleLandingForecastOptions {
  release: string;
  plannedGaIso?: string | null;
  sprintCalendar?: SprintCalendar;
  now?: Date;
  dataSource: 'cache' | 'live';
}

/**
 * Streamlit `_classify_confidence` — VERBATIM.
 */
export function classifyConfidence(
  elapsed: number,
  velocityCv: number | null
): ForecastConfidence {
  if (elapsed <= 0) return 'insufficient';
  if (elapsed === 1) return 'low';
  const cv =
    velocityCv !== null && Number.isFinite(velocityCv) ? velocityCv : 1.0;
  if (elapsed >= 4 && cv < 0.25) return 'high';
  return 'medium';
}

/**
 * Streamlit `_classify_verdict` — VERBATIM.
 */
export function classifyVerdict(
  burnStatus: string,
  gapSprints: number | null
): ForecastVerdict {
  if (burnStatus === 'Shipped') return 'shipped';
  if (
    burnStatus === 'Not started' ||
    burnStatus === 'Missing EC' ||
    burnStatus === 'Missing GA'
  ) {
    return 'not_started';
  }
  if (gapSprints === null) return 'unknown';
  if (gapSprints <= 0) return 'on_time';
  if (gapSprints === 1) return 'slipping';
  return 'at_risk';
}

/**
 * Streamlit `_gap_phrase` — VERBATIM.
 */
export function gapPhrase(gapSprints: number): string {
  const weeks = Math.abs(gapSprints) * 3;
  if (gapSprints === 0) return 'on the planned date';
  if (gapSprints > 0) {
    const word = gapSprints === 1 ? 'sprint' : 'sprints';
    return `${weeks} weeks late (${gapSprints} ${word})`;
  }
  const word = gapSprints === -1 ? 'sprint' : 'sprints';
  return `${weeks} weeks early (${Math.abs(gapSprints)} ${word})`;
}

function formatDate(iso: string | null): string {
  return iso ?? 'TBD';
}

export function buildForecastOneLiner(
  fc: LandingForecastResult,
  burnStatus: string
): string {
  if (fc.verdict === 'shipped') {
    return `${fc.release} shipped on ${formatDate(fc.plannedGaDate)}.`;
  }
  if (fc.verdict === 'not_started') {
    if (!fc.plannedGaDate) {
      return `${fc.release} has no EC/GA configured yet — forecast unavailable.`;
    }
    return `${fc.release} has not started yet (planned GA: ${formatDate(
      fc.plannedGaDate
    )}).`;
  }
  const planned = formatDate(fc.plannedGaDate);
  const forecast = formatDate(fc.forecastGaDate);
  if (fc.gapSprints === null || fc.forecastGaDate === null) {
    if (fc.unresolved === 0) {
      return `${fc.release}: all tracked work is resolved. Planned GA: ${planned}.`;
    }
    return `${fc.release}: not enough velocity data yet to forecast a landing date (planned GA: ${planned}).`;
  }
  if (fc.gapSprints <= 0) {
    return `${fc.release} is on track to land ${gapPhrase(
      fc.gapSprints
    )} (forecast: ${forecast}, planned GA: ${planned}).`;
  }
  return `${fc.release} is forecast to land ${gapPhrase(
    fc.gapSprints
  )} (forecast: ${forecast}, planned GA: ${planned}).`;
}

function buildRecommendedAction(
  fc: LandingForecastResult,
  burnStatus: string
): string {
  if (fc.verdict === 'shipped') return '';
  if (fc.verdict === 'not_started') {
    return 'Confirm EC / GA gate dates on the release so the forecast can engage.';
  }
  if (fc.verdict === 'unknown' || fc.gapSprints === null) {
    return 'Capture at least one sprint of resolution activity before judging this release.';
  }
  if (fc.gapSprints <= 0) {
    return 'Hold pace. Watch for late-arriving scope.';
  }
  if (fc.gapSprints === 1) {
    return `Triage the ${fc.unresolved} unresolved ticket${fc.unresolved === 1 ? '' : 's'}; one sprint of slippage is recoverable with focus.`;
  }
  return `Plan a scope cut — ${fc.unresolved} unresolved at current pace means ~${fc.gapSprints} sprints of slip. Defer non-critical work to the next release.`;
}

function sprintVelocityTotal(s: SprintVelocityResult): number {
  return (
    s.dev.count +
    s.qaVerification.count * QA_VERIFICATION_EFFORT_RATIO +
    s.qaTestTasks.count
  );
}

function coefficientOfVariation(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return null;
  const variance =
    xs.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / xs.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function daysRemainingInCurrentSprint(
  calendar: SprintCalendar,
  now: Date
): number {
  const todaySprint = currentSprintNumber(calendar, now);
  const { endIso } = sprintWindow(todaySprint, calendar);

  const endDate = new Date(endIso + 'T00:00:00Z');
  const nowDate = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');

  const MS_PER_DAY = 86_400_000;
  const daysUntilEnd = Math.floor((endDate.getTime() - nowDate.getTime()) / MS_PER_DAY);

  return Math.max(1, daysUntilEnd + 1);
}

/**
 * Turn counted streams + recent velocity into a LandingForecastResult.
 * Shared by live JIRA and trunk (cached ticket) paths so the math cannot drift.
 */
export function assembleLandingForecast(
  opts: AssembleLandingForecastOptions,
  counts: LandingForecastCounts
): LandingForecastResult {
  const calendar = opts.sprintCalendar ?? NDB_SPRINT_CALENDAR;
  const now = opts.now ?? new Date();
  const todaySprint = currentSprintNumber(calendar, now);
  const rel = opts.release;

  const velocities = counts.recentSprints.map(sprintVelocityTotal);
  const recentVelocity =
    velocities.length > 0
      ? velocities.reduce((a, b) => a + b, 0) / velocities.length
      : 0;
  const velocityCv = coefficientOfVariation(velocities);
  const elapsedSprints = velocities.filter((v) => v > 0).length;

  const plannedGaDate = opts.plannedGaIso?.slice(0, 10) ?? null;
  const plannedGaSprint = plannedGaDate ? sprintFor(plannedGaDate, calendar) : null;

  let forecastGaSprint: number | null = null;
  let forecastGaDate: string | null = null;
  let gapSprints: number | null = null;

  const weightedOutstanding =
    counts.devUnresolved +
    counts.qaVerificationPending * QA_VERIFICATION_EFFORT_RATIO +
    counts.qaTestTasksUnresolved;

  // Inflow stays 0: an unscoped created-date query previously counted
  // all-project inflow and blew forecasts into the far future.
  // TODO(parity): re-introduce when a release-scoped inflow query exists.
  const weightedInflowPerSprint = 0;
  const effectiveVelocity = recentVelocity;

  const sprintsRemaining =
    plannedGaSprint !== null ? Math.max(1, plannedGaSprint - todaySprint) : null;
  const requiredVelocity =
    sprintsRemaining !== null
      ? Math.round((weightedOutstanding / sprintsRemaining) * 100) / 100
      : null;

  const daysRemaining = daysRemainingInCurrentSprint(calendar, now);
  const DAYS_PER_SPRINT = calendar.sprintDays;
  const dailyVelocity = recentVelocity / DAYS_PER_SPRINT;
  const todayCapacity = dailyVelocity * daysRemaining;

  if (weightedOutstanding > 0 && recentVelocity > 0) {
    if (weightedOutstanding <= todayCapacity) {
      forecastGaSprint = todaySprint;
    } else {
      const workOverflow = weightedOutstanding - todayCapacity;
      const sprintsToFinish = Math.ceil(workOverflow / effectiveVelocity);
      forecastGaSprint = todaySprint + sprintsToFinish;
    }
    const { endIso } = sprintWindow(forecastGaSprint, calendar);
    forecastGaDate = endIso;
    if (plannedGaSprint !== null) {
      gapSprints = forecastGaSprint - plannedGaSprint;
    }
  } else if (weightedOutstanding === 0) {
    forecastGaSprint = todaySprint;
    const { endIso } = sprintWindow(todaySprint, calendar);
    forecastGaDate = endIso;
    if (plannedGaSprint !== null) {
      gapSprints = forecastGaSprint - plannedGaSprint;
    }
  }

  let burnStatus = 'Active';
  if (!plannedGaDate) burnStatus = 'Missing GA';
  else if (elapsedSprints === 0 && weightedOutstanding === 0) burnStatus = 'Not started';
  else if (weightedOutstanding === 0 && plannedGaSprint !== null && todaySprint > plannedGaSprint) {
    burnStatus = 'Shipped';
  }

  const verdict = classifyVerdict(burnStatus, gapSprints);
  const confidence = classifyConfidence(elapsedSprints, velocityCv);

  const result: LandingForecastResult = {
    release: rel,
    plannedGaDate,
    plannedGaSprint,
    forecastGaDate,
    forecastGaSprint,
    gapSprints,
    gapWeeks: gapSprints !== null ? gapSprints * 3 : null,
    unresolved: counts.unresolved,
    pendingVerification: counts.pendingVerification,
    recentVelocity: Math.round(recentVelocity * 100) / 100,
    elapsedSprints,
    velocityCv: velocityCv !== null ? Math.round(velocityCv * 1000) / 1000 : null,
    verdict,
    confidence,
    oneLiner: '',
    recommendedAction: '',
    jqlUnresolved: counts.jqlUnresolved,
    jqlPendingVerification: counts.jqlPendingVerification,
    forecastMethod: 'fallback_running',
    netInflowPerSprint: Math.round(weightedInflowPerSprint * 100) / 100,
    effectiveVelocity: Math.round(effectiveVelocity * 100) / 100,
    daysRemainingToday: daysRemaining,
    todayCapacityItems: Math.round(todayCapacity * 100) / 100,
    devUnresolved: counts.devUnresolved,
    jqlDevUnresolved: counts.jqlDevUnresolved,
    qaVerificationPending: counts.qaVerificationPending,
    jqlQaVerificationPending: counts.jqlQaVerificationPending,
    qaTestTasksUnresolved: counts.qaTestTasksUnresolved,
    jqlQaTestTasksUnresolved: counts.jqlQaTestTasksUnresolved,
    weightedOutstanding: Math.round(weightedOutstanding * 100) / 100,
    weightedInflowPerSprint: Math.round(weightedInflowPerSprint * 100) / 100,
    sprintsRemaining,
    requiredVelocity,
    baselineVelocity: 0,
    velocityVsBaselinePct: null,
    payloadTotal: counts.payloadTotal,
    errors: counts.errors,
    dataSource: opts.dataSource,
  };
  result.oneLiner = buildForecastOneLiner(result, burnStatus);
  result.recommendedAction = buildRecommendedAction(result, burnStatus);
  return result;
}
