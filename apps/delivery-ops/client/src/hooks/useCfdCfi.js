/**
 * useCfdCfi — CFD/CFI KPI pulse dashboard.
 *
 * GET  /api/jira/cfdcfi?teamId=
 * POST /api/jira/cfdcfi/refresh
 */
import { useState, useCallback, useEffect } from 'react';
import { authenticatedGet, authenticatedPost } from '../utils/api';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

export function useCfdCfi(teamId) {
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
          '/api/jira/cfdcfi/refresh',
          { teamId },
          creds(),
          { timeout: 300000 }
        );
        setData(resp.data);
      } else {
        const resp = await authenticatedGet(
          '/api/jira/cfdcfi',
          { teamId },
          creds(),
          { timeout: 300000 }
        );
        setData(resp.data);
      }
    } catch (err) {
      setData(null);
      setError(err.response?.data?.error || err.message || 'Failed to load CFD/CFI data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [teamId]);

  useEffect(() => {
    setData(null);
    load({ force: false });
  }, [load]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  return { data, loading, refreshing, error, refresh };
}

export default useCfdCfi;
