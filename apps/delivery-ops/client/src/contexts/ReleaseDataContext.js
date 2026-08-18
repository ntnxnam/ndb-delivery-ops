import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { authenticatedGet } from '../utils/api';
import { useSelectedRelease } from './SelectedReleaseContext';

const ReleaseDataContext = createContext(null);

const RELEASE_DATA_TTL_MS = 5 * 60 * 1000;
const CACHE_STATUS_TTL_MS = 5 * 60 * 1000;
const releaseDataCache = new Map();
const releaseDataInFlight = new Map();
let cacheStatusCache = null;
let cacheStatusInFlight = null;

function readReleaseCache(release) {
  if (!release) return null;
  const entry = releaseDataCache.get(release);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > RELEASE_DATA_TTL_MS) {
    releaseDataCache.delete(release);
    return null;
  }
  return entry;
}

function isJiraUnreachable(err) {
  const status = err?.response?.status;
  // 503 from these auth-gated endpoints always means JIRA host is unreachable.
  // Also match explicit reason tag once server forwards it.
  if (status === 503) return true;
  const reason = err?.response?.data?.reason;
  return reason === 'jira_unreachable';
}

async function fetchCacheStatus({ productId, jiraToken, username, force }) {
  if (!force && cacheStatusCache && Date.now() - cacheStatusCache.fetchedAt <= CACHE_STATUS_TTL_MS) {
    return cacheStatusCache.data;
  }
  if (!force && cacheStatusInFlight) {
    // Dedup: if the in-flight promise rejects, return the empty default instead of re-throwing.
    return cacheStatusInFlight.catch(() => ({ synced: [], meta: {} }));
  }
  cacheStatusInFlight = (async () => {
    try {
      const res = await authenticatedGet(
        '/api/release-dataset/releases',
        { productId },
        { jiraToken, username }
      );
      const data = res?.data?.data || { synced: [], meta: {} };
      cacheStatusCache = { data, fetchedAt: Date.now() };
      return data;
    } finally {
      cacheStatusInFlight = null;
    }
  })();
  // Wrap so any rejection is handled by the caller's try/catch, not here.
  return cacheStatusInFlight;
}

