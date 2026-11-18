import { renderHook, waitFor } from '@testing-library/react';
import { useExecPageBriefing } from '../../hooks/useExecPageBriefing';
import { authenticatedPost } from '../../utils/api';

jest.mock('../../utils/api', () => ({
  authenticatedPost: jest.fn(),
}));

describe('useExecPageBriefing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.setItem('jiraToken', 't');
    localStorage.setItem('username', 'tester');
  });

  it('does not fetch when disabled', async () => {
    const { result } = renderHook(() =>
      useExecPageBriefing({
        enabled: false,
        surface: 'release',
        version: 'NDB-2.12',
        ready: true,
      })
    );
    expect(result.current.state).toBe('idle');
    expect(authenticatedPost).not.toHaveBeenCalled();
  });

  it('fetches page-briefing when enabled for release', async () => {
    authenticatedPost.mockResolvedValue({
      data: {
        summary: '## What ails the team: GREEN\nok',
        meta: { naiCalls: 4, facetCount: 3 },
        intelligence: { version: 'NDB-2.12' },
        facets: [],
      },
    });
    const { result } = renderHook(() =>
      useExecPageBriefing({
        enabled: true,
        surface: 'release',
        version: 'NDB-2.12',
        ready: true,
      })
    );
    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(authenticatedPost).toHaveBeenCalledWith(
      '/api/ai/page-briefing',
      expect.objectContaining({ surface: 'release', version: 'NDB-2.12' }),
      expect.any(Object),
      expect.any(Object)
    );
    expect(result.current.summary).toMatch(/GREEN/);
  });

  it('posts oncall dashboard snapshot so AI matches tiles', async () => {
    const dash = { teamId: 'ndb', asOf: '2026-10-17T00:00:00.000Z', hero: { open: { count: 3 } } };
    authenticatedPost.mockResolvedValue({
      data: { summary: '## What ails the team: YELLOW\nok', meta: {}, intelligence: {}, facets: [] },
    });
    const { result } = renderHook(() =>
      useExecPageBriefing({
        enabled: true,
        surface: 'oncall',
        teamId: 'ndb',
        snapshot: dash,
        snapshotKey: dash.asOf,
        ready: true,
      })
    );
    await waitFor(() => expect(result.current.state).toBe('done'));
    expect(authenticatedPost).toHaveBeenCalledWith(
      '/api/ai/page-briefing',
      expect.objectContaining({ surface: 'oncall', teamId: 'ndb', snapshot: dash }),
      expect.any(Object),
      expect.any(Object)
    );
  });

  it('does not fetch oncall without snapshot', async () => {
    renderHook(() =>
      useExecPageBriefing({
        enabled: true,
        surface: 'oncall',
        teamId: 'ndb',
        ready: true,
      })
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(authenticatedPost).not.toHaveBeenCalled();
  });
});
