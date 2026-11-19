/**
 * Release Outstanding Work — release-scoped Bug/Improvement deferral cockpit.
 * Dev DRI moves fixVersion; Team fills justification; QA DRI adds deferred label;
 * Must-fix (Dev DRI / QA DRI / QA) is a separate label-driven list with org chips.
 */
const fs = require('fs');
const path = require('path');
const { getJira } = require('../utils/jiraClient');
const {
  getTeamById,
  loadTeamBoardConfig,
  normalizeTeamId,
  loadKpiConfigSync,
  getKpisForTeam,
} = require('../utils/teamConfig');
const { getFieldId, getLabelPattern, getLabelJql } = require('../utils/jiraFieldsConfig');
const { extractTextFieldValue } = require('../utils/adfText');
const { getReleaseBaseFilter } = require('../utils/jiraRouteHelpers');
const { mapExtraTicketFields, withExtraTicketFields } = require('../utils/ticketRowFields');

const CONFIG_PATH = path.join(__dirname, '../config/releaseOutstandingWorkConfig.json');
const CC_CONFIG_PATH = path.join(__dirname, '../config/releaseVersionsCCConfig.json');
const RELEASE_EMAIL_CONFIG_PATH = path.join(
  __dirname,
  '../config/releaseVersionsEmailConfig.json'
);
const DEFERRAL_JUSTIFICATION_FIELD = getFieldId('deferralJustification') || 'customfield_42660';
const ASSIGNEE_MANAGER_FIELD = getFieldId('assigneeManager') || 'customfield_19262';
const QA_CONTACT_FIELD = getFieldId('qaContact') || 'customfield_10860';
const FIELDS = withExtraTicketFields([
  'summary',
  'status',
  'issuetype',
  'priority',
  'fixVersions',
  'versions',
  'labels',
  'assignee',
  ASSIGNEE_MANAGER_FIELD,
  QA_CONTACT_FIELD,
  'created',
  'updated',
  DEFERRAL_JUSTIFICATION_FIELD,
].join(','));

/** JIRA wiki mention handle for Data Center user objects. */
function mentionHandle(user) {
  if (!user || typeof user !== 'object') return '';
  return String(user.name || user.key || '').trim();
}

function userLabel(user) {
  if (!user || typeof user !== 'object') return '';
  return String(user.displayName || user.name || user.key || '').trim();
}

function wikiMention(user) {
  const handle = mentionHandle(user);
  return handle ? `[~${handle}]` : '';
}

function wikiMentionHandle(handle) {
  const h = identityKey(handle);
  return h ? `[~${h}]` : '';
}

/** Dev DRIs + QA DRIs + config commentAlwaysCc (default: namratha.singh). */
function workbenchCcHandles(release) {
  const cfg = loadConfig();
  const always = Array.isArray(cfg.commentAlwaysCc) && cfg.commentAlwaysCc.length
    ? cfg.commentAlwaysCc
    : ['namratha.singh'];
  const handles = [
    ...resolveDevDris(release),
    ...resolveQaDris(release),
    ...always.map(identityKey),
  ].filter(Boolean);
  return [...new Set(handles)];
}

/** Append `cc [~…]` for DRIs + always-CC not already mentioned in the body. */
function appendWorkbenchCc(body, release) {
  const text = String(body || '').trim();
  if (!text) return text;
  const missing = workbenchCcHandles(release).filter((h) => !text.includes(`[~${h}]`));
  if (!missing.length) return text;
  return `${text}\n\ncc ${missing.map(wikiMentionHandle).join(' ')}`;
}

/** Stable marker in chase comments so we can find the last nudge. */
const NUDGE_MARKER = '[deferral-nudge]';
const NUDGE_BODY_RE = /deferral justification is empty/i;
/** Must-fix status-update chase (not deferral justification). */
const STATUS_NUDGE_MARKER = '[mustfix-status-nudge]';
const DEFAULT_MUSTFIX_STALE_HOURS = 12;

function commentPlainBody(c) {
  const raw = c?.body;
  if (typeof raw === 'string') return raw;
  return extractTextFieldValue(raw) || '';
}

function isNudgeComment(c) {
  const body = commentPlainBody(c);
  if (!body) return false;
  return body.includes(NUDGE_MARKER) || NUDGE_BODY_RE.test(body);
}

