/**
 * velocityService — 3-stream sprint velocity computation.
 *
 * Per `sprint-velocity-types.mdc`, every sprint surfaces three distinct
 * velocity streams; collapsing them into a single "velocity" number is
 * forbidden because Dev / QA-Verification / QA-Test-Tasks have different
 * effort models and decision implications.
 *
 *   1. Dev velocity
 *      Count of issues resolved in the sprint where
 *      `issueType not in (Feature, Initiative, Epic, X-FEAT, Capability, Test)`.
 *
 *   2. QA Verification velocity
 *      Count of issues where `issueType in (Bug, Improvement)` and
 *      `status changed to "Closed" during the sprint window`. This
 *      represents QA signing off on a dev fix. Effort is reported as
 *      `adjustedCount = count * 0.33` per the 1:3 ratio rule
 *      (verifying 3 tickets = 1 ticket of QA effort).
 *
 *   3. QA Test-Tasks velocity
 *      Count of issues resolved in the sprint where `issueType = Test`.
 *      Pure test-authoring / execution work, separate from verification.
 *
 * All three are emitted with their backing JQL so the UI can link the
 * number directly to a JIRA search filter (per
 * `jira-authenticity-links.mdc`).
 *
 * D1: every input flows in via `productService` — `projectKey`,
 * `sprintCalendar`. Nothing about this file is NDB-specific.
 */

import type { JiraConnector } from '../connectors/jiraConnector.js';
import type { ProcessedTicket } from './releaseDatasetService.js';
import { PROJECT_HIERARCHY } from './issueGroupsService.js';
import {
  NDB_SPRINT_CALENDAR,
  type SprintCalendar,
  currentSprint as currentSprintNumber,
  sprintFor,
  sprintLabel,
  sprintWindow,
} from './sprintsService.js';

// The 1:3 effort ratio from sprint-velocity-types.mdc.
export const QA_VERIFICATION_EFFORT_RATIO = 1 / 3;

// Issue-type clauses scoped by `sprint-velocity-types.mdc`. Centralised so
// future changes (e.g. add `Story` to dev) happen in one place, not five.
const DEV_ISSUE_TYPES_EXCLUSION =
  '(Feature, Initiative, Epic, X-FEAT, Capability, Test)';
const QA_VERIFICATION_ISSUE_TYPES = '(Bug, Improvement)';
const QA_TEST_TASK_ISSUE_TYPE = 'Test';
// Status that counts as "QA verified" — `status changed to "Closed"` is the
// canonical signal of a QA engineer signing off on a fix.
const QA_VERIFICATION_STATUS = 'Closed';

export interface ComputeSprintVelocityOptions {
  /** JIRA project to scope velocity to (D1). e.g. `'ERA'` for NDB. */
  projectKey: string;
  /** Release fixVersion to scope velocity to. Optional — omit for whole-team velocity. */
  release?: string;
  /** Sprint calendar (D1). Defaults to NDB. */
  sprintCalendar?: SprintCalendar;
  /** Sprint number to compute. Defaults to the current sprint. */
  sprintNumber?: number;
}

export interface SprintVelocityStream {
  /** Headline count for the stream. */
  count: number;
  /** Backing JQL (so UI can build a verifiable JIRA URL). */
  jql: string;
  /** Optional fetch error (so the stream can render as "!" instead of dying the page). */
  error?: string;
}

export interface SprintVelocityResult {
  release?: string;
  projectKey: string;
  sprintNumber: number;
  sprintLabel: string;
  window: { startIso: string; endIso: string };
  isCurrent: boolean;
  dev: SprintVelocityStream;
  qaVerification: SprintVelocityStream & {
    /** count × 0.33 — adjusted ticket count, NOT story points (see rule). */
    adjustedCount: number;
  };
  qaTestTasks: SprintVelocityStream;
}

// ── JQL builders (kept local — they're only useful in this context) ──────

function scopeClauses(projectKey: string, release?: string): string {
  const parts = [`project = ${projectKey}`];
  if (release) parts.push(`fixVersion = "${release}"`);
  return parts.join(' AND ');
}

function jqlDev(projectKey: string, release: string | undefined, w: { startIso: string; endIso: string }): string {
  return (
    `${scopeClauses(projectKey, release)} ` +
    `AND issueType not in ${DEV_ISSUE_TYPES_EXCLUSION} ` +
    `AND resolved >= "${w.startIso}" AND resolved <= "${w.endIso}"`
  );
}

function jqlQaVerification(projectKey: string, release: string | undefined, w: { startIso: string; endIso: string }): string {
  // `status changed to "X" during (start, end)` is the JQL idiom for
  // catching the transition itself, not just current status.
  return (
    `${scopeClauses(projectKey, release)} ` +
    `AND issueType in ${QA_VERIFICATION_ISSUE_TYPES} ` +
    `AND status changed to "${QA_VERIFICATION_STATUS}" ` +
    `during ("${w.startIso}", "${w.endIso}")`
  );
}

