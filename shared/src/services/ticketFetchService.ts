/**
 * ticketFetchService — the 8-clause portfolio-children JQL primitive.
 *
 * Ports `~/.cursor/skills/fetch-project-tickets/SKILL.md` (CONSOLIDATION.md
 * #17) into a callable TS service. This is the JQL primitive that
 * expands a FEAT/X-FEAT/Capability key into the full transitive set of
 * tickets descending from it — Features, Initiatives, Epics, sub-tickets,
 * and sub-tasks of sub-tickets — across any JIRA project (the parent
 * project doesn't have to match).
 *
 * The 8-clause union (per the legacy skill):
 *
 *   1. key = X                                             — the FEAT itself
 *   2. "Parent Link" = X                                   — direct children
 *   3. "FEAT ID" ~ X                                       — text-field match (CONTAINS, never EQUALS — JIRA rejects =)
 *   4. "FEAT Number" = X                                   — alternative numbering field
 *   5. issueFunction in portfolioChildrenOf("key=X")       — portfolio-level descendants
 *   6. issueFunction in issuesInEpics(<portfolioChildrenOf>) — work tickets under those descendants' epics
 *   7. issueFunction in subtasksOf("key=X")                — sub-tasks of X itself
 *   8. issueFunction in subtasksOf(<issuesInEpics<...>>)   — sub-tasks of the work tickets (deepest)
 *
 * Two views the skill documents:
 *
 *   - Comprehensive (`buildAllTicketsJql`):   includes Features/Initiatives/Epics
 *     (planning containers). Use for executive views, breakdowns, and
 *     anywhere the user wants to see the full hierarchy.
 *   - Work-items-only (`buildWorkItemsJql`):  excludes (Feature, Initiative,
 *     Epic, X-FEAT, Capability). Use for developer/team views where users
 *     want actionable items only.
 *
 * Bulk optimisation (per the skill's perf section): a single multi-FEAT
 * call replaces N looped calls with N single FEATs, yielding ~93%
 * fewer JIRA function evaluations. This service exposes both forms
 * through one entry point — the form switch is internal.
 *
 * D1: `projectKey` is REQUIRED. The legacy code defaulted to `'ERA'`
 * which is Nutanix-NDB-specific; here it must come from caller (and
 * therefore from productService at the call site).
 */

import type { JiraConnector, JiraIssue } from '../connectors/jiraConnector.js';

// ── Validation ──────────────────────────────────────────────────────────────

/**
 * Nutanix-style project key: uppercase prefix + dash + digits.
 * Examples: `FEAT-1001`, `ERA-12345`, `XFEAT-77`.
 */
const PROJECT_KEY_RE = /^[A-Z]+-\d+$/;

export function isValidProjectKey(key: string): boolean {
  return typeof key === 'string' && PROJECT_KEY_RE.test(key);
}

function validateKeys(keys: string[]): void {
  if (!Array.isArray(keys) || keys.length === 0) {
    throw new Error('ticketFetchService: keys must be a non-empty array');
  }
  const invalid = keys.filter((k) => !isValidProjectKey(k));
  if (invalid.length > 0) {
    throw new Error(
      `ticketFetchService: invalid project key format: ${invalid.join(', ')}`
    );
  }
}

// ── JQL builders ────────────────────────────────────────────────────────────

/**
 * Issue types excluded from the work-items-only view. These are the
 * portfolio containers — they aren't actionable work, they're plans.
 */
export const WORK_ITEMS_EXCLUDED_TYPES =
  '(Feature, Initiative, X-FEAT, Capability, Epic)';

function singleKeyUnion(key: string, includeLinkedIssues: boolean): string {
  const clauses = [
    `key = ${key}`,
    `("Parent Link" = ${key})`,
    `("FEAT ID" ~ ${key})`,
    `("FEAT Number" = ${key})`,
    `(issueFunction in portfolioChildrenOf("key=${key}"))`,
    `(issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key=${key}')"))`,
    `(issueFunction in subtasksOf("key=${key}"))`,
    `issueFunction in subtasksOf("issueFunction in issuesInEpics(\\"issueFunction in portfolioChildrenOf('key=${key}') \\")")`,
  ];
  if (includeLinkedIssues) {
    clauses.push(`issueFunction in linkedIssuesOf("key=${key}")`);
  }
  return clauses.join(' OR ');
}

