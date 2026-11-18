/**
 * What ails the team — multi-facet NAI page briefing.
 *
 * Flow: build facets (deterministic) → parallel facet NAI → stitch → optional compress.
 * Surfaces: release | oncall | kpi | feature
 */

const {
  generatePageFacetBrief,
  generatePageStitchBrief,
  generatePageCompressBrief,
} = require('./naiService');
const logger = require('../utils/logger');

/** Compress when stitched story exceeds this char budget (VP skim). */
const COMPRESS_CHAR_BUDGET = 1600;

const SURFACES = new Set(['release', 'oncall', 'kpi', 'feature']);

function uniqKeys(list) {
  return [...new Set((list || []).filter(Boolean))];
}

function keysFromObjects(items, keyField = 'key') {
  return uniqKeys((items || []).map((i) => i?.[keyField]).filter(Boolean));
}

/**
 * Release facets from releaseAiSummaryService intelligence package.
 */
function buildReleaseFacets(intelligence, version) {
  const p0 = intelligence.p0Bugs || [];
  const mustFix = intelligence.mustFixTickets || [];
  const buckets = intelligence.buckets || {};
  const bucketCounts = intelligence.bucketCounts || {
    'gate-lagging': (buckets['gate-lagging'] || []).length,
    blocked: (buckets.blocked || []).length,
    compliance: (buckets.compliance || []).length,
    dark: (buckets.dark || []).length,
    watching: (buckets.watching || []).length,
    clear: (buckets.clear || []).length,
  };
  const validKeys = uniqKeys([
    ...keysFromObjects(p0),
    ...keysFromObjects(mustFix),
    ...keysFromObjects(buckets['gate-lagging'] || []),
    ...keysFromObjects(buckets.blocked || []),
    ...keysFromObjects(buckets.compliance || []),
    ...keysFromObjects(buckets.dark || []),
  ]);

  return {
    contextLabel: version,
    validKeys,
    facets: [
      {
        id: 'blockers',
        title: 'Blockers & must-fix',
        surface: 'release',
        contextLabel: version,
        validKeys: uniqKeys([...keysFromObjects(p0), ...keysFromObjects(mustFix)]),
        data: {
          p0BugsCount: intelligence.p0BugsCount ?? p0.length,
          p0Bugs: p0.slice(0, 12),
          mustFixCount: mustFix.length,
          mustFixTickets: mustFix.slice(0, 12),
          health: intelligence.health || null,
        },
      },
      {
        id: 'schedule',
        title: 'Schedule & gate lag',
        surface: 'release',
        contextLabel: version,
        validKeys: uniqKeys([
          ...keysFromObjects(buckets['gate-lagging'] || []),
          ...keysFromObjects(buckets.blocked || []),
        ]),
        data: {
          bucketCounts: {
            'gate-lagging': bucketCounts['gate-lagging'] || 0,
            blocked: bucketCounts.blocked || 0,
            watching: bucketCounts.watching || 0,
            clear: bucketCounts.clear || 0,
          },
          gateLagging: (buckets['gate-lagging'] || []).slice(0, 10).map((f) => ({
            key: f.key,
            summary: f.summary,
            phase: f.phase,
          })),
          dateMetrics: intelligence.dateMetrics || null,
          totalFeatures: intelligence.totalFeatures,
        },
      },
      {
        id: 'hygiene',
        title: 'Dark & compliance gaps',
        surface: 'release',
        contextLabel: version,
        validKeys: uniqKeys([
          ...keysFromObjects(buckets.dark || []),
          ...keysFromObjects(buckets.compliance || []),
        ]),
        data: {
          darkCount: bucketCounts.dark || 0,
          complianceCount: bucketCounts.compliance || 0,
          dark: (buckets.dark || []).slice(0, 8).map((f) => ({
            key: f.key,
            summary: f.summary,
            staleDays: f.staleDays,
          })),
          compliance: (buckets.compliance || []).slice(0, 8).map((f) => ({
            key: f.key,
            summary: f.summary,
          })),
        },
      },
    ],
  };
}

/**
 * OnCall facets from oncall intelligence.
 */
