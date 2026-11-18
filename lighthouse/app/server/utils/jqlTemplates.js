/**
 * Server-side mirror of client/src/utils/jqlTemplates.js.
 * Keep in sync with the client file - both must produce the same filter
 * names and JQL for a given { version, excludeVersion } input. The chain is
 * used by:
 *   - client: ReleaseSetup (Create / Rename / Cleanup tabs)
 *   - server: jiraFilterService (renameReleaseCascade, cleanupDuplicatePrefixFilters)
 */

function generateFilterChain(version, excludeVersion) {
  const v = (version || '').trim();
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
      jql: `((fixVersion in (${v}) OR affectedVersion in (${v})) AND ${excludeClause}) OR filter in (${filter4Name}) OR issueFunction in portfolioChildrenOf("fixVersion=${v} and type=Epic and \\"Parent Link\\" IS EMPTY") OR (fixVersion = ${v} and type=Epic and "Parent Link" is EMPTY) AND status != Cancelled`,
      dependsOn: [filter4Name],
    },
  ];
}

const RELEASE_PROJECTS = ['ERA', 'FEAT', 'SDL', 'LEG', 'TECHPUBS'];

function isValidVersionName(version) {
  return (version || '').trim().length > 0;
}

module.exports = {
  generateFilterChain,
  RELEASE_PROJECTS,
  isValidVersionName,
};
