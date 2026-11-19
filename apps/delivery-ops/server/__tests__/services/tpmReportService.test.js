const {  composeReport, needsDeferralTag, buildDeferralSummary, MODE_SCOPE_KIND  } = require('@portfolio-delivery-ops/shared');

const mockFetcher = async (skill, { scope }) => ({
  skill, scope,
  totals: { total: 10, open: 6, done: 4 },
  links: { jiraSearchUrl: 'http://jira/search?jql=x', combinedJql: 'x' },
  cited: [{ jql: 'x', ts: new Date().toISOString() }],
});

describe('MODE_SCOPE_KIND', () => {
  test('maps each mode to expected scope kind', () => {
    expect(MODE_SCOPE_KIND['my-focus']).toBe('me');
    expect(MODE_SCOPE_KIND['release']).toBe('release');
    expect(MODE_SCOPE_KIND['digest']).toBe('team');
    expect(MODE_SCOPE_KIND['rollup']).toBe('org');
  });
});

describe('needsDeferralTag', () => {
  test('true when moved after PG', () => {
    expect(needsDeferralTag('2026-11-20', '2026-11-19')).toBe(true);
  });
  test('false when moved before PG', () => {
    expect(needsDeferralTag('2026-11-18', '2026-11-19')).toBe(false);
  });
  test('false when no PG date', () => {
    expect(needsDeferralTag('2026-11-20', null)).toBe(false);
  });
  test('false when moved exactly at PG', () => {
    expect(needsDeferralTag('2026-11-19T00:00:00.000Z', '2026-11-19T00:00:00.000Z')).toBe(false);
  });
});

describe('buildDeferralSummary', () => {
  test('counts only post-PG deferred + all pending', () => {
    const deferred = [
      { key: 'X-1', movedAt: '2026-11-20' },
      { key: 'X-2', movedAt: '2026-11-18' },
    ];
    const pending = [{ key: 'X-3' }];
    const s = buildDeferralSummary(deferred, pending, '2026-11-19');
    expect(s.deferred).toBe(1);
    expect(s.pending).toBe(1);
  });
});

describe('composeReport', () => {
  test('my-focus fans out to 4 phases', async () => {
    const r = await composeReport({ mode: 'my-focus', scope: { kind: 'me', teamId: 't1', principal: 'alice' }, fetcher: mockFetcher });
    expect(r.sections).toHaveLength(4);
    expect(r.totals.total).toBe(40);
  });
  test('release mode validates scope', async () => {
    await expect(composeReport({ mode: 'release', scope: { kind: 'me', teamId: 't1', principal: 'a' }, fetcher: mockFetcher })).rejects.toThrow(/requires scope kind release/);
  });
  test('release mode succeeds with release scope', async () => {
    const r = await composeReport({ mode: 'release', scope: { kind: 'release', releaseVersion: 'NDB-2.12', teamId: 'ndb' }, fetcher: mockFetcher });
    expect(r.sections).toHaveLength(4);
  });
  test('digest includes gate deadlines', async () => {
    const future = new Date(Date.now() + 2 * 24 * 3600 * 1000).toISOString();
    const past = new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString();
    const r = await composeReport({
      mode: 'digest', scope: { kind: 'team', teamId: 'ndb' }, fetcher: mockFetcher,
      gateDeadlinesProvider: () => [{ label: 'PG', date: future }, { label: 'Old', date: past }],
    });
    expect(r.gateDeadlines).toHaveLength(1);
    expect(r.gateDeadlines[0].label).toBe('PG');
  });
  test('rollup with org scope', async () => {
    const r = await composeReport({ mode: 'rollup', scope: { kind: 'org', orgId: 'eng', teamIds: ['a','b'] }, fetcher: mockFetcher });
    expect(r.totals.total).toBe(40);
  });
  test('D26 auth check blocks send', async () => {
    await expect(composeReport({
      mode: 'digest', scope: { kind: 'team', teamId: 'ndb' }, fetcher: mockFetcher,
      recipients: { to: ['a@co.com'], cc: ['m@co.com'] },
      sendEmail: async () => {},
      isAuthorized: () => false,
    })).rejects.toThrow(/D26/);
  });
  test('previewOnly does not call sendEmail', async () => {
    let called = false;
    const r = await composeReport({
      mode: 'digest', scope: { kind: 'team', teamId: 'ndb' }, fetcher: mockFetcher,
      recipients: { to: ['a@co.com'], cc: [] },
      sendEmail: async () => { called = true; },
      isAuthorized: () => true,
      previewOnly: true,
    });
    expect(called).toBe(false);
    expect(r.emailPreview).toBeDefined();
  });
});
