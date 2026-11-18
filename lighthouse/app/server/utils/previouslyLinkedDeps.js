/**
 * Previously linked (Mode Dependency) — reconstruct removed blocks/blocked-by
 * pairs from JIRA Link changelog. No local snapshot. Does not change Q1–Q7.
 */
const { getJira } = require('./jiraClient');
const { fetchAllChangelogHistories } = require('./changelogPagination');

const KEY_RE = /([A-Z][A-Z0-9_]+-\d+)/gi;
const SAFE_KEY_RE = /^[A-Z][A-Z0-9_]+-\d+$/i;
const MAX_SEEDS = 80;
const CONCURRENCY = 3;
const DEFAULT_LOOKBACK_DAYS = 90;

function isSafeIssueKey(key) {
  return SAFE_KEY_RE.test(String(key || ''));
}

const quietLogger = {
  jira: {
    warning() {},
    info() {},
  },
};

function pairId(a, b) {
  const x = String(a || '').toUpperCase();
  const y = String(b || '').toUpperCase();
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}

function extractKeys(text) {
  if (!text) return [];
  const keys = [];
  const re = new RegExp(KEY_RE.source, 'gi');
  let m;
  while ((m = re.exec(String(text)))) {
    keys.push(m[1].toUpperCase());
  }
  return [...new Set(keys)];
}

function linkTextLooksDependency(text) {
  const t = String(text || '').toLowerCase();
  if (!t.trim()) return false;
  if (t.includes('clone') || t.includes('duplicat') || t.includes('relates')) return false;
  return (
    t.includes('block') ||
    t.includes('depend') ||
    t.includes('needed for') ||
    t.includes('has to be done')
  );
}

function directionFromLinkText(text, seedKey) {
  const t = String(text || '').toLowerCase();
  void seedKey;
  // Order matters: "blocked by" / "is depended" before generic "blocks" / "depend"
  if (t.includes('blocked by') || t.includes('is blocked by')) {
    return 'i_wait_on_them';
  }
  if (t.includes('is depended') || t.includes('depended by')) {
    return 'they_wait_on_me';
  }
  if (t.includes('needed for') || t.includes('has to be done after') || t.includes('depends on')) {
    return 'i_wait_on_them';
  }
  if (t.includes('blocks') || t.includes('has to be done before')) {
    return 'they_wait_on_me';
  }
  return 'i_wait_on_them';
}

function linkTypeFromText(text) {
  const t = String(text || '').toLowerCase();
  if (t.includes('blocked by') || t.includes('is blocked by')) return 'is blocked by';
  if (t.includes('blocks')) return 'blocks';
  if (t.includes('depend')) return 'depends on';
  return 'blocks';
}

/**
 * Walk Link-field changelog for one seed. Returns removed dependency peers.
 */
function parseDependencyLinkHistory(histories, seedKey, { lookbackSinceMs } = {}) {
  const seed = String(seedKey || '').toUpperCase();
  if (!seed || !Array.isArray(histories)) return [];

  /** @type {Map<string, { peerKey: string, direction: string, linkType: string, lastAddedAt: string|null, removedAt: string|null, active: boolean }>} */
  const state = new Map();

  const sorted = [...histories].sort(
    (a, b) => new Date(a.created || 0).getTime() - new Date(b.created || 0).getTime()
  );

  sorted.forEach((hist) => {
    const created = hist.created || null;
    const createdMs = created ? new Date(created).getTime() : 0;
    (hist.items || []).forEach((item) => {
      // JIRA Data Center uses field === "Link" for issue-link add/remove
      if (String(item.field || '') !== 'Link') return;

      const fromS = item.fromString || '';
      const toS = item.toString || '';
      const fromDep = linkTextLooksDependency(fromS);
      const toDep = linkTextLooksDependency(toS);

      // Added: empty → dependency text
      if (!fromDep && toDep) {
        extractKeys(toS)
          .filter((k) => k !== seed)
          .forEach((peer) => {
            state.set(peer, {
              peerKey: peer,
              direction: directionFromLinkText(toS, seed),
              linkType: linkTypeFromText(toS),
              lastAddedAt: created,
              removedAt: null,
              active: true,
            });
          });
        return;
      }

      // Removed: dependency text → empty
      if (fromDep && !toDep) {
        extractKeys(fromS)
          .filter((k) => k !== seed)
          .forEach((peer) => {
            const prev = state.get(peer) || {
              peerKey: peer,
              direction: directionFromLinkText(fromS, seed),
              linkType: linkTypeFromText(fromS),
              lastAddedAt: null,
              removedAt: null,
              active: false,
            };
            if (lookbackSinceMs && createdMs && createdMs < lookbackSinceMs) {
              // Still mark inactive so we don't keep stale "active"
              prev.active = false;
              state.set(peer, prev);
              return;
            }
            state.set(peer, {
              ...prev,
              direction: directionFromLinkText(fromS, seed),
              linkType: linkTypeFromText(fromS),
              removedAt: created,
              active: false,
            });
          });
      }
    });
  });

  return [...state.values()].filter((e) => !e.active && e.removedAt);
}

