import { useState, useRef, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';
import { getUserFacingMessage } from '../utils/errorMessages';
// import { fetchDynamicReleaseData, migrateLegacyToDynamic } from '../utils/dynamicReleaseUtils'; // Removed for core refactoring

// Module-level result cache keyed by fixVersion name. Survives component
// re-mounts so navigating between ReleaseVersionTab and ReleaseTrendsPage,
// or revisiting a version, does NOT re-hit the heavy
// /api/jira/release-items-{commit,long-term} endpoints.
//
// Entry shape: {
//   commit: Array,         // committed items (Step 1 result)
//   longTermFunded: Array, // long-term funded items (Step 2 result), or null if not yet fetched
//   sectionMetadata: object,
//   fetchedAt: number,     // ms epoch of the commit-items fetch
//   longTermFetchedAt: number|null,
// }
const releaseItemsCache = new Map();
const releaseItemsInFlight = new Map();         // version -> Promise<{ commit, sectionMetadata }>
const longTermInFlight = new Map();             // version -> Promise<{ longTermFunded, sectionMetadata }>

// 5 minutes — items mutate more often than versions (status, sprint, dates)
// so a tighter TTL than release-versions (10 min). Refresh button bypasses.
const RELEASE_ITEMS_TTL_MS = 5 * 60 * 1000;

function readItemsCache(version) {
  if (!version) return null;
  const entry = releaseItemsCache.get(version);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > RELEASE_ITEMS_TTL_MS) {
    releaseItemsCache.delete(version);
    return null;
  }
  return entry;
}

function writeCommitItems(version, commit, sectionMetadata) {
  if (!version) return;
  const prev = releaseItemsCache.get(version) || {};
  releaseItemsCache.set(version, {
    commit,
    longTermFunded: prev.longTermFunded ?? null,
    sectionMetadata,
    fetchedAt: Date.now(),
    longTermFetchedAt: prev.longTermFetchedAt ?? null,
  });
}

function writeLongTermItems(version, longTermFunded, sectionMetadata) {
  if (!version) return;
  const prev = releaseItemsCache.get(version);
  if (!prev) return; // commit must be cached first
  releaseItemsCache.set(version, {
    ...prev,
    longTermFunded,
    sectionMetadata,
    longTermFetchedAt: Date.now(),
  });
}

function clearItemsCache(version) {
  if (version) releaseItemsCache.delete(version);
}

/**
 * Custom hook for fetching and managing release items
 * @returns {object} - { items, loadingItems, fetchItemsForVersion, refreshItemsForVersion, fetchLongTermItems, dynamicMode, setDynamicMode, sectionMetadata }
 */
