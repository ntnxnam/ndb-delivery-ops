/**
 * Sprint calendar helpers for Admin onboarding.
 *
 * productService.getSprintCalendar() throws when a team omits
 * { s1StartIso, sprintDays }. These helpers collect that pair from a
 * JIRA sprint board (or validate a payload) so it can be persisted on
 * the team entry in teamBoardConfig.json.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MS_PER_DAY = 86_400_000;
const S1_NAME = /\bS(?:print)?\s*0*1\b/i;

function toDateOnly(value) {
  if (value == null || value === '') return null;
  const s = String(value);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function daysBetween(a, b) {
  return Math.floor((b.getTime() - a.getTime()) / MS_PER_DAY);
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Snap a raw duration onto the common 7/14/21 cadence when close;
 * otherwise round to a positive integer.
 */
function snapSprintDays(raw) {
  const n = Math.max(1, Math.round(Number(raw)));
  if (n >= 6 && n <= 9) return 7;
  if (n >= 13 && n <= 16) return 14;
  if (n >= 19 && n <= 22) return 21;
  return n;
}

/**
 * Validate / normalise a sprintCalendar payload.
 * @param {*} raw
 * @returns {{ s1StartIso: string, sprintDays: number } | null}
 */
function parseSprintCalendar(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const s1StartIso = String(raw.s1StartIso || '').trim();
  const sprintDays = Number(raw.sprintDays);
  if (!ISO_DATE.test(s1StartIso)) return null;
  if (!Number.isInteger(sprintDays) || sprintDays < 1 || sprintDays > 90) return null;
  const parsed = toDateOnly(s1StartIso);
  if (!parsed) return null;
  return { s1StartIso, sprintDays };
}

function asSprintList(sprints) {
  if (!sprints) return [];
  if (Array.isArray(sprints)) return sprints;
  if (typeof sprints.values === 'function') return [...sprints.values()];
  return [];
}

/**
 * Infer { s1StartIso, sprintDays } from JIRA Agile sprint rows.
 * Prefers a sprint named S1 / Sprint 1; otherwise the earliest dated sprint.
 *
 * @param {Array|{values?: function}|Map} sprints
 * @returns {{ s1StartIso: string, sprintDays: number, inferredFrom: object }}
 */
function inferSprintCalendarFromSprints(sprints) {
  const dated = asSprintList(sprints)
    .map((s) => ({
      name: String(s?.name || ''),
      start: toDateOnly(s?.startDate),
      end: toDateOnly(s?.endDate),
    }))
    .filter((s) => s.start)
    .sort((a, b) => a.start - b.start);

  if (dated.length === 0) {
    const err = new Error(
      'Sprint board has no dated sprints. Enter S1 start date and sprint length manually.'
    );
    err.statusCode = 400;
    err.code = 'NO_DATED_SPRINTS';
    throw err;
  }

  const durations = dated
    .filter((s) => s.end && s.end > s.start)
    .map((s) => daysBetween(s.start, s.end) + 1);

  const sprintDays = durations.length ? snapSprintDays(median(durations)) : 21;
  const namedS1 = dated.find((s) => S1_NAME.test(s.name));
  const s1StartIso = isoDate(namedS1 ? namedS1.start : dated[0].start);

  return {
    s1StartIso,
    sprintDays,
    inferredFrom: {
      sprintCount: dated.length,
      namedS1: Boolean(namedS1),
      namedS1Name: namedS1 ? namedS1.name : null,
    },
  };
}

/**
 * Fetch a JIRA board + its sprints and infer the sprint calendar.
 *
 * @param {{ get: Function }} jira - JiraConnector (or test double)
 * @param {number} boardId
 * @returns {Promise<{ board: object, sprintCalendar: object, inferredFrom: object, sprintCount: number }>}
 */
async function collectSprintCalendarFromBoard(jira, boardId) {
  const id = Number(boardId);
  if (!Number.isInteger(id) || id < 1) {
    const err = new Error('boardId must be a positive integer');
    err.statusCode = 400;
    throw err;
  }

  const boardRes = await jira.get(`/rest/agile/1.0/board/${id}`, { timeout: 15000 });
  const board = boardRes.data || {};

  const sprints = [];
  let startAt = 0;
  let hasMore = true;
  while (hasMore) {
    const res = await jira.get(`/rest/agile/1.0/board/${id}/sprint`, {
      timeout: 15000,
      params: { startAt, maxResults: 50 },
    });
    const values = res.data?.values || [];
    sprints.push(...values);
    const isLast = res.data?.isLast;
    hasMore = values.length > 0 && isLast === false;
    startAt += values.length;
  }

  const inferred = inferSprintCalendarFromSprints(sprints);
  return {
    board: {
      id: board.id ?? id,
      name: board.name || null,
      type: board.type || null,
    },
    sprintCalendar: {
      s1StartIso: inferred.s1StartIso,
      sprintDays: inferred.sprintDays,
    },
    inferredFrom: inferred.inferredFrom,
    sprintCount: sprints.length,
  };
}

module.exports = {
  parseSprintCalendar,
  inferSprintCalendarFromSprints,
  collectSprintCalendarFromBoard,
  snapSprintDays,
};
