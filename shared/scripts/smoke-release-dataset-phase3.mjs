/**
 * Smoke test for CONSOLIDATION #1b Phase 3:
 *   - per-release cache + bundle cache (fresh `v1-node-2026-05` schema)
 *   - syncReleaseDataset() orchestration (full vs scoped)
 *   - targeted changelog enrichment for Closed Date on Bug/Improvement
 *
 * Runs end-to-end against a stub JiraConnector (no network), proves
 * every D1 input flows through productService (D34), and exercises the
 * Engineering Payload code path (D36 — fetchReleaseData and sync both
 * still scope by `project = <projectKey>`).
 *
 * Run from monorepo root:
 *   npm --prefix shared run build && node shared/scripts/smoke-release-dataset-phase3.mjs
 */

import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  ProductService,
  ReleaseDatasetCache,
  CACHE_SCHEMA,
  computeReleaseJqlHash,
  syncReleaseDataset,
  rebuildBundleFromDisk,
  enrichClosedDates,
  extractClosedDate,
  SYNC_LOCK_STALE_SECONDS,
} from '../dist/index.js';

let failures = 0;
let asserts = 0;
function assert(cond, msg) {
  asserts++;
  if (!cond) {
    failures++;
    console.error('  FAIL:', msg);
  } else {
    console.log('  ok:', msg);
  }
}

// ── productService wiring (D34) ───────────────────────────────────────────
const configPath = resolve(
  process.cwd(),
  'apps/delivery-ops/server/config/teamBoardConfig.json'
);
const products = new ProductService(configPath);
const productId = products.getDefaultProductId();
const projectKey = products.getJiraProjects(productId)[0];
const labelPrefix = products.getLabelPrefix(productId);
const productPrefix = products.getReleasePrefix(productId);
const sprintCalendar = products.getSprintCalendar(productId);

console.log('1. productService resolves D1 inputs:');
assert(productId === 'ndb', `productId = ndb (got ${productId})`);
assert(projectKey === 'ERA', `projectKey = ERA (got ${projectKey})`);
assert(labelPrefix === 'ndb', `labelPrefix = ndb (got ${labelPrefix})`);
assert(productPrefix === 'NDB-', `productPrefix = NDB- (got ${productPrefix})`);
assert(
  sprintCalendar.s1StartIso === '2024-10-23' && sprintCalendar.sprintDays === 21,
  'sprintCalendar resolved'
);

// ── Stub JiraConnector ─────────────────────────────────────────────────────
//
// Mimics only the surface area used by fetchReleaseData + the changelog
// override path: searchAll() and getIssue(key, { expand: 'changelog' }).
// Issues are pre-seeded per (release, bucket) so each release gets a
// predictable ticket set.

const RELEASES = ['NDB-2.11', 'NDB-2.10'];

const ISSUE_LIBRARY = {
  'NDB-2.11': {
    top_level_projects: [
      mkIssue('ERA-1001', { type: 'Feature', status: 'In Progress', resolution: null, release: 'NDB-2.11' }),
      mkIssue('ERA-1002', { type: 'Initiative', status: 'Done', resolution: 'Done', release: 'NDB-2.11' }),
    ],
    work_toward_project: [
      mkIssue('ERA-1100', { type: 'Task', status: 'In Progress', resolution: null, release: 'NDB-2.11' }),
    ],
    standalone_epics: [
      mkIssue('ERA-1200', { type: 'Epic', status: 'In Progress', resolution: null, release: 'NDB-2.11' }),
    ],
    work_toward_standalone_epic: [
      mkIssue('ERA-1300', { type: 'Task', status: 'Done', resolution: 'Done', release: 'NDB-2.11' }),
    ],
    direct_tickets: [
      mkIssue('ERA-1400', {
        type: 'Bug',
        status: 'Closed',
        resolution: 'Fixed',
        release: 'NDB-2.11',
        labels: ['some-label'],
      }),
      mkIssue('ERA-1401', {
        type: 'Improvement',
        status: 'Closed',
        resolution: 'Fixed',
        release: 'NDB-2.11',
      }),
      mkIssue('ERA-1402', {
        type: 'Bug',
        status: 'Closed',
        resolution: 'Cannot Reproduce',
        release: 'NDB-2.11',
      }),
    ],
    wishlist: [
      mkIssue('ERA-1500', {
        type: 'Task',
        status: 'Open',
        resolution: null,
        release: 'NDB-2.11',
        labels: ['ndb-2.11-wishlist'],
      }),
    ],
    deferred: [
      mkIssue('ERA-1400', {
        type: 'Bug',
        status: 'Closed',
        resolution: 'Fixed',
        release: 'NDB-2.11',
        labels: ['some-label', 'ndb-2.11-deferred'],
      }),
      mkIssue('ERA-1600', {
        type: 'Bug',
        status: 'Cancelled',
        resolution: 'Won\'t Fix',
        release: 'NDB-2.11',
        labels: ['ndb-2.11-deferred'],
      }),
    ],
  },
  'NDB-2.10': {
    top_level_projects: [
      mkIssue('ERA-2001', { type: 'Feature', status: 'Done', resolution: 'Done', release: 'NDB-2.10' }),
    ],
    work_toward_project: [],
    standalone_epics: [],
    work_toward_standalone_epic: [],
    direct_tickets: [
      mkIssue('ERA-2100', {
        type: 'Bug',
        status: 'Closed',
        resolution: 'Fixed',
        release: 'NDB-2.10',
      }),
    ],
    wishlist: [],
    deferred: [],
  },
};

