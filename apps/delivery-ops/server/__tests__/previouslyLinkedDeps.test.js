const {
  parseDependencyLinkHistory,
  buildLiveDependencyPairSet,
  collectPreviouslyLinkedSeeds,
  pairId,
} = require('../utils/previouslyLinkedDeps');

describe('previouslyLinkedDeps', () => {
  test('pairId is order-independent', () => {
    expect(pairId('ERA-1', 'ENG-2')).toBe(pairId('ENG-2', 'ERA-1'));
  });

  test('parseDependencyLinkHistory detects removed blocked-by', () => {
    const histories = [
      {
        created: '2026-10-01T10:00:00.000+0000',
        items: [
          {
            field: 'Link',
            fromString: null,
            toString: 'This issue is blocked by ENG-880012',
          },
        ],
      },
      {
        created: '2026-10-10T12:00:00.000+0000',
        items: [
          {
            field: 'Link',
            fromString: 'This issue is blocked by ENG-880012',
            toString: null,
          },
        ],
      },
    ];
    const edges = parseDependencyLinkHistory(histories, 'ERA-49565', {
      lookbackSinceMs: new Date('2026-01-01').getTime(),
    });
    expect(edges).toHaveLength(1);
    expect(edges[0].peerKey).toBe('ENG-880012');
    expect(edges[0].direction).toBe('i_wait_on_them');
    expect(edges[0].removedAt).toContain('2026-10-10');
    expect(edges[0].active).toBe(false);
  });

  test('still-active link is not returned as removed', () => {
    const histories = [
      {
        created: '2026-10-01T10:00:00.000+0000',
        items: [
          {
            field: 'Link',
            fromString: null,
            toString: 'This issue blocks ENG-111',
          },
        ],
      },
    ];
    const edges = parseDependencyLinkHistory(histories, 'ERA-1', {
      lookbackSinceMs: 0,
    });
    expect(edges).toHaveLength(0);
  });

  test('buildLiveDependencyPairSet excludes live peers', () => {
    const live = buildLiveDependencyPairSet([
      [
        {
          key: 'ERA-1',
          links: [{ key: 'ENG-2', type: 'is blocked by', typeName: 'Blocks' }],
        },
      ],
    ]);
    expect(live.has(pairId('ERA-1', 'ENG-2'))).toBe(true);
  });

  test('collectPreviouslyLinkedSeeds prefers home then partners', () => {
    const seeds = collectPreviouslyLinkedSeeds(
      {
        waitRoots: { issues: [{ key: 'ERA-100' }] },
        blockerHops: { issues: [{ key: 'ENG-200' }] },
        partnershipBlockedBy: { issues: [{ key: 'ENG-300' }] },
      },
      {
        isEraHomeProject: (pk) => pk === 'ERA',
        cfg: {},
        maxSeeds: 10,
      }
    );
    expect(seeds[0]).toBe('ERA-100');
    expect(seeds).toContain('ENG-200');
    expect(seeds).toContain('ENG-300');
  });
});