function jqlQaTestTasks(projectKey: string, release: string | undefined, w: { startIso: string; endIso: string }): string {
  return (
    `${scopeClauses(projectKey, release)} ` +
    `AND issueType = ${QA_TEST_TASK_ISSUE_TYPE} ` +
    `AND resolved >= "${w.startIso}" AND resolved <= "${w.endIso}"`
  );
}

// ── Public surface ────────────────────────────────────────────────────────

/**
 * Compute all three velocity streams for one sprint.
 *
 * Runs the three counts in parallel — each is a single
 * `searchCount` call (maxResults=0).
 */
export async function computeSprintVelocity(
  jira: JiraConnector,
  options: ComputeSprintVelocityOptions
): Promise<SprintVelocityResult> {
  if (!options?.projectKey) {
    throw new Error('computeSprintVelocity: options.projectKey is required (D1)');
  }
  const calendar = options.sprintCalendar ?? NDB_SPRINT_CALENDAR;
  const todaySprint = currentSprintNumber(calendar);
  const sprintNumber = options.sprintNumber ?? todaySprint;
  if (!Number.isInteger(sprintNumber) || sprintNumber < 1) {
    throw new Error(
      `computeSprintVelocity: sprintNumber must be a positive integer, got ${sprintNumber}`
    );
  }
  const window = sprintWindow(sprintNumber, calendar);

  const devJql = jqlDev(options.projectKey, options.release, window);
  const qaVerifJql = jqlQaVerification(options.projectKey, options.release, window);
  const qaTestJql = jqlQaTestTasks(options.projectKey, options.release, window);

  const safeCount = async (jql: string): Promise<SprintVelocityStream> => {
    try {
      const count = await jira.searchCount(jql);
      return { count, jql };
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Search failed';
      return { count: 0, jql, error: message };
    }
  };

  const [dev, qaVerification, qaTestTasks] = await Promise.all([
    safeCount(devJql),
    safeCount(qaVerifJql),
    safeCount(qaTestJql),
  ]);

  return {
    release: options.release,
    projectKey: options.projectKey,
    sprintNumber,
    sprintLabel: sprintLabel(sprintNumber),
    window,
    isCurrent: sprintNumber === todaySprint,
    dev,
    qaVerification: {
      ...qaVerification,
      adjustedCount: Math.round(qaVerification.count * QA_VERIFICATION_EFFORT_RATIO * 100) / 100,
    },
    qaTestTasks,
  };
}

/**
 * Compute velocity for a range of recent sprints, ending at (and
 * including) `endSprint` (default: current). Most-recent sprint first
 * in the returned array.
 *
 * Concurrency: each sprint runs `computeSprintVelocity` (3 parallel
 * count calls), and the per-sprint calls themselves run in parallel up
 * to `concurrency`. Default `concurrency = 4` keeps JIRA happy for a
 * typical 3–6 sprint window.
 */
export async function computeRecentSprintVelocity(
  jira: JiraConnector,
  options: ComputeSprintVelocityOptions & {
    sprintsBack?: number;
    endSprint?: number;
    concurrency?: number;
  }
): Promise<SprintVelocityResult[]> {
  const calendar = options.sprintCalendar ?? NDB_SPRINT_CALENDAR;
  const end = options.endSprint ?? currentSprintNumber(calendar);
  const back = Math.max(1, options.sprintsBack ?? 3);
  const concurrency = Math.max(1, options.concurrency ?? 4);
  const start = Math.max(1, end - back + 1);
  const numbers: number[] = [];
  for (let n = end; n >= start; n--) numbers.push(n);

  // Simple bounded-parallel runner. Avoids importing a 3rd-party
  // dependency for what's effectively a 5-line worker.
  const results: SprintVelocityResult[] = new Array(numbers.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const idx = next++;
      if (idx >= numbers.length) return;
      const sprintNumber = numbers[idx];
      results[idx] = await computeSprintVelocity(jira, {
        projectKey: options.projectKey,
        release: options.release,
        sprintCalendar: calendar,
        sprintNumber,
      });
    }
  }
  const workers = Array.from(
    { length: Math.min(concurrency, numbers.length) },
    () => worker()
  );
  await Promise.all(workers);
  return results;
}

// ── Trunk path (cached ProcessedTicket rows) ──────────────────────────────

export interface ComputeSprintVelocityFromTicketsOptions {
  tickets: ProcessedTicket[];
  projectKey: string;
  release?: string;
  sprintCalendar?: SprintCalendar;
  sprintNumber?: number;
  now?: Date;
}

