import type { JiraConnector } from '../connectors/jiraConnector.js';
import type { GateEvent, ReleaseGateTimeline } from './gateTimelineService.js';

export interface RetrospectiveParentProject {
  key: string;
  summary: string;
  parentType: 'Feature' | 'Initiative' | 'Other';
}

export interface RetrospectiveDiscipline {
  projectKey: string;
  label: string;
  hardGate: 'PG' | 'GA';
}

export interface RetrospectiveOptions {
  release: string;
  projectKeys: string[];
  companionDisciplines: RetrospectiveDiscipline[];
  labelPrefix: string;
  releasePrefix: string;
  topN?: number;
  /** When set, the release-wide gate checks subtract this JIRA saved filter so only
   *  non-FEAT-project tickets are counted ("Gate compliance for everything else"). */
  childIssuesFilter?: string;
}

export interface RetroProjectsPageOptions {
  release: string;
  coreProjectKey: string;
  featureProjectKey: string;
  page: number;
  limit: number;
  labelPrefix?: string; // e.g., "ndb" — used to detect deferred items
  releasePrefix?: string; // e.g., "NDB-" — used with labelPrefix to build deferred label pattern
  ccmDate?: string; // ISO date for CCM gate (for historical status queries)
  cgDate?: string; // ISO date for CG gate (for historical status queries)
  pgDate?: string; // ISO date for PG gate (for historical status queries)
}

interface ResolvedGateDates {
  ccmDate: string | null;
  cgDate: string | null;
  pgDate: string | null;
  gaDate: string | null;
}