export function ReleaseDataProvider({ children }) {
  const { selectedRelease, productId } = useSelectedRelease();
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  const [releaseTickets, setReleaseTickets] = useState([]);
  const [releaseMeta, setReleaseMeta] = useState(null);
  const [loadingRelease, setLoadingRelease] = useState(false);
  const [releaseError, setReleaseError] = useState(null);
  const [cacheStatus, setCacheStatus] = useState({ synced: [], meta: {} });
  const [cacheStatusLoaded, setCacheStatusLoaded] = useState(false);
  const [jiraUnreachable, setJiraUnreachable] = useState(false);

  const loadRelease = useCallback(async (release, force = false) => {
    const releasePrefix = (productId || 'ndb').toUpperCase();
    const isCatchAll = !release || !release.toUpperCase().startsWith(releasePrefix + '-');

    if (!release || !jiraToken || isCatchAll) {
      setReleaseTickets([]);
      setReleaseMeta(null);
      setReleaseError(null);
      return;
    }

    if (!force) {
      const cached = readReleaseCache(release);
      if (cached) {
        setReleaseTickets(cached.tickets);
        setReleaseMeta(cached.meta);
        setReleaseError(null);
        return;
      }
    } else {
      releaseDataCache.delete(release);
    }

    const existing = releaseDataInFlight.get(release);
    if (existing) {
      try {
        const result = await existing;
        setReleaseTickets(result.tickets);
        setReleaseMeta(result.meta);
        setReleaseError(result.error);
        if (result.error === 'jira_unreachable') setJiraUnreachable(true);
      } catch (err) {
        setReleaseTickets([]);
        setReleaseMeta(null);
        if (isJiraUnreachable(err)) {
          setJiraUnreachable(true);
          setReleaseError('jira_unreachable');
        } else {
          setReleaseError('load_failed');
        }
      }
      return;
    }

    setLoadingRelease(true);
    setReleaseError(null);
    const promise = (async () => {
      try {
        const res = await authenticatedGet(
          `/api/release-dataset/per-release/${encodeURIComponent(release)}`,
          { productId },
          { jiraToken, username }
        );
        const data = res?.data?.data || {};
        const next = {
          tickets: Array.isArray(data.tickets) ? data.tickets : [],
          meta: data.meta || null,
          error: null,
        };
        releaseDataCache.set(release, { ...next, fetchedAt: Date.now() });
        return next;
      } catch (err) {
        if (isJiraUnreachable(err)) {
          return { tickets: [], meta: null, error: 'jira_unreachable' };
        }
        const reason = err?.response?.data?.reason;
        if (reason === 'not_cached' || err?.response?.status === 404) {
          return { tickets: [], meta: null, error: 'not_synced' };
        }
        return { tickets: [], meta: null, error: 'load_failed' };
      } finally {
        releaseDataInFlight.delete(release);
      }
    })();

    releaseDataInFlight.set(release, promise);
    try {
      const result = await promise;
      setReleaseTickets(result.tickets);
      setReleaseMeta(result.meta);
      setReleaseError(result.error);
      if (result.error === 'jira_unreachable') setJiraUnreachable(true);
    } catch (err) {
      // Defensive: inner promise always resolves, but guard against unexpected throws.
      setReleaseTickets([]);
      setReleaseMeta(null);
      if (isJiraUnreachable(err)) {
        setJiraUnreachable(true);
        setReleaseError('jira_unreachable');
      } else {
        setReleaseError('load_failed');
      }
    } finally {
      setLoadingRelease(false);
    }
  }, [jiraToken, productId, username]);

  const refreshCacheStatus = useCallback(async (force = false) => {
    if (!jiraToken) return;
    try {
      const data = await fetchCacheStatus({ productId, jiraToken, username, force });
      setCacheStatus(data);
      setJiraUnreachable(false);
    } catch (err) {
      if (isJiraUnreachable(err)) {
        setJiraUnreachable(true);
      }
      // Leave cacheStatus at its last known value; don't crash.
    } finally {
      setCacheStatusLoaded(true);
    }
  }, [jiraToken, productId, username]);

  // Step 1: fetch the list of synced releases first.
  useEffect(() => {
    refreshCacheStatus(false);
  }, [refreshCacheStatus, productId]);

  // Step 2: only attempt a per-release load AFTER we know what's synced.
  // This prevents a guaranteed 404 for releases that haven't been synced yet.
  useEffect(() => {
    if (!cacheStatusLoaded) return; // wait — don't fire until status is known

    const syncedReleases = cacheStatus?.synced || [];
    if (!syncedReleases.includes(selectedRelease)) {
      setReleaseTickets([]);
      setReleaseMeta(null);
      setReleaseError('not_synced');
      return;
    }
    loadRelease(selectedRelease, false);
  }, [selectedRelease, loadRelease, cacheStatus, cacheStatusLoaded]);

  const value = useMemo(() => ({
    releaseTickets,
    releaseMeta,
    loadingRelease,
    releaseError,
    cacheStatus,
    jiraUnreachable,
    refreshRelease: () => loadRelease(selectedRelease, true),
    refreshCacheStatus: () => refreshCacheStatus(true),
  }), [
    cacheStatus,
    jiraUnreachable,
    loadRelease,
    loadingRelease,
    refreshCacheStatus,
    releaseError,
    releaseMeta,
    releaseTickets,
    selectedRelease,
  ]);

  return (
    <ReleaseDataContext.Provider value={value}>
      {children}
    </ReleaseDataContext.Provider>
  );
}

export function useReleaseData() {
  const ctx = useContext(ReleaseDataContext);
  if (!ctx) {
    throw new Error('useReleaseData must be used within ReleaseDataProvider');
  }
  return ctx;
}