export function useReleaseItems() {
  const [items, setItems] = useState({ 
    commit: [],
    longTermFunded: []
  });
  const [loadingItems, setLoadingItems] = useState(false);
  const [error, setError] = useState('');
  const [_dynamicMode, _setDynamicMode] = useState(false); // Permanently disabled - use proven legacy API only
  const [sectionMetadata, setSectionMetadata] = useState({});
  
  // AbortController for request cancellation
  const abortControllerRef = useRef(null);

  const performLongTermFetch = useCallback(async (version) => {
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    if (!jiraToken) {
      setError('JIRA token required for long-term items');
      return null;
    }

    setSectionMetadata(prev => ({ ...prev, loadingLongTerm: true }));

    const promise = (async () => {
      try {
        const body = { fixVersion: version };
        const longTermResponse = await authenticatedPost(
          '/api/jira/release-items-long-term',
          body,
          { jiraToken, username },
          { signal: abortControllerRef.current?.signal }
        );
        if (!longTermResponse.data.success) {
          console.error('Error fetching long-term items:', longTermResponse.data.error);
          return { longTermItems: [], ok: false };
        }
        const longTermItems = longTermResponse.data.data?.items || [];
        return { longTermItems, ok: true };
      } finally {
        longTermInFlight.delete(version);
      }
    })();
    longTermInFlight.set(version, promise);

    try {
      const { longTermItems, ok } = await promise;
      if (!ok) {
        setSectionMetadata(prev => ({ ...prev, loadingLongTerm: false }));
        return null;
      }
      console.log(`[useReleaseItems] Step 2 complete: Got ${longTermItems.length} long-term funded items`);

      setItems(prev => ({ ...prev, longTermFunded: longTermItems }));

      let nextMetadata;
      setSectionMetadata(prev => {
        nextMetadata = {
          ...prev,
          detectedSections: ['commit', ...(longTermItems.length > 0 ? ['longTermFunded'] : [])],
          sectionData: {
            ...prev.sectionData,
            ...(longTermItems.length > 0 && {
              longTermFunded: { name: 'Long-term-funded', itemCount: longTermItems.length, isLegacy: true, loaded: true }
            })
          },
          totalItems: (prev.totalItems || 0) + longTermItems.length,
          loadingLongTerm: false
        };
        return nextMetadata;
      });

      writeLongTermItems(version, longTermItems, nextMetadata);
      return longTermItems;
    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        console.log('[useReleaseItems] Long-term fetch was cancelled');
        return null;
      }
      console.error('[useReleaseItems] Error fetching long-term items:', error);
      setSectionMetadata(prev => ({ ...prev, loadingLongTerm: false }));
      return null;
    }
  }, []);

  const fetchLongTermItems = useCallback(async (version) => {
    if (!version) return null;

    // Cache hit (long-term already cached for this version) -> hydrate, skip API.
    const cached = readItemsCache(version);
    if (cached && Array.isArray(cached.longTermFunded)) {
      setItems(prev => ({ ...prev, longTermFunded: cached.longTermFunded }));
      setSectionMetadata(cached.sectionMetadata || {});
      return cached.longTermFunded;
    }

    // Concurrent fetch in progress for this version -> reuse it.
    const existing = longTermInFlight.get(version);
    if (existing) {
      try {
        const { longTermItems } = await existing;
        if (Array.isArray(longTermItems)) {
          setItems(prev => ({ ...prev, longTermFunded: longTermItems }));
        }
        return longTermItems;
      } catch {
        return null;
      }
    }

    return performLongTermFetch(version);
  }, [performLongTermFetch]);

  const performItemsFetch = useCallback(async (version) => {
    // Cancel previous request if it exists
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    if (!jiraToken) {
      setError('JIRA token required');
      return null;
    }

    setLoadingItems(true);
    setError('');
    setItems({ commit: [], longTermFunded: [] });
    setSectionMetadata({});

    const promise = (async () => {
      try {
        const body = { fixVersion: version };
        console.log('[useReleaseItems] Step 1: Fetching committed items...');
        const commitResponse = await authenticatedPost(
          '/api/jira/release-items-commit',
          body,
          { jiraToken, username },
          { signal: abortControllerRef.current.signal }
        );
        if (!commitResponse.data.success) {
          throw new Error(`Failed to load committed items: ${commitResponse.data.error || commitResponse.data.message}`);
        }
        return commitResponse.data.data?.items || [];
      } finally {
        releaseItemsInFlight.delete(version);
      }
    })();
    releaseItemsInFlight.set(version, promise);

    try {
      const commitItems = await promise;
      console.log(`[useReleaseItems] Step 1 complete: Got ${commitItems.length} committed items`);

      const initialItems = { commit: commitItems, longTermFunded: [] };
      const newMetadata = {
        detectedSections: ['commit'],
        sectionData: {
          commit: { name: 'Commit', itemCount: commitItems.length, isLegacy: true, loaded: true }
        },
        isDynamic: false,
        totalItems: commitItems.length,
        loadingLongTerm: false
      };

      setItems(initialItems);
      setSectionMetadata(newMetadata);
      writeCommitItems(version, commitItems, newMetadata);

      return initialItems;
    } catch (error) {
      if (error.name === 'AbortError' || error.code === 'ERR_CANCELED') {
        console.log('[useReleaseItems] Request was cancelled');
        return null;
      }
      console.error('[useReleaseItems] Error fetching items:', error);
      const userMessage = getUserFacingMessage(error, 'Failed to fetch release items');
      setError(userMessage);
      setItems({ commit: [], longTermFunded: [] });
      setSectionMetadata({});
      throw error;
    } finally {
      setLoadingItems(false);
    }
  }, []);

  // Cache-aware items fetch. Used by Load button + auto-load effects.
  // - Cache hit: hydrate state from cache, do NOT hit the API.
  // - Cache miss: fetch committed items, cache them.
  const fetchItemsForVersion = useCallback(async (version) => {
    if (!version) {
      setError('Please select a version');
      return null;
    }

    // Cache hit -> hydrate state without an API call.
    const cached = readItemsCache(version);
    if (cached) {
      const hydrated = {
        commit: cached.commit || [],
        longTermFunded: Array.isArray(cached.longTermFunded) ? cached.longTermFunded : [],
      };
      setItems(hydrated);
      setSectionMetadata(cached.sectionMetadata || {});
      setError('');
      setLoadingItems(false);
      return hydrated;
    }

    // Concurrent fetch in progress for this version -> reuse.
    const existing = releaseItemsInFlight.get(version);
    if (existing) {
      try {
        const commitItems = await existing;
        const hydrated = { commit: commitItems, longTermFunded: [] };
        setItems(hydrated);
        return hydrated;
      } catch {
        return null;
      }
    }

    return performItemsFetch(version);
  }, [performItemsFetch]);

  // Force-refresh — bypass cache for both commit and long-term items.
  const refreshItemsForVersion = useCallback(async (version) => {
    if (!version) return null;
    clearItemsCache(version);
    const result = await performItemsFetch(version);
    // Long-term is fetched separately by the consumer; clearItemsCache above
    // already wiped longTermFunded so the next fetchLongTermItems will refetch.
    return result;
  }, [performItemsFetch]);


  // Cleanup function to cancel ongoing requests
  const cancelRequests = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
  };

  return {
    items,
    loadingItems,
    error,
    setError,
    fetchItemsForVersion,
    refreshItemsForVersion,
    fetchLongTermItems,
    setItems,
    sectionMetadata,
    cancelRequests
  };
}

