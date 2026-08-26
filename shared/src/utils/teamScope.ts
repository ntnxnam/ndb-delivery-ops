/**
 * Team scope helpers: wrap ticket JQL with a team's base filter, and list
 * fixVersions that actually appear on tickets in that filter.
 *
 * Version discovery searches `(${baseFilter}) AND fixVersion is not EMPTY`.
 * Prefix/glob matching is not used. Ticket queries AND the team's
 * baseFilter the same way KPIs already do.
 */

export interface VersionLike {
  name?: string;
  released?: boolean;
  archived?: boolean;
  releaseDate?: string;
}

export interface TeamScopeInput {
  id?: string;
  baseFilter?: string | null;
  projectKey?: string | null;
}

export interface JiraVersionClient {
  searchAll(
    jql: string,
    fields: string,
    options?: { pageSize?: number; maxIssues?: number; perPageTimeoutMs?: number }
  ): Promise<Array<{ fields?: { fixVersions?: Array<{ name?: string }> } }>>;
  getProjectVersions?(projectKey: string): Promise<VersionLike[]>;
}

export interface TeamFixVersion {
  name: string;
  released: boolean;
  releaseDate?: string;
}

const VERSION_LIST_TTL_MS = 10 * 60 * 1000;
const versionListCache = new Map<string, { fetchedAt: number; versions: TeamFixVersion[] }>();

/**
 * `(${baseFilter}) AND (${jql})` — same shape as kpiService.buildKpiCombinedJql.
 * Empty filter or empty JQL is passed through without wrapping.
 */
export function wrapTeamScope(baseFilter: string | null | undefined, jql: string | null | undefined): string {
  const filter = typeof baseFilter === 'string' ? baseFilter.trim() : '';
  const inner = typeof jql === 'string' ? jql.trim() : '';
  if (!inner) return filter;
  if (!filter) return inner;
  return `(${filter}) AND (${inner})`;
}

export function requireBaseFilter(team: TeamScopeInput | null | undefined): string {
  const filter = typeof team?.baseFilter === 'string' ? team.baseFilter.trim() : '';
  if (!filter) {
    const err = new Error(
      `Team "${team?.id || 'unknown'}" has no baseFilter in Admin. Set the team base filter, then Fetch again.`
    ) as Error & { statusCode: number; publicError: string };
    err.statusCode = 400;
    err.publicError = 'Team has no base filter';
    throw err;
  }
  return filter;
}

/** Admin Test Connection rule: open / future versions only. */
export function isUnreleasedVersion(v: VersionLike | null | undefined): boolean {
  if (!v || !v.name) return false;
  return v.released !== true && v.archived !== true;
}

export function toVersionSummary(v: VersionLike): { name: string; released: boolean; releaseDate?: string } {
  return {
    name: String(v.name),
    released: !!v.released,
    releaseDate: v.releaseDate || undefined,
  };
}

function utcDay(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function parseReleaseDay(releaseDate: string): number | null {
  const t = new Date(releaseDate);
  if (Number.isNaN(t.getTime())) return null;
  return utcDay(t);
}

/**
 * Among unreleased versions, pick the one whose JIRA releaseDate (GA) is
 * the soonest on or after today. If none are upcoming, the soonest dated
 * (overdue) unreleased version; then any unreleased name.
 */
export function pickNextUpcomingGaVersion(
  versions: VersionLike[] | null | undefined,
  now: Date = new Date()
): string | null {
  const unreleased = (versions || []).filter(isUnreleasedVersion);
  if (unreleased.length === 0) return null;

  const today = utcDay(now);
  const dated = unreleased
    .map((v) => ({ v, day: v.releaseDate ? parseReleaseDay(v.releaseDate) : null }))
    .filter((row) => row.day != null) as Array<{ v: VersionLike; day: number }>;

  const upcoming = dated.filter((row) => row.day >= today).sort((a, b) => a.day - b.day);
  if (upcoming.length > 0) return upcoming[0].v.name || null;

  const overdue = dated.sort((a, b) => a.day - b.day);
  if (overdue.length > 0) return overdue[0].v.name || null;

  return unreleased[0].name || null;
}

export function clearFixVersionCache(): void {
  versionListCache.clear();
}

function uniqueFixVersionNames(issues: Array<{ fields?: { fixVersions?: Array<{ name?: string }> } }>): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    for (const fv of issue.fields?.fixVersions || []) {
      if (fv?.name) names.add(String(fv.name));
    }
  }
  return [...names].sort((a, b) => b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' }));
}

/**
 * Unique fixVersions that appear on tickets in the team's baseFilter.
 * Joins released/releaseDate from the team's project versions when available.
 * Cached ~10 minutes per team. Requires baseFilter — never falls back to
 * another team's versions.
 */
export async function listFixVersionsForTeam(
  team: TeamScopeInput,
  jira: JiraVersionClient
): Promise<TeamFixVersion[]> {
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

  const metaByName = new Map<string, VersionLike>();
  if (team.projectKey && typeof jira.getProjectVersions === 'function') {
    try {
      const projectVersions = await jira.getProjectVersions(team.projectKey);
      for (const v of projectVersions || []) {
        if (v?.name) metaByName.set(String(v.name), v);
      }
    } catch {
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
