/**
 * landingForecastService — VP-friendly landing-date forecast for a release.
 *
 * MVP port of the Streamlit chatbot-app `landing_forecast.py` (961 LOC). This
 * file ships the marquee feature — predicted GA date, confidence verdict, and
 * one-line explanation — so it can render on `/release/:name/brief` today.
 *
 * Two of the six "must survive verbatim" algorithms from STREAMLIT_PARITY.md
 * are ported faithfully here:
 *
 *   - `classifyConfidence(elapsed, velocityCv)`  — Streamlit `_classify_confidence`
 *   - `classifyVerdict(burnStatus, gapSprints)`  — Streamlit `_classify_verdict`
 *
 * Faithfully ported narrative:
 *
 *   - `gapPhrase(gapSprints)`         — Streamlit `_gap_phrase`
 *   - `buildForecastOneLiner(fc, burnStatus)`  — Streamlit `_build_one_liner`
 *
 * Forecast math (MVP):
 *
 *   - recent velocity = trailing 3 sprints, summed across Dev + 0.33*QA-V + QA-T
 *   - forecast_sprint = today_sprint + ceil(unresolved / recent_velocity)
 *   - gap_sprints     = forecast_sprint - sprint_for(plannedGaIso)
 *
 * What's MISSING vs. full Streamlit (tracked in STREAMLIT_PARITY.md):
 *
 *   - `historical_tail_forecast` — curve-based forecast using baseline median tail share
 *   - `project_inflow_to_ga`     — phase-aware new-ticket inflow projection
 *   - `phase_normalized_cycle_timing` — pre-BC share normalization for headline narrative
 *   - per-release comparison cards + sparkline timing curves
 *
 * These remain TODO(parity) — the simple forecast we ship here matches the
 * Streamlit "fallback" path that runs when no baseline data is available, so
 * the user-facing answer is correct in shape and degrades gracefully.
 */

import type { JiraConnector } from '../connectors/jiraConnector.js';
import {
  NDB_SPRINT_CALENDAR,
  type SprintCalendar,
  currentSprint as currentSprintNumber,
  sprintFor,
  sprintWindow,
} from './sprintsService.js';
import {
  QA_VERIFICATION_EFFORT_RATIO,
  computeRecentSprintVelocity,
  type SprintVelocityResult,
} from './velocityService.js';
import { buildEngineeringPayloadJql } from './payloadJqlService.js';

// ── Constants kept identical to Streamlit so UI colors/labels match ──────

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

// ── Types ────────────────────────────────────────────────────────────────

export type ForecastVerdict =
  | 'on_time'
  | 'slipping'
  | 'at_risk'
  | 'shipped'
  | 'not_started'
  | 'unknown';

export type ForecastConfidence = 'high' | 'medium' | 'low' | 'insufficient';

export interface ComputeLandingForecastOptions {
  jira: JiraConnector;
  projectKey: string;
  release: string;
  /** Planned GA date (ISO string). When omitted, gap/verdict can't be computed. */
  plannedGaIso?: string | null;
  /**
   * Number of recent sprints used for the rolling velocity average. The Streamlit
   * original uses 3; keep the default consistent.
   */
  recentSprintsWindow?: number;
  sprintCalendar?: SprintCalendar;
  /** Override "today" for tests. */
  now?: Date;
}

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

  /** JQL that produced the `unresolved` count, so the UI can link it. */
  jqlUnresolved: string;
  /** JQL that produced the `pendingVerification` count. */
  jqlPendingVerification: string;
  /** Method used (matches Streamlit field name). MVP only emits `'fallback_running'`. */
  forecastMethod: 'fallback_running' | 'curve_based' | 'curve_with_inflow';

  /** Average net inflow (discovered - closed) per sprint of Bug/Improvement items. */
  netInflowPerSprint: number;
  /** Effective velocity accounting for net inflow (velocity - inflow). */
  effectiveVelocity: number;
  /** Days remaining in today's sprint. */
  daysRemainingToday: number;
  /** Available work capacity in today's remaining days. */
  todayCapacityItems: number;

  /** TODO(parity) — populated when baseline/curve port lands. */
  baselineVelocity: number;
  velocityVsBaselinePct: number | null;
  payloadTotal: number;
  /** Stream-level errors so the UI can render partial. */
  errors: string[];
}