function isDependencyLinkLike(link) {
  const t = `${link?.type || ''} ${link?.typeName || ''}`.toLowerCase();
  if (!link?.key) return false;
  if (t.includes('clone') || t.includes('duplicat') || t.includes('relates')) return false;
  return (
    t.includes('block') ||
    t.includes('depend') ||
    t.includes('needed for') ||
    t.includes('has to be done')
  );
}

/** Live Mode Dependency edges as pair ids. */
function buildLiveDependencyPairSet(issueLists) {
  const live = new Set();
  (issueLists || []).forEach((list) => {
    (list || []).forEach((iss) => {
      const a = String(iss?.key || '').toUpperCase();
      if (!a) return;
      (iss.links || []).forEach((link) => {
        if (!isDependencyLinkLike(link)) return;
        const b = String(link.key || '').toUpperCase();
        if (!b) return;
        live.add(pairId(a, b));
      });
    });
  });
  return live;
}

function projectOfKey(key) {
  const m = String(key || '').match(/^([A-Z][A-Z0-9_]+)-/i);
  return m ? m[1].toUpperCase() : '';
}

function isHomeKey(key, isEraHomeProject, cfg) {
  const pk = projectOfKey(key);
  if (!pk) return false;
  if (typeof isEraHomeProject === 'function') return isEraHomeProject(pk, cfg);
  return pk === 'ERA' || pk === 'FEAT' || pk.startsWith('NDB');
}

/**
 * Home first, then live-chain partners, capped.
 */
function collectPreviouslyLinkedSeeds(sections, { isEraHomeProject, cfg, maxSeeds = MAX_SEEDS } = {}) {
  const home = [];
  const partners = [];
  const seen = new Set();

  const push = (key, homeBucket) => {
    const k = String(key || '').toUpperCase();
    if (!k || !isSafeIssueKey(k) || seen.has(k)) return;
    seen.add(k);
    if (homeBucket) home.push(k);
    else partners.push(k);
  };

  const takeIssues = (issues, forceHome) => {
    (issues || []).forEach((iss) => {
      if (!iss?.key) return;
      const homeish =
        forceHome === true ||
        forceHome === false
          ? forceHome
          : isHomeKey(iss.key, isEraHomeProject, cfg);
      push(iss.key, homeish);
    });
  };

  takeIssues(sections?.waitRoots?.issues, true);
  takeIssues(sections?.wishlist?.issues, true);
  takeIssues(sections?.wishlistLinked?.issues, true);
  takeIssues(sections?.wishlistUnlinked?.issues, true);
  takeIssues(sections?.partnershipBlockedBy?.issues, null);
  takeIssues(sections?.partnershipBlocks?.issues, null);
  takeIssues(sections?.blockerHops?.issues, false);
  takeIssues(sections?.trainLabels?.issues, null);

  (sections?.earlyCalls || []).forEach((bundle) => {
    const s = bundle?.sections || {};
    takeIssues(s.wishlist?.issues, true);
    takeIssues(s.wishlistLinked?.issues, true);
    takeIssues(s.trainLabels?.issues, null);
  });

  return [...home, ...partners].slice(0, maxSeeds);
}

function lookbackSinceMs(ecDateIso) {
  if (ecDateIso) {
    const t = new Date(`${String(ecDateIso).slice(0, 10)}T00:00:00Z`).getTime();
    if (!Number.isNaN(t)) return t;
  }
  return Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000;
}

function slimIssue(iss) {
  if (!iss?.key) return null;
  return {
    key: iss.key,
    summary: iss.summary || '',
    status: iss.status || '',
    issueType: iss.issueType || '',
    project: iss.project || projectOfKey(iss.key),
    labels: Array.isArray(iss.labels) ? iss.labels : [],
    span: iss.span || null,
    spanInfo: iss.spanInfo || null,
  };
}

function stubIssue(key) {
  return {
    key,
    summary: '',
    status: '',
    issueType: '',
    project: projectOfKey(key),
    labels: [],
    span: null,
    spanInfo: null,
    orphan: true,
  };
}

function jiraSearchUrl(base, jql) {
  const root = String(base || 'https://jira.nutanix.com').replace(/\/+$/, '');
  return `${root}/issues/?jql=${encodeURIComponent(jql)}`;
}

async function mapPool(items, concurrency, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }
  const n = Math.min(concurrency, Math.max(1, items.length));
  await Promise.all(Array.from({ length: n }, () => worker()));
  return results;
}

/**
 * @returns {Promise<{ count: number, jql: string|null, jiraUrl: string|null, pairs: Array, seedCount: number, error?: string }>}
 */
