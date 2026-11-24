/**
 * useDeferredInsights — Deferred Insights dashboard (KPI section).
 * GET /api/deferred-insights/insights?teamId=&releases=&priority=&component=
 * POST /api/deferred-insights/insights/refresh  (bypass cache)
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { authenticatedGet, authenticatedPost } from '../shared/services/apiService';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

export function useDeferredInsights(teamId, { releases, priority, component } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);

  const releasesKey = Array.isArray(releases) ? releases.join(',') : String(releases || '');

  const load = useCallback(async ({ force = false } = {}) => {
    if (!teamId) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    if (force) setRefreshing(true);
    else setLoading(true);
    setError(null);
    try {
      const params = { teamId };
      if (releases && (Array.isArray(releases) ? releases.length : String(releases).trim())) {
        params.releases = Array.isArray(releases) ? releases.join(',') : String(releases);
      }
      if (priority) params.priority = priority;
      if (component) params.component = component;
      let resp;
      if (force) {
        resp = await authenticatedPost('/api/deferred-insights/insights/refresh', { teamId, releases: params.releases, priority, component }, creds(), { timeout: 180000, signal: controller.signal });
      } else {
        resp = await authenticatedGet('/api/deferred-insights/insights', params, creds(), { timeout: 180000, signal: controller.signal });
      }
      if (controller.signal.aborted) return;
      setData(resp.data || resp);
    } catch (err) {
      if (err.name === 'CanceledError' || err.code === 'ERR_CANCELED' || controller.signal.aborted) return;
      setData(null);
      setError(err.response?.data?.error || err.message || 'Failed to load Deferred Insights');
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [teamId, releasesKey, priority, component]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setData(null);
    load({ force: false });
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [load]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  return { data, loading, refreshing, error, refresh };
}

export default useDeferredInsights;