function quoteJql(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeRelease(release: string, releasePrefix: string): string {
  const trimmed = release.trim();
  const withoutPrefix = trimmed.startsWith(releasePrefix)
    ? trimmed.slice(releasePrefix.length)
    : trimmed;
  // Replace dots AND spaces/whitespace — JQL label values must not contain spaces.
  // e.g. "Era Future" → "era-future", "2.11" → "2-11"
  return withoutPrefix.toLowerCase().replace(/[\s.]+/g, '-');
}

function resolveGateDate(gates: GateEvent[], kind: GateEvent['kind']): string | null {
  const matching = gates.filter((g) => g.kind === kind);
  if (matching.length === 0) return null;
  const solid = [...matching].reverse().find((g) => g.style === 'solid');
  if (solid) return solid.iso;
  return matching[matching.length - 1]?.iso ?? null;
}

function toIsoDate(value: unknown): string | null {
  if (!value || typeof value !== 'string') return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function isPastOrToday(iso: string | null): boolean {
  if (!iso) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  return d.getTime() <= today.getTime();
}

function ccmRag(closedPct: number): 'green' | 'yellow' | 'red' {
  if (closedPct >= 95) return 'green';
  if (closedPct >= 80) return 'yellow';
  return 'red';
}

function thresholdRag(v: number, yellowMax: number, redMin: number): 'green' | 'yellow' | 'red' {
  if (v === 0) return 'green';
  if (v <= yellowMax) return 'yellow';
  if (v >= redMin) return 'red';
  return 'yellow';
}

function projectClause(projectKeys: string[]): string {
  return `project in (${projectKeys.join(',')})`;
}

/**
 * Builds the full multi-path hierarchy scope for a given parent key.
 *
 * Child tasks in Nutanix JIRA don't carry fixVersion — it lives only on the
 * parent Feature/Initiative. We must therefore scope by parent key using all
 * six relationship paths so we actually find the leaf tickets.
 */
function buildParentScopeClause(parentKey: string, projectKeys: string[]): string {
  const pClause = projectClause(projectKeys);
  return (
    `${pClause} AND (` +
    `key = ${parentKey} OR ` +
    `"Parent Link" = ${parentKey} OR ` +
    `"FEAT ID" ~ ${parentKey} OR ` +
    `"FEAT Number" = ${parentKey} OR ` +
    `issueFunction in portfolioChildrenOf("key = ${parentKey}") OR ` +
    `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key = ${parentKey}')") OR ` +
    `issueFunction in subtasksOf("key = ${parentKey}") OR ` +
    `issueFunction in subtasksOf("issueFunction in issuesInEpics(\\"issueFunction in portfolioChildrenOf('key = ${parentKey}')\\")")` +
    `)`
  );
}

// Issue types excluded from CCM/GA leaf-ticket checks.
// Bug, Test, Improvement are handled by their own gate checks (CG/PG).
const CCM_TYPE_EXCLUSION =
  `issueType not in (Feature, Initiative, "X-FEAT", Capability, Epic, Bug, Test, Improvement, Blog)`;
const GA_TYPE_EXCLUSION =
  `issueType not in (Feature, Initiative, "X-FEAT", Capability, Epic, Blog)`;

export function buildRetroJqls(
  dates: ResolvedGateDates,
  options: RetrospectiveOptions,
  parentKey?: string
): Record<string, string> {
  const release = options.release;
  const normalized = normalizeRelease(release, options.releasePrefix);
  const pClause = projectClause(options.projectKeys);
  const deferredLabel = `${options.labelPrefix}-${normalized}-deferred`;
  const companionKeys = options.companionDisciplines.map((d) => d.projectKey);

  const companionPg = companionKeys.length
    ? `project in (${companionKeys.join(',')}) AND fixVersion = "${quoteJql(
        release
      )}" AND status was not in (Resolved, Closed, Done) ON "${dates.pgDate}"`
    : '';
  const companionGa = companionKeys.length
    ? `project in (${companionKeys.join(',')}) AND fixVersion = "${quoteJql(
        release
      )}" AND status was not in (Resolved, Closed, Done) ON "${dates.gaDate}"`
    : '';

  // pgToGa queries also use the full filter scope for consistency.
  const pgToGaClosed = `${pClause} AND filter = "${quoteJql(release)}-All" AND status changed to Closed after "${dates.pgDate}" before "${dates.gaDate}"`;
  const pgToGaDeferred = `${pClause} AND filter = "${quoteJql(release)}-All" AND labels = "${quoteJql(deferredLabel)}" AND updated > "${dates.pgDate}" AND updated <= "${dates.gaDate}"`;

  // Per-parent queries: scope by the full multi-path hierarchy so we find leaf
  // tickets that don't have fixVersion set on them directly.
  if (parentKey) {
    const scope = buildParentScopeClause(parentKey, options.projectKeys);

    return {
      ccmOpen: dates.ccmDate
        ? `${scope} AND ${CCM_TYPE_EXCLUSION} AND status was not in (Resolved, Closed, Done) ON "${dates.ccmDate}"`
        : '',
      ccmTotal: `${scope} AND ${CCM_TYPE_EXCLUSION}`,
      cgOpenAtGate: dates.cgDate
        ? `${scope} AND issueType = Bug AND priority in ("Blocker - P0", "Critical - P1") AND status was not in (Resolved, Closed, Done) ON "${dates.cgDate}"`
        : '',
      cgFoundAfter: dates.cgDate
        ? `${scope} AND issueType = Bug AND priority in ("Blocker - P0", "Critical - P1") AND created > "${dates.cgDate}"`
        : '',
      pgTestsOpen: dates.pgDate
        ? `${scope} AND issueType = Test AND status was not in (Resolved, Closed, Done) ON "${dates.pgDate}"`
        : '',
      pgBugsOpen: dates.pgDate
        ? `${scope} AND issueType = Bug AND status was not in (Resolved, Closed, Done) ON "${dates.pgDate}" AND labels not in ("${quoteJql(deferredLabel)}")`
        : '',
      gaOpen: dates.gaDate
        ? `${scope} AND ${GA_TYPE_EXCLUSION} AND status was not in (Resolved, Closed, Done) ON "${dates.gaDate}"`
        : '',
      companionPgOpen: companionPg,
      companionGaOpen: companionGa,
      pgToGaClosed,
      pgToGaDeferred,
    };
  }

  // Release-wide queries: use the saved JIRA filter "{release}-All" (e.g. NDB-2.11-All)
  // instead of fixVersion so we capture the full release payload including tickets that
  // are in the portfolio-children hierarchy and don't carry fixVersion directly.
  // fixVersion = "NDB-2.11" returns ~289 tasks; filter = "NDB-2.11-All" returns ~356.
  //
  // When childIssuesFilter is set we subtract the FEAT-project children so the cards
  // show only "everything else" (standalone epics, direct bugs, etc.).
  const filterClause = options.childIssuesFilter
    ? `${pClause} AND filter = "${quoteJql(release)}-All" AND NOT filter = "${quoteJql(options.childIssuesFilter)}"`
    : `${pClause} AND filter = "${quoteJql(release)}-All"`;

  const baseCcmOpen = `${filterClause} AND issueType in (Task, "Unit Test") AND status was not in (Resolved, Closed, Done) ON "${dates.ccmDate}"`;
  const baseCcmTotal = `${filterClause} AND issueType in (Task, "Unit Test")`;

  const baseCgOpen = `${filterClause} AND issueType = Bug AND priority in ("Blocker - P0", "Critical - P1") AND status was not in (Resolved, Closed, Done) ON "${dates.cgDate}"`;
  const baseCgFoundAfter = `${filterClause} AND issueType = Bug AND priority in ("Blocker - P0", "Critical - P1") AND created > "${dates.cgDate}"`;

  const basePgTests = `${filterClause} AND issueType = Test AND status was not in (Resolved, Closed, Done) ON "${dates.pgDate}"`;
  const basePgBugs = `${filterClause} AND issueType = Bug AND status was not in (Resolved, Closed, Done) ON "${dates.pgDate}" AND labels not in ("${quoteJql(deferredLabel)}")`;

  const baseGaOpen = dates.gaDate
    ? `${filterClause} AND status was not in (Resolved, Closed, Done) ON "${dates.gaDate}"`
    : '';

  return {
    ccmOpen: baseCcmOpen,
    ccmTotal: baseCcmTotal,
    cgOpenAtGate: baseCgOpen,
    cgFoundAfter: baseCgFoundAfter,
    pgTestsOpen: basePgTests,
    pgBugsOpen: basePgBugs,
    gaOpen: baseGaOpen,
    companionPgOpen: companionPg,
    companionGaOpen: companionGa,
    pgToGaClosed,
    pgToGaDeferred,
  };
}

export function resolveGateDates(gateTimeline: ReleaseGateTimeline): ResolvedGateDates {
  return {
    ccmDate: resolveGateDate(gateTimeline.gates, 'CCM'),
    cgDate: resolveGateDate(gateTimeline.gates, 'CG'),
    pgDate: resolveGateDate(gateTimeline.gates, 'PG'),
    gaDate: resolveGateDate(gateTimeline.gates, 'GA'),
  };
}

export function getRetroBootstrap(
  gateTimeline: ReleaseGateTimeline,
  parentCount: number,
  options: RetrospectiveOptions
) {
  const started = Date.now();
  const gateDates = resolveGateDates(gateTimeline);
  const payload = {
    release: options.release,
    gateTimeline,
    gateDates,
    parentCount,
    companionCount: options.companionDisciplines.length,
  };
  return { ...payload, timingMs: Date.now() - started };
}

// Priority names treated as "high severity" for CG gate check.
// Nutanix JIRA uses compound names like "Blocker - P0" and "Critical - P1".
// Include both compound and short forms so the set is future-proof.
const HIGH_SEVERITY_PRIORITIES = new Set([
  'Blocker - P0', 'Critical - P1', // Nutanix compound form
  'P0', 'P1',                       // short form (other tenants / future)
  'Blocker', 'Critical',            // legacy / fallback
]);

function isHighSeverity(fields: Record<string, unknown>): boolean {
  const priority = fields?.priority as Record<string, unknown> | undefined;
  const name = (priority?.name as string) || '';
  return HIGH_SEVERITY_PRIORITIES.has(name);
}

export async function getRetroProjectsPage(
  jira: JiraConnector,
  options: RetroProjectsPageOptions
): Promise<{
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  projects: Array<{
    key: string;
    summary: string;
    parentType: 'Feature' | 'Initiative';
    ccm: {
      done: number;
      openEra: number;
      openNonEra: number;
      lastClosedDate: string | null;   // latest resolutiondate among closed Tasks/UnitTests
    };
    cg: {
      done: number;
      openEra: number;
      openNonEra: number;
      lastResolvedDate: string | null; // latest resolutiondate among P0/P1 bugs resolved
    };
    pg: {
      done: number;
      openEra: number;
      openNonEra: number;
      lastResolvedDate: string | null; // latest resolutiondate among all bugs/tests resolved
    };
  }>;
  timingMs: number;
}> {
  const started = Date.now();
  const page = Math.max(1, options.page || 1);
  const limit = Math.max(1, Math.min(200, options.limit || 50));
  const offset = (page - 1) * limit;

  // Single cross-project JQL — same pattern as /project-breakdown (line 685 of releaseDataset.js)
  // which already correctly picks up both FEAT Features and ERA Initiatives.
  const topLevelJql = `fixVersion = "${quoteJql(options.release)}" AND issuetype in (Feature, Initiative, X-FEAT, Capability) AND status not in (Cancelled, Backlog) ORDER BY key`;

  // customfield_11067 (per-FEAT Code Complete Date) is intentionally NOT fetched here.
  // The Planned CC baseline for slip calculation is the release-level CCM gate date
  // from the gate timeline config, not a per-FEAT self-set date. The client reads
  // bootstrap.gateDates.ccmDate and computes CC slip client-side, consistent with how
  // CG and PG slips are already computed using gd.cgDate / gd.pgDate.
  const rawParents = await jira.searchAll(topLevelJql, 'summary,issuetype', { maxIssues: 10000 });

  console.info(
    `[retroService] getRetroProjectsPage release=${options.release} found=${rawParents.length}`
  );

  const allParents = rawParents.map((i) => {
    const fields = i.fields as Record<string, unknown>;
    const issuetypeField = fields?.issuetype as Record<string, unknown> | undefined;
    const issueType: string = (issuetypeField?.name as string) || '';
    const parentType: 'Feature' | 'Initiative' =
      issueType === 'Initiative' ? 'Initiative' : 'Feature';
    return { issue: i, parentType };
  });

  const total = allParents.length;
  const selected = allParents.slice(offset, offset + limit);

  const projects = await mapInBatches(selected, 5, async (item) => {
    const parentKey = item.issue.key;

    // Use the full multi-path scope so we find leaf tickets that don't carry
    // fixVersion on themselves. Sub-tasks are excluded — they have no independent
    // gate compliance meaning and double-count the parent task.
    const childScope = buildParentScopeClause(
      parentKey,
      [options.coreProjectKey, options.featureProjectKey].filter(Boolean)
    );
    const childJql =
      `${childScope} AND issueType not in (Feature, Initiative, Epic, X-FEAT, Capability, "Sub-task")`;

    // Build per-metric JQL links for table cell hyperlinks.
    //
    // Work items (Tasks, Bugs, Tests) live inside epics, not as direct portfolio
    // children. We therefore use:
    //   • issuesInEpics(portfolioChildrenOf(…)) — work items inside epics of the FEAT
    //   • portfolioChildrenOf(…) — direct children (catches any non-epic work items)
    //
    // We intentionally omit the `project in (ERA,FEAT)` scope clause so the link
    // finds children in AT, UXE, NDBQUAL and every other project — matching real
    // JIRA behaviour regardless of which project the child ticket lives in.
    const epicsScope = `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key = ${parentKey}')")`;
    const directScope = `issueFunction in portfolioChildrenOf("key = ${parentKey}")`;
    const fullHierarchyScope = `(${directScope} OR ${epicsScope})`;

    // NOTE: These JQL links are for the projects table and show items that are CURRENTLY open.
    // They do NOT use historical "status was X ON date" checks — they show present status only.
    // This is intentional: the table lets you click through to see what's currently blocking,
    // not what was blocking on the historical gate date.
    const ccOpenJql  = `${fullHierarchyScope} AND issueType in (Task, "Unit Test") AND statusCategory != Done`;
    const ccOpenEraJql = `${ccOpenJql} AND project = ERA`;
    const ccOpenNonEraJql = `${ccOpenJql} AND project != ERA`;

    const cgOpenJql  = `${fullHierarchyScope} AND issueType in (Bug, Improvement) AND priority in ("Blocker - P0", "Critical - P1") AND statusCategory != Done AND status != Resolved`;
    const cgOpenEraJql = `${cgOpenJql} AND project = ERA`;
    const cgOpenNonEraJql = `${cgOpenJql} AND project != ERA`;

    const pgOpenJql  = `${fullHierarchyScope} AND issueType in (Bug, Improvement, Test) AND statusCategory != Done AND status != Resolved`;
    const pgOpenEraJql = `${pgOpenJql} AND project = ERA`;
    const pgOpenNonEraJql = `${pgOpenJql} AND project != ERA`;

    const children = await jira.searchAll(
      childJql,
      'issuetype,priority,status,resolutiondate,labels,fixVersions',
      { maxIssues: 2000 }
    );

    // Build deferred label pattern (e.g., "ndb-2.11-deferred" for release "NDB-2.11").
    // Use normalizeRelease so spaces and dots are both replaced with hyphens —
    // JQL label values cannot contain spaces (e.g. "Era Future" → "era-future").
    const deferredLabelPattern = options.labelPrefix && options.releasePrefix
      ? `${options.labelPrefix}-${normalizeRelease(options.release, options.releasePrefix)}-deferred`
      : null;

    // Gate dates for "missed gate" counting — items open ON the gate date
    // = closed AFTER gate date OR still open now (and not deferred).
    const ccmCutoff = options.ccmDate || null;
    const cgCutoff  = options.cgDate  || null;
    const pgCutoff  = options.pgDate  || null;

    // Gate buckets with ERA/non-ERA split.
    // openEra / openNonEra = items that MISSED the gate (closed after, or still open).
    const ccm = { done: 0, openEra: 0, openNonEra: 0, lastClosedDate: null as string | null };
    const cg  = { done: 0, openEra: 0, openNonEra: 0, lastResolvedDate: null as string | null };
    const pg  = { done: 0, openEra: 0, openNonEra: 0, lastResolvedDate: null as string | null };
    const deferred = { era: 0, nonEra: 0, targetVersions: new Set<string>() };

    const ccmDoneDates: string[] = [];
    const cgResolvedDates: string[] = [];
    const pgResolvedDates: string[] = [];

    for (const c of children) {
      const fields = (c as any)?.fields as Record<string, unknown>;
      const issueKey: string = String(c.key || '');
      const isEra = issueKey.startsWith('ERA-');
      const issueTypeName: string =
        ((fields?.issuetype as Record<string, unknown>)?.name as string) || '';
      const statusName: string = String(
        (fields?.status as Record<string, unknown>)?.name || ''
      );
      const statusCat: string = String(
        ((fields?.status as Record<string, unknown>)?.statusCategory as Record<string, unknown>)?.name || ''
      ).toLowerCase();

      const labelsArray = Array.isArray(fields?.labels) ? (fields?.labels as string[]) : [];
      const isDeferredLabel = deferredLabelPattern && labelsArray.some((label: string) =>
        label && typeof label === 'string' && label === deferredLabelPattern
      );

      const isClosed = statusCat === 'done' || statusName === 'Closed';
      const isResolved = statusName === 'Resolved';
      const isDevFixed = isClosed || isResolved;
      const isCurrentlyOpen = !isClosed && !isResolved;

      const rd = toIsoDate(fields?.resolutiondate as string | undefined);

      // "Missed gate" = closed after the gate cutoff date, OR still open now (not deferred).
      // When no gate date is available (gates in the future), fall back to current open status.
      const missedCcm = (issueKey: string, resolvedDate: string | null): boolean => {
        if (!ccmCutoff) return isCurrentlyOpen;
        if (isCurrentlyOpen) return true;          // still open → missed
        if (resolvedDate && resolvedDate > ccmCutoff) return true; // closed late → missed
        return false;
      };
      const missedCg = (resolvedDate: string | null): boolean => {
        if (!cgCutoff) return isCurrentlyOpen;
        if (isCurrentlyOpen) return true;
        if (resolvedDate && resolvedDate > cgCutoff) return true;
        return false;
      };
      const missedPg = (resolvedDate: string | null): boolean => {
        if (!pgCutoff) return isCurrentlyOpen;
        if (isCurrentlyOpen) return true;
        if (resolvedDate && resolvedDate > pgCutoff) return true;
        return false;
      };

      // CCM gate: Task + Unit Test
      if (issueTypeName === 'Task' || issueTypeName === 'Unit Test') {
        if (isClosed) {
          ccm.done++;
          if (rd) ccmDoneDates.push(rd);
        }
        if (!isDeferredLabel) {
          if (missedCcm(issueKey, rd)) {
            if (isEra) ccm.openEra++;
            else ccm.openNonEra++;
          }
        }
      }

      // CG gate: high-severity (P0/P1) Bugs + Improvements
      if (issueTypeName === 'Bug' || issueTypeName === 'Improvement') {
        if (isHighSeverity(fields)) {
          if (isDevFixed) {
            cg.done++;
            if (rd) cgResolvedDates.push(rd);
          }
          if (!isDeferredLabel && missedCg(rd)) {
            if (isEra) cg.openEra++;
            else cg.openNonEra++;
          }
        }
        // PG gate: ALL Bugs + Improvements
        if (isDevFixed) {
          pg.done++;
          if (rd) pgResolvedDates.push(rd);
        }
        if (!isDeferredLabel && missedPg(rd)) {
          if (isEra) pg.openEra++;
          else pg.openNonEra++;
        }
      }

      // PG gate: Test tickets
      if (issueTypeName === 'Test') {
        if (isClosed) {
          pg.done++;
          if (rd) pgResolvedDates.push(rd);
        }
        if (!isDeferredLabel && missedPg(rd)) {
          if (isEra) pg.openEra++;
          else pg.openNonEra++;
        }
      }

      // Deferred items
      if (isDeferredLabel) {
        if (isEra) deferred.era++;
        else deferred.nonEra++;

        const fixVersionField = fields?.fixVersions as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(fixVersionField)) {
          fixVersionField.forEach((fv: Record<string, unknown>) => {
            const versionName = fv?.name as string | undefined;
            if (versionName) deferred.targetVersions.add(versionName);
          });
        }
      }
    }

    // CCM: latest closed Task/UnitTest date
    if (ccmDoneDates.length > 0) {
      ccm.lastClosedDate = ccmDoneDates.sort()[ccmDoneDates.length - 1];
    }

    // CG: latest date a P0/P1 bug was resolved
    if (cgResolvedDates.length > 0) {
      cg.lastResolvedDate = cgResolvedDates.sort()[cgResolvedDates.length - 1];
    }

    // PG: latest date any bug/improvement/test was resolved/closed
    if (pgResolvedDates.length > 0) {
      pg.lastResolvedDate = pgResolvedDates.sort()[pgResolvedDates.length - 1];
    }

    return {
      key: parentKey,
      summary: String(item.issue.fields?.summary || parentKey),
      parentType: item.parentType,
      ccm,
      cg,
      pg,
      deferred: {
        ...deferred,
        targetVersions: Array.from(deferred.targetVersions),
      },
      links: {
        ccmOpen: ccOpenJql,
        ccmOpenEra: ccOpenEraJql,
        ccmOpenNonEra: ccOpenNonEraJql,
        cgOpen: cgOpenJql,
        cgOpenEra: cgOpenEraJql,
        cgOpenNonEra: cgOpenNonEraJql,
        pgOpen: pgOpenJql,
        pgOpenEra: pgOpenEraJql,
        pgOpenNonEra: pgOpenNonEraJql,
        deferred: deferredLabelPattern
          ? `${childScope} AND labels = "${deferredLabelPattern}"`
          : null,
        deferredEra: deferredLabelPattern
          ? `${childScope} AND labels = "${deferredLabelPattern}" AND project = ERA`
          : null,
        deferredNonEra: deferredLabelPattern
          ? `${childScope} AND labels = "${deferredLabelPattern}" AND project != ERA`
          : null,
      },
    };
  });

  return {
    page,
    limit,
    total,
    hasMore: offset + limit < total,
    projects,
    timingMs: Date.now() - started,
  };
}

export async function getRetroProjectDetail(
  gateTimeline: ReleaseGateTimeline,
  options: RetrospectiveOptions,
  parentProject: RetrospectiveParentProject,
  jira: JiraConnector
) {
  const started = Date.now();
  const dates = resolveGateDates(gateTimeline);
  const jqls = buildRetroJqls(dates, options, parentProject.key);
  const hasPastCcm = isPastOrToday(dates.ccmDate);
  const hasPastCg = isPastOrToday(dates.cgDate);
  const hasPastPg = isPastOrToday(dates.pgDate);
  const hasPastGa = isPastOrToday(dates.gaDate);

  const normalized = normalizeRelease(options.release, options.releasePrefix);
  const deferredLabel = `${options.labelPrefix}-${normalized}-deferred`;
  const parentScope = buildParentScopeClause(parentProject.key, options.projectKeys);
  const deferredJql = `${parentScope} AND labels = "${quoteJql(deferredLabel)}"`;

  const [ccmOpen, ccmTotal, cgOpen, cgAfter, pgTests, pgBugs, gaOpen, deferredCount] =
    await Promise.all([
      hasPastCcm ? jira.searchCount(jqls.ccmOpen) : Promise.resolve(0),
      hasPastCcm ? jira.searchCount(jqls.ccmTotal) : Promise.resolve(0),
      hasPastCg ? jira.searchCount(jqls.cgOpenAtGate) : Promise.resolve(0),
      hasPastCg ? jira.searchCount(jqls.cgFoundAfter) : Promise.resolve(0),
      hasPastPg ? jira.searchCount(jqls.pgTestsOpen) : Promise.resolve(0),
      hasPastPg ? jira.searchCount(jqls.pgBugsOpen) : Promise.resolve(0),
      jqls.gaOpen ? jira.searchCount(jqls.gaOpen) : Promise.resolve(0),
      jira.searchCount(deferredJql),
    ]);

  return {
    parent: parentProject,
    dates,
    checks: {
      ccm: {
        skipped: !hasPastCcm,
        total: ccmTotal,
        openAtGate: ccmOpen,
        closedPct: ccmTotal > 0 ? Math.round(((ccmTotal - ccmOpen) / ccmTotal) * 100) : 100,
        rag: ccmRag(ccmTotal > 0 ? Math.round(((ccmTotal - ccmOpen) / ccmTotal) * 100) : 100),
        links: { openAtGate: jqls.ccmOpen, total: jqls.ccmTotal },
      },
      cg: {
        skipped: !hasPastCg,
        p0p1OpenAtGate: cgOpen,
        p0p1FoundAfter: cgAfter,
        ragOpen: thresholdRag(cgOpen, 3, 4),
        ragAfter: thresholdRag(cgAfter, 5, 6),
        links: { p0p1OpenAtGate: jqls.cgOpenAtGate, p0p1FoundAfter: jqls.cgFoundAfter },
      },
      pg: {
        skipped: !hasPastPg,
        testsOpenAtGate: pgTests,
        bugsOpenAtGate: pgBugs,
        ragTests: thresholdRag(pgTests, 5, 6),
        ragBugs: thresholdRag(pgBugs, 3, 4),
        links: { testsOpenAtGate: jqls.pgTestsOpen, bugsOpenAtGate: jqls.pgBugsOpen },
      },
      ga: {
        skipped: !hasPastGa,
        openAtGate: gaOpen,
        rag: thresholdRag(gaOpen, 2, 3),
        links: { openAtGate: jqls.gaOpen },
      },
      deferred: {
        count: deferredCount,
        links: { count: deferredJql },
      },
    },
    timingMs: Date.now() - started,
  };
}

/**
 * Probe JIRA to find which saved-filter name holds the FEAT-project child issues
 * for this release. Naming conventions have varied over time so we try both:
 *   primary  → getndb-2.12ChildIssues  (release.toLowerCase() keeps the hyphen)
 *   fallback → getndb2.12ChildIssues   (hyphen removed)
 * Returns null if neither filter exists, causing gate checks to fall back to the
 * full-release scope.
 */
async function resolveChildIssuesFilterName(
  release: string,
  jira: JiraConnector
): Promise<string | null> {
  const lower = release.toLowerCase();
  const primary = `get${lower}ChildIssues`;               // getndb-2.12ChildIssues
  const fallback = `get${lower.replace(/-/g, '')}ChildIssues`; // getndb2.12ChildIssues
  for (const name of [primary, fallback]) {
    try {
      await jira.searchCount(`filter = "${name}"`);
      return name;
    } catch {
      // try next
    }
  }
  return null;
}

export async function runRetroGateChecks(
  gateTimeline: ReleaseGateTimeline,
  options: RetrospectiveOptions,
  jira: JiraConnector
) {
  const dates: ResolvedGateDates = {
    ccmDate: resolveGateDate(gateTimeline.gates, 'CCM'),
    cgDate: resolveGateDate(gateTimeline.gates, 'CG'),
    pgDate: resolveGateDate(gateTimeline.gates, 'PG'),
    gaDate: resolveGateDate(gateTimeline.gates, 'GA'),
  };

  // Resolve the child-issues filter once and inject it into options so that
  // buildRetroJqls scopes the cards to "everything else" (non-FEAT tickets).
  const childIssuesFilter = await resolveChildIssuesFilterName(options.release, jira);
  const effectiveOptions = childIssuesFilter ? { ...options, childIssuesFilter } : options;
  if (childIssuesFilter) {
    console.info(`[retroService] Gate compliance scoped to "everything else" using filter: ${childIssuesFilter}`);
  } else {
    console.warn(`[retroService] No child-issues filter found for ${options.release}; using full-release scope`);
  }

  const jqls = buildRetroJqls(dates, effectiveOptions);
  const hasPastCcm = isPastOrToday(dates.ccmDate);
  const hasPastCg = isPastOrToday(dates.cgDate);
  const hasPastPg = isPastOrToday(dates.pgDate);
  const hasPastGa = isPastOrToday(dates.gaDate);

  const [
    ccmOpen,
    ccmTotal,
    cgOpen,
    cgFoundAfter,
    pgTestsOpen,
    pgBugsOpen,
    gaOpen,
    companionPgOpen,
    companionGaOpen,
    pgToGaClosed,
    pgToGaDeferred,
  ] = await Promise.all([
    hasPastCcm ? jira.searchCount(jqls.ccmOpen) : Promise.resolve(0),
    hasPastCcm ? jira.searchCount(jqls.ccmTotal) : Promise.resolve(0),
    hasPastCg ? jira.searchCount(jqls.cgOpenAtGate) : Promise.resolve(0),
    hasPastCg ? jira.searchCount(jqls.cgFoundAfter) : Promise.resolve(0),
    hasPastPg ? jira.searchCount(jqls.pgTestsOpen) : Promise.resolve(0),
    hasPastPg ? jira.searchCount(jqls.pgBugsOpen) : Promise.resolve(0),
    jqls.gaOpen ? jira.searchCount(jqls.gaOpen) : Promise.resolve(0),
    hasPastPg && jqls.companionPgOpen ? jira.searchCount(jqls.companionPgOpen) : Promise.resolve(0),
    jqls.companionGaOpen ? jira.searchCount(jqls.companionGaOpen) : Promise.resolve(0),
    hasPastPg && hasPastGa ? jira.searchCount(jqls.pgToGaClosed) : Promise.resolve(0),
    hasPastPg ? jira.searchCount(jqls.pgToGaDeferred) : Promise.resolve(0),
  ]);

  const ccmClosedPct = ccmTotal > 0 ? Math.round(((ccmTotal - ccmOpen) / ccmTotal) * 100) : 100;

  const companionRows = await Promise.all(
    options.companionDisciplines.map(async (d) => {
      const jqlPg = hasPastPg
        ? `project = ${d.projectKey} AND fixVersion = "${quoteJql(
            options.release
          )}" AND status was not in (Resolved, Closed, Done) ON "${dates.pgDate}"`
        : '';
      const jqlGa = hasPastGa
        ? `project = ${d.projectKey} AND fixVersion = "${quoteJql(
            options.release
          )}" AND status was not in (Resolved, Closed, Done) ON "${dates.gaDate}"`
        : '';
      const [openAtPg, openAtGa] = await Promise.all([
        jqlPg ? jira.searchCount(jqlPg) : Promise.resolve(0),
        jqlGa ? jira.searchCount(jqlGa) : Promise.resolve(0),
      ]);

      let statusLabel = 'Not reached';
      if (hasPastGa) {
        statusLabel = openAtGa === 0 ? 'Done at GA' : 'Open at GA';
      } else if (hasPastPg) {
        statusLabel = openAtPg === 0 ? 'Done at PG (ahead)' : 'In closing window';
      }
      return {
        ...d,
        openAtPg,
        openAtGa,
        statusLabel,
        links: { openAtPg: jqlPg, openAtGa: jqlGa },
      };
    })
  );

  return {
    dates,
    checks: {
      ccm: {
        skipped: !hasPastCcm,
        total: ccmTotal,
        openAtGate: ccmOpen,
        closedPct: ccmClosedPct,
        rag: ccmRag(ccmClosedPct),
        links: { openAtGate: jqls.ccmOpen, total: jqls.ccmTotal },
      },
      cg: {
        skipped: !hasPastCg,
        p0p1OpenAtGate: cgOpen,
        p0p1FoundAfter: cgFoundAfter,
        ragOpen: thresholdRag(cgOpen, 3, 4),
        ragAfter: thresholdRag(cgFoundAfter, 5, 6),
        links: { p0p1OpenAtGate: jqls.cgOpenAtGate, p0p1FoundAfter: jqls.cgFoundAfter },
      },
      pg: {
        skipped: !hasPastPg,
        testsOpenAtGate: pgTestsOpen,
        bugsOpenAtGate: pgBugsOpen,
        ragTests: thresholdRag(pgTestsOpen, 5, 6),
        ragBugs: thresholdRag(pgBugsOpen, 3, 4),
        links: { testsOpenAtGate: jqls.pgTestsOpen, bugsOpenAtGate: jqls.pgBugsOpen },
      },
      ga: {
        skipped: !hasPastGa,
        openAtGate: gaOpen,
        rag: thresholdRag(gaOpen, 2, 3),
        links: { openAtGate: jqls.gaOpen },
      },
    },
    companionReadiness: {
      totalAtPg: companionPgOpen,
      totalAtGa: companionGaOpen,
      rows: companionRows,
      links: { totalAtPg: jqls.companionPgOpen, totalAtGa: jqls.companionGaOpen },
    },
    pgToGa: {
      closedInWindow: pgToGaClosed,
      deferredInWindow: pgToGaDeferred,
      links: { closedInWindow: jqls.pgToGaClosed, deferredInWindow: jqls.pgToGaDeferred },
    },
  };
}

const NAUGHTY_WEIGHTS = {
  cgOpenAtGate: 10,
  cgFoundAfter: 8,
  pgBugs: 6,
  deferredCount: 5,
  pgTests: 4,
  ccmSlip: 2,
} as const;

function naughtyRag(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 40) return 'red';
  if (score >= 15) return 'yellow';
  return 'green';
}