function buildOncallFacets(intelligence, teamId) {
  const stacks = intelligence.stacks || [];
  const validKeys = uniqKeys(intelligence.validKeys || keysFromObjects(stacks));
  const hero = intelligence.hero || {};

  return {
    contextLabel: teamId || intelligence.teamId || 'OnCalls',
    validKeys,
    facets: [
      {
        id: 'load',
        title: 'Interrupt load',
        surface: 'oncall',
        contextLabel: teamId,
        validKeys: keysFromObjects(stacks).slice(0, 20),
        data: {
          hero,
          rag: intelligence.rag,
          health: intelligence.health,
          priorityMix: intelligence.priorityMix,
          openSample: stacks.slice(0, 8).map((s) => ({
            key: s.key,
            summary: s.summary,
            priority: s.priority,
            ageDays: s.ageDays,
            assignee: s.assignee,
          })),
        },
      },
      {
        id: 'paths',
        title: 'Escalation paths',
        surface: 'oncall',
        contextLabel: teamId,
        validKeys,
        data: {
          paths: intelligence.paths,
          stacksWithTechHelp: stacks
            .filter((s) => (s.techHelp || []).length)
            .slice(0, 8)
            .map((s) => ({
              key: s.key,
              techHelp: (s.techHelp || []).map((t) => t.key),
              engFixes: (s.engFixes || []).map((e) => e.key),
            })),
        },
      },
      {
        id: 'chase',
        title: 'Aged & chase',
        surface: 'oncall',
        contextLabel: teamId,
        validKeys: keysFromObjects(stacks),
        data: {
          aged: stacks
            .filter((s) => (s.ageDays || 0) >= 14)
            .slice(0, 10)
            .map((s) => ({
              key: s.key,
              ageDays: s.ageDays,
              priority: s.priority,
              assignee: s.assignee,
              blurb: s.blurb,
            })),
          assigneeMix: intelligence.assigneeMix,
        },
      },
    ],
  };
}

/**
 * KPI page facets from client snapshot (counts already loaded on page).
 */
