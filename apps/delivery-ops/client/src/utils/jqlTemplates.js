/**
 * Generates the chain of 5 JIRA saved filter definitions for a release version.
 *
 * The filters form a dependency chain (1 is the leaf, 5 is the root):
 *   1 -> 2 -> 3 -> 4 -> 5
 *
 * Keep in sync with server/utils/jqlTemplates.js - both must produce the same
 * filter names and JQL for a given { version, excludeVersion } input.
 *
 * @param {string} version - e.g. "NDB-2.12"
 * @param {string} excludeVersion - future version to exclude from the root filter, e.g. "NDB-2.13"
 * @returns {Array<{order: number, name: string, jql: string, dependsOn: string[]}>}
 */
export function generateFilterChain(version, excludeVersion) {
  const v = version.trim();
  const vExclude = (excludeVersion || '').trim();

  const filter1Name = `Get${v}FeaturesAndInitiatives`;
  const filter2Name = `Get${v}EpicsOfFeaturesAndInitiatives`;
  const filter3Name = `Get${v}IssuesInEpics`;
  const filter4Name = `Get${v}ChildIssues`;
  const filter5Name = `${v}-All`;

  const excludeClause = vExclude
    ? `fixVersion not in ("Era Future", ${vExclude})`
    : `fixVersion not in ("Era Future")`;

  return [
    {
      order: 1,
      name: filter1Name,
      jql: `type in (Initiative, Feature) AND fixVersion in (${v})`,
      dependsOn: [],
    },
    {
      order: 2,
      name: filter2Name,
      jql: `issueFunction in portfolioChildrenOf("filter = ${filter1Name}") AND issuetype = Epic`,
      dependsOn: [filter1Name],
    },
    {
      order: 3,
      name: filter3Name,
      jql: `issueFunction in issuesInEpics("filter = ${filter2Name}")`,
      dependsOn: [filter2Name],
    },
    {
      order: 4,
      name: filter4Name,
      jql: [
        `filter = ${filter2Name}`,
        `OR filter = ${filter3Name}`,
        `OR issueFunction in subtasksOf("filter = ${filter3Name}")`,
        `OR issueFunction in subtasksOf("filter = ${filter2Name}")`,
      ].join(' '),
      dependsOn: [filter2Name, filter3Name],
    },
    {
      order: 5,
      name: filter5Name,
      jql: `((fixVersion in (${v}) OR affectedVersion in (${v})) AND ${excludeClause}) OR filter in (${filter4Name}) AND status != Cancelled ORDER BY rank ASC`,
      dependsOn: [filter4Name],
    },
  ];
}

export const RELEASE_PROJECTS = ['ERA', 'FEAT', 'SDL', 'LEG', 'TECHPUBS'];

/**
 * Validates that a version name is non-empty.
 * @param {string} version
 * @returns {boolean}
 */
export function isValidVersionName(version) {
  return (version || '').trim().length > 0;
}