type TicketWithSprintCols = ProcessedTicket & {
  'Sprint Number'?: number | null;
  'Closed Sprint Number'?: number | null;
};

function issueTypeOf(t: ProcessedTicket): string {
  return String(t['Issue Type'] || '').trim();
}

function isDevIssueType(issueType: string): boolean {
  return !PROJECT_HIERARCHY.has(issueType) && issueType !== 'Test';
}

function resolvedSprintOf(
  t: TicketWithSprintCols,
  calendar: SprintCalendar
): number | null {
  if (typeof t['Sprint Number'] === 'number') return t['Sprint Number'];
  return sprintFor(t['Resolved Date'], calendar);
}

function closedSprintOf(
  t: TicketWithSprintCols,
  calendar: SprintCalendar
): number | null {
  if (typeof t['Closed Sprint Number'] === 'number') {
    return t['Closed Sprint Number'];
  }
  return sprintFor(t['Closed Date'], calendar);
}

function ticketsForRelease(
  tickets: ProcessedTicket[],
  release?: string
): ProcessedTicket[] {
  if (!release) return tickets;
  return tickets.filter((t) => t['Release Name'] === release);
}

/**
 * 3-stream sprint velocity from cached tickets (CONSOLIDATION #2).
 *
 * Semantics match the live JQL in this file:
 *   - Dev: non-portfolio, non-Test, Resolved Date in the sprint window
 *   - QA Verification: Bug/Improvement with Closed Date in the window
 *     (a Closed Bug in-window counts as both Dev and QA-Verif)
 *   - QA Test: issueType = Test, Resolved Date in the window
 *
 * Click-through `jql` fields reuse the live builders unchanged.
 */
export function computeSprintVelocityFromTickets(
  options: ComputeSprintVelocityFromTicketsOptions
): SprintVelocityResult {
  if (!options?.projectKey) {
    throw new Error(
      'computeSprintVelocityFromTickets: options.projectKey is required (D1)'
    );
  }
  const calendar = options.sprintCalendar ?? NDB_SPRINT_CALENDAR;
  const now = options.now ?? new Date();
  const todaySprint = currentSprintNumber(calendar, now);
  const sprintNumber = options.sprintNumber ?? todaySprint;
  if (!Number.isInteger(sprintNumber) || sprintNumber < 1) {
    throw new Error(
      `computeSprintVelocityFromTickets: sprintNumber must be a positive integer, got ${sprintNumber}`
    );
  }
  const window = sprintWindow(sprintNumber, calendar);
  const scoped = ticketsForRelease(options.tickets, options.release);

  let devCount = 0;
  let qaVerifCount = 0;
  let qaTestCount = 0;
  for (const t of scoped) {
    const type = issueTypeOf(t);
    if (isDevIssueType(type) && resolvedSprintOf(t, calendar) === sprintNumber) {
      devCount += 1;
    }
    if (
      (type === 'Bug' || type === 'Improvement') &&
      closedSprintOf(t, calendar) === sprintNumber
    ) {
      qaVerifCount += 1;
    }
    if (type === 'Test' && resolvedSprintOf(t, calendar) === sprintNumber) {
      qaTestCount += 1;
    }
  }

  return {
    release: options.release,
    projectKey: options.projectKey,
    sprintNumber,
    sprintLabel: sprintLabel(sprintNumber),
    window,
    isCurrent: sprintNumber === todaySprint,
    dev: {
      count: devCount,
      jql: jqlDev(options.projectKey, options.release, window),
    },
    qaVerification: {
      count: qaVerifCount,
      jql: jqlQaVerification(options.projectKey, options.release, window),
      adjustedCount:
        Math.round(qaVerifCount * QA_VERIFICATION_EFFORT_RATIO * 100) / 100,
    },
    qaTestTasks: {
      count: qaTestCount,
      jql: jqlQaTestTasks(options.projectKey, options.release, window),
    },
  };
}

/**
 * Recent-sprint velocity from cached tickets. Most-recent sprint first.
 */
export function computeRecentSprintVelocityFromTickets(
  options: ComputeSprintVelocityFromTicketsOptions & {
    sprintsBack?: number;
    endSprint?: number;
  }
): SprintVelocityResult[] {
  const calendar = options.sprintCalendar ?? NDB_SPRINT_CALENDAR;
  const now = options.now ?? new Date();
  const end = options.endSprint ?? currentSprintNumber(calendar, now);
  const back = Math.max(1, options.sprintsBack ?? 3);
  const start = Math.max(1, end - back + 1);
  const results: SprintVelocityResult[] = [];
  for (let n = end; n >= start; n--) {
    results.push(
      computeSprintVelocityFromTickets({
        tickets: options.tickets,
        projectKey: options.projectKey,
        release: options.release,
        sprintCalendar: calendar,
        sprintNumber: n,
        now,
      })
    );
  }
  return results;
}
