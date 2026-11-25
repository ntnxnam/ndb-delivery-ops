/**
 * Deferred Insights — cross-release deferred bug dashboard (KPI section).
 * Per release: how many bugs got deferred, which release they finally got fixed in, what is still pending.
 * Product-agnostic: labelPrefix + releasePrefix from teamBoardConfig, label taxonomy from jiraFieldsConfig.
 */

const { getJira, searchPages } = require('../utils/jiraClient');
const { loadTeamBoardConfig, normalizeTeamId } = require('../utils/teamConfig');
const { getLabelPattern } = require('../utils/jiraFieldsConfig');
const { SimpleCache } = require('../utils/simpleCache');

const heroCache = new SimpleCache(5 * 60 * 1000);

// ── helpers ───────────────────────────────────────────────────────────────

let _jiraBaseUrlCached = null;
function jiraBaseUrl() {
  if (_jiraBaseUrlCached) return _jiraBaseUrlCached;
  try {
    const raw = require('../config/jiraFieldsConfig.json');
    _jiraBaseUrlCached = raw?.jiraBaseUrl || 'https://jira.nutanix.com';
  } catch (_) { _jiraBaseUrlCached = 'https://jira.nutanix.com'; }
  return _jiraBaseUrlCached;
}

function getTeamMeta(teamId) {
  const board = loadTeamBoardConfig();
  const nid = normalizeTeamId(teamId);
  const team = (board.teams || []).find((t) => normalizeTeamId(t.id) === nid) || null;
  const labelPrefix = String(team?.labelPrefix || 'ndb-').toLowerCase(); // e.g. "ndb-"
  // Strip trailing dash for getLabelPattern which expects prefix without dash
  const prefixForLabel = labelPrefix.replace(/-+$/, '') || 'ndb';
  const releasePrefix = String(team?.releasePrefix || 'NDB-').trim() || 'NDB-';
  const projectKey = String(team?.projectKey || team?.featureProjectKey || 'ERA').trim() || 'ERA';
  return { team, labelPrefix, prefixForLabel, releasePrefix, projectKey };
}

function versionSlug(release) {
  return String(release || '').trim();
}

function versionForLabel(release, releasePrefix) {
  // NDB-2.11 -> "2.11" for label pattern {prefix}-{version}-deferred
  let v = String(release || '').trim();
  const rp = String(releasePrefix || '').trim();
  if (rp && v.toLowerCase().startsWith(rp.toLowerCase())) v = v.slice(rp.length);
  return v.toLowerCase();
}

function deferredLabel(release, releasePrefix, prefixForLabel) {
  const version = versionForLabel(release, releasePrefix);
  const pat = getLabelPattern('lifecycle.deferred', { prefix: prefixForLabel, version });
  if (pat) return pat;
  return `${String(prefixForLabel).toLowerCase()}-${version}-deferred`;
}

function deferredJql(release, releasePrefix, prefixForLabel) {
  const canonical = deferredLabel(release, releasePrefix, prefixForLabel);
  const raw = `${String(release || '').trim()}-deferred`;
  const variants = [...new Set([canonical, raw])];
  if (variants.length === 1) return `labels = "${variants[0].replace(/"/g, '\\"')}"`;
  return `labels in (${variants.map((v) => `"${v.replace(/"/g, '\\"')}"`).join(', ')})`;
}

function quote(v) { return `"${String(v).replace(/"/g, '\\"')}"`; }

function isDoneStatus(status, statusCategory) {
  const cat = String(statusCategory || '').toLowerCase();
  if (cat === 'done') return true;
  const s = String(status || '').toLowerCase();
  return s === 'closed' || s === 'resolved' || s === 'done';
}

function classifyResolution(issue) {
  const status = issue.fields?.status?.name || issue.status || '';
  const cat = issue.fields?.statusCategory?.name || issue.statusCategory || issue.fields?.status?.statusCategory?.name || '';
  const done = isDoneStatus(status, cat);
  return { status, statusCategory: cat, done };
}

// Compare releases oldest→newest using numeric version ordering
function releaseSortKey(name) {
  // Extract numeric segments from release name, e.g. NDB-2.11.1 -> [2,11,1]
  const v = String(name || '').match(/(\d+(?:\.\d+)*)/);
  if (!v) return [9999];
  return v[1].split('.').map((n) => parseInt(n, 10) || 0);
}
function compareReleases(a, b) {
  const ka = releaseSortKey(a); const kb = releaseSortKey(b);
  const len = Math.max(ka.length, kb.length);
  for (let i = 0; i < len; i++) {
    const da = ka[i] ?? -1; const db = kb[i] ?? -1;
    if (da !== db) return da - db;
  }
  return String(a).localeCompare(String(b));
}

