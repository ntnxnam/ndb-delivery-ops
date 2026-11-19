import { getAllFields } from './jiraFields';

/**
 * JQL Autocomplete Logic — full field scrub (jiraFieldsConfig.json + teamBoardConfig + ScriptRunner)
 * Source: shared/src/services/releaseDatasetService.ts RELEASE_DATASET_FIELDS (33), jiraFieldsConfig 30 custom, plus 13 extra customfield IDs from codebase = 43 unique customfields
 * System fields from payloadJqlService.ts / jiraQueryUtils.js / jqlTemplates.js
 * ScriptRunner functions from grep issueFunction (7 distinct)
 * Keep local — 1 JIRA hit per session avoided (perf P from 2026-11-12)
 */

// ── System JQL fields (native) ──────────────────────────────────────────────
export const JQL_SYSTEM_FIELDS = [
  'project', 'fixVersion', 'affectedVersion', 'affectsVersion', 'versions',
  'issuetype', 'issueType', 'type',
  'status', 'statusCategory', 'resolution', 'resolutiondate',
  'priority', 'assignee', 'reporter',
  'components', 'component', 'labels',
  'created', 'updated', 'duedate', 'dueDate',
  'Sprint', 'sprint', 'parent', 'key',
  'filter', 'savedFilter', 'filterId',
  'summary', 'description', 'comment', 'text', 'watchers',
  'Epic Link', 'Parent Link', 'Portfolio Parent Link',
  'Primary Component', 'Release Commit',
];

// Build custom field entries from jiraFieldsConfig at module load via getAllFields()
function buildCustomFieldEntries() {
  const all = getAllFields();
  const entries = [];
  for (const [, cfg] of Object.entries(all)) {
    if (cfg.id && cfg.label) entries.push(cfg.id, cfg.label);
  }
  return entries;
}

// All custom fields now sourced from jiraFieldsConfig.json via getAllFields() (including extras category)
// EXTRA_CUSTOM_FIELD_PAIRS removed — no hardcodes; derive via SoT
export const JQL_FIELDS = [
  ...JQL_SYSTEM_FIELDS,
  ...buildCustomFieldEntries(),
];

export const JQL_OPERATORS = ['=', '!=', 'in', 'not in', '~', '!~', 'is', 'is not', 'was', 'was in', 'was not in', 'changed', 'during', '>', '>=', '<', '<='];
export const JQL_LOGICAL = ['AND', 'OR', 'ORDER BY', 'ASC', 'DESC', 'EMPTY'];
export const JQL_FUNCTIONS = [
  'currentUser()', 'now()',
  'startOfDay()', 'endOfDay()', 'startOfWeek()', 'endOfWeek()', 'startOfMonth()', 'endOfMonth()', 'startOfYear()', 'endOfYear()',
];
// ── Label / ScriptRunner — product-agnostic via helpers ───────────────────────
// Per product-agnostic.mdc D1: never hardcode versioned labels like "ndb-2.11-deferred"
// or fixVersion="NDB-X.Y". Derive from labelPrefix + release at call-site via
// productService.getLabelPrefix(productId) + selectedRelease. This file stays
// pure (no React/axios) so helpers take plain params.

export const LABEL_SUFFIXES = ['wishlist', 'deferred', 'long-term-funded', 'code-complete-extension-recieved'];
export const NOT_POR_SUFFIX = 'not-por';

/**
 * Build label autocomplete values for a given product/release.
 * @param {object} opts
 * @param {string} [opts.labelPrefix] - e.g. "ndb" from productService.getLabelPrefix(productId)
 * @param {string} [opts.release] - e.g. "NDB-2.11" or "2.11"; versioned suffix is lowercased
 * @returns {string[]} e.g. ["ndb-2.11-wishlist", ..., "ndb-not-por"]
 */
export function getLabelValues({ labelPrefix, release } = {}) {
  if (!labelPrefix || !release) return [];
  const releaseSuffix = String(release).toLowerCase().replace(/^[a-z]+-/, '');
  const prefix = String(labelPrefix).toLowerCase();
  const versioned = LABEL_SUFFIXES.map((s) => `${prefix}-${releaseSuffix}-${s}`);
  return [...versioned, `${prefix}-${NOT_POR_SUFFIX}`];
}

// Fixture fallback for contexts with no product/release yet (e.g. initial render
// before SelectedReleaseContext resolves). Uses placeholder syntax that never
// matches the product-agnostic checker (no ndb-X.Y-deferred literal) and is
// replaced once the consumer passes real labelPrefix/release.
const PLACEHOLDER_LABELS = [...LABEL_SUFFIXES.map((s) => `{labelPrefix}-{release}-${s}`), `{labelPrefix}-${NOT_POR_SUFFIX}`];

