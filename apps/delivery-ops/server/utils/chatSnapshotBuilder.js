const fs = require('fs');
const path = require('path');

const RELEASE_DATASET_CACHE_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  '..',
  'shared',
  '.cache',
  'release-dataset'
);

const PRODUCT_CONFIG_PATH = path.resolve(__dirname, '..', 'config', 'teamBoardConfig.json');
const RELEASE_GATE_CONFIG_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'releaseVersionsEmailConfig.json'
);

let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    _sharedPromise =
      process.env.NODE_ENV === 'test'
        ? Promise.resolve(require('@portfolio-delivery-ops/shared'))
        : import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

function safeJsonRead(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (_e) {
    return fallback;
  }
}

function parseReleaseDates() {
  const parsed = safeJsonRead(RELEASE_GATE_CONFIG_PATH, {});
  const releaseGateDates = parsed?.releaseGateDates || {};
  return releaseGateDates;
}

function summarizeTickets(tickets, { teamFilter = [], ticketKeys = [] } = {}) {
  const source = Array.isArray(tickets) ? tickets : [];
  const keysFilter = new Set((ticketKeys || []).map((k) => String(k).toUpperCase()));
  const teamsFilter = (teamFilter || []).map((t) => String(t).toLowerCase());

  const scoped = source.filter((t) => {
    if (keysFilter.size > 0) {
      return keysFilter.has(String(t['Issue Key'] || '').toUpperCase());
    }
    if (teamsFilter.length > 0) {
      const component = String(t['Primary Component'] || t['JIRA Components'] || '').toLowerCase();
      return teamsFilter.some((needle) => component.includes(needle));
    }
    return true;
  });

  const byStatus = {};
  const byIssueType = {};
  const p0p1Open = [];

  for (const ticket of scoped) {
    const status = String(ticket['Status'] || 'Unknown');
    const issueType = String(ticket['Issue Type'] || 'Unknown');
    const priority = String(ticket['Priority'] || '');
    const key = String(ticket['Issue Key'] || '');
    const summary = String(ticket['Summary'] || '');
    const assignee = String(ticket['Assignee'] || 'Unassigned');
    const resolution = String(ticket['Resolution'] || '').toLowerCase();

    byStatus[status] = (byStatus[status] || 0) + 1;
    byIssueType[issueType] = (byIssueType[issueType] || 0) + 1;

    const isOpen = !resolution || resolution === 'unresolved';
    const isHighPriority = priority.includes('P0') || priority.includes('P1');
    if (isOpen && isHighPriority && key) {
      p0p1Open.push({ key, summary, assignee, priority, status });
    }
  }

  return {
    total: scoped.length,
    byStatus,
    byIssueType,
    topP0P1Open: p0p1Open.slice(0, 10),
    sampleTickets: scoped.slice(0, 12).map((t) => ({
      key: t['Issue Key'] || null,
      summary: t['Summary'] || '',
      status: t['Status'] || '',
      priority: t['Priority'] || '',
      issueType: t['Issue Type'] || '',
      assignee: t['Assignee'] || '',
      riskIndicator: t['Risk Indicator'] || '',
      ccDate: t['CC Date'] || null,
      cgDate: t['CG Date'] || null,
      pgDate: t['PG Date'] || null,
      labels: t['Labels'] || [],
    })),
  };
}

async function loadReleasePayload(cache, releaseName) {
  const { tickets = [], meta = null } = cache.loadReleaseLenient(releaseName);
  return { tickets, meta };
}

async function buildSnapshot({
  scope,
  defaultRelease,
  productId = 'ndb',
  buildReleaseIntelligence,
  jiraToken,
}) {
  const shared = await getShared();
  const { ReleaseDatasetCache } = shared;
  const cache = new ReleaseDatasetCache({ cacheDir: RELEASE_DATASET_CACHE_DIR, productId });
  const releaseGateDates = parseReleaseDates();
  const releases = scope.releases?.length ? scope.releases : [defaultRelease].filter(Boolean);

  const byRelease = {};
  const allTeams = new Set();
  const validTicketKeys = new Set();
  const releaseIntelligence = {};

  for (const release of releases.slice(0, 4)) {
    const { tickets, meta } = await loadReleasePayload(cache, release);
    const summary = summarizeTickets(tickets, {
      teamFilter: scope.teams || [],
      ticketKeys: scope.ticketKeys || [],
    });
    byRelease[release] = {
      meta,
      gateDates: releaseGateDates[release] || {},
      summary,
    };

    for (const row of tickets) {
      const key = row?.['Issue Key'];
      if (key) validTicketKeys.add(String(key).toUpperCase());
      const component = row?.['Primary Component'] || row?.['JIRA Components'];
      if (component) allTeams.add(String(component));
    }

    if (typeof buildReleaseIntelligence === 'function' && jiraToken) {
      try {
        const intel = await buildReleaseIntelligence(release, jiraToken);
        const { bucketCounts } = await getShared();
        releaseIntelligence[release] = {
          totalFeatures: intel.totalFeatures,
          p0BugsCount: intel.p0BugsCount,
          phaseDist: intel.phaseDist,
          dateMetrics: intel.dateMetrics,
          selfReportedRisk: intel.selfReportedRisk,
          health: intel.health,
          bucketCounts: bucketCounts(intel.buckets || {}),
          mustFixTickets: (intel.mustFixTickets || []).slice(0, 10),
          p0Bugs: (intel.p0Bugs || []).slice(0, 10),
        };
      } catch (_e) {
        releaseIntelligence[release] = { error: 'release_intelligence_unavailable' };
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    schema: 'chat-snapshot-v1',
    scope,
    defaults: { release: defaultRelease, productId },
    releaseContext: byRelease,
    releaseIntelligence,
    knownTeams: [...allTeams].slice(0, 50),
    validTicketKeys: [...validTicketKeys].slice(0, 500),
    sourceInfo: {
      releaseCacheDir: RELEASE_DATASET_CACHE_DIR,
      releaseGateConfigPath: RELEASE_GATE_CONFIG_PATH,
      productConfigPath: PRODUCT_CONFIG_PATH,
    },
  };
}

module.exports = {
  buildSnapshot,
};