async function discoverReleases(token, projectKey) {
  async function fallbackFromConfig() {
    try {
      const cfg = require('../config/releaseVersionsEmailConfig.json');
      const names = Object.keys(cfg.releaseGateDates || {});
      const filtered = names.filter((n) => /\d+\.\d+/.test(n));
      filtered.sort(compareReleases);
      return filtered;
    } catch (_) { return []; }
  }
  try {
    const jira = await getJira(token);
    const versions = await jira.getProjectVersions(projectKey);
    // versions: [{name, released, releaseDate, archived}]
    const names = (versions || []).map((v) => v.name).filter(Boolean);
    // Keep only major/minor/maintenance (dotted numeric), exclude master/Era Future etc
    const filtered = names.filter((n) => /\d+\.\d+/.test(n));
    filtered.sort(compareReleases);
    if (filtered.length) return filtered;
    // JIRA returned no dotted releases (e.g. ERA only has master/Era Future) — fallback to config
    const fb = await fallbackFromConfig();
    if (fb.length) return fb;
    return filtered;
  } catch (_) {
    const fb = await fallbackFromConfig();
    if (fb.length) return fb;
    return [];
  }
}

function jqlForDeferredRelease(release, releasePrefix, prefixForLabel, extraFilter) {
  const defJql = deferredJql(release, releasePrefix, prefixForLabel);
  const base = `issuetype = Bug AND ${defJql}`;
  if (extraFilter) return `${base} AND (${extraFilter})`;
  return base;
}

// ── main dashboard ──────────────────────────────────────────────────────

