/**
 * useSosItems — data hook for the SoS Summary page.
 *
 * Makes a single POST /api/jira/sos-items call (cache-first; forceLive
 * on Refresh All). Returns { byVersion, source, degraded, lastSyncIso }.
 *
 * No release version list required from the client — zero dependency on
 * useReleaseVersions / SelectedReleaseContext.
 */

import { useState, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';
import { fetchBreakdownsForKeys } from '../services/taskBreakdownService';
import { getUserFacingMessage } from '../utils/errorMessages';

const BREAKDOWN_BATCH_SIZE = 5;

export function useSosItems() {
  const [byVersion, setByVersion] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);
  const [degraded, setDegraded] = useState(false);
  const [lastSyncIso, setLastSyncIso] = useState(null);

  const [breakdownDataMap, setBreakdownDataMap] = useState({});
  const [loadingBreakdowns, setLoadingBreakdowns] = useState(false);

  const fetchBreakdowns = useCallback(async (keys, jiraToken, username) => {
    if (!keys || keys.length === 0) return;
    setLoadingBreakdowns(true);
    try {
      for (let i = 0; i < keys.length; i += BREAKDOWN_BATCH_SIZE) {
        const batch = keys.slice(i, i + BREAKDOWN_BATCH_SIZE);
        const results = await fetchBreakdownsForKeys(batch, jiraToken, username);
        setBreakdownDataMap((prev) => {
          const next = { ...prev };
          for (const [key, data] of results.entries()) {
            next[key] = data;
          }
          return next;
        });
      }
    } catch (err) {
      console.warn('[useSosItems] Breakdown fetch error:', err.message);
    } finally {
      setLoadingBreakdowns(false);
    }
  }, []);

  const fetchAll = useCallback(async (teamId = 'ndb', { forceLive = false } = {}) => {
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setLoading(true);
    setError(null);

    try {
      const resp = await authenticatedPost(
        '/api/jira/sos-items',
        { teamId, forceLive },
        { jiraToken, username }
      );

      if (!resp.data.success) {
        throw new Error(resp.data.error || 'Failed to fetch SoS items');
      }

      const payload = resp.data.data || {};
      const data = payload.byVersion || {};
      setByVersion(data);
      setSource(payload.source || null);
      setDegraded(Boolean(payload.degraded));
      setLastSyncIso(payload.lastSyncIso || null);

      // Live JIRA follow-on calls (breakdowns) only after a live fetch.
      // After a 429, firing them immediately re-trips the rate limit.
      const allKeys = Object.values(data).flat().map((i) => i.key).filter(Boolean);
      if (forceLive && payload.source === 'jira' && allKeys.length > 0) {
        fetchBreakdowns(allKeys, jiraToken, username);
      }
    } catch (err) {
      setError(getUserFacingMessage(err, {
        context: 'sos-items',
        fallback: err.response?.data?.error || err.message || 'Failed to load SoS items',
      }));
    } finally {
      setLoading(false);
    }
  }, [fetchBreakdowns]);

  return {
    byVersion,
    loading,
    error,
    source,
    degraded,
    lastSyncIso,
    breakdownDataMap,
    loadingBreakdowns,
    fetchAll,
  };
}
