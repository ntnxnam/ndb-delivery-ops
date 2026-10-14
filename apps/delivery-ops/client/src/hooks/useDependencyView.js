/**
 * useDependencyView — Dependency View overview + wishlist config save.
 * GET /api/dependency/overview?teamId=&release=
 * PUT /api/dependency/wishlist-config
 */
import { useState, useCallback, useEffect, useRef } from 'react';
import { authenticatedGet, authenticatedPut } from '../utils/api';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

export function useDependencyView(teamId, release) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [savingConfig, setSavingConfig] = useState(false);
  const [configSaveError, setConfigSaveError] = useState(null);
  const loadSeq = useRef(0);

  const load = useCallback(
    async ({ force = false } = {}) => {
      if (!teamId) {
        setData(null);
        setLoading(false);
        setError(null);
        return;
      }
      const seq = ++loadSeq.current;
      if (force) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const params = { teamId };
        if (release) params.release = release;
        const resp = await authenticatedGet(
          '/api/dependency/overview',
          params,
          { ...creds(), ignoreFailureCooldown: true },
          { timeout: 180000 }
        );
        if (seq !== loadSeq.current) return;
        setData(resp.data);
      } catch (err) {
        if (seq !== loadSeq.current) return;
        setError(
          err.response?.data?.error || err.message || 'Failed to load Dependency View'
        );
      } finally {
        if (seq === loadSeq.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [teamId, release]
  );

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => load({ force: true }), [load]);

  const saveWishlistConfig = useCallback(
    async (patch) => {
      setSavingConfig(true);
      setConfigSaveError(null);
      try {
        const resp = await authenticatedPut('/api/dependency/wishlist-config', patch, creds());
        const wishlist = resp.data?.wishlist;
        // Reload overview so Q7 JQL reflects saved filter
        await load({ force: true });
        return wishlist;
      } catch (err) {
        const msg =
          err.response?.data?.error || err.message || 'Failed to save wishlist config';
        setConfigSaveError(msg);
        throw err;
      } finally {
        setSavingConfig(false);
      }
    },
    [load]
  );

  return {
    data,
    loading,
    refreshing,
    error,
    refresh,
    saveWishlistConfig,
    savingConfig,
    configSaveError,
  };
}