async function mapInBatches<T, R>(
  arr: T[],
  concurrency: number,
  fn: (x: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < arr.length; i += concurrency) {
    const batch = arr.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(fn));
    out.push(...results);
  }
  return out;
}

export async function runNaughtyList(
  gateTimeline: ReleaseGateTimeline,
  options: RetrospectiveOptions,
  parentProjects: RetrospectiveParentProject[],
  jira: JiraConnector
) {
  const dates: ResolvedGateDates = {
    ccmDate: resolveGateDate(gateTimeline.gates, 'CCM'),
    cgDate: resolveGateDate(gateTimeline.gates, 'CG'),
    pgDate: resolveGateDate(gateTimeline.gates, 'PG'),
    gaDate: resolveGateDate(gateTimeline.gates, 'GA'),
  };

  const topN = Math.max(1, options.topN ?? 10);
  const hasPastCcm = isPastOrToday(dates.ccmDate);
  const hasPastCg = isPastOrToday(dates.cgDate);
  const hasPastPg = isPastOrToday(dates.pgDate);

  // Pre-rank using a cheap "open at any passed gate" count.
  const preRanked = await mapInBatches(parentProjects, 5, async (p) => {
    const gateClauses: string[] = [];
    if (hasPastCcm) {
      gateClauses.push(
        `status was not in (Resolved, Closed, Done) ON "${dates.ccmDate}" AND issueType in (Task, "Unit Test")`
      );
    }
    if (hasPastCg) {
      gateClauses.push(
        `status was not in (Resolved, Closed, Done) ON "${dates.cgDate}" AND issueType = Bug AND priority in ("Blocker - P0", "Critical - P1")`
      );
    }
    if (hasPastPg) {
      gateClauses.push(
        `status was not in (Resolved, Closed, Done) ON "${dates.pgDate}" AND issueType in (Bug, Test)`
      );
    }
    if (gateClauses.length === 0) return { project: p, preCount: 0 };
    const scope = buildParentScopeClause(p.key, options.projectKeys);
    const jql = `${scope} AND (${gateClauses.map((g) => `(${g})`).join(' OR ')})`;
    const preCount = await jira.searchCount(jql);
    return { project: p, preCount };
  });

  const selected = preRanked
    .sort((a, b) => b.preCount - a.preCount)
    .slice(0, topN)
    .map((x) => x.project);

  const rows = await mapInBatches(selected, 5, async (p) => {
    const jqls = buildRetroJqls(dates, options, p.key);
    const normalized = normalizeRelease(options.release, options.releasePrefix);
    const deferredLabel = `${options.labelPrefix}-${normalized}-deferred`;
    const pScope = buildParentScopeClause(p.key, options.projectKeys);
    const deferredJql = `${pScope} AND labels = "${quoteJql(deferredLabel)}"`;


    const [ccmSlip, cgOpenAtGate, cgFoundAfter, pgTests, pgBugs, deferredCount] =
      await Promise.all([
        hasPastCcm ? jira.searchCount(jqls.ccmOpen) : Promise.resolve(0),
        hasPastCg ? jira.searchCount(jqls.cgOpenAtGate) : Promise.resolve(0),
        hasPastCg ? jira.searchCount(jqls.cgFoundAfter) : Promise.resolve(0),
        hasPastPg ? jira.searchCount(jqls.pgTestsOpen) : Promise.resolve(0),
        hasPastPg ? jira.searchCount(jqls.pgBugsOpen) : Promise.resolve(0),
        jira.searchCount(deferredJql),
      ]);

    const score =
      ccmSlip * NAUGHTY_WEIGHTS.ccmSlip +
      cgOpenAtGate * NAUGHTY_WEIGHTS.cgOpenAtGate +
      cgFoundAfter * NAUGHTY_WEIGHTS.cgFoundAfter +
      pgTests * NAUGHTY_WEIGHTS.pgTests +
      pgBugs * NAUGHTY_WEIGHTS.pgBugs +
      deferredCount * NAUGHTY_WEIGHTS.deferredCount;

    return {
      parentKey: p.key,
      parentType: p.parentType,
      parentSummary: p.summary,
      ccmSlip,
      cgOpenAtGate,
      cgFoundAfter,
      pgTests,
      pgBugs,
      deferredCount,
      score,
      rag: naughtyRag(score),
      links: {
        ccmSlip: jqls.ccmOpen,
        cgOpenAtGate: jqls.cgOpenAtGate,
        cgFoundAfter: jqls.cgFoundAfter,
        pgTests: jqls.pgTestsOpen,
        pgBugs: jqls.pgBugsOpen,
        deferredCount: deferredJql,
      },
    };
  });

  rows.sort((a, b) => b.score - a.score);

  return {
    weights: NAUGHTY_WEIGHTS,
    rows,
  };
}
