/**
 * sprintsService — sprint enumeration over a fixed-cadence calendar.
 *
 * Ports `sprints.py` (CONSOLIDATION.md #1b Phase 2).
 *
 * The Python original hardcoded the NDB calendar:
 *
 *   S1 starts 2024-10-23 (Wednesday). Every sprint = 21 days, no gaps.
 *
 * D1 (product-agnostic): here we accept a `SprintCalendar` so other
 * products can supply their own anchor + cadence. The NDB defaults are
 * exported as `NDB_SPRINT_CALENDAR` for convenience but callers should
 * pass `productService.getSprintCalendar()` (or equivalent) at the
 * call site rather than relying on the default.
 */

export interface SprintCalendar {
  /** ISO date string for the start of Sprint 1, e.g. `'2024-10-23'`. */
  s1StartIso: string;
  /** Sprint length in days. Typically 14 or 21. */
  sprintDays: number;
}

/**
 * NDB's calendar (S1 = 2024-10-23, 21-day cadence). Exported for
 * convenience and back-compat with the legacy Python data layer, but
 * D1-compliant callers should fetch from product config.
 */
export const NDB_SPRINT_CALENDAR: SprintCalendar = {
  s1StartIso: '2024-10-23',
  sprintDays: 21,
};

// ── Internal date helpers ──────────────────────────────────────────────────

function parseIsoDate(iso: string): Date {
  // `new Date('2024-10-23')` is parsed as UTC midnight in browsers and
  // Node, which is what we want — sprint windows are date-only, not
  // timezone-sensitive.
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`sprintsService: invalid ISO date '${iso}'`);
  }
  return d;
}

function toDateOnly(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value;
  }
  const s = String(value);
  // Strip the time portion if present so we get day-level granularity.
  // JIRA dates come through like '2026-04-10T12:00:00.000+0530' — we
  // want the date in UTC, matching Python's `pd.to_datetime(..., utc=True)`.
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 86_400_000;
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Return Sn (1-indexed) for a date, or `null` if before S1 or
 * unparseable. Matches Python `sprint_for(d)`.
 */
export function sprintFor(
  date: unknown,
  calendar: SprintCalendar = NDB_SPRINT_CALENDAR
): number | null {
  const pyDate = toDateOnly(date);
  if (pyDate === null) return null;
  const s1 = parseIsoDate(calendar.s1StartIso);
  if (pyDate < s1) return null;
  return Math.floor(daysBetween(s1, pyDate) / calendar.sprintDays) + 1;
}

/**
 * Return `(start, endInclusive)` ISO dates for sprint number `n`.
 * Matches Python `sprint_window(n)` returning ISO strings.
 */
export function sprintWindow(
  n: number,
  calendar: SprintCalendar = NDB_SPRINT_CALENDAR
): { startIso: string; endIso: string } {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`sprintWindow: n must be a positive integer, got ${n}`);
  }
  const s1 = parseIsoDate(calendar.s1StartIso);
  const start = addDays(s1, (n - 1) * calendar.sprintDays);
  const end = addDays(start, calendar.sprintDays - 1);
  return { startIso: isoDate(start), endIso: isoDate(end) };
}

/** Sprint number containing today (or 1 if today is before S1). */
export function currentSprint(
  calendar: SprintCalendar = NDB_SPRINT_CALENDAR,
  now: Date = new Date()
): number {
  return sprintFor(now, calendar) ?? 1;
}

/** `[1, 2, ..., upTo ?? currentSprint()]`. */
export function enumerateSprints(
  upTo?: number,
  calendar: SprintCalendar = NDB_SPRINT_CALENDAR
): number[] {
  const end = upTo ?? currentSprint(calendar);
  const cap = Math.max(1, end);
  return Array.from({ length: cap }, (_, i) => i + 1);
}

export function sprintLabel(n: number): string {
  return `S${n}`;
}