// ── Verbatim algorithm ports ─────────────────────────────────────────────

/**
 * Streamlit `_classify_confidence` — VERBATIM.
 *
 * High when we have ≥4 sprints of data and pace is steady (CV < 0.25);
 * medium with ≥2 sprints; low after the first sprint; insufficient before
 * any data.
 */
export function classifyConfidence(
  elapsed: number,
  velocityCv: number | null
): ForecastConfidence {
  if (elapsed <= 0) return 'insufficient';
  if (elapsed === 1) return 'low';
  // Streamlit treats `NaN` as 1.0 to stay conservative; we do the same.
  const cv =
    velocityCv !== null && Number.isFinite(velocityCv) ? velocityCv : 1.0;
  if (elapsed >= 4 && cv < 0.25) return 'high';
  return 'medium';
}

/**
 * Streamlit `_classify_verdict` — VERBATIM.
 *
 * Map (burn status, gap) → a single VP-facing verdict. When `gapSprints` is
 * null we can't make a call, so it's "unknown" — never "on_time" by default.
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

/**
 * Streamlit `_build_one_liner` — close port (NDB-only date formatting).
 */
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

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Sum of (Dev + 0.33*QA-Verification + QA-Test) for a sprint, matching the
 * Sprint Velocity overlay line definition from `pages/4_Sprint_Analysis.py`.
 */
