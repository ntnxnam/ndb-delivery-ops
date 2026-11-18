/**
 * Weekly Skim — multi-release ADHD email payload.
 *
 * Reuses:
 *   - computeOutstandingCounts (shared outstandingService)
 *   - buildReleaseIntelligence (releaseAiSummaryService)
 *   - generateReleaseSummary (naiService) — ONE release at a time
 *
 * Does not invent JQL.
 */

const path = require('path');
const { buildReleaseIntelligence } = require('./releaseAiSummaryService');
const { generateReleaseSummary } = require('./naiService');
const logger = require('../utils/logger');

const PRODUCT_CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'teamBoardConfig.json');

const RAG_RANK = { RED: 3, YELLOW: 2, GREEN: 1 };

let _shared;
async function getShared() {
  if (!_shared) {
    _shared =
      import('@portfolio-delivery-ops/shared');
  }
  return _shared;
}

function versionLabel(version) {
  return String(version || '').toLowerCase();
}

/** Same P0 / must-fix JQL already used inside releaseAiSummaryService (proof links only). */
function p0Jql(version) {
  return `filter = "${versionLabel(version)}-all" AND statusCategory != Done AND priority = "P0 - Blocker"`;
}

function mustFixJql(version) {
  return `labels = "${versionLabel(version)}-mustfix" AND statusCategory != Done`;
}

function extractPulse(summary) {
  if (!summary) return '';
  const health = summary.match(/##\s*Release Health:\s*(GREEN|YELLOW|RED)\s*\n+([\s\S]*?)(?=\n##|$)/i);
  if (health) {
    const body = health[2].trim().split('\n').find((l) => l.trim());
    if (body) return body.replace(/^[-*•]\s*/, '').trim().slice(0, 120);
  }
  const first = summary.split('\n').find((l) => l.trim() && !l.startsWith('#'));
  return (first || '').trim().slice(0, 120);
}

function extractChaseBullets(summary, release, limit = 3) {
  if (!summary) return [];
  const m = summary.match(/##\s*7-Day Action List\s*\n([\s\S]*?)(?=\n##|$)/i);
  if (!m) return [];
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^[-*•\d.)\s]+/, '').trim())
    .filter(Boolean)
    .slice(0, limit)
    .map((text) => ({ text, release }));
}

function gaFromDateMetrics(dateMetrics) {
  if (!dateMetrics) return null;
  return (
    dateMetrics.currentGADate ||
    dateMetrics.gaDate ||
    dateMetrics.GA ||
    dateMetrics.ga ||
    null
  );
}

/** Short Key Content cell — PDF-style themes, not a feature laundry list. */
function buildKeyContent(intelligence) {
  const total = intelligence.totalFeatures || 0;
  const buckets = intelligence.buckets || {};
  const clear = (buckets.clear || []).length;
  const lagging = (buckets['gate-lagging'] || []).length;
  const watching = (buckets.watching || []).length;
  const parts = [];
  if (total) parts.push(`${total} committed FEATs`);
  if (clear) parts.push(`${clear} clear`);
  if (lagging) parts.push(`${lagging} gate-lagging`);
  else if (watching) parts.push(`${watching} watching`);
  const phaseDist = intelligence.phaseDist || {};
  const topPhase = Object.entries(phaseDist).sort((a, b) => b[1] - a[1])[0];
  if (topPhase) parts.push(`mostly ${topPhase[0]}`);
  return parts.join(' · ') || '—';
}

function tileByKey(tiles, key) {
  return (tiles || []).find((t) => t.key === key) || null;
}

async function fetchOutstandingTiles(jiraToken, productId, release) {
  const shared = await getShared();
  const {
    JiraConnector,
    loadEnv,
    getProductService,
    computeOutstandingCounts,
  } = shared;

  const productService = getProductService(PRODUCT_CONFIG_PATH);
  const product = productService.getProduct(productId);
  const projectKey = product.projectKey;
  const labelPrefix = productService.getLabelPrefix(productId);

  const env = { ...loadEnv({ requirePat: false }), jiraPat: jiraToken };
  const jira = new JiraConnector(env);
  const tiles = await computeOutstandingCounts(jira, {
    release,
    projectKey,
    labelPrefix,
  });
  return { tiles, projectKey, labelPrefix };
}

function normalizePulse(text, fallback = 'needs a watch') {
  let pulse = (text || fallback).trim();
  if (pulse && !/[.!?]$/.test(pulse)) pulse += '.';
  return pulse;
}

/**
 * ADHD headline — only RED gets "air cover".
 * YELLOW = watch (often open must-fix / lagging FEATs — normal mid-release noise).
 * GREEN / unknown = quiet.
 */
