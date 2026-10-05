/**
 * Team scope helpers: wrap ticket JQL with a team's base filter, and list
 * unreleased versions from the team's JIRA project.
 *
 * Version listing is GET /project/{projectKey}/versions (one call). It does
 * not search tickets. Ticket queries still AND the team's baseFilter.
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
  getProjectVersions(projectKey: string): Promise<VersionLike[]>;
}

export interface TeamFixVersion {
  name: string;
  released: boolean;
  releaseDate?: string;
}

const VERSION_LIST_TTL_MS = 10 * 60 * 1000;
const versionListCache = new Map<string, { fetchedAt: number; versions: TeamFixVersion[] }>();

const TRAILING_ORDER_BY = /\s+(ORDER\s+BY\s+.+)$/i;

/**
 * `(${baseFilter}) AND (${jql})` — same shape as kpiService.buildKpiCombinedJql.
 * Empty filter or empty JQL is passed through without wrapping.
 * A trailing ORDER BY is hoisted outside the AND group — JIRA 400s if it
 * stays inside the parentheses.
 */
export function wrapTeamScope(baseFilter: string | null | undefined, jql: string | null | undefined): string {
  const filter = typeof baseFilter === 'string' ? baseFilter.trim() : '';
  const inner = typeof jql === 'string' ? jql.trim() : '';
  if (!inner) return filter;
  if (!filter) return inner;
  const orderMatch = inner.match(TRAILING_ORDER_BY);
  if (orderMatch && orderMatch.index != null) {
    const clause = inner.slice(0, orderMatch.index).trim();
    const orderBy = String(orderMatch[1]).trim();
    return `(${filter}) AND (${clause}) ${orderBy}`;
  }
  return `(${filter}) AND (${inner})`;
}

const TRAILING_NOT_DONE =
  /\s+AND\s+statusCategory\s*(?:!=\s*"?Done"?|not\s+in\s*\(\s*"?Done"?\s*\))\s*$/i;

/**
 * Sprint reports must count completed work, so the sprint scope is the
 * team base filter minus a trailing `AND statusCategory != Done`.
 */
export function sprintScopeFromBaseFilter(baseFilter: string | null | undefined): string {
  let filter = typeof baseFilter === 'string' ? baseFilter.trim() : '';
  const orderMatch = filter.match(TRAILING_ORDER_BY);
  if (orderMatch && orderMatch.index != null) filter = filter.slice(0, orderMatch.index).trim();
  return filter.replace(TRAILING_NOT_DONE, '').trim();
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

export function requireProjectKey(team: TeamScopeInput | null | undefined): string {
  const key = typeof team?.projectKey === 'string' ? team.projectKey.trim() : '';
  if (!key) {
    const err = new Error(
      `Team "${team?.id || 'unknown'}" has no projectKey in Admin. Set the team's JIRA project, then Fetch again.`
    ) as Error & { statusCode: number; publicError: string };
    err.statusCode = 400;
    err.publicError = 'Team has no JIRA project';
    throw err;
  }
  return key;
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

function sortVersionNames(a: string, b: string): number {
  return b.localeCompare(a, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Unreleased versions in the team's JIRA project.
 * One call: GET /rest/api/2/project/{projectKey}/versions.
 * Requires projectKey — never falls back to another team's project.
 */
export async function listFixVersionsForTeam(
  team: TeamScopeInput,
  jira: JiraVersionClient
): Promise<TeamFixVersion[]> {
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
