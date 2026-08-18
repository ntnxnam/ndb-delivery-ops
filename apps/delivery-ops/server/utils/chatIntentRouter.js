const { chatCompletion } = require('../services/naiService');

const RELEASE_TOKEN_RE = /\b([A-Z][A-Z0-9]*-\d+(?:\.\d+){1,3}(?:-[A-Z]+\d*)?)\b/gi;
// Avoid matching release prefixes like "XYZ-2.11" as ticket keys (it would
// otherwise match "XYZ-2"). Ticket keys must not continue as a dotted version.
const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]*-\d+)\b(?!\.\d)/g;
const SPRINT_RE = /\bS(\d{1,4})\b/gi;
const COMPARE_RE = /\b(compare|vs\.?|versus|between|difference|differ|side[- ]by[- ]side)\b/i;
const TEAM_HINT_RE = /\b(team|component|owner|owned by)\b/i;

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function resolveReleaseMentions(message, availableReleases) {
  const lowerToCanonical = new Map(
    (availableReleases || []).map((r) => [String(r).toLowerCase(), String(r)])
  );
  const hits = [];
  let match;
  while ((match = RELEASE_TOKEN_RE.exec(message || '')) !== null) {
    const raw = match[1];
    const canonical = lowerToCanonical.get(raw.toLowerCase()) || raw.toUpperCase();
    hits.push(canonical);
  }
  return unique(hits).slice(0, 4);
}

function resolveTicketKeys(message) {
  const keys = [];
  let match;
  while ((match = TICKET_KEY_RE.exec(message || '')) !== null) {
    keys.push(match[1].toUpperCase());
  }
  return unique(keys).slice(0, 8);
}

function resolveSprints(message) {
  const sprintNames = [];
  let match;
  while ((match = SPRINT_RE.exec(message || '')) !== null) {
    sprintNames.push(`S${match[1]}`);
  }
  return unique(sprintNames).slice(0, 6);
}

function resolveTeams(message, knownTeams) {
  const text = String(message || '').toLowerCase();
  return (knownTeams || [])
    .filter((name) => text.includes(String(name).toLowerCase()))
    .slice(0, 4);
}

function resolveIntent({ releases, ticketKeys, teams, sprints, message }) {
  if (ticketKeys.length > 0) return 'ticket_drilldown';
  if (releases.length >= 2 && COMPARE_RE.test(message || '')) return 'compare_releases';
  if (teams.length > 0 || TEAM_HINT_RE.test(message || '')) return 'team_focus';
  if (sprints.length > 0 || /\btrend|velocity|last\s+\d+\s+week|past\s+\d+\s+week\b/i.test(message || '')) {
    return 'trend';
  }
  if (releases.length > 0) return 'single_release';
  return 'unknown';
}

function coerceJson(text) {
  if (typeof text !== 'string') return null;
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch (_e) {
    return null;
  }
}

async function llmFallbackScope({ message, availableReleases, defaultRelease, knownTeams }) {
  const messages = [
    {
      role: 'system',
      content: [
        'You extract chat scope as strict JSON.',
        'Return only JSON with keys: releases, teams, intent.',
        'intent must be one of: compare_releases, single_release, ticket_drilldown, team_focus, trend, unknown.',
        'Do not invent releases; use only values from AVAILABLE_RELEASES.',
      ].join(' '),
    },
    {
      role: 'user',
      content: JSON.stringify(
        {
          message,
          defaultRelease,
          availableReleases: availableReleases || [],
          knownTeams: knownTeams || [],
        },
        null,
        2
      ),
    },
  ];

  const text = await chatCompletion(messages, { temperature: 0, maxTokens: 250 });
  const parsed = coerceJson(text);
  if (!parsed) return null;

  const releaseSet = new Set((availableReleases || []).map((r) => String(r).toLowerCase()));
  const releases = unique(
    (Array.isArray(parsed.releases) ? parsed.releases : [])
      .map((r) => String(r))
      .filter((r) => releaseSet.has(r.toLowerCase()))
  ).slice(0, 4);

  const teams = unique(
    (Array.isArray(parsed.teams) ? parsed.teams : []).map((t) => String(t))
  ).slice(0, 4);

  const intent = [
    'compare_releases',
    'single_release',
    'ticket_drilldown',
    'team_focus',
    'trend',
    'unknown',
  ].includes(parsed.intent)
    ? parsed.intent
    : 'unknown';

  return { releases, teams, intent };
}

async function extractScope({
  message,
  availableReleases = [],
  knownTeams = [],
  defaultRelease = null,
}) {
  const releases = resolveReleaseMentions(message, availableReleases);
  const ticketKeys = resolveTicketKeys(message);
  const sprints = resolveSprints(message);
  const teams = resolveTeams(message, knownTeams);

  let intent = resolveIntent({ releases, ticketKeys, teams, sprints, message });
  let assumedFocus = false;
  let finalReleases = releases;
  let finalTeams = teams;

  if (finalReleases.length === 0 && ticketKeys.length === 0) {
    try {
      const fallback = await llmFallbackScope({
        message,
        availableReleases,
        defaultRelease,
        knownTeams,
      });
      if (fallback) {
        if (fallback.releases.length > 0) finalReleases = fallback.releases;
        if (fallback.teams.length > 0) finalTeams = fallback.teams;
        if (intent === 'unknown' && fallback.intent) intent = fallback.intent;
      }
    } catch (_e) {
      // Best effort; hard fallback below keeps the turn moving.
    }
  }

  if (finalReleases.length === 0 && defaultRelease) {
    finalReleases = [defaultRelease];
    assumedFocus = true;
    if (intent === 'unknown') intent = 'single_release';
  }

  return {
    releases: finalReleases.slice(0, 4),
    teams: finalTeams.slice(0, 4),
    ticketKeys: ticketKeys.slice(0, 8),
    sprints: sprints.slice(0, 6),
    intent,
    assumedFocus,
  };
}

module.exports = {
  extractScope,
};