function buildKpiFacets(snapshot, teamId) {
  const kpis = snapshot?.kpis || [];
  const pulse = snapshot?.pulse || null;
  const validKeys = uniqKeys(snapshot?.validKeys || []);
  const label = snapshot?.label || teamId || 'KPIs';

  const high = kpis
    .filter((k) => typeof k.count === 'number' && k.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  return {
    contextLabel: label,
    validKeys,
    facets: [
      {
        id: 'volume',
        title: 'KPI volume',
        surface: 'kpi',
        contextLabel: label,
        validKeys,
        data: { teamId, topKpis: high, kpiCount: kpis.length },
      },
      {
        id: 'pulse',
        title: 'Pulse & aging',
        surface: 'kpi',
        contextLabel: label,
        validKeys,
        data: {
          openNow: pulse?.heroes?.openNow || pulse?.openNow || null,
          agedOpen: pulse?.heroes?.agedOpen || pulse?.agedOpen || null,
          mttr: pulse?.mttr || null,
          created: pulse?.heroes?.created || null,
          resolved: pulse?.heroes?.resolved || null,
        },
      },
      {
        id: 'risk',
        title: 'Priority & risk signals',
        surface: 'kpi',
        contextLabel: label,
        validKeys,
        data: {
          riskKpis: high.filter((k) =>
            /p0|p1|blocker|critical|sla|aged|escalat/i.test(`${k.name || ''} ${k.id || ''}`)
          ),
          story: snapshot?.story || null,
        },
      },
    ],
  };
}

/**
 * Feature dashboard facets from client snapshot.
 */
function buildFeatureFacets(snapshot, featureKey) {
  const key = featureKey || snapshot?.key || snapshot?.featureKey;
  const validKeys = uniqKeys([
    key,
    ...(snapshot?.validKeys || []),
    ...keysFromObjects(snapshot?.outstanding || []),
    ...keysFromObjects(snapshot?.blockers || []),
  ]);
  const label = snapshot?.summary
    ? `${key}: ${snapshot.summary}`
    : key || 'Feature';

  return {
    contextLabel: label,
    validKeys,
    facets: [
      {
        id: 'delivery',
        title: 'Delivery & risk',
        surface: 'feature',
        contextLabel: label,
        validKeys,
        data: {
          key,
          summary: snapshot?.summary,
          status: snapshot?.status,
          riskAssessment: snapshot?.riskAssessment,
          pathToGreen: snapshot?.pathToGreen,
          riskIndicator: snapshot?.riskIndicator,
          timing: snapshot?.timing || null,
          gates: snapshot?.gates || null,
        },
      },
      {
        id: 'outstanding',
        title: 'Outstanding work',
        surface: 'feature',
        contextLabel: label,
        validKeys,
        data: {
          outstanding: (snapshot?.outstanding || []).slice(0, 15),
          kpiBoxes: (snapshot?.kpiBoxes || snapshot?.teamKpiBoxes || []).slice(0, 12),
          burn: snapshot?.burn || null,
        },
      },
      {
        id: 'hygiene',
        title: 'Hygiene & links',
        surface: 'feature',
        contextLabel: label,
        validKeys,
        data: {
          hygiene: snapshot?.hygiene || null,
          links: {
            cgChecklist: snapshot?.cgChecklistLink,
            pgChecklist: snapshot?.pgChecklistLink,
          },
          headerExtras: snapshot?.header || null,
        },
      },
    ],
  };
}

const TICKET_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

/** Strip ticket keys not in the VALID allowlist (fail closed on hallucination). */
function sanitizeSummaryKeys(text, validKeys) {
  if (!text) return text;
  const allowed = new Set((validKeys || []).filter(Boolean));
  if (allowed.size === 0) {
    // No keys allowed — remove any ticket-key shaped tokens
    return text.replace(TICKET_KEY_RE, '[omitted]');
  }
  return text.replace(TICKET_KEY_RE, (match) => (allowed.has(match) ? match : '[omitted]'));
}

async function runFacetPipeline({ facets, contextLabel, surface, validKeys }) {
  const started = Date.now();
  const facetBriefs = await Promise.all(
    facets.map(async (facet) => {
      const text = await generatePageFacetBrief(facet);
      return { id: facet.id, title: facet.title, text: sanitizeSummaryKeys(text, facet.validKeys || validKeys) };
    })
  );

  let summary = await generatePageStitchBrief({
    contextLabel,
    surface,
    facetBriefs,
    validKeys,
  });
  summary = sanitizeSummaryKeys(summary, validKeys);

  let compressed = false;
  if (summary.length > COMPRESS_CHAR_BUDGET) {
    summary = await generatePageCompressBrief(summary, validKeys);
    summary = sanitizeSummaryKeys(summary, validKeys);
    compressed = true;
  }

  return {
    summary,
    facets: facetBriefs,
    meta: {
      surface,
      contextLabel,
      facetCount: facets.length,
      naiCalls: facets.length + 1 + (compressed ? 1 : 0),
      compressed,
      compressBudget: COMPRESS_CHAR_BUDGET,
      durationMs: Date.now() - started,
      validKeyCount: validKeys.length,
    },
  };
}

/**
 * Build and run page briefing.
 *
 * @param {object} opts
 * @param {'release'|'oncall'|'kpi'|'feature'} opts.surface
 * @param {string} [opts.token]
 * @param {string} [opts.version]
 * @param {string} [opts.teamId]
 * @param {string} [opts.featureKey]
 * @param {object} [opts.snapshot]
 */
async function buildPageBriefing(opts = {}) {
  const surface = (opts.surface || '').trim().toLowerCase();
  if (!SURFACES.has(surface)) {
    throw Object.assign(new Error(`surface must be one of: ${[...SURFACES].join(', ')}`), {
      statusCode: 400,
    });
  }

  let package_;

  if (surface === 'release') {
    const version = (opts.version || '').trim();
    if (!version) {
      throw Object.assign(new Error('version is required for surface=release'), { statusCode: 400 });
    }
    const { buildReleaseIntelligence } = require('./releaseAiSummaryService');
    const intelligence = await buildReleaseIntelligence(version, opts.token);
    package_ = buildReleaseFacets(intelligence, version);
    const bc = intelligence.bucketCounts || {
      'gate-lagging': (intelligence.buckets?.['gate-lagging'] || []).length,
      blocked: (intelligence.buckets?.blocked || []).length,
      compliance: (intelligence.buckets?.compliance || []).length,
      dark: (intelligence.buckets?.dark || []).length,
      watching: (intelligence.buckets?.watching || []).length,
      clear: (intelligence.buckets?.clear || []).length,
    };
    package_.intelligence = {
      version,
      totalFeatures: intelligence.totalFeatures,
      p0BugsCount: intelligence.p0BugsCount,
      bucketCounts: bc,
      health: intelligence.health,
      generatedAt: intelligence.generatedAt,
    };
  } else if (surface === 'oncall') {
    const { buildIntelligence } = require('./oncallAiSummaryService');
    const intelligence = await buildIntelligence({
      token: opts.token,
      teamId: opts.teamId,
      dashboard: opts.snapshot,
    });
    package_ = buildOncallFacets(intelligence, opts.teamId);
    package_.intelligence = {
      teamId: intelligence.teamId,
      hero: intelligence.hero,
      rag: intelligence.rag,
      health: intelligence.health,
      generatedAt: intelligence.generatedAt,
    };
  } else if (surface === 'kpi') {
    if (!opts.snapshot || typeof opts.snapshot !== 'object') {
      throw Object.assign(new Error('snapshot is required for surface=kpi'), { statusCode: 400 });
    }
    package_ = buildKpiFacets(opts.snapshot, opts.teamId);
    package_.intelligence = { teamId: opts.teamId, kpiCount: (opts.snapshot.kpis || []).length };
  } else if (surface === 'feature') {
    if (!opts.snapshot || typeof opts.snapshot !== 'object') {
      throw Object.assign(new Error('snapshot is required for surface=feature'), { statusCode: 400 });
    }
    package_ = buildFeatureFacets(opts.snapshot, opts.featureKey);
    package_.intelligence = {
      featureKey: opts.featureKey || opts.snapshot.key,
      summary: opts.snapshot.summary,
    };
  }

  logger.info(
    `[page-briefing] surface=${surface} facets=${package_.facets.length} keys=${package_.validKeys.length}`
  );

  const result = await runFacetPipeline({
    facets: package_.facets,
    contextLabel: package_.contextLabel,
    surface,
    validKeys: package_.validKeys,
  });

  return {
    ...result,
    intelligence: package_.intelligence || null,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  buildPageBriefing,
  buildReleaseFacets,
  buildOncallFacets,
  buildKpiFacets,
  buildFeatureFacets,
  runFacetPipeline,
  sanitizeSummaryKeys,
  COMPRESS_CHAR_BUDGET,
  SURFACES,
  _internals: {
    uniqKeys,
    keysFromObjects,
  },
};