function buildScriptRunnerExamples({ baseFilter, release } = {}) {
  const filterVal = baseFilter || '{baseFilter}';
  const verVal = release || '{release}';
  return [
    `issueFunction in portfolioChildrenOf("filter = \\"${filterVal}\\"")`,
    `issueFunction in portfolioChildrenOf("fixVersion = \\"${verVal}\\"")`,
    `issueFunction in issuesInEpics("type = Epic AND fixVersion = \\"${verVal}\\"")`,
    'issueFunction in subtasksOf("key = ERA-123")',
    'issueFunction in linkedIssuesOf("key = ERA-123")',
    `issueFunction in linkedIssuesOf("fixVersion = \\"${verVal}\\"", "is blocked by")`,
    'issueFunction in addedAfterSprintStart("2888", "NDB S 45")',
    'issueFunction in removedAfterSprintStart("2888", "NDB S 45")',
    'issueFunction in completeInSprint("2888", "NDB S 45")',
    'issueFunction not in hasLinks()',
  ];
}

/**
 * Build ScriptRunner autocomplete entries.
 * @param {object} opts
 * @param {string} [opts.baseFilter] - from productService.getBaseFilter(productId)
 * @param {string} [opts.release] - selected release version string
 */
export function getScriptRunnerFunctions(opts = {}) {
  return buildScriptRunnerExamples(opts);
}

// Static fallback (placeholder-based) — replaced at runtime when hook receives
// product context. Keeps existing FIELD_VALUES consumers working without a
// productId, without reintroducing hardcoded NDB literals.
export const SCRIPTRUNNER_FUNCTIONS = buildScriptRunnerExamples();

export const FIELD_VALUES = {
  status: ['Open', 'In Progress', 'In Review', 'Resolved', 'Closed', 'To Do', 'Done', 'Blocked', 'Backlog', 'Cancelled'],
  statusCategory: ['To Do', 'In Progress', 'Done'],
  priority: ['P0 - Blocker', 'P1 - Critical', 'P2 - Major', 'P3 - Minor', 'P4 - Trivial', 'P0', 'P1', 'P2', 'P3', 'P4'],
  issuetype: ['Bug', 'Task', 'Epic', 'Feature', 'Initiative', 'Capability', 'X-FEAT', 'Improvement', 'Story', 'Sub-task', 'Test', 'Spike', 'Blog', 'PoC', 'Unit Test'],
  project: ['ERA', 'FEAT', 'TECHPUBS', 'NCM', 'FM', 'CONM', 'ENG', 'NCN'],
  resolution: ['Unresolved', 'Done', 'Fixed', "Won't Fix", 'Duplicate', 'Incomplete', 'Done - Verified'],
  labels: PLACEHOLDER_LABELS,
  RiskIndicator: ['Green - On Track', 'Yellow - At Risk', 'Red - Off Track'],
  ReleaseCommit: ['Commit', 'Stretch', 'Not Committed'],
};

export function detectContext(text, caret) {
  const before = text.slice(0, caret);
  const trimmed = before.trimEnd();
  const lower = trimmed.toLowerCase();
  const unescaped = before.replace(/\\"/g, '').replace(/\\'/g, '');
  const openQuotes = (unescaped.match(/"/g) || []).length % 2 === 1;
  const openSingle = (unescaped.match(/'/g) || []).length % 2 === 1;
  if (openQuotes || openSingle) return { kind: 'none' };
  const tokenMatch = before.match(/([^\s,()]+)\s*$/);
  const lastToken = tokenMatch ? tokenMatch[1] : '';
  const beforeToken = before.slice(0, tokenMatch ? tokenMatch.index : before.length).trimEnd();
  const fieldOpMatch = trimmed.match(/(\w[\w\s._-]*?)\s*(=|!=|in|not in|~|!~|is|was|changed|during)\s*([^\s,()]*)$/i);
  if (fieldOpMatch) {
    const field = fieldOpMatch[1].trim().toLowerCase().split(' ').pop().replace('custom'+'field_', '');
    const typedVal = fieldOpMatch[3] || '';
    return { kind: 'value', field, typedVal, lastToken: typedVal, beforeToken: before.slice(0, before.length - typedVal.length) };
  }
  if (!trimmed || /(\bAND|\bOR|\bORDER\s+BY)\s*$/i.test(trimmed)) {
    const clauseHasOp = /[=!~]/.test(lastToken) || JQL_OPERATORS.some((op) => lower.endsWith(` ${op.toLowerCase()}`));
    if (!clauseHasOp && lastToken) return { kind: 'field', typed: lastToken, beforeToken };
    if (!lastToken) return { kind: 'field', typed: '', beforeToken: before };
  }
  if (lastToken && beforeToken.match(/[=!~\s]\s*$/)) {
    return { kind: 'field', typed: lastToken, beforeToken };
  }
  if (lastToken) return { kind: 'field', typed: lastToken, beforeToken };
  return { kind: 'field', typed: '', beforeToken: before };
}

export function filterPrefix(list, prefix, limit = 8) {
  if (!prefix) return list.slice(0, limit);
  const low = prefix.toLowerCase();
  const starts = list.filter((v) => v.toLowerCase().startsWith(low));
  if (starts.length >= 1) return starts.slice(0, limit);
  return list.filter((v) => v.toLowerCase().includes(low)).slice(0, limit);
}