function buildThisWeek(rows) {
  const ok = rows.filter((r) => !r.error);
  if (!ok.length) return 'Could not load release skim — retry Generate.';

  const reds = ok.filter((r) => r.rag === 'RED');
  const yellows = ok.filter((r) => r.rag === 'YELLOW');
  const greens = ok.filter((r) => r.rag === 'GREEN');

  const unknown = ok.filter((r) => !r.rag || !['RED', 'YELLOW', 'GREEN'].includes(r.rag));
  if (reds.length === 0 && yellows.length === 0) {
    if (unknown.length > 0) {
      return `⚪ Health unknown for ${unknown.map((r) => r.release).join(', ')} — regenerate or open Release Brief; do not treat as green.`;
    }
    return '🟢 All selected releases look quiet — nothing to chase this week.';
  }

  // RED = real air cover. Name them; mention others only if quiet.
  if (reds.length >= 1) {
    const focus = reds[0];
    const pulse = normalizePulse(focus.pulse || focus.healthReason, 'blocking risk');
    if (reds.length === 1) {
      const restQuiet = yellows.length === 0;
      const tail = restQuiet && ok.length > 1 ? ' Everything else can wait.' : '';
      const yellowNote =
        yellows.length > 0
          ? ` ${yellows.length} other release${yellows.length > 1 ? 's' : ''} on watch only.`
          : '';
      return `🔴 ${focus.release} needs air cover — ${pulse}${tail}${yellowNote}`;
    }
    const names = reds.map((r) => r.release).join(', ');
    return `🔴 ${reds.length} releases need air cover: ${names}. Lead with ${focus.release} — ${pulse}`;
  }

  // YELLOW only — never say "air cover"
  const focus = yellows[0];
  const pulse = normalizePulse(focus.pulse || focus.healthReason);
  if (yellows.length === 1) {
    const tail = greens.length > 0 || ok.length > 1 ? ' Rest look fine.' : '';
    return `🟡 ${focus.release} is on watch this week — ${pulse}${tail}`;
  }
  return `🟡 ${yellows.length} releases on watch (not on fire). Start with ${focus.release} — ${pulse}`;
}

/**
 * @param {{ productId: string, releases: string[], jiraToken: string, onProgress?: (p) => void }} args
 */
async function generateWeeklySkim({ productId = 'ndb', releases, jiraToken, onProgress }) {
  const list = (releases || []).map((r) => String(r).trim()).filter(Boolean);
  if (!list.length) {
    const err = new Error('releases array is required');
    err.statusCode = 400;
    throw err;
  }

  const rows = [];
  const chase = [];

  for (let i = 0; i < list.length; i++) {
    const version = list[i];
    if (typeof onProgress === 'function') {
      onProgress({ release: version, index: i + 1, total: list.length });
    }
    logger.info(`[weekly-skim] ${version} (${i + 1}/${list.length})`);

    let openTile = null;
    let intelligence = null;
    try {
      try {
        const { tiles } = await fetchOutstandingTiles(jiraToken, productId, version);
        openTile = tileByKey(tiles, 'open_in_release');
      } catch (e) {
        logger.warn(`[weekly-skim] outstanding failed for ${version}: ${e.message}`);
      }

      intelligence = await buildReleaseIntelligence(version, jiraToken);
      const summary = await generateReleaseSummary(intelligence);

      // Prefer computed health; fall back to parsing NAI "## Release Health:" — never default YELLOW.
      const fromHealth = (intelligence.health?.verdict || '').toUpperCase();
      const fromSummary = (summary.match(/##\s*Release Health:\s*(GREEN|YELLOW|RED)/i) || [])[1];
      const rag = (fromHealth || (fromSummary || '').toUpperCase() || null);
      const pulse = extractPulse(summary);
      const rowChase = extractChaseBullets(summary, version, 3);
      chase.push(...rowChase);

      rows.push({
        release: version,
        ga: gaFromDateMetrics(intelligence.dateMetrics),
        rag,
        healthReason: intelligence.health?.reason || null,
        keyContent: buildKeyContent(intelligence),
        open: {
          count: openTile?.count ?? null,
          jql: openTile?.jql || null,
        },
        p0: {
          count: intelligence.p0BugsCount ?? (intelligence.p0Bugs || []).length,
          jql: p0Jql(version),
        },
        mustFix: {
          count: (intelligence.mustFixTickets || []).length,
          jql: mustFixJql(version),
        },
        pulse,
        summary,
        bucketCounts: Object.fromEntries(
          Object.entries(intelligence.buckets || {}).map(([k, v]) => [k, (v || []).length])
        ),
        totalFeatures: intelligence.totalFeatures,
        error: null,
      });
    } catch (e) {
      logger.error(`[weekly-skim] failed for ${version}`, e, { naiDebug: e.naiDebug });
      // Preserve any counts we already fetched (outstanding / intelligence) even if NAI fails.
      rows.push({
        release: version,
        ga: gaFromDateMetrics(intelligence?.dateMetrics) || null,
        rag: (intelligence?.health?.verdict || '').toUpperCase() || null,
        keyContent: intelligence ? buildKeyContent(intelligence) : null,
        open: {
          count: openTile?.count ?? null,
          jql: openTile?.jql || null,
        },
        p0: {
          count: intelligence
            ? intelligence.p0BugsCount ?? (intelligence.p0Bugs || []).length
            : null,
          jql: p0Jql(version),
        },
        mustFix: {
          count: intelligence ? (intelligence.mustFixTickets || []).length : null,
          jql: mustFixJql(version),
        },
        pulse: null,
        summary: null,
        error: e.message || 'Failed to generate skim for this release',
      });
    }
  }

  // Dedupe chase by text; keep ≤3 globally, prefer RED/YELLOW releases
  const ragByRelease = Object.fromEntries(rows.map((r) => [r.release, r.rag]));
  const uniqueChase = [];
  const seen = new Set();
  const ordered = [...chase].sort(
    (a, b) => (RAG_RANK[ragByRelease[b.release]] || 0) - (RAG_RANK[ragByRelease[a.release]] || 0)
  );
  for (const c of ordered) {
    const key = c.text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueChase.push(c);
    if (uniqueChase.length >= 3) break;
  }

  return {
    generatedAt: new Date().toISOString(),
    thisWeek: buildThisWeek(rows),
    chase: uniqueChase,
    rows,
  };
}

module.exports = {
  generateWeeklySkim,
  p0Jql,
  mustFixJql,
  extractPulse,
  extractChaseBullets,
  buildThisWeek,
  buildKeyContent,
};
