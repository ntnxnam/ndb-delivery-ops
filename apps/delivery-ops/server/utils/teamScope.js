/**
 * Team scope helpers (CJS). Keep in sync with shared/src/utils/teamScope.ts.
 *
 * Version listing is GET /project/{projectKey}/versions (one call).
 * Ticket queries still AND the team's baseFilter.
 */

const VERSION_LIST_TTL_MS = 10 * 60 * 1000;
const versionListCache = new Map();

const TRAILING_ORDER_BY = /\s+(ORDER\s+BY\s+.+)$/i;

function wrapTeamScope(baseFilter, jql) {
  const filter = typeof baseFilter === 'string' ? baseFilter.trim() : '';
  const inner = typeof jql === 'string' ? jql.trim() : '';
  if (!inner) return filter;
  if (!filter) return inner;
  // ORDER BY is only valid at the top level. Wrapping it inside AND (...)
  // is a JQL parse error (HTTP 400 from JIRA).
  const orderMatch = inner.match(TRAILING_ORDER_BY);
  const clause = orderMatch ? inner.slice(0, orderMatch.index).trim() : inner;
  const orderBy = orderMatch ? orderMatch[1].trim() : '';
  const wrapped = `(${filter}) AND (${clause})`;
  return orderBy ? `${wrapped} ${orderBy}` : wrapped;
}

const TRAILING_NOT_DONE =
  /\s+AND\s+statusCategory\s*(?:!=\s*"?Done"?|not\s+in\s*\(\s*"?Done"?\s*\))\s*$/i;

/**
 * Sprint reports must count completed work, so the sprint scope is the
 * team base filter minus a trailing `AND statusCategory != Done`.
 */
function sprintScopeFromBaseFilter(baseFilter) {
  return stripOrderBy(baseFilter).replace(TRAILING_NOT_DONE, '').trim();
}

function stripOrderBy(jql) {
  const filter = typeof jql === 'string' ? jql.trim() : '';
  const orderMatch = filter.match(TRAILING_ORDER_BY);
  return orderMatch ? filter.slice(0, orderMatch.index).trim() : filter;
}

function requireBaseFilter(team) {
  const filter = typeof team?.baseFilter === 'string' ? team.baseFilter.trim() : '';
  if (!filter) {
    const err = new Error(
      `Team "${team?.id || 'unknown'}" has no baseFilter in Admin. Set the team base filter, then Fetch again.`
    );
    err.statusCode = 400;
    err.publicError = 'Team has no base filter';
    throw err;
  }
  return filter;
}

function requireProjectKey(team) {
  const key = typeof team?.projectKey === 'string' ? team.projectKey.trim() : '';
  if (!key) {
    const err = new Error(
      `Team "${team?.id || 'unknown'}" has no projectKey in Admin. Set the team's JIRA project, then Fetch again.`
    );
    err.statusCode = 400;
    err.publicError = 'Team has no JIRA project';
    throw err;
  }
  return key;
}

function isUnreleasedVersion(v) {
  return Boolean(v && v.name) && v.released !== true && v.archived !== true;
}

/**
 * Returns true for a one-dot (Major.Minor) release name, e.g. "NDB-2.12", "NCC-6.0".
 * Maintenance (two-dot), patch (three-dot), and pre-release (-EA, -RC) versions return false.
 * Used so the global defaultReleaseVersion always points to the nearest one-dot release.
 */
function isOneDotRelease(name) {
  if (!name || typeof name !== 'string') return false;
  // Strip known product prefix (e.g. "NDB-", "NCC-") then count dots in the version part.
  const versionPart = name.replace(/^[A-Z]+-/i, '');
  // Pre-release suffixes (e.g. -EA, -RC1) are not one-dot releases.
  if (/-[A-Z]/i.test(versionPart)) return false;
  return (versionPart.match(/\./g) || []).length === 1;
}

function toVersionSummary(v) {
  return {
    name: String(v.name),
    released: !!v.released,
    releaseDate: v.releaseDate || undefined,
  };
}

function utcDay(d) {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseReleaseDay(releaseDate) {
  const t = new Date(releaseDate);
  if (Number.isNaN(t.getTime())) return null;
  return utcDay(t);
}

function pickNextUpcomingGaVersion(versions, now = new Date()) {
  const unreleased = (versions || []).filter(isUnreleasedVersion);
  if (unreleased.length === 0) return null;

  const today = utcDay(now);
  const dated = unreleased
    .map((v) => ({ v, day: v.releaseDate ? parseReleaseDay(v.releaseDate) : null }))
    .filter((row) => row.day != null);

  // Prefer one-dot (Major.Minor) releases as the global default — maintenance/patch
  // releases (2+ dots) or pre-releases (-EA/-RC) should not override the global default.
  const oneDot = dated.filter((row) => isOneDotRelease(row.v.name));
  const candidate = oneDot.length > 0 ? oneDot : dated;

  const upcoming = candidate.filter((row) => row.day >= today).sort((a, b) => a.day - b.day);
  if (upcoming.length > 0) return upcoming[0].v.name || null;

  const overdue = candidate.sort((a, b) => a.day - b.day);
  if (overdue.length > 0) return overdue[0].v.name || null;

  return unreleased[0].name || null;
}

function clearFixVersionCache() {
  versionListCache.clear();
}

function sortVersionNames(a, b) {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
}

async function listFixVersionsForTeam(team, jira) {
  const projectKey = requireProjectKey(team);
  const cacheKey = String(team.id || projectKey);
  const cached = versionListCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < VERSION_LIST_TTL_MS) {
    return cached.versions;
  }

  const projectVersions = await jira.getProjectVersions(projectKey);
  const versions = (projectVersions || [])
    .filter(isUnreleasedVersion)
    .map((v) => ({
      name: String(v.name),
      released: false,
      releaseDate: v.releaseDate || undefined,
    }))
    .sort((a, b) => sortVersionNames(a.name, b.name));

  versionListCache.set(cacheKey, { fetchedAt: Date.now(), versions });
  return versions;
}

module.exports = {
  wrapTeamScope,
  sprintScopeFromBaseFilter,
  stripOrderBy,
  requireBaseFilter,
  requireProjectKey,
  isUnreleasedVersion,
  isOneDotRelease,
  toVersionSummary,
  pickNextUpcomingGaVersion,
  listFixVersionsForTeam,
  clearFixVersionCache,
};
