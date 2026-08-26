/**
 * landingForecastService — VP-friendly landing-date forecast for a release.
 *
 * Two count sources, one assemble path (`landingForecastAssemble.ts`):
 *
 *   - `computeLandingForecast`            live JIRA `searchCount` fallback
 *   - `computeLandingForecastFromTickets` release-dataset trunk (cached rows)
 *
 * Click-through JQL is the same on both paths (existing extras, unchanged).
 * Inflow stays 0 — see assemble. TODO(parity): curve tail, scoped inflow,
 * phase-normalized timing.
 */

import type { JiraConnector } from '../connectors/jiraConnector.js';
import {
  NDB_SPRINT_CALENDAR,
  type SprintCalendar,
  currentSprint as currentSprintNumber,
} from './sprintsService.js';
import {
  computeRecentSprintVelocity,
  computeRecentSprintVelocityFromTickets,
  type SprintVelocityResult,
} from './velocityService.js';
import { buildEngineeringPayloadJql } from './payloadJqlService.js';
import {
  assembleLandingForecast,
  type LandingForecastCounts,
  type LandingForecastResult,
} from './landingForecastAssemble.js';
import { categorizeResolution } from './resolutionCategoriesService.js';
import { PROJECT_HIERARCHY } from './issueGroupsService.js';
import { isDeferredLabel } from './releaseDatasetService.js';
import type { ProcessedTicket } from './releaseDatasetService.js';

export type {
  ForecastVerdict,
  ForecastConfidence,
  LandingForecastResult,
  LandingForecastCounts,
} from './landingForecastAssemble.js';
export {
  classifyConfidence,
  classifyVerdict,
  gapPhrase,
  buildForecastOneLiner,
  assembleLandingForecast,
  FORECAST_VERDICT_COLORS,
  FORECAST_VERDICT_LABELS,
  FORECAST_CONFIDENCE_LABELS,
} from './landingForecastAssemble.js';

export interface ComputeLandingForecastOptions {
  jira: JiraConnector;
  projectKey: string;
  release: string;
  /** Planned GA date (ISO string). When omitted, gap/verdict can't be computed. */
  plannedGaIso?: string | null;
  recentSprintsWindow?: number;
  sprintCalendar?: SprintCalendar;
  now?: Date;
}

export interface ComputeLandingForecastFromTicketsOptions {
  tickets: ProcessedTicket[];
  projectKey: string;
  release: string;
  /** D1: product label prefix for deferred-label matching. */
  labelPrefix: string;
  plannedGaIso?: string | null;
  recentSprintsWindow?: number;
  sprintCalendar?: SprintCalendar;
  now?: Date;
}

/**
 * Click-through JQL for the forecast tiles. Extras match the live path
 * that shipped with this service — do not edit without JQL approval.
 */
function forecastClickthroughJqls(
  release: string,
  projectKey: string
): Pick<
  LandingForecastCounts,
  | 'jqlUnresolved'
  | 'jqlPendingVerification'
  | 'jqlDevUnresolved'
  | 'jqlQaVerificationPending'
  | 'jqlQaTestTasksUnresolved'
> {
  const relLower = release.toLowerCase().replace(/^ndb-/, '');
  const deferredLabel = `ndb-${relLower}-deferred`;
  return {
    jqlUnresolved: buildEngineeringPayloadJql(release, {
      projectKey,
      extras: [
        'resolution = Unresolved',
        `(labels != "${deferredLabel}" OR labels is EMPTY)`,
      ],
    }),
    jqlPendingVerification: buildEngineeringPayloadJql(release, {
      projectKey,
      extras: ['issuetype in (Bug, Improvement)', 'status = Resolved'],
    }),
    jqlDevUnresolved: buildEngineeringPayloadJql(release, {
      projectKey,
      extras: [
        'issueType not in (Feature, Initiative, Epic, X-FEAT, Capability, Test)',
        'resolution = Unresolved',
        `(labels != "${deferredLabel}" OR labels is EMPTY)`,
      ],
    }),
    jqlQaVerificationPending: buildEngineeringPayloadJql(release, {
      projectKey,
      extras: ['issuetype in (Bug, Improvement)', 'status = Resolved'],
    }),
    jqlQaTestTasksUnresolved: buildEngineeringPayloadJql(release, {
      projectKey,
      extras: [
        'issueType = Test',
        'resolution = Unresolved',
        `(labels != "${deferredLabel}" OR labels is EMPTY)`,
      ],
    }),
  };
}

function issueTypeOf(t: ProcessedTicket): string {
  return String(t['Issue Type'] || '').trim();
}

function isDevIssueType(issueType: string): boolean {
  return !PROJECT_HIERARCHY.has(issueType) && issueType !== 'Test';
}

function isUnresolvedTicket(t: ProcessedTicket): boolean {
  return categorizeResolution(t.Resolution) === 'Unresolved';
}