function bulkKeyUnion(keys: string[], includeLinkedIssues: boolean): string {
  const list = keys.join(', ');
  // "FEAT ID" only supports the ~ (contains) operator — = and IN are both rejected by JIRA.
  const featIdClauses = keys.map((k) => `"FEAT ID" ~ ${k}`).join(' OR ');
  const clauses = [
    `key IN (${list})`,
    `("Parent Link" IN (${list}))`,
    `(${featIdClauses})`,
    `("FEAT Number" IN (${list}))`,
    `(issueFunction in portfolioChildrenOf("key IN (${list})"))`,
    `(issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key IN (${list})')"))`,
    `(issueFunction in subtasksOf("key IN (${list})"))`,
    `issueFunction in subtasksOf("issueFunction in issuesInEpics(\\"issueFunction in portfolioChildrenOf('key IN (${list})') \\")")`,
  ];
  if (includeLinkedIssues) {
    // The legacy server builder emits a per-key OR-joined linkedIssuesOf
    // when bulk, since JIRA's linkedIssuesOf doesn't accept a `key IN (...)`
    // sub-expression in production. Match that shape.
    const perKey = keys
      .map((k) => `issueFunction in linkedIssuesOf("key=${k}")`)
      .join(' OR ');
    clauses.push(`(${perKey})`);
  }
  return clauses.join(' OR ');
}

export interface TicketJqlOptions {
  /**
   * JIRA project key the FEAT lives in (e.g. 'ERA' for NDB). Optional
   * by design: the FEAT keys themselves carry their project scope, so
   * production callers (existing /api/jira/issue-breakdown route) don't
   * prepend `project = X`. When provided, the JQL is wrapped as
   * `project = X AND (UNION)` to take advantage of JIRA's project-index
   * optimisation. Per D1, no default — caller must opt in via
   * `productService.getJiraProjectKey()` if they want the scope clause.
   */
  projectKey?: string;
  /** When true, append `AND status not in (Done, Closed, Cancelled)`. */
  openOnly?: boolean;
  /**
   * When true, add a 9th clause `issueFunction in linkedIssuesOf("key=X")`
   * (or per-key OR-join in bulk mode). Matches the legacy server-side
   * `buildOptimizedProjectTicketsJQL` behaviour used by the dashboards.
   * Default: false (the skill-spec form is the 8-clause union).
   */
  includeLinkedIssues?: boolean;
}

/**
 * Comprehensive view — includes Feature/Initiative/Epic containers.
 * Use for executive breakdowns and total counts.
 */
export function buildAllTicketsJql(
  keys: string[],
  options: TicketJqlOptions = {}
): string {
  validateKeys(keys);
  const includeLinkedIssues = options.includeLinkedIssues ?? false;
  const union =
    keys.length === 1
      ? singleKeyUnion(keys[0]!, includeLinkedIssues)
      : bulkKeyUnion(keys, includeLinkedIssues);
  let jql = options.projectKey
    ? `project = ${options.projectKey} AND (${union})`
    : `(${union})`;
  if (options.openOnly) {
    jql += ' AND status not in (Done, Closed, Cancelled)';
  }
  return jql;
}

/**
 * Work-items-only view — excludes portfolio containers. Use when the
 * user wants actionable items (Tasks, Bugs, Stories) they can work on.
 */
export function buildWorkItemsJql(
  keys: string[],
  options: TicketJqlOptions = {}
): string {
  const baseJql = buildAllTicketsJql(keys, { ...options, openOnly: false });
  let jql = `${baseJql} AND issuetype not in ${WORK_ITEMS_EXCLUDED_TYPES}`;
  if (options.openOnly) {
    jql += ' AND status not in (Done, Closed, Cancelled)';
  }
  return jql;
}

// ── JIRA hyperlink URL builders (for "X of Y done" clickable counts) ───────

