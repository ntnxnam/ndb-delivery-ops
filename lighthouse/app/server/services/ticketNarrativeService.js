/**
 * Shared ticket narrative builder — hierarchy, deps, comments, status dwell.
 * Reusable by OnCalls, exec-summary consumers, and future KPI deep-dives.
 *
 * Wraps jiraTicketNarrative primitives and adds:
 *   - full status dwell (days in each status)
 *   - link role classification (oncall / techhelp / eng_fix / other)
 *   - richer field fetch for stack graphs
 */

const { getJira } = require('../utils/jiraClient');
const { SimpleCache } = require('../utils/simpleCache');
const logger = require('../utils/logger');
const {
  fetchTicketNarrative,
  _internals,
} = require('../utils/jiraTicketNarrative');

const {
  buildDescription,
  buildComments,
  buildBlockers,
  buildOutstandingSubtasks,
  stripWikiMarkup,
  truncate,
} = _internals;

const bundleCache = new SimpleCache(5 * 60 * 1000);

function daysBetween(aIso, bIso) {
  const a = aIso ? new Date(aIso).getTime() : NaN;
  const b = bIso ? new Date(bIso).getTime() : NaN;
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.floor((b - a) / 86400000));
}

function daysAgo(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function extractName(user) {
  if (!user) return 'unknown';
  if (typeof user === 'string') return user;
  return user.displayName || user.name || user.emailAddress || 'unknown';
}

function extractStatus(issue) {
  const s = issue?.fields?.status || issue?.status;
  if (!s) return 'unknown';
  return typeof s === 'string' ? s : (s.name || 'unknown');
}

function projectKeyOf(issueKey) {
  if (!issueKey || typeof issueKey !== 'string') return '';
  const i = issueKey.indexOf('-');
  return i > 0 ? issueKey.slice(0, i) : issueKey;
}

/**
 * Build chronological status trail + dwell days per status from changelog.
 */
function computeStatusDwell(changelog, currentStatus) {
  const histories = changelog?.histories;
  const events = [];
  if (Array.isArray(histories)) {
    for (const h of histories) {
      if (!Array.isArray(h.items)) continue;
      for (const item of h.items) {
        if (item.field !== 'status') continue;
        events.push({
          from: item.fromString || 'unknown',
          to: item.toString || 'unknown',
          by: extractName(h.author),
          date: h.created || null,
        });
      }
    }
  }
  events.sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0));

  const dwellByStatus = {};
  let currentDwellDays = null;
  let lastStatusChange = null;

  if (events.length === 0) {
    currentDwellDays = null;
    return {
      transitions: [],
      dwellByStatus,
      currentStatus: currentStatus || null,
      currentDwellDays: currentDwellDays,
      lastStatusChange: null,
    };
  }

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const nextDate = i + 1 < events.length ? events[i + 1].date : new Date().toISOString();
    const days = daysBetween(ev.date, nextDate);
    if (days != null) {
      dwellByStatus[ev.to] = (dwellByStatus[ev.to] || 0) + days;
    }
  }

  const last = events[events.length - 1];
  lastStatusChange = last.date;
  currentDwellDays = daysAgo(last.date);

  return {
    transitions: events.map((e) => ({
      ...e,
      ageDays: daysAgo(e.date),
    })),
    dwellByStatus,
    currentStatus: currentStatus || last.to,
    currentDwellDays,
    lastStatusChange,
  };
}

/**
 * Classify a linked issue into oncall | techhelp | knowledge | techpubs | eng_fix | other.
 * - knowledge (SR) = self-help / knowledge bytes — not eng remediation
 * - techpubs = docs outcome from OnCall (kept for AI insight; counts as remediation)
 * - eng_fix = code/eng work (TECHPUBS treated as remediation sibling when listed in techPubsProjects)
 * engFixProjects empty → any non-oncall/non-techhelp/non-knowledge linked ticket is eng_fix or techpubs.
 */
function classifyLinkRole(issueKey, cfg = {}) {
  const pk = projectKeyOf(issueKey).toUpperCase();
  const onCall = String(cfg.onCallProject || 'OnCall').toUpperCase();
  const techHelp = (cfg.techHelpProjects || ['TH', 'TechHelp']).map((p) => String(p).toUpperCase());
  const knowledge = (cfg.knowledgeProjects || ['SR']).map((p) => String(p).toUpperCase());
  const techPubs = (cfg.techPubsProjects || ['TECHPUBS']).map((p) => String(p).toUpperCase());
  const engAllow = (cfg.engFixProjects || []).map((p) => String(p).toUpperCase()).filter(Boolean);

  if (pk === onCall) return 'oncall';
  if (techHelp.includes(pk)) return 'techhelp';
  if (knowledge.includes(pk)) return 'knowledge';
  if (techPubs.includes(pk)) return 'techpubs';
  if (engAllow.length === 0) return 'eng_fix';
  if (engAllow.includes(pk)) return 'eng_fix';
  return 'other';
}

