/**
 * issueGroupsService — issue-type → 6-group classification.
 *
 * Ports `issue_groups.py` (CONSOLIDATION.md #1b Phase 2).
 *
 * The six groups (per `.cursor/rules/issue-type-grouping.mdc`):
 *
 *   1. Project Hierarchy   — Feature, Initiative, Epic, X-FEAT, Capability
 *   2. Bug
 *   3. Improvement
 *   4. Dev Code            — Task, Unit Test
 *   5. Test
 *   6. Everything Else
 *
 * Only groups 2-6 appear in "By Issue Type" user-visible breakdowns
 * (Project Hierarchy is excluded — those are containers, not work).
 *
 * No D1 concerns: these issue types are JIRA-system concepts, not
 * Nutanix-specific.
 */

export const PROJECT_HIERARCHY = new Set([
  'Feature',
  'Initiative',
  'Epic',
  'X-FEAT',
  'X-Feat',
  'Capability',
]);

export const DEV_CODE = new Set(['Task', 'Unit Test']);

export const ALL_GROUPS = [
  'Project Hierarchy',
  'Bug',
  'Improvement',
  'Dev Code',
  'Test',
  'Everything Else',
] as const;

export const DISPLAY_GROUPS = [
  'Bug',
  'Improvement',
  'Dev Code',
  'Test',
  'Everything Else',
] as const;

export type IssueGroup = (typeof ALL_GROUPS)[number];

/** Map a JIRA Issue Type string to one of the 6 groups. */
export function groupFor(issueType: string | null | undefined): IssueGroup {
  const it = (issueType ?? '').trim();
  if (PROJECT_HIERARCHY.has(it)) return 'Project Hierarchy';
  if (it === 'Bug') return 'Bug';
  if (it === 'Improvement') return 'Improvement';
  if (DEV_CODE.has(it)) return 'Dev Code';
  if (it === 'Test') return 'Test';
  return 'Everything Else';
}

/**
 * Build a JQL fragment that matches issues in a given group. Used by
 * downstream URL builders to produce clickable counts. `X-FEAT` is
 * bare-legal in JQL `in (...)` lists (the parser tokenises by commas;
 * hyphenated identifiers read as one token).
 */
export function groupFilterJql(group: IssueGroup): string {
  switch (group) {
    case 'Project Hierarchy':
      return 'issueType in (Feature, Initiative, Epic, X-FEAT, Capability)';
    case 'Bug':
      return 'issueType = Bug';
    case 'Improvement':
      return 'issueType = Improvement';
    case 'Dev Code':
      return 'issueType in (Task, "Unit Test")';
    case 'Test':
      return 'issueType = Test';
    case 'Everything Else':
      return (
        'issueType not in (Feature, Initiative, Epic, X-FEAT, Capability, ' +
        'Bug, Improvement, Task, "Unit Test", Test)'
      );
  }
}

/**
 * Work-type bucket used by processMaster (Dev / Test / Hierarchy).
 * Subset of the 6 groups, collapsing Dev Code / Improvement / Bug /
 * Everything-Else into "Dev". Mirrors Python's local `_work_type`
 * helper inside `process_master`.
 */
export type WorkType = 'Hierarchy' | 'Test' | 'Dev';

export function workTypeFor(issueType: string | null | undefined): WorkType {
  const it = (issueType ?? '').trim();
  if (PROJECT_HIERARCHY.has(it)) return 'Hierarchy';
  if (it === 'Test') return 'Test';
  return 'Dev';
}
