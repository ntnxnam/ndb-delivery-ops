/**
 * useSosItems — data hook for the SoS Summary page.
 *
 * Makes a single POST /api/jira/sos-items call (no fixVersion needed —
 * the server uses the team's sosBaseFilter to fetch everything and groups
 * by fixVersion). Returns { byVersion: { [version]: Item[] } }.
 *
 * No release version list required from the client — zero dependency on
 * useReleaseVersions / SelectedReleaseContext.
 */

import { useState, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';
import { fetchBreakdownsForKeys } from '../services/taskBreakdownService';

const BREAKDOWN_BATCH_SIZE = 5;

export function useSosItems() {
  const [byVersion, setByVersion] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

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

  const fetchAll = useCallback(async (teamId = 'ndb') => {
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setLoading(true);
    setError(null);

    try {
      const resp = await authenticatedPost(
        '/api/jira/sos-items',
        { teamId },
        { jiraToken, username }
      );

      if (!resp.data.success) {
        throw new Error(resp.data.error || 'Failed to fetch SoS items');
      }

      const data = resp.data.data?.byVersion || {};
      setByVersion(data);

      // Fire-and-forget breakdowns for all keys across all versions
      const allKeys = Object.values(data).flat().map((i) => i.key).filter(Boolean);
      if (allKeys.length > 0) {
        fetchBreakdowns(allKeys, jiraToken, username);
      }
    } catch (err) {
      setError(err.message || 'Failed to load SoS items');
    } finally {
      setLoading(false);
    }
  }, [fetchBreakdowns]);

  return {
    byVersion,
    loading,
    error,
    breakdownDataMap,
    loadingBreakdowns,
    fetchAll,
  };
}