function mapLinkedIssues(issuelinks, cfg) {
  if (!Array.isArray(issuelinks)) return [];
  const out = [];
  const seen = new Set();
  for (const link of issuelinks) {
    const other = link?.inwardIssue || link?.outwardIssue;
    if (!other?.key || seen.has(other.key)) continue;
    seen.add(other.key);
    const relationship =
      (link.inwardIssue && (link?.type?.inward || link?.type?.name)) ||
      (link.outwardIssue && (link?.type?.outward || link?.type?.name)) ||
      'links';
    out.push({
      key: other.key,
      role: classifyLinkRole(other.key, cfg),
      relationship: String(relationship).toLowerCase(),
      status: extractStatus(other),
      summary: truncate(other.fields?.summary || '', 200),
      projectKey: projectKeyOf(other.key),
    });
  }
  return out;
}

/**
 * Fetch a richer narrative bundle for one key (fields + changelog + dwell + classified links).
 */
async function fetchTicketNarrativeBundle(key, jiraToken, cfg = {}) {
  if (!key || !jiraToken) return null;

  const cacheKey = `bundle:${key}:${jiraToken.slice(0, 8)}`;
  const cached = bundleCache.get(cacheKey);
  if (cached) return cached;

  try {
    const jira = await getJira(jiraToken);
    const response = await jira.get(`/rest/api/2/issue/${encodeURIComponent(key)}`, {
      timeout: 20000,
      params: {
        fields:
          'summary,description,comment,issuelinks,subtasks,status,priority,assignee,created,updated,resolutiondate,issuetype,parent,labels',
        expand: 'changelog',
      },
    });

    const fields = response.data?.fields || {};
    const statusName = extractStatus({ fields });
    const dwell = computeStatusDwell(response.data?.changelog, statusName);
    const linked = mapLinkedIssues(fields.issuelinks, cfg);
    const baseNarrative = {
      description: buildDescription(fields.description),
      comments: buildComments(fields.comment),
      blockers: buildBlockers(fields.issuelinks),
      outstandingSubtasks: buildOutstandingSubtasks(fields.subtasks),
    };

    const bundle = {
      key,
      summary: fields.summary || '',
      status: statusName,
      priority: fields.priority?.name || null,
      assignee: extractName(fields.assignee),
      issueType: fields.issuetype?.name || null,
      created: fields.created || null,
      updated: fields.updated || null,
      resolutiondate: fields.resolutiondate || null,
      labels: Array.isArray(fields.labels) ? fields.labels : [],
      parentKey: fields.parent?.key || null,
      ageDays: daysAgo(fields.created),
      ...baseNarrative,
      lastCommentAgeDays: baseNarrative.comments[0]?.ageDays ?? null,
      linked,
      techHelp: linked.filter((l) => l.role === 'techhelp'),
      techPubs: linked.filter((l) => l.role === 'techpubs'),
      knowledge: linked.filter((l) => l.role === 'knowledge'),
      // Remediaton path: eng code + TechPubs (not SR knowledge bytes)
      engFixes: linked.filter((l) => l.role === 'eng_fix' || l.role === 'techpubs'),
      dwell,
      role: classifyLinkRole(key, cfg),
    };

    bundleCache.set(cacheKey, bundle);
    return bundle;
  } catch (err) {
    logger.jira.warning(key, `Ticket narrative bundle failed: ${err.message}`, {
      httpStatus: err.response?.status,
    });
    return null;
  }
}

/**
 * Deterministic one-line stack summary (no LLM).
 */
function buildDeterministicStackBlurb(bundle) {
  if (!bundle) return '';
  const dwell = bundle.dwell?.currentDwellDays;
  const statusBit =
    dwell != null
      ? `${dwell}d in "${bundle.status}"`
      : `status "${bundle.status}"`;
  const th = bundle.techHelp || [];
  const eng = (bundle.engFixes || []).filter((e) => e.role === 'eng_fix');
  const pubs = bundle.techPubs || (bundle.engFixes || []).filter((e) => e.role === 'techpubs');
  const know = bundle.knowledge || [];
  const thBit =
    th.length === 0
      ? 'no TechHelp linked'
      : `TechHelp: ${th.map((t) => `${t.key}(${t.status})`).join(', ')}`;
  const engBit =
    eng.length === 0
      ? 'no eng fix linked'
      : `eng: ${eng.map((e) => `${e.key}(${e.status})`).join(', ')}`;
  const pubsBit =
    pubs.length === 0 ? null : `TechPubs: ${pubs.map((p) => `${p.key}(${p.status})`).join(', ')}`;
  const knowBit =
    know.length === 0 ? null : `knowledge/SR: ${know.map((k) => `${k.key}`).join(', ')}`;
  const rem =
    bundle.comments?.[0]?.body
      ? `last comment: ${truncate(stripWikiMarkup(bundle.comments[0].body), 120)}`
      : 'no recent remediation comment';
  return [`[${bundle.key}] ${statusBit}`, thBit, engBit, pubsBit, knowBit, rem]
    .filter(Boolean)
    .join('; ');
}

module.exports = {
  fetchTicketNarrative,
  fetchTicketNarrativeBundle,
  computeStatusDwell,
  classifyLinkRole,
  mapLinkedIssues,
  buildDeterministicStackBlurb,
  projectKeyOf,
  daysAgo,
  daysBetween,
};
