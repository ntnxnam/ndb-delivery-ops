/**
 * What ails the team — facet builders + orchestration (mocked NAI).
 */
jest.mock('../../services/naiService', () => ({
  generatePageFacetBrief: jest.fn(async (facet) => `## Facet: ${facet.title}\nRAG: YELLOW\n• mock`),
  generatePageStitchBrief: jest.fn(async () =>
    '## What ails the team: YELLOW\nStitched TLDR.\n\n## Where it hurts\n• A\n\n## Chase this week\n• B'
  ),
  generatePageCompressBrief: jest.fn(async (story) => `COMPRESSED:${story.slice(0, 40)}`),
}));

const {
  buildReleaseFacets,
  buildKpiFacets,
  buildFeatureFacets,
  runFacetPipeline,
  sanitizeSummaryKeys,
  COMPRESS_CHAR_BUDGET,
} = require('../../services/pageAiBriefingService');
const nai = require('../../services/naiService');

describe('pageAiBriefingService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('builds three release facets with valid keys from P0/must-fix/buckets', () => {
    const pkg = buildReleaseFacets(
      {
        p0BugsCount: 1,
        p0Bugs: [{ key: 'ERA-1', summary: 'p0' }],
        mustFixTickets: [{ key: 'ERA-2', summary: 'mf' }],
        bucketCounts: { 'gate-lagging': 1, dark: 1, compliance: 0, blocked: 0, watching: 0, clear: 0 },
        buckets: {
          'gate-lagging': [{ key: 'FEAT-9', summary: 'lag' }],
          dark: [{ key: 'FEAT-8', summary: 'stale', staleDays: 20 }],
          blocked: [],
          compliance: [],
        },
        health: { verdict: 'RED' },
        totalFeatures: 5,
      },
      'NDB-2.12'
    );
    expect(pkg.facets).toHaveLength(3);
    expect(pkg.validKeys).toEqual(expect.arrayContaining(['ERA-1', 'ERA-2', 'FEAT-9', 'FEAT-8']));
  });

  it('builds kpi facets from snapshot counts', () => {
    const pkg = buildKpiFacets(
      {
        kpis: [
          { id: 'a', name: 'Top-CFI', count: 12 },
          { id: 'b', name: 'P0 Blockers', count: 2 },
        ],
      },
      'ndb'
    );
    expect(pkg.facets).toHaveLength(3);
    expect(pkg.facets[0].data.topKpis[0].name).toBe('Top-CFI');
  });

  it('builds feature facets from snapshot', () => {
    const pkg = buildFeatureFacets(
      {
        key: 'FEAT-100',
        summary: 'Storage',
        outstanding: [{ key: 'ERA-10', summary: 'work' }],
      },
      'FEAT-100'
    );
    expect(pkg.facets).toHaveLength(3);
    expect(pkg.validKeys).toContain('FEAT-100');
    expect(pkg.validKeys).toContain('ERA-10');
  });

  it('runs parallel facets + stitch (3 facets → ≥4 NAI calls when not compressed)', async () => {
    const facets = [
      { id: 'a', title: 'A', surface: 'kpi', data: { x: 1 }, validKeys: [] },
      { id: 'b', title: 'B', surface: 'kpi', data: { y: 2 }, validKeys: [] },
      { id: 'c', title: 'C', surface: 'kpi', data: { z: 3 }, validKeys: [] },
    ];
    const result = await runFacetPipeline({
      facets,
      contextLabel: 'test',
      surface: 'kpi',
      validKeys: [],
    });
    expect(nai.generatePageFacetBrief).toHaveBeenCalledTimes(3);
    expect(nai.generatePageStitchBrief).toHaveBeenCalledTimes(1);
    expect(nai.generatePageCompressBrief).not.toHaveBeenCalled();
    expect(result.meta.naiCalls).toBe(4);
    expect(result.meta.compressed).toBe(false);
    expect(result.summary).toMatch(/What ails the team/);
  });

  it('compresses when stitch exceeds budget', async () => {
    const long = 'X'.repeat(COMPRESS_CHAR_BUDGET + 50);
    nai.generatePageStitchBrief.mockResolvedValueOnce(long);
    const facets = [
      { id: 'a', title: 'A', surface: 'kpi', data: { x: 1 }, validKeys: [] },
      { id: 'b', title: 'B', surface: 'kpi', data: { y: 2 }, validKeys: [] },
    ];
    const result = await runFacetPipeline({
      facets,
      contextLabel: 'test',
      surface: 'kpi',
      validKeys: [],
    });
    expect(nai.generatePageCompressBrief).toHaveBeenCalledTimes(1);
    expect(nai.generatePageCompressBrief).toHaveBeenCalledWith(expect.any(String), []);
    expect(result.meta.compressed).toBe(true);
    expect(result.meta.naiCalls).toBe(4); // 2 facets + stitch + compress
  });

  it('strips hallucinated ticket keys not in VALID list', () => {
    const out = sanitizeSummaryKeys('Chase ERA-1 and ERA-999', ['ERA-1']);
    expect(out).toContain('ERA-1');
    expect(out).not.toContain('ERA-999');
    expect(out).toContain('[omitted]');
  });
});
