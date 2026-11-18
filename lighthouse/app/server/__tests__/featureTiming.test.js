/**
 * Spec A — real start + fixVersion hygiene pure helpers (shared).
 */
describe('feature timing helpers', () => {
  let shared;

  beforeAll(async () => {
    const mod = await import('@portfolio-delivery-ops/shared');
    shared = mod.default && typeof mod.default.computeFeatureTiming === 'function' ? mod.default : mod;
  });

  test('extractFirstInProgressIso uses earliest In Progress category transition', () => {
    const map = shared.buildStatusCategoryByName([
      { name: 'Open', statusCategory: { key: 'new' } },
      { name: 'Coding', statusCategory: { key: 'indeterminate' } },
      { name: 'Closed', statusCategory: { key: 'done' } },
    ]);
    const iso = shared.extractFirstInProgressIso(
      {
        changelog: {
          histories: [
            { created: '2026-01-10T00:00:00.000Z', items: [{ field: 'status', toString: 'Open' }] },
            { created: '2026-02-01T00:00:00.000Z', items: [{ field: 'status', toString: 'Coding' }] },
          ],
        },
      },
      map
    );
    expect(iso).toBe('2026-02-01');
  });

  test('computeFeatureTiming picks earliest seed ticket', () => {
    const timing = shared.computeFeatureTiming('2026-01-15', [
      { key: 'ERA-1', firstInProgressIso: '2026-02-10' },
      { key: 'ERA-2', firstInProgressIso: '2026-01-20' },
    ]);
    expect(timing.realStartKey).toBe('ERA-2');
    expect(timing.deltaDaysVsEc).toBe(5);
  });

  test('computeFixVersionHygiene counts missing release', () => {
    const hygiene = shared.computeFixVersionHygiene(
      [
        { key: 'ERA-1', fixVersions: ['NDB-2.12'] },
        { key: 'ERA-2', fixVersions: [] },
      ],
      'NDB-2.12',
      'base-jql'
    );
    expect(hygiene.wrongFixVersionCount).toBe(1);
    expect(hygiene.jql).toContain('ERA-2');
  });
});
