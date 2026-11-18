import React, { useEffect } from 'react';
import { render, waitFor, act } from '@testing-library/react';
import { SelectedReleaseProvider, useSelectedRelease } from '../SelectedReleaseContext';
import { useTeam } from '../TeamContext';
import { listReleaseVersions, fetchGateTimeline } from '../../release/services/releaseBriefService';

jest.mock('../TeamContext', () => ({
  useTeam: jest.fn(),
}));

jest.mock('../../release/services/releaseBriefService', () => ({
  listReleaseVersions: jest.fn(),
  fetchGateTimeline: jest.fn(),
  pickDefaultRelease: jest.fn((versions, preferred) => {
    if (preferred && versions.some((v) => v.name === preferred)) return preferred;
    return versions[0]?.name || null;
  }),
}));

function StormChild() {
  const { versions, fetchVersions, versionsError } = useSelectedRelease();
  // Recreates the old Project Status bug: refetch whenever the list is empty.
  useEffect(() => {
    if (!versions.length) {
      fetchVersions();
    }
  }, [versions.length, fetchVersions]);
  return <div data-testid="status">{versionsError || 'ok'}</div>;
}

function RefreshChild({ onReady }) {
  const ctx = useSelectedRelease();
  useEffect(() => {
    onReady(ctx);
  }, [ctx, onReady]);
  return <div data-testid="status">{ctx.versionsError || ctx.versions.map((v) => v.name).join(',')}</div>;
}

describe('SelectedReleaseProvider version fetch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.localStorage.setItem('jiraToken', 'test-token');
    window.localStorage.setItem('username', 'testuser');

    useTeam.mockReturnValue({
      selectedTeamId: 'ndb',
      selectedTeam: { id: 'ndb' },
      hasTeamSelected: true,
      teamEpoch: 0,
    });
    fetchGateTimeline.mockResolvedValue({ timeline: null });
  });

  test('does not storm POST /api/jira/release-versions after a failed load', async () => {
    listReleaseVersions.mockRejectedValue(new Error('network down'));

    render(
      <SelectedReleaseProvider>
        <StormChild />
      </SelectedReleaseProvider>
    );

    await waitFor(() => {
      expect(listReleaseVersions).toHaveBeenCalled();
    });

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });

    expect(listReleaseVersions.mock.calls.length).toBeLessThanOrEqual(2);
  });

  test('explicit refresh retries after a failure', async () => {
    listReleaseVersions
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        versions: [{ name: 'NDB-2.11', released: false }],
        defaultVersion: 'NDB-2.11',
      });

    let latestCtx;
    render(
      <SelectedReleaseProvider>
        <RefreshChild onReady={(ctx) => { latestCtx = ctx; }} />
      </SelectedReleaseProvider>
    );

    await waitFor(() => {
      expect(latestCtx?.versionsError).toBeTruthy();
    });

    await act(async () => {
      await latestCtx.refreshVersions();
    });

    await waitFor(() => {
      expect(latestCtx.versions.map((v) => v.name)).toEqual(['NDB-2.11']);
    });
    expect(listReleaseVersions).toHaveBeenCalledTimes(2);
  });
});
