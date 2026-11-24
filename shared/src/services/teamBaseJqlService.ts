/**
 * teamBaseJqlService — auto-generates standardized base JQL for teams (D1, D3, D44).
 *
 * Replaces manual saved-filter `filter=NDB-All-Base-Filter` dependency with
 * component + DL/Handle driven construction:
 *   - ENG is shared engineering project
 *   - FEAT/SDL/TECHPUBS/SR/LEG/NDBECO are horizontal compliance shared projects
 *   - ERA/NDBECO/NCN are private custom projects (comma-separated)
 *
 * JQL is built to match existing codebase convention:
 *   project in (...) AND (component in (...) OR "primary component" in (...) OR assignee in (...) OR issuetype in (...))
 *   private: (project in (ERA, NDBECO) OR (project in (ENG,FEAT...) AND (...)))
 *
 * @module shared/src/services/teamBaseJqlService
 */

// Horizontal shared compliance projects — derived from teamBoardConfig companionDisciplines
// plus FEAT (global Feature intake) and ENG (shared eng basin).
// TECHPUBS key is "TECHPUBS" (not "TECH PUBS"); NDBQUAL is legacy alias for NDBECO.
export const SHARED_ENG_PROJECT = 'ENG';
export const HORIZONTAL_PROJECTS = ['FEAT', 'SDL', 'TECHPUBS', 'SR', 'LEG', 'NDBECO'] as const;
export const SHARED_PROJECTS_ALL = [SHARED_ENG_PROJECT, ...HORIZONTAL_PROJECTS] as const;

// Known companion projects that may appear in old JQLs (ONCALL/TH/ACP/LBDR) — kept for parity
// but not auto-included unless explicitly requested. Default shared set is the 7 above.
export const LEGACY_SHARED_PROJECTS = ['ONCALL', 'TH', 'ACP', 'LBDR'] as const;

export interface BuildBaseJqlParams {
  teamName: string;
  isSharedProject: boolean;
  customProjectKey: string | null; // comma-separated e.g. "ERA,NDBECO" or null
  components: string[]; // required, at least 1
  // Aggregated assignee DLs/Handles across 8 contact rows — caller merges them
  assigneeDLs: string[]; // DL names → membersOf("...")
  assigneeHandles: string[]; // Jira handles → direct
  // Optional: include legacy projects in shared set (default false to keep JQL minimal)
  includeLegacy?: boolean;
  // Optional: include oncall issuetype clause (default true to match legacy JQL)
  includeOncallType?: boolean;
}

function esc(v: string): string {
  return String(v).replace(/"/g, '\\"');
}

function quoteIfNeeded(v: string): string {
  const s = String(v).trim();
  if (!s) return '""';
  // JQL needs quotes for values with spaces or special chars; project keys never quoted, components often do
  if (/[\s",()]/.test(s)) return `"${esc(s)}"`;
  return esc(s);
}

function quoteComponent(v: string): string {
  // Always quote components to match existing JQL style: component in (Era, ERA, NDB, "NDB Databases")
  // Era/NDB without spaces were unquoted historically, but quoting is valid and safer. Keep minimal quoting for parity.
  if (/\s/.test(v) || v.includes('"')) return `"${esc(v)}"`;
  return v;
}

function dedupeAndTrim(arr: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of arr) {
    const s = String(raw).trim();
    if (!s) continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function parseCustomKeys(raw: string | null): string[] {
  if (!raw) return [];
  return dedupeAndTrim(String(raw).split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean));
}

/**
 * Build the inner OR clause: component OR "primary component" OR assignee OR issuetype
 */
function buildInnerOr(params: BuildBaseJqlParams): string {
  const comps = dedupeAndTrim(params.components);
  if (comps.length === 0) throw new Error('buildTeamBaseJql: components is required (at least 1)');

  const parts: string[] = [];

  // component in (...)
  parts.push(`component in (${comps.map(quoteComponent).join(', ')})`);

  // "primary component" in (...) — same list, always quoted per JQL spec
  parts.push(`"primary component" in (${comps.map(c => `"${esc(c)}"`).join(', ')})`);

  // assignee in (...) — membersOf for DLs + direct handles, baked with OR
  const dlParts = dedupeAndTrim(params.assigneeDLs).map(dl => `membersOf("${esc(dl)}")`);
  const handleParts = dedupeAndTrim(params.assigneeHandles);
  const allAssignee = [...dlParts, ...handleParts];
  if (allAssignee.length > 0) {
    parts.push(`assignee in (${allAssignee.join(', ')})`);
  }

  // issuetype oncall — keep parity with legacy JQL (Era/ERA Oncall)
  if (params.includeOncallType !== false) {
    parts.push(`issuetype in ("Era Oncall", "ERA Oncall")`);
  }

  return parts.join(' OR ');
}

export function buildTeamBaseJql(params: BuildBaseJqlParams): string {
  const customKeys = parseCustomKeys(params.customProjectKey);
  const isShared = params.isSharedProject;

  if (!params.teamName || !String(params.teamName).trim()) {
    throw new Error('buildTeamBaseJql: team_name is required');
  }
  if (params.components.length === 0) {
    throw new Error('buildTeamBaseJql: components is required');
  }
  if (!isShared && customKeys.length === 0) {
    throw new Error('buildTeamBaseJql: custom_project_key is required when is_shared_project == false');
  }

  const sharedList = params.includeLegacy
    ? [...SHARED_PROJECTS_ALL, ...LEGACY_SHARED_PROJECTS]
    : [...SHARED_PROJECTS_ALL];

  const innerOr = buildInnerOr(params);

  if (isShared) {
    // Case A: only shared projects filtered by components+assignee
    return `project in (${sharedList.join(', ')}) AND (${innerOr})`;
  }

  // Case B: private project(s) taken whole OR shared filtered
  const customStr = customKeys.join(', ');
  const sharedStr = sharedList.join(', ');
  return `(project in (${customStr}) OR (project in (${sharedStr}) AND (${innerOr})))`;
}

/**
 * Validate components exist across ENG + horizontal projects via JIRA.
 * Caller should fetch via JiraConnector.getProjectComponents and compare.
 * This helper just checks non-empty and trims.
 */
export function validateTeamBaseJqlInput(params: BuildBaseJqlParams): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!params.teamName || !String(params.teamName).trim()) errors.push('team_name is required');
  if (!Array.isArray(params.components) || params.components.length === 0) errors.push('components is required (at least 1)');
  if (!params.isSharedProject) {
    const keys = parseCustomKeys(params.customProjectKey);
    if (keys.length === 0) errors.push('custom_project_key is required when is_shared_project is false');
    for (const k of keys) {
      if (!/^[A-Z][A-Z0-9_]+$/.test(k)) errors.push(`custom_project_key "${k}" is not a valid JIRA project key`);
    }
  }
  return { valid: errors.length === 0, errors };
}

export const teamBaseJqlService = {
  buildTeamBaseJql,
  validateTeamBaseJqlInput,
  SHARED_ENG_PROJECT,
  HORIZONTAL_PROJECTS,
  SHARED_PROJECTS_ALL,
  LEGACY_SHARED_PROJECTS,
};

export default teamBaseJqlService;
