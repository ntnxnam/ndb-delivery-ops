/**
 * useDependencyView — read-only Dependency View overview.
 * GET /api/dependency/overview?teamId=&release=
 */
import { useState, useCallback, useEffect } from 'react';
import { authenticatedGet } from '../utils/api';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

export function useDependencyView(teamId, release) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(
    async ({ force = false } = {}) => {
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
        const params = { teamId };
        if (release) params.release = release;
        const resp = await authenticatedGet('/api/dependency/overview', params, creds(), {
          timeout: 180000,
        });
        setData(resp.data);
      } catch (err) {
        setError(
          err.response?.data?.error || err.message || 'Failed to load Dependency View'
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [teamId, release]
  );

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  return { data, loading, refreshing, error, refresh };
}
