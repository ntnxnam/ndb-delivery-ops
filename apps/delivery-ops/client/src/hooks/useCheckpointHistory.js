import { useState, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';

// Module-level cache keyed by fixVersion. Same shape as the cache in
// useReleaseItems / useReleaseVersions: survives component re-mounts so
// the heavy /api/jira/release-items-history POST only fires once per
// version within the TTL window.
//
// Entry shape: { history: object, fetchedAt: number }
const historyCache = new Map();
const historyInFlight = new Map();

// 5 minutes — checkpoint history changes when JIRA dates are edited
// (commit gate, promotion gate, code complete). Same TTL as items.
const HISTORY_TTL_MS = 5 * 60 * 1000;

function readHistoryCache(version) {
  if (!version) return null;
  const entry = historyCache.get(version);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > HISTORY_TTL_MS) {
    historyCache.delete(version);
    return null;
  }
  return entry;
}

function writeHistoryCache(version, history) {
  if (!version) return;
  historyCache.set(version, { history, fetchedAt: Date.now() });
}

function clearHistoryCache(version) {
  if (version) historyCache.delete(version);
}

/**
 * Custom hook for fetching and managing checkpoint history.
 * @returns {object} - { checkpointHistory, loadingHistory, fetchHistoryForVersion, refreshHistoryForVersion, setCheckpointHistory }
 */
export function useCheckpointHistory() {
  const [checkpointHistory, setCheckpointHistory] = useState({});
  const [loadingHistory, setLoadingHistory] = useState(false);

  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  const performFetch = useCallback(async (version) => {
    setLoadingHistory(true);

    const promise = (async () => {
      try {
        const historyResponse = await authenticatedPost('/api/jira/release-items-history', {
          fixVersion: version
        }, {
          jiraToken,
          username
        });
        if (historyResponse.data.success) {
          return historyResponse.data.data?.history || {};
        }
        console.warn('History response was not successful:', historyResponse.data);
        return null;
      } finally {
        historyInFlight.delete(version);
      }
    })();
    historyInFlight.set(version, promise);

    try {
      const historyData = await promise;
      if (historyData !== null) {
        setCheckpointHistory(historyData);
        writeHistoryCache(version, historyData);
      }
      return historyData;
    } catch (err) {
      console.error('Error fetching history:', err);
      if (err.response?.status === 504 || err.response?.status === 408) {
        console.warn('History fetch timed out. The request is taking longer than expected.');
      } else if (err.response?.status === 429) {
        console.warn('Rate limit exceeded for history fetch. Please wait 60-90 seconds.');
      }
      return null;
    } finally {
      setLoadingHistory(false);
    }
  }, [jiraToken, username]);

  // Cache-aware fetch. Used by the Load orchestrator and any auto-fetch effect.
  const fetchHistoryForVersion = useCallback(async (version) => {
    if (!version || !jiraToken) return;

    // Cache hit -> hydrate state, skip API.
    const cached = readHistoryCache(version);
    if (cached) {
      setCheckpointHistory(cached.history);
      return cached.history;
    }

    // Concurrent fetch in progress -> reuse.
    const existing = historyInFlight.get(version);
    if (existing) {
      try {
        const historyData = await existing;
        if (historyData) setCheckpointHistory(historyData);
        return historyData;
      } catch {
        return null;
      }
    }

    // Reset display state for new fetches (preserves prior UX where the table
    // briefly shows empty while loading). Cache hits skip this for instant UX.
    setCheckpointHistory({});
    return performFetch(version);
  }, [jiraToken, performFetch]);

  // Force-refresh — bypasses cache.
  const refreshHistoryForVersion = useCallback(async (version) => {
    if (!version || !jiraToken) return;
    clearHistoryCache(version);
    setCheckpointHistory({});
    return performFetch(version);
  }, [jiraToken, performFetch]);

  return {
    checkpointHistory,
    loadingHistory,
    fetchHistoryForVersion,
    refreshHistoryForVersion,
    setCheckpointHistory
  };
}