function ticketIsDeferred(
  t: ProcessedTicket,
  release: string,
  labelPrefix: string
): boolean {
  const derived = (t as ProcessedTicket & { 'Is Deferred'?: boolean })['Is Deferred'];
  if (typeof derived === 'boolean') return derived;
  return isDeferredLabel(t.Labels || '', t['Release Name'] || release, {
    labelPrefix,
  });
}

function countOutstandingFromTickets(
  tickets: ProcessedTicket[],
  release: string,
  labelPrefix: string
): Pick<
  LandingForecastCounts,
  | 'unresolved'
  | 'pendingVerification'
  | 'payloadTotal'
  | 'devUnresolved'
  | 'qaVerificationPending'
  | 'qaTestTasksUnresolved'
> {
  const scoped = tickets.filter(
    (t) => !release || t['Release Name'] === release
  );
  let unresolved = 0;
  let pendingVerification = 0;
  let devUnresolved = 0;
  let qaTestTasksUnresolved = 0;

  for (const t of scoped) {
    const type = issueTypeOf(t);
    const deferred = ticketIsDeferred(t, release, labelPrefix);
    const unresolvedRow = isUnresolvedTicket(t);
    if (unresolvedRow && !deferred) unresolved += 1;
    if (
      (type === 'Bug' || type === 'Improvement') &&
      t.Status === 'Resolved'
    ) {
      pendingVerification += 1;
    }
    if (isDevIssueType(type) && unresolvedRow && !deferred) {
      devUnresolved += 1;
    }
    if (type === 'Test' && unresolvedRow && !deferred) {
      qaTestTasksUnresolved += 1;
    }
  }

  return {
    unresolved,
    pendingVerification,
    payloadTotal: scoped.length,
    devUnresolved,
    qaVerificationPending: pendingVerification,
    qaTestTasksUnresolved,
  };
}

/**
 * Compute the MVP landing forecast from live JIRA counts.
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
  const rel = opts.release;
  const jqls = forecastClickthroughJqls(rel, opts.projectKey);
  const jqlPayloadTotal = buildEngineeringPayloadJql(rel, {
    projectKey: opts.projectKey,
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

  const [
    unresolved,
    pendingVerification,
    payloadTotal,
    recentSprints,
    devUnresolved,
    qaVerificationPending,
    qaTestTasksUnresolved,
  ] = await Promise.all([
    safeCount(jqls.jqlUnresolved, 'unresolved'),
    safeCount(jqls.jqlPendingVerification, 'pendingVerification'),
    safeCount(jqlPayloadTotal, 'payloadTotal'),
    safeVelocity(),
    safeCount(jqls.jqlDevUnresolved, 'devUnresolved'),
    safeCount(jqls.jqlQaVerificationPending, 'qaVerificationPending'),
    safeCount(jqls.jqlQaTestTasksUnresolved, 'qaTestTasksUnresolved'),
  ]);

  return assembleLandingForecast(
    {
      release: rel,
      plannedGaIso: opts.plannedGaIso,
      sprintCalendar: calendar,
      now,
      dataSource: 'live',
    },
    {
      unresolved,
      pendingVerification,
      payloadTotal,
      recentSprints,
      devUnresolved,
      qaVerificationPending,
      qaTestTasksUnresolved,
      ...jqls,
      errors,
    }
  );
}

/**
 * Compute the MVP landing forecast from cached `ProcessedTicket` rows
 * (CONSOLIDATION #4 on the #1b trunk). Click-through JQL is unchanged.
 */
export function computeLandingForecastFromTickets(
  opts: ComputeLandingForecastFromTicketsOptions
): LandingForecastResult {
  if (!opts?.projectKey) {
    throw new Error(
      'computeLandingForecastFromTickets: projectKey is required (D1)'
    );
  }
  if (!opts?.release) {
    throw new Error('computeLandingForecastFromTickets: release is required');
  }
  if (!opts?.labelPrefix) {
    throw new Error(
      'computeLandingForecastFromTickets: labelPrefix is required (D1)'
    );
  }
  const calendar = opts.sprintCalendar ?? NDB_SPRINT_CALENDAR;
  const now = opts.now ?? new Date();
  const todaySprint = currentSprintNumber(calendar, now);
  const window = Math.max(2, opts.recentSprintsWindow ?? 3);
  const rel = opts.release;
  const jqls = forecastClickthroughJqls(rel, opts.projectKey);
  const outstanding = countOutstandingFromTickets(
    opts.tickets,
    rel,
    opts.labelPrefix
  );
  const recentSprints = computeRecentSprintVelocityFromTickets({
    tickets: opts.tickets,
    projectKey: opts.projectKey,
    release: rel,
    sprintCalendar: calendar,
    sprintsBack: window,
    endSprint: todaySprint,
    now,
  });

  return assembleLandingForecast(
    {
      release: rel,
      plannedGaIso: opts.plannedGaIso,
      sprintCalendar: calendar,
      now,
      dataSource: 'cache',
    },
    {
      ...outstanding,
      recentSprints,
      ...jqls,
      errors: [],
    }
  );
}
