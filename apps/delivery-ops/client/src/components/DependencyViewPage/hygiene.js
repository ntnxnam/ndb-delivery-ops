/**
 * Client hygiene chase — plain-English titles (dependency_rule.md §6).
 */

const TRAIN_ASK_RE = /^ndb-.+-(ask|asks|dependency)$/i;

function hasTrainAskLabel(issue) {
  return (issue?.labels || []).some((l) => TRAIN_ASK_RE.test(String(l || '')));
}

function browseUrl(jiraBaseUrl, key) {
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/+$/, '');
  return `${base}/browse/${key}`;
}

function exampleFromIssue(issue, jiraBaseUrl) {
  const fv =
    (Array.isArray(issue.commitFixVersions) && issue.commitFixVersions.length
      ? issue.commitFixVersions
      : issue.fixVersions || []
    ).join(', ') || null;
  const summary = String(issue.summary || issue.key || '').trim();
  const short = summary.length > 56 ? `${summary.slice(0, 55)}…` : summary;
  return {
    key: issue.key,
    href: browseUrl(jiraBaseUrl, issue.key),
    summary: short || issue.key,
    fixVersion: fv,
  };
}

/**
 * @returns {{ id: string, owner: 'ndb'|'them', severity: number, title: string, detail?: string, count: number, keys: string[], jiraUrl?: string, jql?: string }[]}
 */
export function buildHygieneItems({
  iWaitIssues = [],
  theyWaitIssues = [],
  wishlistCount = 0,
  wishlistUnlinked = [],
  partnerOrphans = [],
  sections = {},
  jiraBaseUrl,
  trainName,
}) {
  const items = [];
  const train = trainName || 'the aligned train';

  const depCount = iWaitIssues.length + theyWaitIssues.length;
  if (depCount > 0 && wishlistCount === 0) {
    items.push({
      id: 'ndb-dep-without-wishlist',
      owner: 'ndb',
      severity: 1,
      title:
        'We linked dependencies to partners, but we never labeled our own NDB projects as wishlist for this release',
      detail:
        'Add an ndb-{release}-wishlist label on the NDB project that wishes this work into the release.',
      count: depCount,
      sampleIssues: [...iWaitIssues, ...theyWaitIssues].slice(0, 5),
      jiraUrl: sections.wishlist?.jiraUrl,
      jql: sections.wishlist?.jql,
    });
  }

  const partnerCommitGaps = [...iWaitIssues, ...theyWaitIssues].filter(
    (i) => i.commitHygiene === 'partner_missing_fixversion'
  );
  if (partnerCommitGaps.length) {
    items.push({
      id: 'them-commit-no-fv',
      owner: 'them',
      severity: 1,
      title:
        'The partner marked Release Commit as Commit or Stretch, but did not put a real fixVersion (only master / ERA Future / blank counts as missing)',
      detail: 'Fault is on the ticket owner — they need a real release version.',
      count: partnerCommitGaps.length,
      sampleIssues: partnerCommitGaps.slice(0, 5),
    });
  }

  const partnerBlankRc = [...iWaitIssues, ...theyWaitIssues].filter(
    (i) => i.commitHygiene === 'partner_missing_release_commit'
  );
  if (partnerBlankRc.length) {
    items.push({
      id: 'them-fv-blank-rc',
      owner: 'them',
      severity: 1,
      title:
        'The partner set a real fixVersion but left the Release Commit field blank (not Commit or Stretch)',
      detail: 'Fault is on the ticket owner — Release Commit says how firm their commitment is.',
      count: partnerBlankRc.length,
      sampleIssues: partnerBlankRc.slice(0, 5),
    });
  }

  const missingAsk = [...iWaitIssues, ...theyWaitIssues].filter((i) => !hasTrainAskLabel(i));
  if (missingAsk.length) {
    items.push({
      id: 'missing-train-ask',
      owner: 'them',
      severity: 2,
      title: `We have a Dependency link to a partner ticket, but that ticket has no ask label for ${train} (for example ndb-leto-ask or ndb-leto-dependency)`,
      detail:
        'Partner can be a peer NDB team or outside NDB. Links without ask labels are common — still chase the label so the ask is discoverable.',
      count: missingAsk.length,
      sampleIssues: missingAsk.slice(0, 5),
    });
  }

  if (wishlistUnlinked.length) {
    items.push({
      id: 'wishlist-no-link',
      owner: 'ndb',
      severity: 2,
      title:
        'We labeled NDB projects as wishlist for this release, but never linked them to the partner’s work in JIRA',
      detail: 'Create a Dependency link (blocks / is blocked by) from our side to the partner ticket.',
      count: wishlistUnlinked.length,
      sampleIssues: wishlistUnlinked.slice(0, 5),
      jiraUrl: sections.wishlistUnlinked?.jiraUrl,
      jql: sections.wishlistUnlinked?.jql,
    });
  }

  if (partnerOrphans.length) {
    items.push({
      id: 'ask-orphan',
      owner: 'them',
      severity: 2,
      title: `Someone labeled a ticket as an ask for ${train}, but it is not linked to our NDB wishlist for this release`,
      detail: 'Either link it to the wishlist ticket, or clean up an orphan ask.',
      count: partnerOrphans.length,
      sampleIssues: partnerOrphans.slice(0, 5),
      jiraUrl: sections.partnerOrphans?.jiraUrl,
      jql: sections.partnerOrphans?.jql,
    });
  }

  return items
    .sort((a, b) => a.severity - b.severity || b.count - a.count)
    .map((it) => ({
      ...it,
      examples: (it.sampleIssues || []).map((iss) => exampleFromIssue(iss, jiraBaseUrl)),
    }));
}

export { browseUrl, hasTrainAskLabel };