export interface TicketUrlOptions {
  /** JIRA base URL, e.g. `'https://jira.nutanix.com'`. Trailing slashes stripped. */
  jiraBaseUrl: string;
  /** Project key for the FEAT (optional — see TicketJqlOptions.projectKey). */
  projectKey?: string;
  /**
   * Open-only by default (we want users to land on outstanding work).
   * Caller can override to include Done/Closed when needed.
   */
  openOnly?: boolean;
  /** Pass through to JQL builder. */
  includeLinkedIssues?: boolean;
}

/**
 * Build the "all tickets" search URL for a single FEAT. Defaults to
 * open-only because the typical caller is rendering a clickable
 * "X out of Y done" hyperlink.
 */
export function buildAllTicketsUrl(
  key: string,
  options: TicketUrlOptions
): string {
  if (!options.jiraBaseUrl) {
    throw new Error('buildAllTicketsUrl: options.jiraBaseUrl is required');
  }
  const jql = buildAllTicketsJql([key], {
    projectKey: options.projectKey,
    openOnly: options.openOnly ?? true,
    includeLinkedIssues: options.includeLinkedIssues,
  });
  return `${options.jiraBaseUrl.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

/**
 * Build the "work items only" search URL for a single FEAT. Same
 * defaults as `buildAllTicketsUrl` but excludes portfolio containers.
 */
export function buildWorkItemsUrl(
  key: string,
  options: TicketUrlOptions
): string {
  if (!options.jiraBaseUrl) {
    throw new Error('buildWorkItemsUrl: options.jiraBaseUrl is required');
  }
  const jql = buildWorkItemsJql([key], {
    projectKey: options.projectKey,
    openOnly: options.openOnly ?? true,
    includeLinkedIssues: options.includeLinkedIssues,
  });
  return `${options.jiraBaseUrl.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

// ── Fetch + breakdown ──────────────────────────────────────────────────────

export interface TicketBreakdown {
  total: number;
  done: number;
  remaining: number;
  byType: Record<string, { total: number; done: number; remaining: number }>;
  byStatus: Record<string, number>;
}

const DONE_STATUS_CATEGORIES = new Set(['done', 'closed', 'resolved']);

function summarizeIssues(issues: JiraIssue[]): TicketBreakdown {
  const breakdown: TicketBreakdown = {
    total: issues.length,
    done: 0,
    remaining: 0,
    byType: {},
    byStatus: {},
  };
  for (const issue of issues) {
    const fields = (issue.fields ?? {}) as Record<string, unknown>;
    const typeName =
      ((fields.issuetype as { name?: string } | undefined)?.name ?? 'Unknown');
    const statusObj = fields.status as { name?: string; statusCategory?: { key?: string } } | undefined;
    const statusName = statusObj?.name ?? 'Unknown';
    const isDone = DONE_STATUS_CATEGORIES.has(
      (statusObj?.statusCategory?.key ?? '').toLowerCase()
    );

    breakdown.byType[typeName] ??= { total: 0, done: 0, remaining: 0 };
    breakdown.byType[typeName]!.total += 1;
    if (isDone) {
      breakdown.byType[typeName]!.done += 1;
      breakdown.done += 1;
    } else {
      breakdown.byType[typeName]!.remaining += 1;
      breakdown.remaining += 1;
    }
    breakdown.byStatus[statusName] = (breakdown.byStatus[statusName] ?? 0) + 1;
  }
  return breakdown;
}

export interface FetchBreakdownOptions extends TicketJqlOptions {
  /** Default: `'all'` (includes containers). Set `'work-items'` for actionable-only. */
  view?: 'all' | 'work-items';
  /**
   * Default open-only when `true` (the typical caller is computing
   * outstanding work). Set `false` to count all matching tickets.
   */
  openOnly?: boolean;
  /** Default 1000 issues per page (matches jiraConnector default). */
  pageSize?: number;
}

const DEFAULT_FIELDS = ['issuetype', 'status', 'summary', 'assignee'];

export class TicketFetchService {
  constructor(private readonly jira: JiraConnector) {}

  /**
   * Fetch the breakdown for ONE FEAT key. Backwards-compatible with the
   * legacy `fetchSingleBreakdown(jiraKey)` shape used by TaskBreakdownCell.
   */
  async fetchBreakdown(
    key: string,
    options: FetchBreakdownOptions
  ): Promise<TicketBreakdown> {
    const out = await this.fetchBulkBreakdown([key], options);
    return out[key]!;
  }

  /**
   * Fetch breakdowns for MANY FEAT keys in a single JIRA call (the
   * bulk optimisation; ~93% fewer JIRA function evaluations than
   * looping). Returns a map keyed by FEAT key.
   *
   * Tickets that match more than one FEAT (rare but possible) are
   * counted under each FEAT they relate to — we can't perfectly
   * partition without a per-FEAT lookup, and overcounting is usually
   * preferable to losing the relationship.
   */
  async fetchBulkBreakdown(
    keys: string[],
    options: FetchBreakdownOptions
  ): Promise<Record<string, TicketBreakdown>> {
    const view = options.view ?? 'all';
    const openOnly = options.openOnly ?? true;
    const jql =
      view === 'work-items'
        ? buildWorkItemsJql(keys, { projectKey: options.projectKey, openOnly })
        : buildAllTicketsJql(keys, { projectKey: options.projectKey, openOnly });

    const fields = [
      ...DEFAULT_FIELDS,
      'customfield_11067', // CC date (so callers can roll up gate progress without a 2nd fetch)
      'customfield_35863', // CG
      'customfield_35864', // PG
      'parent',
      'customfield_20363', // Parent Link (Nutanix JPO — links Epics → FEAT/Initiative)
      'customfield_10361', // Epic Link (Nutanix field ID, confirmed from jira_custom_fields.csv)
    ];

    const issues = await this.jira.searchAll(jql, fields.join(','), {
      pageSize: options.pageSize ?? 1000,
    });

    // Group issues by which FEAT key they relate to. We check each
    // ticket against each requested key via the same predicates the
    // JQL union used.
    const out: Record<string, TicketBreakdown> = {};
    for (const key of keys) out[key] = summarizeIssues([]);

    // Partition heuristic: a ticket matches a FEAT key if any of the
    // following point at that key:
    //   - issue.key === featKey
    //   - "Parent Link" === featKey
    //   - "FEAT ID" contains featKey
    //   - "FEAT Number" === featKey
    //   - "Epic Link" → epic whose Parent Link === featKey (we don't
    //     have the epic chain here; rely on inclusion in JQL match)
    //
    // For tickets we can't attribute, we put them under all requested
    // keys (over-count rather than lose) — matches the legacy
    // `groupBreakdownByProject` behaviour when relationship metadata
    // is incomplete.
    const unattributable: JiraIssue[] = [];
    for (const issue of issues) {
      const fields = (issue.fields ?? {}) as Record<string, unknown>;
      const parentLink =
        (fields['customfield_20363'] as string | undefined) ??
        (fields['Parent Link'] as string | undefined) ??
        null;
      const featId =
        (fields['FEAT ID'] as string | undefined) ??
        (fields['customfield_35862'] as string | undefined) ??
        '';
      const featNumber =
        (fields['FEAT Number'] as string | undefined) ??
        '';

      let attributed = false;
      for (const key of keys) {
        if (
          issue.key === key ||
          parentLink === key ||
          (featId && String(featId).includes(key)) ||
          featNumber === key
        ) {
          (out[key] as TicketBreakdown).total += 1;
          attributed = true;
        }
      }
      if (!attributed) unattributable.push(issue);
    }

    // Recompute per-key breakdowns from the attributed sets, then add
    // the unattributable items to each key (over-count, matches legacy).
    for (const key of keys) {
      const attributed = issues.filter((i) => {
        const f = (i.fields ?? {}) as Record<string, unknown>;
        const parentLink =
          (f['customfield_20363'] as string | undefined) ??
          (f['Parent Link'] as string | undefined) ??
          null;
        const featId = (f['FEAT ID'] as string | undefined) ?? '';
        const featNumber = (f['FEAT Number'] as string | undefined) ?? '';
        return (
          i.key === key ||
          parentLink === key ||
          (featId && String(featId).includes(key)) ||
          featNumber === key
        );
      });
      out[key] = summarizeIssues([...attributed, ...unattributable]);
    }

    return out;
  }
}
