/**
 * useSosItems — data hook for the SoS Summary page.
 *
 * For each active release:
 *   1. Fetches Features + Initiatives live from JIRA via POST /api/jira/sos-items
 *   2. Fetches task breakdowns for all returned keys
 *
 * No cache for the items fetch (intentional — SoS always needs live data).
 * Breakdown data uses the existing taskBreakdownService 5-min TTL cache.
 */

import { useState, useCallback, useRef } from 'react';
import { authenticatedPost } from '../utils/api';
import { fetchBreakdownsForKeys } from '../services/taskBreakdownService';

const BREAKDOWN_BATCH_SIZE = 5;

export function useSosItems() {
  // itemsByRelease: { [version]: Item[] }
  const [itemsByRelease, setItemsByRelease] = useState({});
  const [loadingByRelease, setLoadingByRelease] = useState({});
  const [errorByRelease, setErrorByRelease] = useState({});

  // breakdownDataMap: { [jiraKey]: breakdownData }
  const [breakdownDataMap, setBreakdownDataMap] = useState({});
  const [loadingBreakdowns, setLoadingBreakdowns] = useState(false);

  const abortControllersRef = useRef({});

  const fetchItemsForRelease = useCallback(async (version, teamId = 'ndb') => {
    if (!version) return;

    // Cancel any existing in-flight request for this version
    if (abortControllersRef.current[version]) {
      abortControllersRef.current[version].abort();
    }
    const controller = new AbortController();
    abortControllersRef.current[version] = controller;

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setLoadingByRelease((prev) => ({ ...prev, [version]: true }));
    setErrorByRelease((prev) => ({ ...prev, [version]: null }));

    try {
      const resp = await authenticatedPost(
        '/api/jira/sos-items',
        { fixVersion: version, teamId },
        { jiraToken, username },
        { signal: controller.signal }
      );

      if (!resp.data.success) {
        throw new Error(resp.data.error || 'Failed to fetch SoS items');
      }

      const items = resp.data.data?.items || [];
      setItemsByRelease((prev) => ({ ...prev, [version]: items }));
      setLoadingByRelease((prev) => ({ ...prev, [version]: false }));

      // Fire-and-forget breakdowns for newly fetched keys
      const keys = items.map((i) => i.key).filter(Boolean);
      if (keys.length > 0) {
        fetchBreakdownsForAllKeys(keys, jiraToken, username);
      }

      return items;
    } catch (err) {
      if (err.name === 'AbortError' || err.code === 'ERR_CANCELED') {
        setLoadingByRelease((prev) => ({ ...prev, [version]: false }));
        return null;
      }
      setErrorByRelease((prev) => ({ ...prev, [version]: err.message || 'Failed to load' }));
      setLoadingByRelease((prev) => ({ ...prev, [version]: false }));
      return null;
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchBreakdownsForAllKeys = useCallback(async (keys, jiraToken, username) => {
    if (!keys || keys.length === 0) return;
    setLoadingBreakdowns(true);
    try {
      // Process in batches of BREAKDOWN_BATCH_SIZE to avoid hammering the server
      const batches = [];
      for (let i = 0; i < keys.length; i += BREAKDOWN_BATCH_SIZE) {
        batches.push(keys.slice(i, i + BREAKDOWN_BATCH_SIZE));
      }
      for (const batch of batches) {
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

  /**
   * Fetch items for all provided release versions in parallel.
   * @param {string[]} versions
   * @param {string} teamId
   */
  const fetchAll = useCallback(async (versions, teamId = 'ndb') => {
    if (!versions || versions.length === 0) return;
    await Promise.all(versions.map((v) => fetchItemsForRelease(v, teamId)));
  }, [fetchItemsForRelease]);

  /**
   * Refresh a single release (clear and re-fetch).
   */
  const refreshRelease = useCallback(async (version, teamId = 'ndb') => {
    setItemsByRelease((prev) => {
      const next = { ...prev };
      delete next[version];
      return next;
    });
    return fetchItemsForRelease(version, teamId);
  }, [fetchItemsForRelease]);

  return {
    itemsByRelease,
    loadingByRelease,
    errorByRelease,
    breakdownDataMap,
    loadingBreakdowns,
    fetchAll,
    fetchItemsForRelease,
    refreshRelease,
  };
}
