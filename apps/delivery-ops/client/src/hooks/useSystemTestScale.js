/**
 * useSystemTestScale — System-Test scale dashboard data + refresh.
 *
 * Fetches once per team (all releases in one payload). Current / Compare are
 * applied client-side from byRelease — no submit, no re-pull on release change.
 *
 * GET  /api/jira/system-test-scale?teamId=
 * POST /api/jira/system-test-scale/refresh
 */
import { useState, useCallback, useEffect } from 'react';
import { authenticatedGet, authenticatedPost } from '../utils/api';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

export function useSystemTestScale(teamId) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async ({ force = false } = {}) => {
    if (!teamId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      if (force) {
        const resp = await authenticatedPost(
          '/api/jira/system-test-scale/refresh',
          { teamId },
          creds(),
          { timeout: 180000 }
        );
        setData(resp.data);
      } else {
        const resp = await authenticatedGet(
          '/api/jira/system-test-scale',
          { teamId },
          creds(),
          { timeout: 180000 }
        );
        setData(resp.data);
      }
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Failed to load System-Test scale data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [teamId]);

  useEffect(() => {
    load({ force: false });
  }, [load]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  return { data, loading, refreshing, error, refresh, reload: load };
}