async function fetchPreviouslyLinked({
  token,
  sections,
  issueIndexByKey,
  jiraBaseUrl,
  ecDate,
  isEraHomeProject,
  cfg,
  maxSeeds = MAX_SEEDS,
} = {}) {
  const empty = { count: 0, jql: null, jiraUrl: null, pairs: [], seedCount: 0 };
  if (!token) return empty;

  const seeds = collectPreviouslyLinkedSeeds(sections, { isEraHomeProject, cfg, maxSeeds });
  if (!seeds.length) return { ...empty, seedCount: 0 };

  const livePairs = buildLiveDependencyPairSet([
    sections?.partnershipBlockedBy?.issues,
    sections?.partnershipBlocks?.issues,
    sections?.waitRoots?.issues,
    sections?.blockerHops?.issues,
    sections?.wishlist?.issues,
    sections?.wishlistLinked?.issues,
  ]);

  const sinceMs = lookbackSinceMs(ecDate);
  try {
    await getJira(token);
  } catch (err) {
    return { ...empty, seedCount: seeds.length, error: err.message || String(err) };
  }

  const removedEdges = [];
  const baseUrl = jiraBaseUrl || process.env.JIRA_BASE_URL || 'https://jira.nutanix.com';

  await mapPool(seeds, CONCURRENCY, async (seedKey) => {
    try {
      const { histories } = await fetchAllChangelogHistories(
        baseUrl,
        seedKey,
        null,
        token,
        null,
        null,
        quietLogger,
        null
      );
      const edges = parseDependencyLinkHistory(histories, seedKey, { lookbackSinceMs: sinceMs });
      edges.forEach((e) => {
        if (livePairs.has(pairId(seedKey, e.peerKey))) return;
        removedEdges.push({
          leftKey: seedKey,
          rightKey: e.peerKey,
          direction: e.direction,
          linkType: e.linkType,
          linkStatus: 'removed',
          removedAt: e.removedAt,
          lastAddedAt: e.lastAddedAt,
        });
      });
    } catch (err) {
      console.warn('[previouslyLinked] changelog failed for', seedKey, err.message || err);
    }
  });

  // Dedupe by unordered pair + prefer most recent removedAt
  const byPair = new Map();
  removedEdges.forEach((edge) => {
    const id = pairId(edge.leftKey, edge.rightKey);
    const prev = byPair.get(id);
    if (!prev) {
      byPair.set(id, edge);
      return;
    }
    const prevT = new Date(prev.removedAt || 0).getTime();
    const nextT = new Date(edge.removedAt || 0).getTime();
    if (nextT >= prevT) byPair.set(id, edge);
  });

  const edgeList = [...byPair.values()];
  const missingKeys = [
    ...new Set(
      edgeList
        .flatMap((e) => [e.leftKey, e.rightKey])
        .filter((k) => k && !issueIndexByKey?.get?.(String(k).toUpperCase()))
    ),
  ].slice(0, 80);

  if (missingKeys.length) {
    try {
      const { runSearchByJql } = require('./jiraSearchByJql');
      const result = await runSearchByJql(token, `key in (${missingKeys.join(', ')})`, 100, {
        extraFields: ['summary', 'status', 'issuetype', 'project', 'labels'],
      });
      (result.issues || []).forEach((raw) => {
        const key = String(raw.key || '').toUpperCase();
        if (!key) return;
        const status = raw.status?.name || (typeof raw.status === 'string' ? raw.status : '') || '';
        const issueType =
          raw.issuetype?.name || (typeof raw.issuetype === 'string' ? raw.issuetype : '') || '';
        const project =
          raw.project?.key || (typeof raw.project === 'string' ? raw.project : '') || projectOfKey(raw.key);
        issueIndexByKey?.set?.(key, {
          key: raw.key,
          summary: raw.summary || '',
          status,
          issueType,
          project,
          labels: Array.isArray(raw.labels) ? raw.labels : [],
        });
      });
    } catch (err) {
      console.warn('[previouslyLinked] peer enrich failed:', err.message || err);
    }
  }

  const resolve = (key) => {
    const k = String(key || '').toUpperCase();
    const fromIndex = issueIndexByKey?.get?.(k) || issueIndexByKey?.get?.(key);
    if (fromIndex) return slimIssue(fromIndex);
    return stubIssue(k);
  };

  const pairs = edgeList
    .sort((a, b) => new Date(b.removedAt || 0) - new Date(a.removedAt || 0))
    .map((edge) => ({
      left: resolve(edge.leftKey),
      right: resolve(edge.rightKey),
      direction: edge.direction,
      linkType: edge.linkType,
      linkStatus: 'removed',
      removedAt: edge.removedAt,
      lastAddedAt: edge.lastAddedAt || null,
    }));

  const allKeys = [
    ...new Set(
      pairs
        .flatMap((p) => [p.left?.key, p.right?.key].filter(Boolean))
        .filter(isSafeIssueKey)
        .map((k) => String(k).toUpperCase())
    ),
  ];
  const jql = allKeys.length ? `key in (${allKeys.join(', ')})` : null;

  return {
    count: pairs.length,
    jql,
    jiraUrl: jql ? jiraSearchUrl(jiraBaseUrl, jql) : null,
    pairs,
    seedCount: seeds.length,
  };
}

module.exports = {
  parseDependencyLinkHistory,
  collectPreviouslyLinkedSeeds,
  buildLiveDependencyPairSet,
  fetchPreviouslyLinked,
  pairId,
  linkTextLooksDependency,
  MAX_SEEDS,
  CONCURRENCY,
};