function mkIssue(key, opts) {
  return {
    key,
    fields: {
      issuetype: { name: opts.type },
      status: {
        name: opts.status,
        statusCategory: {
          name: opts.status === 'Done' || opts.status === 'Closed'
            ? 'Done'
            : 'In Progress',
        },
      },
      resolution: opts.resolution ? { name: opts.resolution } : null,
      resolutiondate: opts.resolution ? '2026-04-10T12:00:00.000+0000' : null,
      created: '2026-01-01T00:00:00.000+0000',
      updated: '2026-04-10T12:00:00.000+0000',
      fixVersions: [{ name: opts.release }],
      labels: opts.labels ?? [],
      components: [],
      priority: { name: 'Major - P2' },
      assignee: { name: 'alice' },
    },
  };
}

function classifyJql(jql) {
  // Return [release, bucket] for any JQL we recognise; throw otherwise.
  // Release name appears in two forms in the JQL family:
  //   - bucket JQL uses the canonical fixVersion form `NDB-2.11`
  //   - sidecar JQL uses the lower-cased label form `"ndb-2.11-wishlist"`
  // Match both and normalise back to the canonical form.
  const relMatch = /(?:ndb|NDB)-([0-9]+\.[0-9]+(?:\.[0-9]+){0,2})(?:-[A-Za-z]+)?/.exec(
    jql
  );
  let release = null;
  if (relMatch) {
    const m = relMatch[0];
    release = m.startsWith('ndb-') ? `NDB-${m.slice(4)}` : m;
    // Strip a trailing sidecar suffix (`-wishlist`/`-deferred`) if the
    // regex consumed it from the lowercase label form.
    release = release.replace(/-(wishlist|deferred)$/, '');
  }
  if (!release) throw new Error(`mock JIRA: no release in JQL: ${jql}`);
  if (/labels = "[^"]+-wishlist"/.test(jql)) return [release, 'wishlist'];
  if (/labels = "[^"]+-deferred"/.test(jql)) return [release, 'deferred'];
  if (/issueFunction in issuesInEpics\("issuefunction in portfolioChildrenOf/.test(jql)) {
    return [release, 'work_toward_project'];
  }
  if (/issueFunction in issuesInEpics\("type = Epic/.test(jql)) {
    return [release, 'work_toward_standalone_epic'];
  }
  if (/type = Epic .* "Parent Link" is EMPTY/.test(jql)) {
    return [release, 'standalone_epics'];
  }
  if (/issueType in \(Feature, Initiative\)/.test(jql)) {
    return [release, 'top_level_projects'];
  }
  if (/"Epic Link" is EMPTY/.test(jql)) {
    return [release, 'direct_tickets'];
  }
  throw new Error(`mock JIRA: unrecognised JQL: ${jql}`);
}

class StubJira {
  constructor(library) {
    this.library = library;
    this.searchCalls = 0;
    this.getIssueCalls = 0;
  }
  async searchAll(jql /* , fields, options */) {
    this.searchCalls += 1;
    // The full JQL has `project = ERA AND (BUCKET_JQL)` — sanity-check
    // that the D36 Engineering Payload scope is still present.
    if (!jql.startsWith(`project = ${projectKey} AND `)) {
      throw new Error(
        `StubJira.searchAll: expected D36 Engineering Payload scope, got: ${jql.slice(0, 60)}...`
      );
    }
    const [release, bucket] = classifyJql(jql);
    return this.library[release]?.[bucket] ?? [];
  }
  async getIssue(key /* , options */) {
    // Not used directly — sync uses fetchChangelog override below.
    this.getIssueCalls += 1;
    return { key, fields: {} };
  }
}

// Changelog override: emit a "transitioned to Closed" history for any
// Bug/Improvement we know about. Real production code would call
// jiraConnector.getIssue(key, { expand: 'changelog' }) (now supported).
async function stubFetchChangelog(_jira, key) {
  // Pretend status went New → In Progress → Closed.
  return {
    key,
    fields: {},
    changelog: {
      histories: [
        {
          created: '2026-04-09T09:00:00.000+0000',
          items: [{ field: 'status', toString: 'In Progress', fromString: 'New' }],
        },
        {
          created: '2026-04-10T15:30:00.000+0000',
          items: [{ field: 'status', toString: 'Closed', fromString: 'In Progress' }],
        },
      ],
    },
  };
}

// ── extractClosedDate unit checks ─────────────────────────────────────────
console.log('\n2. extractClosedDate parses changelog correctly:');
const issueWithClose = {
  key: 'X-1',
  changelog: {
    histories: [
      { created: '2026-01-01T00:00:00Z', items: [{ field: 'priority', toString: 'P1' }] },
      { created: '2026-02-01T00:00:00Z', items: [{ field: 'status', toString: 'Closed' }] },
    ],
  },
};
assert(
  extractClosedDate(issueWithClose) === '2026-02-01T00:00:00Z',
  'finds the most-recent status → Closed transition'
);
assert(
  extractClosedDate({ key: 'X-2' }) === null,
  'returns null when no changelog'
);
assert(
  extractClosedDate({ key: 'X-3', changelog: { histories: [] } }) === null,
  'returns null when empty histories'
);
assert(
  extractClosedDate({
    key: 'X-4',
    changelog: {
      histories: [
        { created: '2026-01-01T00:00:00Z', items: [{ field: 'status', toString: 'Resolved' }] },
      ],
    },
  }) === null,
  'returns null when never closed'
);

// ── cache round-trip ──────────────────────────────────────────────────────
const cacheRoot = mkdtempSync(join(tmpdir(), 'rds-phase3-'));
try {
  console.log(`\n3. ReleaseDatasetCache round-trip (cache root: ${cacheRoot}):`);
  const cache = new ReleaseDatasetCache({ cacheDir: cacheRoot, productId });

  const fakeTickets = [
    {
      'Issue Key': 'ERA-1',
      'Issue Type': 'Bug',
      Status: 'Closed',
      'Status Category': 'Done',
      Resolution: 'Fixed',
      'Fix Version': 'NDB-2.11',
      'All Fix Versions': 'NDB-2.11',
      'Resolved Date': '2026-04-10T12:00:00.000+0000',
      'Created Date': '2026-01-01T00:00:00.000+0000',
      'Updated Date': '2026-04-10T12:00:00.000+0000',
      'Closed Date': null,
      'Release Name': 'NDB-2.11',
      Labels: '',
      Components: 'direct_tickets',
      'JIRA Components': '',
      'Primary Component': '',
      Priority: 'Major - P2',
      Assignee: 'alice',
    },
  ];

  assert(
    cache.saveRelease('NDB-2.11', fakeTickets, { projectKey, labelPrefix }) === true,
    'saveRelease succeeds'
  );
  const loaded = cache.loadRelease('NDB-2.11', { projectKey, labelPrefix });
  assert(loaded?.length === 1 && loaded[0]['Issue Key'] === 'ERA-1', 'loadRelease round-trips');

  // strict invalidation: wrong projectKey
  assert(
    cache.loadRelease('NDB-2.11', { projectKey: 'DATALENS', labelPrefix }) === null,
    'loadRelease rejects when projectKey mismatches'
  );
  // strict invalidation: wrong labelPrefix
  assert(
    cache.loadRelease('NDB-2.11', { projectKey, labelPrefix: 'datalens' }) === null,
    'loadRelease rejects when labelPrefix mismatches'
  );

  // jqlHash check — compute hash and corrupt the meta on disk.
  const expectedHash = computeReleaseJqlHash('NDB-2.11', labelPrefix);
  const metaPath = join(cacheRoot, productId, 'per_release', 'NDB-2.11.meta.json');
  const md = JSON.parse(readFileSync(metaPath, 'utf8'));
  assert(md.jqlHash === expectedHash, `meta carries the freshly-computed jqlHash (${md.jqlHash})`);
  assert(md.schema === CACHE_SCHEMA, `meta carries the current CACHE_SCHEMA (${md.schema})`);
  writeFileSync(metaPath, JSON.stringify({ ...md, jqlHash: 'deadbeef' }));
  assert(
    cache.loadRelease('NDB-2.11', { projectKey, labelPrefix }) === null,
    'loadRelease rejects when jqlHash drifts'
  );
  // lenient still works
  const lenient = cache.loadReleaseLenient('NDB-2.11');
  assert(lenient.tickets?.length === 1, 'loadReleaseLenient returns tickets even with stale meta');

  // Restore the meta so getCachedReleasesInfo lights up
  writeFileSync(metaPath, JSON.stringify(md));

  // schema-diff path: stamp the meta with a fake old schema
  writeFileSync(metaPath, JSON.stringify({ ...md, schema: 'v0-legacy' }));
  const info = cache.getCachedReleasesInfo({ projectKey, labelPrefix });
  assert(info['NDB-2.11']?.schemaDiff === true, 'getCachedReleasesInfo flags schema drift');
  assert(info['NDB-2.11']?.loadableStrict === false, 'getCachedReleasesInfo flags unloadable cache');
  // Restore
  writeFileSync(metaPath, JSON.stringify(md));
  const cleanInfo = cache.getCachedReleasesInfo({ projectKey, labelPrefix });
  assert(
    cleanInfo['NDB-2.11']?.loadableStrict === true,
    'getCachedReleasesInfo flags loadable cache after restore'
  );

  // Bundle round-trip
  const fakeProcessed = [
    {
      ...fakeTickets[0],
      'Priority Band': 'P2',
      'Sprint Number': 8,
      'Closed Sprint Number': null,
      'Issue Group': 'Bug',
      'Work Type': 'Dev',
      'Resolution Category': 'Done',
      'Is Done': true,
      'Is Deferred': false,
      'Is Wishlist': false,
      'Is QA Verification': false,
      'Release Type': 'Major/Minor',
    },
  ];
  assert(
    cache.saveBundle(fakeProcessed, ['NDB-2.11'], { projectKey, labelPrefix, productPrefix }) === true,
    'saveBundle succeeds'
  );
  const bundle = cache.loadBundle({ projectKey, labelPrefix, productPrefix });
  assert(bundle?.payload.processed.length === 1, 'loadBundle round-trips');
  assert(
    cache.loadBundle({ projectKey, labelPrefix, productPrefix: 'DataLens-' }) === null,
    'loadBundle rejects when productPrefix mismatches'
  );

  // Sync lock
  assert(cache.isSyncInProgress() === false, 'isSyncInProgress=false when no lock');
  cache.acquireSyncLock('test');
  assert(cache.isSyncInProgress() === true, 'isSyncInProgress=true after acquire');
  cache.touchSyncLock();
  // Force the lock to look stale (mtime far in the past) and verify auto-cleanup.
  const lockPath = join(cacheRoot, productId, '.sync_in_progress');
  const stalePast = new Date(Date.now() - (SYNC_LOCK_STALE_SECONDS + 60) * 1000);
  utimesSync(lockPath, stalePast, stalePast);
  assert(
    cache.isSyncInProgress() === false,
    'isSyncInProgress=false (and auto-cleans) when lock is older than SYNC_LOCK_STALE_SECONDS'
  );
  assert(!existsSync(lockPath), 'stale lock was unlinked');
  cache.releaseSyncLock(); // no-op now, but should not throw

  cache.clearRelease('NDB-2.11');
  cache.clearBundle();
  assert(
    cache.loadRelease('NDB-2.11', { projectKey, labelPrefix }) === null,
    'clearRelease removes the cache'
  );

  // ── enrichClosedDates (direct) ─────────────────────────────────────────
  console.log('\n4. enrichClosedDates targets the right tickets:');
  const ticketsForEnrichment = [
    {
      'Issue Key': 'A-1',
      'Issue Type': 'Bug',
      Resolution: 'Fixed',
      'Closed Date': null,
    },
    {
      'Issue Key': 'A-2',
      'Issue Type': 'Improvement',
      Resolution: 'Done',
      'Closed Date': null,
    },
    {
      'Issue Key': 'A-3',
      'Issue Type': 'Bug',
      Resolution: 'Cannot Reproduce', // not in Done family → skip
      'Closed Date': null,
    },
    {
      'Issue Key': 'A-4',
      'Issue Type': 'Task', // not Bug/Improvement → skip
      Resolution: 'Done',
      'Closed Date': null,
    },
    {
      'Issue Key': 'A-5',
      'Issue Type': 'Bug',
      Resolution: 'Fixed',
      'Closed Date': '2026-01-01T00:00:00.000Z', // already populated → skip
    },
  ];
  const stub = new StubJira(ISSUE_LIBRARY);
  const enriched = await enrichClosedDates(stub, ticketsForEnrichment, {
    fetchChangelog: stubFetchChangelog,
    concurrency: 2,
  });
  assert(enriched.checked === 2, `only 2 tickets needed enrichment (got ${enriched.checked})`);
  assert(enriched.enriched === 2, `all 2 needing tickets were enriched (got ${enriched.enriched})`);
  assert(enriched.errors === 0, 'no errors during enrichment');
  assert(
    ticketsForEnrichment[0]['Closed Date'] === '2026-04-10T15:30:00.000+0000',
    'A-1 (Bug-Done) got Closed Date filled'
  );
  assert(
    ticketsForEnrichment[1]['Closed Date'] === '2026-04-10T15:30:00.000+0000',
    'A-2 (Improvement-Done) got Closed Date filled'
  );
  assert(
    ticketsForEnrichment[2]['Closed Date'] === null,
    'A-3 (Bug-CannotReproduce) was skipped'
  );
  assert(
    ticketsForEnrichment[3]['Closed Date'] === null,
    'A-4 (Task-Done) was skipped'
  );
  assert(
    ticketsForEnrichment[4]['Closed Date'] === '2026-01-01T00:00:00.000Z',
    'A-5 (already populated) was skipped'
  );

  // ── syncReleaseDataset — full sync, cold cache ──────────────────────────
  console.log('\n5. syncReleaseDataset full sync, cold cache:');
  const syncStub = new StubJira(ISSUE_LIBRARY);
  const events = [];
  const result1 = await syncReleaseDataset(syncStub, RELEASES, {
    cache,
    projectKey,
    labelPrefix,
    productPrefix,
    sprintCalendar,
    fetchChangelog: stubFetchChangelog,
    onProgress: (e) => events.push(e),
  });
  assert(
    Object.keys(result1.errors).length === 0,
    `no errors (errors: ${JSON.stringify(result1.errors)})`
  );
  assert(
    result1.releases.length === 2 && result1.releases.includes('NDB-2.11'),
    'bundle includes both releases'
  );
  assert(result1.processed.length > 0, 'processed dataset is non-empty');
  // NDB-2.11 has 4 Bug/Improvement-Done tickets that need changelog:
  // ERA-1400, ERA-1401, ERA-1402 (Cannot Reproduce — NOT done family → skipped),
  // and NDB-2.10 has 1 (ERA-2100 Bug/Fixed). So 3 enrichments total.
  assert(
    result1.changelogEnriched === 3,
    `changelog enriched the right count (expected 3, got ${result1.changelogEnriched})`
  );
  assert(
    result1.source['NDB-2.11'] === 'fetched' && result1.source['NDB-2.10'] === 'fetched',
    'every release in cold sync went through JIRA'
  );

  // Verify D36 Engineering Payload scoping happened: the stub asserts that
  // every JQL starts with `project = ERA AND `. If the assertion failed
  // earlier, searchCalls would have thrown.
  assert(
    syncStub.searchCalls === RELEASES.length * 7,
    `searchAll fired 7 times per release (5 buckets + 2 sidecars); got ${syncStub.searchCalls}`
  );

  // Verify QA Verification rows landed: at least one Bug/Improvement
  // with Closed Date populated and Is Done = true.
  const qaVerified = result1.processed.filter((r) => r['Is QA Verification']);
  assert(
    qaVerified.length >= 1,
    `at least one Is QA Verification row (got ${qaVerified.length})`
  );

  // Verify the bundle hit disk
  const bundleAfter = cache.loadBundle({ projectKey, labelPrefix, productPrefix });
  assert(bundleAfter?.payload.releases.length === 2, 'bundle persisted to disk');

  // ── second sync — warm cache, should not call JIRA at all ──────────────
  console.log('\n6. syncReleaseDataset full sync, warm cache:');
  const warmStub = new StubJira(ISSUE_LIBRARY);
  const result2 = await syncReleaseDataset(warmStub, RELEASES, {
    cache,
    projectKey,
    labelPrefix,
    productPrefix,
    sprintCalendar,
    fetchChangelog: stubFetchChangelog,
  });
  assert(
    warmStub.searchCalls === 0,
    `warm sync makes ZERO JIRA calls (got ${warmStub.searchCalls})`
  );
  assert(
    result2.source['NDB-2.11'] === 'cache_hit' && result2.source['NDB-2.10'] === 'cache_hit',
    'every release served from cache'
  );
  assert(result2.changelogEnriched === 0, 'warm sync does no changelog work');
  assert(
    result2.releases.length === 2 && result2.processed.length > 0,
    'warm sync still produces a complete bundle'
  );

  // ── third sync — scoped refetch ────────────────────────────────────────
  console.log('\n7. syncReleaseDataset scoped refetch:');
  const scopedStub = new StubJira(ISSUE_LIBRARY);
  const result3 = await syncReleaseDataset(scopedStub, [], {
    cache,
    projectKey,
    labelPrefix,
    productPrefix,
    sprintCalendar,
    forceReleases: ['NDB-2.11'],
    fetchChangelog: stubFetchChangelog,
  });
  assert(
    scopedStub.searchCalls === 7,
    `scoped refetch fires 7 searches for the one forced release (got ${scopedStub.searchCalls})`
  );
  assert(
    result3.source['NDB-2.11'] === 'fetched',
    'forced release was refetched'
  );
  assert(
    !('NDB-2.10' in result3.source),
    'non-forced release is NOT in the source map'
  );
  assert(
    result3.releases.length === 2,
    'bundle still includes both releases (forced fresh + cached overlay)'
  );

  // ── rebuildBundleFromDisk ──────────────────────────────────────────────
  console.log('\n8. rebuildBundleFromDisk:');
  cache.clearBundle();
  const rebuilt = rebuildBundleFromDisk({
    cache,
    projectKey,
    labelPrefix,
    productPrefix,
    sprintCalendar,
  });
  assert(rebuilt !== null, 'rebuildBundleFromDisk returns a bundle');
  assert(
    rebuilt?.releases.length === 2,
    `rebuilt bundle has both releases (got ${rebuilt?.releases.length})`
  );
  const bundleAgain = cache.loadBundle({ projectKey, labelPrefix, productPrefix });
  assert(bundleAgain !== null, 'rebuildBundleFromDisk also persists the bundle');

  // ── D1 guards ──────────────────────────────────────────────────────────
  console.log('\n9. D1 input guards:');
  let threw = false;
  try {
    new ReleaseDatasetCache({ cacheDir: cacheRoot });
  } catch (e) {
    threw = /productId is required/.test(e.message);
  }
  assert(threw, 'ReleaseDatasetCache throws when productId is missing');

  threw = false;
  try {
    await syncReleaseDataset(syncStub, ['NDB-2.11'], {
      cache,
      projectKey,
      labelPrefix,
      // productPrefix missing
      sprintCalendar,
    });
  } catch (e) {
    threw = /productPrefix is required/.test(e.message);
  }
  assert(threw, 'syncReleaseDataset throws when productPrefix is missing (D1)');
} finally {
  rmSync(cacheRoot, { recursive: true, force: true });
}

console.log(`\n${failures === 0 ? 'ALL PASS' : `${failures} FAILURE(S)`} — ${asserts} assertions`);
process.exit(failures === 0 ? 0 : 1);