function sprintVelocityTotal(s: SprintVelocityResult): number {
  return (
    s.dev.count +
    s.qaVerification.count * QA_VERIFICATION_EFFORT_RATIO +
    s.qaTestTasks.count
  );
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function coefficientOfVariation(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  if (mean === 0) return null;
  const variance =
    xs.reduce((acc, v) => acc + (v - mean) * (v - mean), 0) / xs.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

/**
 * Calculate remaining days in the sprint containing `now`.
 * Returns days from `now` (inclusive) through end of sprint (inclusive).
 * 
 * Example: if today is Wed (day 1 of 21-day sprint), returns 21 days.
 * If today is Tue (last day of sprint), returns 1 day.
 */
function daysRemainingInCurrentSprint(
  calendar: SprintCalendar,
  now: Date
): number {
  const todaySprint = currentSprintNumber(calendar, now);
  const { endIso } = sprintWindow(todaySprint, calendar);
  
  // Parse dates at UTC midnight for consistent day-counting
  const endDate = new Date(endIso + 'T00:00:00Z');
  const nowDate = new Date(now.toISOString().slice(0, 10) + 'T00:00:00Z');
  
  const MS_PER_DAY = 86_400_000;
  const daysUntilEnd = Math.floor((endDate.getTime() - nowDate.getTime()) / MS_PER_DAY);
  
  // +1 because both start and end dates are inclusive
  return Math.max(1, daysUntilEnd + 1);
}

/**
 * Calculate the average net inflow (discovered - closed) of Bug + Improvement
 * items over a set of sprints. Used to project how many new bugs will arrive
 * by the forecast date.
 * 
 * Returns: items per sprint (positive = growing backlog, negative = shrinking)
 */
async function calculateNetInflowTrend(
  jira: JiraConnector,
  projectKey: string,
  release: string,
  calendar: SprintCalendar,
  sprintNumbers: number[]
): Promise<number> {
  if (sprintNumbers.length === 0) return 0;

  const discovered: number[] = [];
  const closed: number[] = [];

  for (const sprintNum of sprintNumbers) {
    const { startIso, endIso } = sprintWindow(sprintNum, calendar);

    // Bugs discovered (created) during the sprint
    const jqlDiscovered = `project = ${projectKey} AND issuetype in (Bug, Improvement) AND created >= "${startIso}" AND created <= "${endIso}"`;
    const countDiscovered = await jira.searchCount(jqlDiscovered).catch(() => 0);
    discovered.push(countDiscovered);

    // Bugs closed (moved to Closed) during the sprint
    const jqlClosed = `project = ${projectKey} AND issuetype in (Bug, Improvement) AND status changed to "Closed" during ("${startIso}", "${endIso}")`;
    const countClosed = await jira.searchCount(jqlClosed).catch(() => 0);
    closed.push(countClosed);
  }

  const totalDiscovered = discovered.reduce((a, b) => a + b, 0);
  const totalClosed = closed.reduce((a, b) => a + b, 0);
  const netPerSprint = (totalDiscovered - totalClosed) / sprintNumbers.length;

  return netPerSprint;
}

// ── Public entrypoint ────────────────────────────────────────────────────

/**
 * Compute the MVP landing forecast for `release`. Issues two parallel
 * JIRA calls (unresolved count + recent velocity series).
 */
export async function computeLandingForecast(
  opts: ComputeLandingForecastOptions
): Promise<LandingForecastResult> {
  if (!opts?.projectKey) {
    throw new Error('computeLandingForecast: projectKey is required (D1)');
  }
  if (!opts?.release) {
    throw new Error('computeLandingForecast: release is required');
  }
  const calendar = opts.sprintCalendar ?? NDB_SPRINT_CALENDAR;
  const now = opts.now ?? new Date();
  const todaySprint = currentSprintNumber(calendar, now);
  const window = Math.max(2, opts.recentSprintsWindow ?? 3);

  // Build the unresolved JQL — mirrors Streamlit's `fc.jql_unresolved`:
  // payload + Unresolved + not in the *-deferred bucket. `labels != X`
  // does NOT match empty labels, so combine with `labels is EMPTY` per
  // the comment in `landing_forecast.py`.
  const rel = opts.release;
  const relLower = rel.toLowerCase().replace(/^ndb-/, '');
  const deferredLabel = `ndb-${relLower}-deferred`;
  const jqlUnresolved = buildEngineeringPayloadJql(rel, {
    projectKey: opts.projectKey,
    extras: [
      'resolution = Unresolved',
      `(labels != "${deferredLabel}" OR labels is EMPTY)`,
    ],
  });
  const jqlPayloadTotal = buildEngineeringPayloadJql(rel, {
    projectKey: opts.projectKey,
  });

  // Pending verification: Bug + Improvement issues with status "Resolved"
  // (waiting for QA sign-off before moving to Closed).
  const jqlPendingVerification = buildEngineeringPayloadJql(rel, {
    projectKey: opts.projectKey,
    extras: [
      'issuetype in (Bug, Improvement)',
      'status = Resolved',
    ],
  });

  const errors: string[] = [];
  const safeCount = async (jql: string, label: string): Promise<number> => {
    try {
      return await opts.jira.searchCount(jql);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'searchCount failed';
      errors.push(`${label}: ${message}`);
      return 0;
    }
  };

  const safeVelocity = async (): Promise<SprintVelocityResult[]> => {
    try {
      return await computeRecentSprintVelocity(opts.jira, {
        projectKey: opts.projectKey,
        release: rel,
        sprintCalendar: calendar,
        sprintsBack: window,
        endSprint: todaySprint,
      });
    } catch (e: unknown) {
      const message =
        e instanceof Error ? e.message : 'velocity fetch failed';
      errors.push(`velocity: ${message}`);
      return [];
    }
  };

  const [unresolved, pendingVerification, payloadTotal, recentSprints] = await Promise.all([
    safeCount(jqlUnresolved, 'unresolved'),
    safeCount(jqlPendingVerification, 'pendingVerification'),
    safeCount(jqlPayloadTotal, 'payloadTotal'),
    safeVelocity(),
  ]);

  const velocities = recentSprints.map(sprintVelocityTotal);
  const recentVelocity =
    velocities.length > 0
      ? velocities.reduce((a, b) => a + b, 0) / velocities.length
      : 0;
  const velocityCv = coefficientOfVariation(velocities);
  // MVP "elapsed sprints" proxy: how many of the recent N had non-zero
  // velocity on this release. TODO(parity): use release_burn.first_activity_sprint().
  const elapsedSprints = velocities.filter((v) => v > 0).length;

  const plannedGaDate = opts.plannedGaIso?.slice(0, 10) ?? null;
  const plannedGaSprint = plannedGaDate ? sprintFor(plannedGaDate, calendar) : null;

  let forecastGaSprint: number | null = null;
  let forecastGaDate: string | null = null;
  let gapSprints: number | null = null;

  // ─────────────────────────────────────────────────────────────────────────
  // IMPROVED FORECAST: Account for today's remaining capacity + bug inflow trend
  // ─────────────────────────────────────────────────────────────────────────
  
  let netInflowPerSprint = 0;
  try {
    // Calculate the sprint numbers to sample for inflow trend
    const sprintsToAnalyze = recentSprints
      .map((_, i) => todaySprint - window + i)
      .filter((s) => s >= 1);
    
    if (sprintsToAnalyze.length > 0) {
      netInflowPerSprint = await calculateNetInflowTrend(
        opts.jira,
        opts.projectKey,
        rel,
        calendar,
        sprintsToAnalyze
      );
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'inflow calculation failed';
    errors.push(`inflow: ${message}`);
    netInflowPerSprint = 0;
  }

  // Effective velocity = actual velocity minus net inflow.
  // If net inflow exceeds velocity, the backlog is growing and we can't finish.
  const effectiveVelocity = Math.max(0.1, recentVelocity - netInflowPerSprint);
  
  // Calculate remaining days in today's sprint and today's available capacity.
  const daysRemaining = daysRemainingInCurrentSprint(calendar, now);
  const DAYS_PER_SPRINT = calendar.sprintDays;
  const dailyVelocity = recentVelocity / DAYS_PER_SPRINT;
  const todayCapacity = dailyVelocity * daysRemaining;

  // Determine forecast sprint by allocating work: today first, then future sprints.
  if (unresolved > 0 && effectiveVelocity > 0) {
    if (unresolved <= todayCapacity) {
      // All work fits in today's remaining capacity
      forecastGaSprint = todaySprint;
    } else {
      // Work spills into future sprints
      const workOverflow = unresolved - todayCapacity;
      const sprintsToFinish = Math.ceil(workOverflow / effectiveVelocity);
      forecastGaSprint = todaySprint + sprintsToFinish;
    }
    const { endIso } = sprintWindow(forecastGaSprint, calendar);
    forecastGaDate = endIso;
    if (plannedGaSprint !== null) {
      gapSprints = forecastGaSprint - plannedGaSprint;
    }
  } else if (unresolved === 0) {
    // No unresolved work; we're done today
    forecastGaSprint = todaySprint;
    const { endIso } = sprintWindow(todaySprint, calendar);
    forecastGaDate = endIso;
    if (plannedGaSprint !== null) {
      gapSprints = forecastGaSprint - plannedGaSprint;
    }
  }

  // Derive a coarse "burnStatus" for `classifyVerdict`. TODO(parity): use
  // release_burn.release_burn(). For MVP we infer from the inputs.
  let burnStatus = 'Active';
  if (!plannedGaDate) burnStatus = 'Missing GA';
  else if (elapsedSprints === 0 && unresolved === 0) burnStatus = 'Not started';
  else if (unresolved === 0 && plannedGaSprint !== null && todaySprint > plannedGaSprint) {
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
    unresolved,
    pendingVerification,
    recentVelocity: Math.round(recentVelocity * 100) / 100,
    elapsedSprints,
    velocityCv: velocityCv !== null ? Math.round(velocityCv * 1000) / 1000 : null,
    verdict,
    confidence,
    oneLiner: '',
    recommendedAction: '',
    jqlUnresolved,
    jqlPendingVerification,
    forecastMethod: 'fallback_running',
    netInflowPerSprint: Math.round(netInflowPerSprint * 100) / 100,
    effectiveVelocity: Math.round(effectiveVelocity * 100) / 100,
    daysRemainingToday: daysRemaining,
    todayCapacityItems: Math.round(todayCapacity * 100) / 100,
    baselineVelocity: 0,
    velocityVsBaselinePct: null,
    payloadTotal,
    errors,
  };
  result.oneLiner = buildForecastOneLiner(result, burnStatus);
  result.recommendedAction = buildRecommendedAction(result, burnStatus);
  return result;
}
