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

  const upcoming = dated.filter((row) => row.day >= today).sort((a, b) => a.day - b.day);
  if (upcoming.length > 0) return upcoming[0].v.name || null;

  const overdue = dated.sort((a, b) => a.day - b.day);
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
  requireBaseFilter,
  requireProjectKey,
  isUnreleasedVersion,
  toVersionSummary,
  pickNextUpcomingGaVersion,
  listFixVersionsForTeam,
  clearFixVersionCache,
};
