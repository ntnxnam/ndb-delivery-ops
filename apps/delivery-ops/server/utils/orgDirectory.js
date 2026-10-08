/**
 * Resolve JIRA assignees to their reporting line using the corporate
 * directory groups synced into JIRA:
 *   Team-<First>-<Last>-DirectReports  → the user's direct manager
 *   Team-<First>-<Last>-Org            → every manager above the user (flattened)
 *
 * Group membership listing needs JIRA admin, so we read each user's own
 * groups (`/user?expand=groups`) instead and derive the tree bottom-up.
 */

const { runWithConcurrency } = require('./concurrency');

const DIRECT_REPORTS_RE = /^Team-(.+)-DirectReports$/;
const ORG_RE = /^Team-(.+)-Org$/;

function personFromGroup(groupName, re) {
  const m = re.exec(groupName || '');
  return m ? m[1].replace(/-/g, ' ') : null;
}

/** Team-Puneet-Kala-DirectReports → username guesses for the group owner. */
function usernameCandidatesFromGroup(groupName) {
  const part = (DIRECT_REPORTS_RE.exec(groupName) || ORG_RE.exec(groupName) || [])[1];
  if (!part) return [];
  const bits = part.split('-').filter(Boolean);
  const lower = bits.map((b) => b.toLowerCase());
  return [...new Set([
    lower.join('.'),
    lower.join(''),
    `${lower[0]}.${lower.slice(1).join('')}`,
    lower.length > 2 ? `${lower[0]}.${lower[1]}` : null,
  ].filter(Boolean))];
}

function normName(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * For each Team-*-DirectReports / Team-*-Org group, resolve whether the
 * named owner still has an active JIRA account. Stale groups (owner left)
 * keep current employees as members — we must not treat those owners as live managers.
 */
async function resolveGroupOwners(jira, groupNames, { concurrency = 4 } = {}) {
  const unique = Array.from(new Set((groupNames || []).filter((g) => DIRECT_REPORTS_RE.test(g) || ORG_RE.test(g))));
  const tasks = unique.map((group) => async () => {
    const displayFromGroup = personFromGroup(group, DIRECT_REPORTS_RE.test(group) ? DIRECT_REPORTS_RE : ORG_RE);
    const want = normName(displayFromGroup);
    let hit = null;
    for (const q of usernameCandidatesFromGroup(group)) {
      try {
        const r = await jira.get('/rest/api/2/user/search', {
          timeout: 15000,
          params: { username: q, includeInactive: true, maxResults: 8 },
        });
        const list = r.data || [];
        hit = list.find((u) => normName(u.displayName) === want)
          || list.find((u) => normName(u.name) === want)
          || list.find((u) => u.name === q)
          || null;
        if (hit) break;
      } catch (err) { /* try next guess */ }
    }
    return [group, {
      displayName: displayFromGroup,
      username: hit?.name || null,
      active: hit ? Boolean(hit.active) : null, // null = could not resolve — keep (don't drop blindly)
    }];
  });
  return Object.fromEntries(await runWithConcurrency(tasks, concurrency));
}

async function fetchUserGroups(jira, usernames, { concurrency = 6 } = {}) {
  const tasks = usernames.map((username) => async () => {
    try {
      const r = await jira.get('/rest/api/2/user', {
        timeout: 15000,
        params: { username, expand: 'groups' },
      });
      const g = r.data?.groups || {};
      const items = (g.items || []).map((x) => x.name).filter(Boolean);
      return [username, {
        displayName: r.data?.displayName || username,
        groups: items,
        groupsTruncated: typeof g.size === 'number' && g.size > items.length,
      }];
    } catch (err) {
      return [username, { displayName: username, groups: [], error: err.message }];
    }
  });
  return Object.fromEntries(await runWithConcurrency(tasks, concurrency));
}

/**
 * Leader = the largest Org group (by weight) that holds at most
 * `leaderMaxShare` of the total weight. Weight is typically the user's
 * sprint-item count, so the roll-up lands one level below whoever owns
 * (almost) the whole product.
 *
 * @param {Record<string, {displayName, groups}>} users
 * @param {{ weights?: Record<string, number>, leaderMaxShare?: number, groupOwners?: Record<string, {active:boolean|null, displayName?:string}> }} opts
 * @returns {{ byUser: Record<string, {manager, managerGroup, leader, leaderGroup, formerManager}> }}
 */
function buildOrgDirectory(users, { weights = {}, leaderMaxShare = 0.7, groupOwners = {} } = {}) {
  const ownerLive = (group) => {
    if (!group) return false;
    const o = groupOwners[group];
    if (!o || o.active == null) return true; // unresolved → keep (avoid dropping everyone)
    return o.active === true;
  };

  const orgWeight = {};
  let total = 0;
  for (const [username, u] of Object.entries(users)) {
    const w = weights[username] ?? 1;
    total += w;
    (u.groups || []).filter((g) => ORG_RE.test(g)).forEach((g) => { orgWeight[g] = (orgWeight[g] || 0) + w; });
  }
  const cap = total * leaderMaxShare;

  const byUser = {};
  for (const [username, u] of Object.entries(users)) {
    const groups = u.groups || [];
    const drAll = groups.filter((g) => DIRECT_REPORTS_RE.test(g));
    const dr = drAll.find(ownerLive) || null;
    const staleDr = !dr ? drAll.find((g) => groupOwners[g] && groupOwners[g].active === false) : null;
    const leaderGroup = groups
      .filter((g) => ORG_RE.test(g) && orgWeight[g] <= cap && ownerLive(g))
      .sort((a, b) => orgWeight[b] - orgWeight[a])[0] || null;
    byUser[username] = {
      manager: dr ? personFromGroup(dr, DIRECT_REPORTS_RE) : null,
      managerGroup: dr,
      formerManager: staleDr ? personFromGroup(staleDr, DIRECT_REPORTS_RE) : null,
      leader: leaderGroup ? personFromGroup(leaderGroup, ORG_RE) : null,
      leaderGroup,
    };
  }
  return { byUser };
}

module.exports = {
  fetchUserGroups, buildOrgDirectory, personFromGroup, resolveGroupOwners, usernameCandidatesFromGroup,
};