async function getDashboard({ token, teamId, releases: requestedReleases, priority, component, bypassCache }) {
  const { team, labelPrefix, prefixForLabel, releasePrefix, projectKey } = getTeamMeta(teamId);
  const rid = normalizeTeamId(teamId) || 'ndb';
  let releaseNames = Array.isArray(requestedReleases) && requestedReleases.length
    ? [...requestedReleases].map((r) => String(r).trim()).filter(Boolean)
    : [];

  if (!releaseNames.length) {
    releaseNames = await discoverReleases(token, projectKey);
    // Cap to last 12 to keep latency sane (oldest→newest, take tail)
    if (releaseNames.length > 12) releaseNames = releaseNames.slice(-12);
  } else {
    releaseNames.sort(compareReleases);
  }

  if (!releaseNames.length) {
    return {
      teamId: rid,
      jiraBaseUrl: jiraBaseUrl(),
      asOf: new Date().toISOString(),
      releases: [],
      hero: { totalDeferred: 0, totalFixed: 0, totalPending: 0, fixRate: 0, medianLagDays: null },
      emptyReason: 'No releases found for this team. Add releases in Release Setup or pass ?releases=NDB-2.10,NDB-2.11',
    };
  }

  const cacheKey = `deferred:${rid}:${releaseNames.join(',')}:${priority||''}:${component||''}`;
  if (!bypassCache) {
    const cached = heroCache.get(cacheKey);
    if (cached) return cached;
  }

  const jira = await getJira(token);
  const baseUrl = jiraBaseUrl();

  // Build extra filter from priority/component — priority allowlisted to prevent JQL injection
  const ALLOWED_PRIORITIES = new Set(['Blocker - P0', 'Critical - P1', 'Major - P2', 'Minor - P3', 'Blocker', 'Critical', 'Major', 'Minor', 'P0', 'P1', 'P2', 'P3']);
  const extraParts = [];
  if (priority && ALLOWED_PRIORITIES.has(String(priority).trim())) extraParts.push(`priority = ${quote(String(priority).trim())}`);
  else if (priority) console.warn(`[deferred-insights] Ignoring unknown priority filter: ${priority}`);
  if (component) extraParts.push(`component = ${quote(component)}`);
  const extraFilter = extraParts.length ? extraParts.join(' AND ') : null;

  // Count + sample fetch per release in parallel
  const perRelease = await Promise.all(releaseNames.map(async (rel) => {
    const jql = jqlForDeferredRelease(rel, releasePrefix, prefixForLabel, extraFilter);
    let total = 0;
    let countError = null;
    try { total = await jira.searchCount(jql); } catch (e) { countError = e.message || String(e); }

    let issues = [];
    let fetchError = null;
    if (total > 0) {
      try {
        issues = await searchPages(token, jql,
          'key,summary,status,priority,fixVersions,labels,components,assignee,created,updated,resolution,resolutiondate,statusCategoryChangeDate',
          { pageSize: 50, maxTotal: Math.min(total, 200), timeoutMs: 30000, delayMs: 120 });
      } catch (e) { fetchError = e.message || String(e); }
    }

    // Classify each ticket: fixed vs pending, and where fixed
    let fixed = 0;
    let pending = 0;
    const byFixVersion = {}; // fixVersion name -> count (for fixed bucket)
    const byPriority = {};
    const byComponent = {};
    const samples = [];

    for (const it of issues) {
      const key = it.key || '';
      const summary = it.fields?.summary || it.summary || '';
      const pri = it.fields?.priority?.name || it.priority || '';
      const status = it.fields?.status?.name || it.status || '';
      const statusCat = it.fields?.status?.statusCategory?.name || it.fields?.statusCategory?.name || it.fields?.status?.statusCategory?.name || '';
      const done = isDoneStatus(status, statusCat);
      const fvs = (it.fields?.fixVersions || it.fixVersions || []).map((v) => v.name || String(v)).filter(Boolean);
      const fvLabel = fvs.length ? fvs.join(', ') : '—';
      const labels = (it.fields?.labels || it.labels || []);
      const labelStr = Array.isArray(labels) ? labels.join(',') : String(labels || '');
      const comps = (it.fields?.components || it.components || []).map((c) => c.name || String(c)).filter(Boolean);
      const compLabel = comps.length ? comps[0] : '—';

      if (done) {
        fixed += 1;
        const bucketKey = fvLabel && fvLabel !== '—' ? fvLabel : 'Closed (no fixVersion)';
        byFixVersion[bucketKey] = (byFixVersion[bucketKey] || 0) + 1;
      } else {
        pending += 1;
        const bucketKey = fvLabel && fvLabel !== '—' ? fvLabel : 'No fixVersion (parked)';
        byFixVersion[bucketKey] = (byFixVersion[bucketKey] || 0) + 1;
      }
      if (pri) byPriority[pri] = (byPriority[pri] || 0) + 1;
      if (comps.length) {
        for (const c of comps) byComponent[c] = (byComponent[c] || 0) + 1;
      } else {
        byComponent['—'] = (byComponent['—'] || 0) + 1;
      }

      samples.push({
        key, summary, status, statusCategory: statusCat, done,
        priority: pri, fixVersions: fvs, fixVersionLabel: fvLabel, component: compLabel, components: comps,
        assignee: it.fields?.assignee?.displayName || it.fields?.assignee?.name || it.assignee || '',
        created: it.fields?.created || it.created || null,
        updated: it.fields?.updated || it.updated || null,
        labels: labelStr,
      });
    }

    // JQL for drill + open in JIRA
    const drillJql = jql;
    const deferredLabelStr = deferredLabel(rel, releasePrefix, prefixForLabel);

    return {
      release: rel,
      deferredLabel: deferredLabelStr,
      total,
      fixed,
      pending,
      fixRate: total ? Math.round((fixed / total) * 100) : 0,
      error: countError || fetchError || null,
      jql: drillJql,
      breakdowns: {
        byFixVersion,
        byPriority,
        byComponent,
      },
      sample: samples,
      sampleTruncated: total > issues.length,
    };
  }));

  const heroTotal = perRelease.reduce((s, r) => s + (r.total || 0), 0);
  const heroFixed = perRelease.reduce((s, r) => s + (r.fixed || 0), 0);
  const heroPending = perRelease.reduce((s, r) => s + (r.pending || 0), 0);
  const heroFixRate = heroTotal ? Math.round((heroFixed / heroTotal) * 100) : 0;

  // Hero JQLs — aggregate proof for metric-click-dual-action (count→drill, Open in JIRA→exact JQL)
  const unionJqls = perRelease.map((r) => `(${r.jql})`).filter(Boolean);
  const heroAllJql = unionJqls.length ? unionJqls.join(' OR ') : null;
  // Derive fixed/pending JQLs by intersecting hero scope with statusCategory
  const heroFixedJql = heroAllJql ? `(${heroAllJql}) AND statusCategory = Done` : null;
  const heroPendingJql = heroAllJql ? `(${heroAllJql}) AND statusCategory != Done` : null;

  const hasErrors = perRelease.some((r) => r.error);

  const result = {
    teamId: rid,
    jiraBaseUrl: baseUrl,
    asOf: new Date().toISOString(),
    releases: perRelease,
    hero: {
      totalDeferred: heroTotal,
      totalFixed: heroFixed,
      totalPending: heroPending,
      fixRate: heroFixRate,
      releaseCount: perRelease.length,
      jql: heroAllJql,
      fixedJql: heroFixedJql,
      pendingJql: heroPendingJql,
    },
    filters: { priority: priority || null, component: component || null },
  };

  // Don't cache partial errors (prevent cache poison for 5m)
  if (!hasErrors) heroCache.set(cacheKey, result);
  return result;
}

module.exports = { getDashboard, discoverReleases, deferredLabel, deferredJql, compareReleases };
