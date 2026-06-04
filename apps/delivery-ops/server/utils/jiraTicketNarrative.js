/**
 * JIRA Ticket Narrative Fetcher
 *
 * Pulls the *narrative* side of a JIRA issue — description, recent comments,
 * linked blockers, outstanding subtasks, recent status transitions — in a
 * single API call. Feeds the AI exec summary so it can reason about WHY
 * gates are slipping (from comments and links), not just THAT they are
 * (from structured signals).
 *
 * Why one call: GET /issue/{key}?fields=...&expand=changelog returns all
 * five sources we want. One round trip, cached 5 min per key.
 *
 * Why cache: regenerate / retry clicks are common; the underlying ticket
 * doesn't change in seconds. 5-min TTL mirrors the breakdown cache.
 */

const axios = require('axios');
const { JIRA_API_V2 } = require('../config/api');
const { jiraHeaders, createHttpsAgent, retryJiraCall } = require('../services/jiraService');
const { SimpleCache } = require('./simpleCache');
const logger = require('./logger');

const narrativeCache = new SimpleCache(5 * 60 * 1000); // 5 minutes

// Trimming constants. Tuned to keep the prompt under ~25KB while preserving
// the highest-signal slices of the ticket.
const DESCRIPTION_MAX_CHARS = 800;
const COMMENT_MAX_CHARS = 500;
const MAX_COMMENTS = 10;
const STALE_COMMENT_AGE_DAYS = 90; // drop ancient comments — usually irrelevant
const MAX_SUBTASKS = 10;
const MAX_STATUS_TRANSITIONS = 5;

// Only these link relationships matter for "what's blocking this feature".
// Capturing every link type would flood the prompt with cloners, related, etc.
const BLOCKER_RELATIONSHIPS = new Set([
  'is blocked by',
  'blocks',
  'depends on',
]);

// Compliance tickets are linked from any project key in this map, regardless
// of the link relationship name. They surface in their own narrative section
// so the AI can see whether security/legal/docs are actually filed and closed
// — independent of whether the parent ticket also carries a matching label.
const COMPLIANCE_PROJECT_KEYS = {
  SDL: 'security',      // Security Development Lifecycle
  LEG: 'legal',         // Legal / compliance
  TECHPUBS: 'docs',     // Documentation
};

// Status names that count as "outstanding" (not yet done). Mirror the
// categorisation used in taskBreakdownService.js so the AI sees the same world.
const DONE_STATUSES = new Set(['done', 'closed']);

// Statuses we consider "closed / signed off" when judging whether a compliance
// ticket has been completed. Mirrors the Done-family resolutions used elsewhere
// in the codebase (see velocity-resolution-categories rule).
const CLOSED_COMPLIANCE_STATUSES = new Set([
  'closed',
  'resolved',
  'done',
  'complete',
  'fixed',
]);

// ── Helpers ─────────────────────────────────────────────────────────────────

function daysAgo(isoDate) {
  if (!isoDate) return null;
  const d = new Date(isoDate);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

// Strip JIRA wiki markup that bloats prompt size without adding meaning:
// {color}, {panel}, {code}, *bold*, _italic_. Preserves the prose itself.
function stripWikiMarkup(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .replace(/\{[a-zA-Z]+(?::[^}]*)?\}/g, ' ')      // {color:red}, {panel}, etc.
    .replace(/\{[a-zA-Z]+\}/g, ' ')                  // closing tags
    .replace(/\*([^*\n]+)\*/g, '$1')                 // *bold*
    .replace(/_([^_\n]+)_/g, '$1')                   // _italic_
    .replace(/\r/g, '')
    .replace(/\n{3,}/g, '\n\n')                      // collapse blank runs
    .trim();
}

