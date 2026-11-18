const {
  loadSosItemsFromCache,
  _internals: { isVersionedRelease, groupItemsByVersion, listCachedReleaseNames },
} = require('../../services/releaseItemsDataService');

describe('SoS cache helpers', () => {
  test('isVersionedRelease keeps numbered releases and drops catch-alls', () => {
    expect(isVersionedRelease('NDB-2.12')).toBe(true);
    expect(isVersionedRelease('NDB-3.0-EA')).toBe(true);
    expect(isVersionedRelease('master')).toBe(false);
    expect(isVersionedRelease('Era Future')).toBe(false);
    expect(isVersionedRelease('')).toBe(false);
  });

  test('groupItemsByVersion splits comma-separated fixVersions', () => {
    const grouped = groupItemsByVersion([
      { key: 'FEAT-1', fixVersions: 'NDB-2.12', customfield_23560: 'Red' },
      { key: 'FEAT-2', fixVersions: 'NDB-2.11, NDB-2.12', customfield_23560: 'Green' },
      { key: 'FEAT-3', fixVersions: 'N/A', customfield_23560: 'Yellow' },
    ]);
    expect(grouped['NDB-2.12'].map((i) => i.key)).toEqual(expect.arrayContaining(['FEAT-1', 'FEAT-2']));
    expect(grouped['NDB-2.11'].map((i) => i.key)).toEqual(['FEAT-2']);
    expect(grouped.Unversioned.map((i) => i.key)).toEqual(['FEAT-3']);
  });

  test('listCachedReleaseNames intersects cache with configured gate releases', () => {
    const names = listCachedReleaseNames('ndb');
    expect(names).not.toContain('master');
    expect(names).not.toContain('Era Future');
    expect(names).not.toContain('NDB-2.7');
    if (names.length > 0) {
      expect(names.every((n) => /\d/.test(n))).toBe(true);
      expect(names.some((n) => /2\.1[12]|3\.0/.test(n))).toBe(true);
    }
  });

  test('loadSosItemsFromCache returns Feature/Initiative rows without throwing', async () => {
    const result = await loadSosItemsFromCache('ndb');
    expect(result).toEqual(expect.objectContaining({
      byVersion: expect.any(Object),
      itemCount: expect.any(Number),
    }));
    expect(result.itemCount).toBeGreaterThanOrEqual(0);
  }, 30000);
});
