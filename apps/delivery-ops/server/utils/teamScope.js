/**
 * Team scope helpers (CJS). Keep in sync with shared/src/utils/teamScope.ts.
 */

const VERSION_LIST_TTL_MS = 10 * 60 * 1000;
const versionListCache = new Map();

function wrapTeamScope(baseFilter, jql) {
  const filter = typeof baseFilter === 'string' ? baseFilter.trim() : '';
  const inner = typeof jql === 'string' ? jql.trim() : '';
  if (!inner) return filter;
  if (!filter) return inner;
  return `(${filter}) AND (${inner})`;
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

function uniqueFixVersionNames(issues) {
  const names = new Set();
  for (const issue of issues || []) {
    for (const fv of issue.fields?.fixVersions || []) {
      if (fv?.name) names.add(String(fv.name));
    }
  }
  return [...names].sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
}

async function listFixVersionsForTeam(team, jira) {
  const baseFilter = requireBaseFilter(team);
  const cacheKey = String(team.id || baseFilter);
  const cached = versionListCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < VERSION_LIST_TTL_MS) {
    return cached.versions;
  }

  const jql = wrapTeamScope(baseFilter, 'fixVersion is not EMPTY');
  const issues = await jira.searchAll(jql, 'fixVersions', {
    pageSize: 100,
    maxIssues: 20000,
  });
  const names = uniqueFixVersionNames(issues);

  const metaByName = new Map();
  if (team.projectKey && typeof jira.getProjectVersions === 'function') {
    try {
      const projectVersions = await jira.getProjectVersions(team.projectKey);
      for (const v of projectVersions || []) {
        if (v?.name) metaByName.set(String(v.name), v);
      }
    } catch (_e) {
      // Metadata is optional — ticket names still win.
    }
  }

  const versions = names.map((name) => {
    const meta = metaByName.get(name);
    return {
      name,
      released: !!meta?.released,
      releaseDate: meta?.releaseDate || undefined,
    };
  });

  versionListCache.set(cacheKey, { fetchedAt: Date.now(), versions });
  return versions;
}

module.exports = {
  wrapTeamScope,
  requireBaseFilter,
  isUnreleasedVersion,
  toVersionSummary,
  pickNextUpcomingGaVersion,
  listFixVersionsForTeam,
  clearFixVersionCache,
  uniqueFixVersionNames,
};