function truncate(text, max) {
  if (!text) return '';
  if (text.length <= max) return text;
  return text.slice(0, max).trim() + ' [...]';
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

// ── Field-level extractors ──────────────────────────────────────────────────

function buildDescription(rawDescription) {
  const stripped = stripWikiMarkup(rawDescription);
  return truncate(stripped, DESCRIPTION_MAX_CHARS);
}

function buildComments(commentObj) {
  const raw = commentObj?.comments;
  if (!Array.isArray(raw) || raw.length === 0) return [];

  // JIRA returns comments oldest-first. Reverse to surface the latest signal.
  const sortedDesc = [...raw].sort((a, b) => {
    const ad = new Date(a.created || a.updated || 0).getTime();
    const bd = new Date(b.created || b.updated || 0).getTime();
    return bd - ad;
  });

  const trimmed = [];
  for (const c of sortedDesc) {
    if (trimmed.length >= MAX_COMMENTS) break;
    const ageDays = daysAgo(c.created);
    if (ageDays != null && ageDays > STALE_COMMENT_AGE_DAYS) continue;
    trimmed.push({
      author: extractName(c.author),
      created: c.created || null,
      ageDays,
      body: truncate(stripWikiMarkup(c.body), COMMENT_MAX_CHARS),
    });
  }
  return trimmed;
}

function buildBlockers(issuelinks) {
  if (!Array.isArray(issuelinks)) return [];
  const out = [];
  for (const link of issuelinks) {
    const typeName = link?.type?.name || '';
    const inwardLabel = (link?.type?.inward || '').toLowerCase();
    const outwardLabel = (link?.type?.outward || '').toLowerCase();
    // A blocker link presents either as inwardIssue (the OTHER side blocks us)
    // or outwardIssue (we block the other side). Capture either if relationship matches.
    if (link.inwardIssue && BLOCKER_RELATIONSHIPS.has(inwardLabel)) {
      out.push({
        key: link.inwardIssue.key,
        relationship: inwardLabel,
        status: extractStatus(link.inwardIssue),
        summary: truncate(link.inwardIssue.fields?.summary || '', 200),
      });
    } else if (link.outwardIssue && BLOCKER_RELATIONSHIPS.has(outwardLabel)) {
      out.push({
        key: link.outwardIssue.key,
        relationship: outwardLabel,
        status: extractStatus(link.outwardIssue),
        summary: truncate(link.outwardIssue.fields?.summary || '', 200),
      });
    } else if (typeName.toLowerCase() === 'blocks') {
      // Some JIRA configs emit a 'Blocks' type without inward/outward strings.
      const other = link.inwardIssue || link.outwardIssue;
      if (other) {
        out.push({
          key: other.key,
          relationship: link.inwardIssue ? 'is blocked by' : 'blocks',
          status: extractStatus(other),
          summary: truncate(other.fields?.summary || '', 200),
        });
      }
    }
  }
  return out;
}

// Walk issuelinks and pull out anything in a compliance project (SDL, LEG,
// TECHPUBS) regardless of the link relationship name. These are the
// authoritative source for "has the security/legal/docs work been filed?" —
// labels on the parent ticket are only a hint and were causing false
// "unfiled" verdicts in the exec summary.
function buildComplianceTickets(issuelinks) {
  const out = { security: [], legal: [], docs: [] };
  if (!Array.isArray(issuelinks)) return out;

  for (const link of issuelinks) {
    const other = link?.inwardIssue || link?.outwardIssue;
    if (!other?.key) continue;

    const projectKey = String(other.key).split('-')[0];
    const bucket = COMPLIANCE_PROJECT_KEYS[projectKey];
    if (!bucket) continue;

    const statusName = extractStatus(other);
    const closed = CLOSED_COMPLIANCE_STATUSES.has((statusName || '').toLowerCase());

    out[bucket].push({
      key: other.key,
      status: statusName,
      closed,
      relationship: link?.type?.inward || link?.type?.outward || link?.type?.name || 'links to',
      summary: truncate(other.fields?.summary || '', 150),
    });
  }
  return out;
}

function buildOutstandingSubtasks(subtasks) {
  if (!Array.isArray(subtasks)) return [];
  const outstanding = subtasks.filter(st => {
    const status = (extractStatus(st) || '').toLowerCase();
    return !DONE_STATUSES.has(status);
  });

  // Sort by updated desc so the most active subtasks surface first.
  outstanding.sort((a, b) => {
    const au = new Date(a.fields?.updated || 0).getTime();
    const bu = new Date(b.fields?.updated || 0).getTime();
    return bu - au;
  });

  return outstanding.slice(0, MAX_SUBTASKS).map(st => ({
    key: st.key,
    status: extractStatus(st),
    summary: truncate(st.fields?.summary || '', 150),
  }));
}

// JIRA changelog histories contain mixed-field transitions. Pull only the
// status-field transitions to capture "did this ticket bounce status".
function buildStatusTransitions(changelog) {
  const histories = changelog?.histories;
  if (!Array.isArray(histories) || histories.length === 0) return [];

  const statusEvents = [];
  for (const h of histories) {
    if (!Array.isArray(h.items)) continue;
    for (const item of h.items) {
      if (item.field !== 'status') continue;
      statusEvents.push({
        from: item.fromString || 'unknown',
        to: item.toString || 'unknown',
        by: extractName(h.author),
        date: h.created || null,
        ageDays: daysAgo(h.created),
      });
    }
  }

  // Most recent first, capped.
  statusEvents.sort((a, b) => {
    const ad = new Date(a.date || 0).getTime();
    const bd = new Date(b.date || 0).getTime();
    return bd - ad;
  });
  return statusEvents.slice(0, MAX_STATUS_TRANSITIONS);
}

// ── Main: fetch + assemble ──────────────────────────────────────────────────

/**
 * Fetch the narrative side of a JIRA issue.
 *
 * @param {string} key  e.g. "FEAT-17029"
 * @param {string} jiraToken  Bearer token from the request
 * @returns {Promise<object|null>}  Narrative object, or null on failure.
 */
async function fetchTicketNarrative(key, jiraToken) {
  if (!key || !jiraToken) return null;

  // Cache key includes token-hash (first 8 chars) so different users can't
  // accidentally see each other's cached data if tokens differ.
  const cacheKey = `narrative:${key}:${jiraToken.slice(0, 8)}`;
  const cached = narrativeCache.get(cacheKey);
  if (cached) return cached;

  const httpsAgent = createHttpsAgent();

  // Single call: description, comments, links, subtasks + changelog.
  const url = `${JIRA_API_V2}/issue/${encodeURIComponent(key)}` +
    `?fields=description,comment,issuelinks,subtasks,status,summary` +
    `&expand=changelog`;

  try {
    const response = await retryJiraCall(() =>
      axios.get(url, {
        headers: jiraHeaders(jiraToken),
        httpsAgent,
        timeout: 15000,
      })
    );

    const fields = response.data?.fields || {};
    const narrative = {
      description: buildDescription(fields.description),
      comments: buildComments(fields.comment),
      blockers: buildBlockers(fields.issuelinks),
      compliance: buildComplianceTickets(fields.issuelinks),
      outstandingSubtasks: buildOutstandingSubtasks(fields.subtasks),
      recentStatusTransitions: buildStatusTransitions(response.data?.changelog),
    };
    narrative.lastCommentAgeDays = narrative.comments[0]?.ageDays ?? null;

    narrativeCache.set(cacheKey, narrative);
    return narrative;
  } catch (err) {
    // logger.warn doesn't exist at the top level — use logger.jira.warning,
    // which carries the JIRA key and serialises through the jira-fetch log.
    logger.jira.warning(key, `Ticket narrative fetch failed: ${err.message}`, {
      httpStatus: err.response?.status,
    });
    // Caller decides whether to fall back; we never throw out of this util
    // because narrative is supplementary — signals can still drive the summary.
    return null;
  }
}

module.exports = {
  fetchTicketNarrative,
  COMPLIANCE_PROJECT_KEYS,
  // Exposed for unit tests
  _internals: {
    buildDescription,
    buildComments,
    buildBlockers,
    buildComplianceTickets,
    buildOutstandingSubtasks,
    buildStatusTransitions,
    stripWikiMarkup,
    truncate,
  },
};