function formatNudgeAge(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function truncateCommentBody(body, max = 320) {
  const t = String(body || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!t) return '';
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

/** Most recent comment on an issue (any author). */
function pickLastComment(comments) {
  if (!Array.isArray(comments) || !comments.length) return null;
  let best = null;
  for (const c of comments) {
    const created = c.created || c.updated;
    if (!created) continue;
    if (
      !best ||
      new Date(created) > new Date(best.created || best.updated || 0)
    ) {
      best = c;
    }
  }
  if (!best) return null;
  const created = best.created || best.updated;
  const body = truncateCommentBody(commentPlainBody(best));
  if (!body) return null;
  return {
    author: userLabel(best.author) || '—',
    body,
    created,
    age: formatNudgeAge(created),
  };
}

function pickLastNudgeAt(comments) {
  let lastAt = null;
  for (const c of comments || []) {
    if (!isNudgeComment(c)) continue;
    const created = c.created || c.updated;
    if (!created) continue;
    if (!lastAt || new Date(created) > new Date(lastAt)) lastAt = created;
  }
  return lastAt;
}

function isStatusNudgeComment(c) {
  const body = commentPlainBody(c);
  return Boolean(body && body.includes(STATUS_NUDGE_MARKER));
}

function pickLastStatusNudgeAt(comments) {
  let lastAt = null;
  for (const c of comments || []) {
    if (!isStatusNudgeComment(c)) continue;
    const created = c.created || c.updated;
    if (!created) continue;
    if (!lastAt || new Date(created) > new Date(lastAt)) lastAt = created;
  }
  return lastAt;
}

function hoursSince(iso) {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return Infinity;
  return (Date.now() - t) / 3600000;
}

/** Most recent of last comment / JIRA updated / created. */
function lastActivityIso(row) {
  const candidates = [row?.lastComment?.created, row?.updated, row?.created].filter(Boolean);
  if (!candidates.length) return null;
  return candidates.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
}

/**
 * Must-fix does not chase deferral justification — flag stale tickets for a
 * status-update comment when last activity is older than staleHours.
 */
function applyMustFixStatusFlags(row, staleHours = DEFAULT_MUSTFIX_STALE_HOURS) {
  const hours = Number(staleHours);
  const threshold = Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_MUSTFIX_STALE_HOURS;
  const lastAt = lastActivityIso(row);
  const ageH = lastAt ? hoursSince(lastAt) : Infinity;
  row.lastActivityAt = lastAt;
  row.lastActivityAge = lastAt ? formatNudgeAge(lastAt) : null;
  row.statusStaleHours = threshold;
  row.needsStatusUpdate = ageH >= threshold;
  row.canChaseStatusUpdate = Boolean(row.canChaseJustification);
  return row;
}

function cfdCfiPriorityRank(name, order = 99) {
  const s = String(name || '');
  const isNonTop = /\bnon[-_\s]*top\b/i.test(s);
  const isCfi = /cfi/i.test(s);
  const isCfd = /cfd/i.test(s);
  if (!isNonTop && isCfi) return 0;
  if (!isNonTop && isCfd) return 1;
  if (isNonTop && isCfi) return 2;
  if (isNonTop && isCfd) return 3;
  return 4 + (Number(order) || 0);
}

function resolveTeamCfdCfiKpis(teamId) {
  try {
    const kpiTeams = loadKpiConfigSync();
    const { kpis } = getKpisForTeam(kpiTeams, teamId);
    return [...(kpis || [])]
      .filter(
        (k) =>
          k && k.name && k.baseQuery && /CFD|CFI/i.test(k.name) && !/oncalls?/i.test(k.name)
      )
      .sort((a, b) => cfdCfiPriorityRank(a.name, a.order) - cfdCfiPriorityRank(b.name, b.order));
  } catch {
    return [];
  }
}

async function fetchMatchingKeySet(jira, keys, filterClause) {
  const matched = new Set();
  const chunkSize = 80;
  for (let i = 0; i < keys.length; i += chunkSize) {
    const chunk = keys.slice(i, i + chunkSize);
    const jql = `key in (${chunk.map(quote).join(', ')}) AND (${filterClause})`;
    try {
      const res = await jira.get('/rest/api/2/search', {
        params: {
          jql,
          fields: 'key',
          maxResults: chunk.length,
          startAt: 0,
        },
      });
      for (const iss of res?.data?.issues || []) {
        if (iss?.key) matched.add(iss.key);
      }
    } catch {
      // ignore failed chunk
    }
  }
  return matched;
}

/**
 * Tag rows with winning CFD/CFI KPI category (Top-CFI > Top-CFD > Non-Top-CFI > Non-Top-CFD).
 * Uses clubbed OR membership query from kpiConfig baseQueries first, then resolves winning KPI.
 */
async function enrichCfdCfiCategories(jira, teamId, rowLists) {
  const byKey = new Map();
  for (const rows of rowLists || []) {
    for (const row of rows || []) {
      if (!row?.key) continue;
      if (row.cfdCfiCategory === undefined) row.cfdCfiCategory = null;
      const list = byKey.get(row.key);
      if (list) list.push(row);
      else byKey.set(row.key, [row]);
    }
  }
  const allKeys = [...byKey.keys()];
  const kpis = resolveTeamCfdCfiKpis(teamId);
  if (!allKeys.length || !kpis.length) return rowLists;

  const clubbedJql = kpis.map((k) => k.baseQuery).join(' OR ');
  const candidateKeys = [...(await fetchMatchingKeySet(jira, allKeys, clubbedJql))];
  if (!candidateKeys.length) return rowLists;

  const perKpiSets = await Promise.all(
    kpis.map((k) => fetchMatchingKeySet(jira, candidateKeys, k.baseQuery))
  );
  for (const key of candidateKeys) {
    const winner = kpis.find((_, idx) => perKpiSets[idx].has(key));
    if (!winner) continue;
    for (const row of byKey.get(key) || []) {
      row.cfdCfiCategory = winner.name;
    }
  }
  return rowLists;
}

/**
 * Visible CFI/CFD strip counts for a release scope (clubbed + per KPI).
 * scopeJql = release universe (e.g. All-filter ∧ not Done).
 */
async function buildCfdCfiStrip(jira, teamId, scopeJql) {
  const kpis = resolveTeamCfdCfiKpis(teamId);
  const scope = String(scopeJql || '').trim();
  if (!kpis.length || !scope) {
    return { total: 0, jql: '', categories: [] };
  }
  const clubbedInner = kpis.map((k) => `(${k.baseQuery})`).join(' OR ');
  const clubJql = `(${scope}) AND (${clubbedInner})`;
  let total = 0;
  try {
    total = Number(await jira.searchCount(clubJql)) || 0;
  } catch {
    total = 0;
  }
  const categories = [];
  await Promise.all(
    kpis.map(async (k) => {
      const jql = `(${scope}) AND (${k.baseQuery})`;
      let count = 0;
      try {
        count = Number(await jira.searchCount(jql)) || 0;
      } catch {
        count = 0;
      }
      if (count <= 0) return;
      let sample = [];
      try {
        // FIELDS is already a comma-joined string — do not .join() again.
        const res = await jira.get('/rest/api/2/search', {
          params: {
            jql,
            fields: FIELDS,
            maxResults: 80,
            startAt: 0,
          },
        });
        sample = (res?.data?.issues || []).map((iss) => {
          const row = mapIssue(iss, null);
          row.cfdCfiCategory = k.name;
          return row;
        });
      } catch (e) {
        console.warn('[cfd-cfi-strip] sample failed:', k.name, e.message || e);
        sample = [];
      }
      categories.push({
        id: `cfdcfi:${k.name}`,
        name: k.name,
        count,
        jql,
        sample,
        truncated: count > sample.length,
      });
    })
  );
  categories.sort(
    (a, b) => cfdCfiPriorityRank(a.name) - cfdCfiPriorityRank(b.name) || b.count - a.count
  );
  return {
    total,
    jql: clubJql,
    label: 'CFI / CFD',
    categories,
  };
}

/**
 * Attach lastComment (all CommentBar queues) + lastNudge (missing justification)
 * + lastStatusNudge (must-fix). One comment fetch per key; capped + concurrency-limited.
 */
async function enrichIssueComments(jira, rowLists) {
  const byKey = new Map();
  for (const rows of rowLists) {
    for (const row of rows || []) {
      if (row?.key && !byKey.has(row.key)) byKey.set(row.key, row);
    }
  }
  const keys = [...byKey.keys()].slice(0, 80);
  const chunk = 8;
  for (let i = 0; i < keys.length; i += chunk) {
    const batch = keys.slice(i, i + chunk);
    await Promise.all(
      batch.map(async (key) => {
        try {
          const res = await jira.get(`/rest/api/2/issue/${encodeURIComponent(key)}/comment`);
          const comments = res?.data?.comments || res?.comments || [];
          const row = byKey.get(key);
          row.lastComment = pickLastComment(comments);
          if (row.missingJustification) {
            const lastAt = pickLastNudgeAt(comments);
            row.lastNudgeAt = lastAt;
            row.lastNudgeAge = lastAt ? formatNudgeAge(lastAt) : null;
          }
          const statusAt = pickLastStatusNudgeAt(comments);
          if (statusAt) {
            row.lastStatusNudgeAt = statusAt;
            row.lastStatusNudgeAge = formatNudgeAge(statusAt);
          }
        } catch {
          // leave unset
        }
      })
    );
  }
  return rowLists;
}

function versionNames(field) {
  return Array.isArray(field) ? field.map((v) => v?.name).filter(Boolean) : [];
}

/**
 * Open with "Hi [~assignee]," when an assignee exists; always cc Dev/QA DRIs
 * for the release plus commentAlwaysCc (namratha.singh).
 */
async function postIssueComment(jira, issueKey, comment, { assigneeUser = null, release = null } = {}) {
  const body = String(comment || '').trim();
  if (!body) return false;
  let assignee = assigneeUser;
  if (!assignee) {
    const issue = await jira.getIssue(issueKey, ['assignee']);
    assignee = issue.fields?.assignee || null;
  }
  const mention = wikiMention(assignee);
  let text = body;
  if (mention && !/^hi\s+\[~/i.test(body)) {
    text = `Hi ${mention},\n\n${body}`;
  }
  text = appendWorkbenchCc(text, release);
  await jira.addComment(issueKey, text);
  return true;
}

/**
 * JIRA Deferral Justification default / preset (field schema default).
 * Empty = deleted OR never answered beyond this scaffold.
 */
const JUSTIFICATION_PRESET_LINES = [
  'why is the bug being deferred',
  'impact to customers',
  'workaround available',
  'frequency of the issue intermittent or consistent',
];

/** Plain text from textarea / ADF deferral justification (keeps line breaks). */
function plainDeferralJustification(raw) {
  const extracted = extractTextFieldValue(raw);
  if (!extracted) return '';
  return String(extracted)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizeJustificationCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[*_#>`]+/g, ' ')
    .replace(/[?:;,./\\|()[\]{}'"]+/g, ' ')
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * True when deleted/empty OR only the JIRA default preset (no real answers added).
 */
function isMissingJustification(text) {
  const raw = String(text || '').trim();
  if (!raw) return true;
  let remainder = normalizeJustificationCompare(raw);
  for (const line of JUSTIFICATION_PRESET_LINES) {
    remainder = remainder.split(line).join(' ');
  }
  remainder = remainder.replace(/\s+/g, ' ').trim();
  return remainder.length < 3;
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function loadCcConfig() {
  try {
    return JSON.parse(fs.readFileSync(CC_CONFIG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

/** Main release setup — releaseGateDates[version].devDRIs / qaDRIs */
function loadReleaseGateEntry(release) {
  try {
    const raw = fs.readFileSync(RELEASE_EMAIL_CONFIG_PATH, 'utf8');
    const emailConfig = raw && raw.trim() ? JSON.parse(raw) : {};
    return emailConfig.releaseGateDates?.[release] || null;
  } catch {
    return null;
  }
}

/** Normalize email / username for DRI matching. */
function identityKey(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('@')) return s.split('@')[0];
  return s;
}

function authorKeys(author) {
  if (!author) return [];
  return [
    identityKey(author.name),
    identityKey(author.key),
    identityKey(author.emailAddress),
    identityKey(author.displayName),
  ].filter(Boolean);
}

/**
 * Dev DRIs: main Release Config (releaseGateDates.devDRIs),
 * else versionDRIs email CC list.
 */
function resolveDevDris(release) {
  const gate = loadReleaseGateEntry(release);
  if (Array.isArray(gate?.devDRIs) && gate.devDRIs.length) {
    return gate.devDRIs.map(identityKey).filter(Boolean);
  }
  const cc = loadCcConfig();
  const fromCc = cc.versionDRIs?.[release];
  if (Array.isArray(fromCc) && fromCc.length) {
    return fromCc.map(identityKey).filter(Boolean);
  }
  return [];
}

function resolveQaDris(release) {
  const gate = loadReleaseGateEntry(release);
  if (Array.isArray(gate?.qaDRIs) && gate.qaDRIs.length) {
    return gate.qaDRIs.map(identityKey).filter(Boolean);
  }
  return [];
}

function isDevDriAuthor(author, driKeys) {
  if (!driKeys.length) return null; // unknown — no list configured
  const keys = authorKeys(author);
  if (!keys.length) return false;
  return keys.some((k) => driKeys.includes(k));
}

/**
 * Find who last removed `release` from fixVersion (the kick / move off this release).
 */
function isFixVersionChangelogField(field) {
  // JIRA history uses "Fix Version" (space); never match "fixversion" alone.
  const n = String(field || '')
    .toLowerCase()
    .replace(/\s+/g, '');
  return n === 'fixversion' || n === 'fixversions';
}

function findFixVersionMoveOffAuthor(changelog, release) {
  const histories = changelog?.histories || [];
  for (let i = histories.length - 1; i >= 0; i -= 1) {
    const h = histories[i];
    for (const it of h.items || []) {
      if (!isFixVersionChangelogField(it.field)) continue;
      // JIRA often emits add/remove as separate items: from=NDB-2.12,to=null
      // (not a single from="…,NDB-2.12" → to="…,master" row).
      const from = String(it.fromString || '');
      const to = String(it.toString || '');
      const fromParts = from.split(/\s*,\s*/).filter(Boolean);
      const toParts = to.split(/\s*,\s*/).filter(Boolean);
      const had = fromParts.includes(release);
      const still = toParts.includes(release);
      if (had && !still) {
        return {
          author: h.author || null,
          when: h.created || null,
          fromVersions: from,
          toVersions: to,
        };
      }
    }
  }
  return null;
}

// ── Central labels taxonomy (jiraFieldsConfig.json → jiraFieldsConfig.js) ───────
// versionSlug / deferredLabel / mustFixLabel kept as thin wrappers for backwards
// compat (outstandingWorkbenchService etc.). Internally they delegate to
// getLabelPattern('lifecycle.deferred' / 'lifecycle.mustfix') so the taxonomy
// stays single-source-of-truth.

function parseLabelRelease(release) {
  const raw = String(release || '').trim();
  if (!raw) return { prefix: 'ndb', version: '' };
  const idx = raw.indexOf('-');
  if (idx > 0) {
    return { prefix: raw.slice(0, idx).toLowerCase(), version: raw.slice(idx + 1).toLowerCase() };
  }
  return { prefix: 'ndb', version: raw.toLowerCase() };
}

function versionSlug(release) {
  return String(release || '').toLowerCase();
}

// Thin wrappers — preserve signature (release) => label string
function deferredLabel(release) {
  const { prefix, version } = parseLabelRelease(release);
  return getLabelPattern('lifecycle.deferred', { prefix, version }) || `${versionSlug(release)}-deferred`;
}

function mustFixLabel(release) {
  const { prefix, version } = parseLabelRelease(release);
  return getLabelPattern('lifecycle.mustfix', { prefix, version }) || `${versionSlug(release)}-mustfix`;
}

// Shared helpers for variant-aware checks (JIRA labels are case-sensitive)
function deferredLabelVariants(release) {
  return [...new Set([deferredLabel(release), `${String(release || '').trim()}-deferred`])];
}
function mustFixLabelVariants(release) {
  return [...new Set([mustFixLabel(release), `${String(release || '').trim()}-mustfix`])];
}

function quote(v) {
  return `"${String(v).replace(/"/g, '\\"')}"`;
}

/** Release membership via `{version}-All` filter (not bare fixVersion was/=). */
function releaseAllClause(release) {
  const base = getReleaseBaseFilter(release) || `filter=${String(release || '').trim()}-All`;
  return `(${base})`;
}

/**
 * Empty labels do not match bare `labels not in (...)` on Nutanix JIRA.
 * Keep mustfix / deferred out of Move & Defer queues.
 * Uses central taxonomy for mf/def labels; empty handling mirrors
 * labels.porExclude JQL shape (labels is EMPTY OR ...) from jiraFieldsConfig.
 */
function openDeferralLabelsClause(release) {
  const mf = mustFixLabel(release);
  const def = deferredLabel(release);
  const demo = `${String(release || '').trim().toLowerCase()}-demo-site-test`;
  // getLabelJql('porExclude') demonstrates the EMPTY-or-not-in shape; we
  // keep explicit composition here to preserve exact prior JQL semantics.
  void getLabelJql; // reference to ensure taxonomy import is used
  return `(labels is EMPTY OR labels not in (${quote(mf)}, ${quote(def)}, ${quote(demo)}))`;
}

/**
 * Move: in release All filter · still on this fixVersion · Bug/Improvement · open.
 * Exclude mustfix / deferred.
 */
function candidatesJql(release) {
  return [
    releaseAllClause(release),
    `issuetype in (Bug, Improvement)`,
    `fixVersion = ${quote(release)}`,
    `statusCategory != Done`,
    openDeferralLabelsClause(release),
  ].join(' AND ');
}

/**
 * Justification / Defer pool: in release All filter · not currently on this fixVersion.
 * (Replaces `fixVersion was` — All includes Affected / payload membership.)
 */
function awaitingDeferralJql(release) {
  return [
    releaseAllClause(release),
    `issuetype in (Bug, Improvement)`,
    `fixVersion != ${quote(release)}`,
    `statusCategory != Done`,
    openDeferralLabelsClause(release),
  ].join(' AND ');
}

function mustFixJql(release) {
  // Actionable must-fix: labeled keep AND still on this fixVersion.
  // Must-fix + FV ≠ release is hygiene (outstanding workbench), not this queue.
  return [
    releaseAllClause(release),
    `labels = ${quote(mustFixLabel(release))}`,
    `fixVersion = ${quote(release)}`,
    `statusCategory != Done`,
  ].join(' AND ');
}

function priorityBand(priorityName) {
  const p = String(priorityName || '').toUpperCase().trim();
  if (/\bP0\b/.test(p) || p.startsWith('P0') || p.includes('BLOCKER')) return 'P0';
  if (/\bP1\b/.test(p) || p.startsWith('P1') || p.includes('CRITICAL')) return 'P1';
  if (/\bP2\b/.test(p) || p.startsWith('P2') || p.includes('MAJOR')) return 'P2';
  if (p.includes('MINOR') || p.includes('TRIVIAL') || /\bP[3-5]\b/.test(p)) return 'P3+';
  return 'P3+';
}

/**
 * Rulebook: P0/P1 → next immediate dot release; >P2 → next major.
 * Does not create versions — caller checks existence.
 */
function suggestTargetName(release) {
  const raw = String(release || '').trim();
  if (!raw) return null;
  const m = raw.match(/^([A-Za-z]+)-(.+)$/);
  const prefix = m ? `${m[1]}-` : '';
  const rest = m ? m[2] : raw;
  let base = rest;
  let suffix = null;
  if (rest.includes('-')) {
    const idx = rest.indexOf('-');
    const maybe = rest.slice(idx + 1);
    if (/^(EA|RC\d*|BETA|ALPHA|SNAPSHOT)$/i.test(maybe)) {
      base = rest.slice(0, idx);
      suffix = maybe;
    }
  }
  const parts = base.split('.').map((n) => Number(n));
  if (parts.some((n) => !Number.isInteger(n))) return null;
  return { prefix, parts, suffix };
}

function nextDotName(release) {
  const parsed = suggestTargetName(release);
  if (!parsed) return null;
  const { prefix, parts } = parsed;
  const next = [...parts];
  next[next.length - 1] = (next[next.length - 1] || 0) + 1;
  // If major/minor (2 parts), next "dot" release is maintenance: X.Y.1
  if (parts.length === 2) {
    return `${prefix}${parts[0]}.${parts[1]}.1`;
  }
  return `${prefix}${next.join('.')}`;
}

function nextMajorName(release) {
  const parsed = suggestTargetName(release);
  if (!parsed) return null;
  const { prefix, parts } = parsed;
  if (parts.length < 2) return null;
  return `${prefix}${parts[0]}.${parts[1] + 1}`;
}

function versionTuple(name) {
  const parsed = suggestTargetName(name);
  if (!parsed?.parts?.length) return null;
  return parsed.parts;
}

function cmpTuples(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const x = a[i] || 0;
    const y = b[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

function versionNamesList(versions) {
  return (versions || [])
    .map((v) => (typeof v === 'string' ? v : v?.name))
    .filter(Boolean);
}

function versionExists(versions, name) {
  if (!name) return false;
  return mergeVersionUniverse(versions).includes(name);
}

/** Release names from Release Config (releaseGateDates) — fill gaps if JIRA list is thin. */
function configuredReleaseNames() {
  try {
    const raw = fs.readFileSync(RELEASE_EMAIL_CONFIG_PATH, 'utf8');
    const emailConfig = raw && raw.trim() ? JSON.parse(raw) : {};
    return Object.keys(emailConfig.releaseGateDates || {});
  } catch {
    return [];
  }
}

function mergeVersionUniverse(versions) {
  const names = new Set([
    ...versionNamesList(versions),
    ...configuredReleaseNames(),
  ]);
  return [...names];
}

/**
 * Next major/minor that exists after this release's base
 * (e.g. NDB-2.12 → NDB-3.0). Never invents a name that is not in the universe.
 */
function nextExistingMajor(release, versions) {
  const cur = versionTuple(release);
  if (!cur || cur.length < 2) return null;
  const universe = mergeVersionUniverse(versions);
  const majors = universe
    .map((name) => {
      const parsed = suggestTargetName(name);
      return { name, t: parsed?.parts, suffix: parsed?.suffix || null };
    })
    // Major/minor only (one dot), no EA/RC suffix — prefer GA line like NDB-3.0
    .filter(
      (x) =>
        x.t &&
        x.t.length === 2 &&
        !x.suffix &&
        cmpTuples(x.t, cur.slice(0, 2)) > 0
    )
    .sort((a, b) => cmpTuples(a.t, b.t));
  return majors[0]?.name || null;
}

function nextExistingDot(release, versions) {
  const universe = mergeVersionUniverse(versions);
  const synthetic = nextDotName(release);
  if (synthetic && universe.includes(synthetic)) return synthetic;
  const cur = versionTuple(release);
  if (!cur) return null;
  const candidates = universe
    .map((name) => ({ name, t: versionTuple(name) }))
    .filter((x) => x.t && cmpTuples(x.t, cur) > 0)
    .filter((x) => {
      if (cur.length === 2) return x.t[0] === cur[0] && x.t[1] === cur[1] && x.t.length > 2;
      return x.t[0] === cur[0] && x.t[1] === cur[1];
    })
    .sort((a, b) => cmpTuples(a.t, b.t));
  return candidates[0]?.name || null;
}

function rulebookTarget(release, priorityName, versions = []) {
  const band = priorityBand(priorityName);
  if (band === 'P0' || band === 'P1') {
    const target = nextExistingDot(release, versions);
    return {
      band,
      reason: 'P0/P1 (Critical) → next immediate dot release',
      target,
    };
  }
  const target = nextExistingMajor(release, versions);
  return {
    band,
    reason: '>P2 (Major+) → next major/minor that exists (not invented)',
    target,
  };
}

function mapIssue(issue, release) {
  const f = issue.fields || {};
  const fixVersions = versionNames(f.fixVersions);
  const affectedVersions = versionNames(f.versions);
  const justification = plainDeferralJustification(f[DEFERRAL_JUSTIFICATION_FIELD]);
  const missingJustification = isMissingJustification(justification);
  const manager = f[ASSIGNEE_MANAGER_FIELD] || null;
  const qaContact = f[QA_CONTACT_FIELD] || null;
  const labels = Array.isArray(f.labels) ? f.labels : [];
  const mfVariants = release
    ? [...new Set([mustFixLabel(release), `${String(release).trim()}-mustfix`])]
    : [];
  const defVariants = release
    ? [...new Set([deferredLabel(release), `${String(release).trim()}-deferred`])]
    : [];
  return {
    key: issue.key,
    summary: f.summary || '',
    status: f.status?.name || '',
    issueType: f.issuetype?.name || '',
    priority: f.priority?.name || '',
    fixVersions,
    affectedVersions,
    labels,
    isMustFix: mfVariants.some((l) => labels.includes(l)),
    isDeferred: defVariants.some((l) => labels.includes(l)),
    cfdCfiCategory: null,
    assignee: userLabel(f.assignee),
    assigneeManager: userLabel(manager),
    qaContact: userLabel(qaContact),
    missingJustification,
    canChaseJustification: Boolean(mentionHandle(f.assignee) || mentionHandle(manager)),
    ...mapExtraTicketFields(f),
    createdAge: f.created ? formatNudgeAge(f.created) : null,
    updated: f.updated || null,
    deferralJustification: justification,
  };
}

function classifyMustFixOrg(author, cfg) {
  if (!author) return { org: 'Other', author: '' };
  const name = String(author.name || author.key || '').toLowerCase();
  const display = String(author.displayName || author.name || author.key || '');
  const email = String(author.emailAddress || '').toLowerCase();
  const hay = `${name} ${display} ${email}`.toLowerCase();

  const map = cfg.mustFixOrgMap || {};
  for (const org of ['QA', 'Serv', 'PM']) {
    const list = map[org] || [];
    if (list.some((u) => hay.includes(String(u).toLowerCase()))) {
      return { org, author: display || name };
    }
  }
  const hints = cfg.mustFixOrgHints || {};
  for (const org of ['QA', 'Serv', 'PM']) {
    const words = hints[org] || [];
    if (words.some((w) => new RegExp(`\\b${String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(hay))) {
      return { org, author: display || name };
    }
  }
  return { org: 'Other', author: display || name };
}

function findMustFixLabelAuthor(changelog, label) {
  const histories = changelog?.histories || [];
  for (let i = histories.length - 1; i >= 0; i -= 1) {
    const h = histories[i];
    const items = h.items || [];
    for (const it of items) {
      if (String(it.field || '').toLowerCase() !== 'labels') continue;
      const to = String(it.toString || '');
      const from = String(it.fromString || '');
      if (to.split(/\s+/).includes(label) && !from.split(/\s+/).includes(label)) {
        return h.author || null;
      }
    }
  }
  return null;
}

async function listProjectVersions(jira, projectKey) {
  if (!projectKey) return [];
  const res = await jira.get(`/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`);
  const list = Array.isArray(res.data) ? res.data : [];
  return list
    .filter((v) => v && !v.archived)
    .map((v) => ({ name: v.name, released: !!v.released, releaseDate: v.releaseDate || null }));
}

function resolveTeam(teamId) {
  const board = loadTeamBoardConfig();
  const requested = normalizeTeamId(teamId) || normalizeTeamId(board.defaultTeamId) || 'ndb';
  const team = getTeamById(requested) || getTeamById(board.defaultTeamId);
  if (!team || !team.projectKey) {
    const err = new Error(`Unknown team '${requested}' — no projectKey in teamBoardConfig`);
    err.statusCode = 400;
    throw err;
  }
  return {
    teamId: team.id || requested,
    projectKey: team.projectKey,
    jiraBaseUrl: process.env.JIRA_BASE_URL || 'https://jira.nutanix.com',
  };
}

async function enrichMustFixAuthors(jira, issues, release, cfg) {
  const label = mustFixLabel(release);
  const out = [];
  // Cap changelog fetches for responsiveness
  const cap = Math.min(issues.length, 80);
  for (let i = 0; i < cap; i += 1) {
    const row = mapIssue(issues[i], release);
    let org = 'Other';
    let author = '';
    try {
      const full = await jira.getIssue(row.key, { fields: ['labels'], expand: 'changelog' });
      const who = findMustFixLabelAuthor(full.changelog, label);
      const classified = classifyMustFixOrg(who, cfg);
      org = classified.org;
      author = classified.author;
    } catch {
      // leave Other
    }
    out.push({ ...row, mustFixOrg: org, mustFixAuthor: author });
  }
  for (let i = cap; i < issues.length; i += 1) {
    out.push({ ...mapIssue(issues[i], release), mustFixOrg: 'Other', mustFixAuthor: '' });
  }
  return out;
}

/**
 * For awaiting-deferral rows: who moved fixVersion off this release,
 * and whether they are a configured Dev DRI. Never blocks Defer.
 */
async function enrichAwaitingMovers(jira, issues, release, driKeys) {
  const out = [];
  const cap = Math.min(issues.length, 80);
  for (let i = 0; i < cap; i += 1) {
    const row = mapIssue(issues[i], release);
    let movedBy = '';
    let movedAt = null;
    let movedByDevDri = null; // null = no DRI list / unknown
    try {
      const full = await jira.getIssue(row.key, {
        fields: ['fixVersions'],
        expand: 'changelog',
      });
      const move = findFixVersionMoveOffAuthor(full.changelog, release);
      if (move?.author) {
        movedBy =
          move.author.displayName || move.author.name || move.author.key || '';
        movedAt = move.when;
        movedByDevDri = isDevDriAuthor(move.author, driKeys);
      }
    } catch {
      // leave unknown
    }
    out.push({
      ...row,
      movedBy,
      movedAt,
      movedByDevDri,
      highlightNonDriMove: movedByDevDri === false,
    });
  }
  for (let i = cap; i < issues.length; i += 1) {
    out.push({
      ...mapIssue(issues[i], release),
      movedBy: '',
      movedAt: null,
      movedByDevDri: null,
      highlightNonDriMove: false,
    });
  }
  return out;
}

async function getWorkbench({ token, teamId, release }) {
  if (!release) {
    const err = new Error('release is required');
    err.statusCode = 400;
    throw err;
  }
  const cfg = loadConfig();
  const { projectKey, jiraBaseUrl, teamId: tid } = resolveTeam(teamId);
  const jira = await getJira(token);

  const candJql = candidatesJql(release);
  const awaitJql = awaitingDeferralJql(release);
  const mfJql = mustFixJql(release);

  const [versions, candidatesRaw, awaitingRaw, mustFixRaw] = await Promise.all([
    listProjectVersions(jira, projectKey),
    jira.searchAll(candJql, FIELDS, { pageSize: 100, maxIssues: 500 }),
    jira.searchAll(awaitJql, FIELDS, { pageSize: 100, maxIssues: 500 }),
    jira.searchAll(mfJql, FIELDS, { pageSize: 100, maxIssues: 500 }),
  ]);

  const onReleaseRows = (candidatesRaw || []).map((iss) => {
    const row = mapIssue(iss, release);
    const rb = rulebookTarget(release, row.priority, versions);
    const exists = versionExists(versions, rb.target);
    return {
      ...row,
      rulebook: rb,
      targetExists: exists,
      canMove: Boolean(rb.target && exists),
      justificationQueueScope: 'onRelease',
    };
  });

  const driKeys = resolveDevDris(release);
  const qaDriKeys = resolveQaDris(release);
  const [leftReleaseRows, mustFix] = await Promise.all([
    enrichAwaitingMovers(jira, awaitingRaw || [], release, driKeys),
    enrichMustFixAuthors(jira, mustFixRaw || [], release, cfg),
  ]);
  const leftWithScope = (leftReleaseRows || []).map((r) => ({
    ...r,
    justificationQueueScope: 'leftRelease',
  }));

  // Justification is for the deferral handoff only: left release + still need deferred
  // label, but empty/default justification. On-release tickets stay on Move even if
  // justification is empty (most open bugs never fill that field).
  // Guard: never treat a row as "left" if current fixVersions still include this release
  // (avoids Was-on == Now-on nonsense if JQL/history drifts).
  const candidates = onReleaseRows;
  const onReleaseKeys = new Set(onReleaseRows.map((r) => r.key));
  const needsJustification = [];
  const awaitingDeferral = [];
  for (const r of leftWithScope) {
    const stillOnRelease =
      onReleaseKeys.has(r.key) ||
      (r.fixVersions || []).includes(release);
    if (stillOnRelease) continue;
    if (r.missingJustification) {
      needsJustification.push(r);
    } else {
      awaitingDeferral.push(r);
    }
  }

  // Comment preview + CFD/CFI category for Justify / Move / Defer / Must-fix.
  const queueLists = [needsJustification, candidates, awaitingDeferral, mustFix];
  const cfdCfiScope = `${releaseAllClause(release)} AND statusCategory != Done`;
  const [, , cfdCfi] = await Promise.all([
    enrichIssueComments(jira, queueLists),
    enrichCfdCfiCategories(jira, tid, queueLists),
    buildCfdCfiStrip(jira, tid, cfdCfiScope),
  ]);

  const staleHours = cfg.mustFixStatusStaleHours ?? DEFAULT_MUSTFIX_STALE_HOURS;
  const orgCounts = { QA: 0, Serv: 0, PM: 0, Other: 0 };
  mustFix.forEach((t) => {
    applyMustFixStatusFlags(t, staleHours);
    // Must-fix path never chases deferral justification — clear handoff flags.
    t.missingJustification = false;
    t.canChaseJustification = false;
    orgCounts[t.mustFixOrg] = (orgCounts[t.mustFixOrg] || 0) + 1;
  });

  const nonDriMoveCount = awaitingDeferral.filter((r) => r.highlightNonDriMove).length;

  // Justification proof = same All≠FV pool as Defer. JIRA cannot express "still the
  // default Deferral Justification preset" (cf[42660] is never EMPTY). In-app list is
  // the unanswered/default subset of that pool.
  const needsJustificationJql = awaitJql;

  return {
    teamId: tid,
    projectKey,
    release,
    jiraBaseUrl,
    labels: {
      deferred: deferredLabel(release),
      mustFix: mustFixLabel(release),
    },
    jql: {
      needsJustification: needsJustificationJql,
      candidates: candJql,
      awaitingDeferral: awaitJql,
      mustFix: mfJql,
    },
    devDRIs: driKeys,
    qaDRIs: qaDriKeys,
    versions,
    needsJustification,
    candidates,
    awaitingDeferral,
    mustFix,
    orgCounts,
    nonDriMoveCount,
    cfdCfi: cfdCfi || { total: 0, jql: '', categories: [] },
  };
}

async function maybeComment(jira, issueKey, comment, { assigneeUser = null, release = null } = {}) {
  return postIssueComment(jira, issueKey, comment, { assigneeUser, release });
}

async function postComment({ token, release, issueKey, comment }) {
  const body = String(comment || '').trim();
  if (!issueKey) {
    const err = new Error('issueKey is required');
    err.statusCode = 400;
    throw err;
  }
  if (!body) {
    const err = new Error('comment is required');
    err.statusCode = 400;
    throw err;
  }
  const jira = await getJira(token);
  await postIssueComment(jira, issueKey, body, { release });
  const nowIso = new Date().toISOString();
  return {
    key: issueKey,
    commented: true,
    lastComment: {
      author: 'You',
      body: truncateCommentBody(body),
      created: nowIso,
      age: formatNudgeAge(nowIso),
    },
  };
}

/**
 * Ping assignee + Assignee Manager when Deferral Justification is empty.
 * Opens with "Hi [~assignee],"; always cc manager, Dev/QA DRIs, and commentAlwaysCc.
 */
async function chaseMissingJustification({ token, release, issueKey }) {
  if (!issueKey) {
    const err = new Error('issueKey is required');
    err.statusCode = 400;
    throw err;
  }
  const jira = await getJira(token);
  const issue = await jira.getIssue(issueKey, [
    'assignee',
    ASSIGNEE_MANAGER_FIELD,
    DEFERRAL_JUSTIFICATION_FIELD,
  ]);
  const f = issue.fields || {};
  const justification = plainDeferralJustification(f[DEFERRAL_JUSTIFICATION_FIELD]);
  if (!isMissingJustification(justification)) {
    const err = new Error('Deferral Justification is already filled');
    err.statusCode = 409;
    err.code = 'JUSTIFICATION_PRESENT';
    throw err;
  }
  const assignee = f.assignee || null;
  const manager = f[ASSIGNEE_MANAGER_FIELD] || null;
  if (!mentionHandle(assignee) && !mentionHandle(manager)) {
    const err = new Error('No assignee or Assignee Manager to tag');
    err.statusCode = 400;
    err.code = 'NO_MENTION_TARGETS';
    throw err;
  }
  const releaseBit = release ? ` for ${release}` : '';
  const managerBit = wikiMention(manager) ? ` cc ${wikiMention(manager)}` : '';
  const nowIso = new Date().toISOString();
  const body = [
    `Deferral Justification is empty${releaseBit}.${managerBit}`,
    'Please fill in why this Bug/Improvement is being deferred (or confirm it should stay).',
    NUDGE_MARKER,
  ].join(' ');
  await postIssueComment(jira, issueKey, body, { assigneeUser: assignee, release });
  return {
    key: issueKey,
    commented: true,
    lastNudgeAt: nowIso,
    lastNudgeAge: formatNudgeAge(nowIso),
    tagged: {
      assignee: userLabel(assignee) || null,
      assigneeManager: userLabel(manager) || null,
      cc: workbenchCcHandles(release),
    },
  };
}

/**
 * Must-fix: ask assignee for a status-update comment when activity is stale (≥12h).
 * Does not touch Deferral Justification.
 */
async function chaseMustFixStatusUpdate({ token, release, issueKey }) {
  if (!issueKey) {
    const err = new Error('issueKey is required');
    err.statusCode = 400;
    throw err;
  }
  if (!release) {
    const err = new Error('release is required');
    err.statusCode = 400;
    throw err;
  }
  const cfg = loadConfig();
  const staleHours = cfg.mustFixStatusStaleHours ?? DEFAULT_MUSTFIX_STALE_HOURS;
  const jira = await getJira(token);
  const issue = await jira.getIssue(issueKey, [
    'assignee',
    ASSIGNEE_MANAGER_FIELD,
    'labels',
    'updated',
    'created',
  ]);
  const f = issue.fields || {};
  const labels = Array.isArray(f.labels) ? f.labels : [];
  const mf = mustFixLabel(release);
  if (!labels.includes(mf)) {
    const err = new Error(`Issue is not labeled ${mf}`);
    err.statusCode = 409;
    err.code = 'NOT_MUSTFIX';
    throw err;
  }
  const assignee = f.assignee || null;
  const manager = f[ASSIGNEE_MANAGER_FIELD] || null;
  if (!mentionHandle(assignee) && !mentionHandle(manager)) {
    const err = new Error('No assignee or Assignee Manager to tag');
    err.statusCode = 400;
    err.code = 'NO_MENTION_TARGETS';
    throw err;
  }

  let lastComment = null;
  try {
    const res = await jira.get(`/rest/api/2/issue/${encodeURIComponent(issueKey)}/comment`);
    const comments = res?.data?.comments || res?.comments || [];
    lastComment = pickLastComment(comments);
  } catch {
    // fall through with updated/created only
  }
  const probe = {
    lastComment,
    updated: f.updated || null,
    created: f.created || null,
  };
  applyMustFixStatusFlags(probe, staleHours);
  if (!probe.needsStatusUpdate) {
    const err = new Error(
      `Ticket was updated ${probe.lastActivityAge || 'recently'} — status chase only after ${staleHours}h of silence`
    );
    err.statusCode = 409;
    err.code = 'NOT_STALE';
    throw err;
  }

  const managerBit = wikiMention(manager) ? ` cc ${wikiMention(manager)}` : '';
  const nowIso = new Date().toISOString();
  const body = [
    `This is a must-fix for ${release} with no update in ${staleHours}+ hours.${managerBit}`,
    'Please post a status update (progress / blocker / ETA).',
    STATUS_NUDGE_MARKER,
  ].join(' ');
  await postIssueComment(jira, issueKey, body, { assigneeUser: assignee, release });
  return {
    key: issueKey,
    commented: true,
    lastStatusNudgeAt: nowIso,
    lastStatusNudgeAge: formatNudgeAge(nowIso),
    lastActivityAt: nowIso,
    lastActivityAge: formatNudgeAge(nowIso),
    needsStatusUpdate: false,
    tagged: {
      assignee: userLabel(assignee) || null,
      assigneeManager: userLabel(manager) || null,
      cc: workbenchCcHandles(release),
    },
  };
}

async function moveFixVersion({ token, teamId, release, issueKey, comment }) {
  if (!issueKey || !release) {
    const err = new Error('issueKey and release are required');
    err.statusCode = 400;
    throw err;
  }
  const { projectKey } = resolveTeam(teamId);
  const jira = await getJira(token);
  const issue = await jira.getIssue(issueKey, [
    'priority',
    'fixVersions',
    'labels',
    'issuetype',
    'assignee',
  ]);
  const priority = issue.fields?.priority?.name || '';
  const versions = await listProjectVersions(jira, projectKey);
  const rb = rulebookTarget(release, priority, versions);
  if (!rb.target) {
    const err = new Error('Could not compute rulebook target');
    err.statusCode = 400;
    throw err;
  }
  if (!versionExists(versions, rb.target)) {
    const err = new Error(
      `Target ${rb.target} is not created in JIRA yet. Create the version, then retry Move.`
    );
    err.statusCode = 409;
    err.code = 'TARGET_VERSION_MISSING';
    err.target = rb.target;
    throw err;
  }
  await jira.updateIssue(issueKey, { fixVersions: [{ name: rb.target }] });
  const commented = await maybeComment(jira, issueKey, comment, {
    assigneeUser: issue.fields?.assignee,
    release,
  });
  return { key: issueKey, from: release, to: rb.target, rulebook: rb, commented };
}

async function addLabel({ token, release, issueKey, label, comment, removeLabels = [] }) {
  if (!issueKey || !label) {
    const err = new Error('issueKey and label are required');
    err.statusCode = 400;
    throw err;
  }
  const jira = await getJira(token);
  const issue = await jira.getIssue(issueKey, ['labels', 'assignee']);
  const drop = new Set((removeLabels || []).filter(Boolean));
  let labels = Array.isArray(issue.fields?.labels) ? [...issue.fields.labels] : [];
  if (drop.size) labels = labels.filter((l) => !drop.has(l));
  if (!labels.includes(label)) labels.push(label);
  await jira.updateIssue(issueKey, { labels });
  const commented = await maybeComment(jira, issueKey, comment, {
    assigneeUser: issue.fields?.assignee,
    release,
  });
  return {
    key: issueKey,
    labels,
    removedLabels: [...drop].filter((l) =>
      Array.isArray(issue.fields?.labels) ? issue.fields.labels.includes(l) : false
    ),
    commented,
  };
}

async function addDeferralLabel({ token, release, issueKey, comment }) {
  return addLabel({ token, release, issueKey, label: deferredLabel(release), comment });
}

/**
 * Add `{release}-mustfix` and drop only that release's deferred label
 * (e.g. ndb-2.12-mustfix clears ndb-2.12-deferred, not ndb-2.10-deferred).
 */
async function addMustFixLabel({ token, release, issueKey, comment }) {
  return addLabel({
    token,
    release,
    issueKey,
    label: mustFixLabel(release),
    comment,
    removeLabels: [deferredLabel(release)],
  });
}

module.exports = {
  getWorkbench,
  moveFixVersion,
  addDeferralLabel,
  addMustFixLabel,
  postComment,
  chaseMissingJustification,
  chaseMustFixStatusUpdate,
  candidatesJql,
  awaitingDeferralJql,
  mustFixJql,
  rulebookTarget,
  nextDotName,
  nextMajorName,
  nextExistingMajor,
  nextExistingDot,
  deferredLabel,
  mustFixLabel,
  deferredLabelVariants,
  mustFixLabelVariants,
  versionSlug, // backwards compat
  enrichCfdCfiCategories,
  buildCfdCfiStrip,
};
