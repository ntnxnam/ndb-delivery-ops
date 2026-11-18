/**
 * Regroup SoS byVersion items under NDB eng leaders via Assignee Manager.
 *
 * Config shape: GET /api/config/ndb-leader-org
 * Match: case-insensitive trimmed display name against leader.matchNames,
 * manager.displayName, manager.matchNames, and nested manager.reports.
 */

/** @param {string|null|undefined} name */
export function normalizeManagerName(name) {
  if (name == null) return '';
  return String(name).trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Extract assignee manager display name from a SoS item.
 * @param {object} item
 * @returns {string} empty string when missing
 */
export function extractAssigneeManagerName(item) {
  if (!item) return '';
  const m = item.assigneeManager;
  if (!m) return '';
  if (typeof m === 'string') return m.trim();
  if (typeof m === 'object') {
    return String(m.displayName || m.name || '').trim();
  }
  return '';
}

/**
 * Flatten leader config into managerName (normalized) → leaderId.
 * @param {{ leaders?: Array }} orgConfig
 * @returns {Map<string, string>}
 */
export function buildManagerToLeaderMap(orgConfig) {
  const map = new Map();
  const leaders = orgConfig?.leaders || [];

  const addNames = (names, leaderId) => {
    (names || []).forEach((n) => {
      const key = normalizeManagerName(n);
      if (key) map.set(key, leaderId);
    });
  };

  const walkManager = (mgr, leaderId) => {
    if (!mgr) return;
    const aliases = [
      mgr.displayName,
      ...(Array.isArray(mgr.matchNames) ? mgr.matchNames : []),
    ];
    addNames(aliases, leaderId);
    (mgr.reports || []).forEach((child) => walkManager(child, leaderId));
  };

  leaders.forEach((leader) => {
    if (!leader?.id) return;
    addNames(leader.matchNames || [leader.displayName], leader.id);
    (leader.managers || []).forEach((mgr) => walkManager(mgr, leader.id));
  });

  return map;
}

/**
 * Resolve which leader owns an item. Returns null if unmapped.
 * @param {object} item
 * @param {Map<string, string>} managerToLeader
 * @returns {string|null} leader id
 */
export function resolveLeaderId(item, managerToLeader) {
  const key = normalizeManagerName(extractAssigneeManagerName(item));
  if (!key) return null;
  return managerToLeader.get(key) || null;
}

/**
 * Sort release version keys newest-first (Unversioned last) — same as SoS.
 * @param {string[]} versions
 * @returns {string[]}
 */
export function sortVersionKeys(versions) {
  return [...versions].sort((a, b) => {
    if (a === 'Unversioned') return 1;
    if (b === 'Unversioned') return -1;
    return b.localeCompare(a, undefined, { numeric: true });
  });
}

/**
 * Regroup SoS byVersion into leader → byVersion (+ unmapped).
 *
 * @param {Record<string, object[]>} byVersion
 * @param {{ leaders?: Array }} orgConfig
 * @returns {{
 *   byLeader: Record<string, { byVersion: Record<string, object[]>, itemCount: number }>,
 *   unmapped: { byVersion: Record<string, object[]>, itemCount: number },
 *   managerToLeader: Map<string, string>,
 * }}
 */
export function regroupByLeader(byVersion, orgConfig) {
  const managerToLeader = buildManagerToLeaderMap(orgConfig);
  const leaders = orgConfig?.leaders || [];

  const byLeader = {};
  leaders.forEach((l) => {
    if (l?.id) byLeader[l.id] = { byVersion: {}, itemCount: 0 };
  });

  const unmapped = { byVersion: {}, itemCount: 0 };

  const push = (bucket, version, item) => {
    if (!bucket.byVersion[version]) bucket.byVersion[version] = [];
    bucket.byVersion[version].push(item);
    bucket.itemCount += 1;
  };

  Object.entries(byVersion || {}).forEach(([version, items]) => {
    (items || []).forEach((item) => {
      const leaderId = resolveLeaderId(item, managerToLeader);
      if (leaderId && byLeader[leaderId]) {
        push(byLeader[leaderId], version, item);
      } else {
        push(unmapped, version, item);
      }
    });
  });

  return { byLeader, unmapped, managerToLeader };
}

/**
 * Count items in a byVersion map.
 * @param {Record<string, object[]>} byVersion
 */
export function countByVersion(byVersion) {
  return Object.values(byVersion || {}).reduce((n, arr) => n + (arr?.length || 0), 0);
}

/**
 * All display-name aliases that roll up to a leader (for JQL Assignee Manager in (...)).
 * @param {{ leaders?: Array }} orgConfig
 * @param {string} leaderId
 * @returns {string[]}
 */
export function listAssigneeManagerNamesForLeader(orgConfig, leaderId) {
  const names = [];
  const seen = new Set();
  const add = (n) => {
    const t = String(n || '').trim();
    if (!t) return;
    const key = normalizeManagerName(t);
    if (seen.has(key)) return;
    seen.add(key);
    names.push(t);
  };

  const walk = (mgr) => {
    if (!mgr) return;
    add(mgr.displayName);
    (mgr.matchNames || []).forEach(add);
    (mgr.reports || []).forEach(walk);
  };

  const leader = (orgConfig?.leaders || []).find((l) => l?.id === leaderId);
  if (!leader) return names;
  (leader.matchNames || [leader.displayName]).forEach(add);
  (leader.managers || []).forEach(walk);
  return names;
}

/**
 * JQL fragment scoping to Assignee Manager display names (and optionally EMPTY).
 * @param {string[]} managerNames
 * @param {{ includeEmpty?: boolean }} [opts]
 * @returns {string|null}
 */
export function buildAssigneeManagerJqlClause(managerNames, opts = {}) {
  const quoted = (managerNames || [])
    .map((n) => String(n || '').trim())
    .filter(Boolean)
    .map((n) => `"${n.replace(/"/g, '\\"')}"`);
  const parts = [];
  if (quoted.length === 1) parts.push(`"Assignee Manager" = ${quoted[0]}`);
  else if (quoted.length > 1) parts.push(`"Assignee Manager" in (${quoted.join(', ')})`);
  if (opts.includeEmpty) parts.push(`"Assignee Manager" is EMPTY`);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  return `(${parts.join(' OR ')})`;
}
