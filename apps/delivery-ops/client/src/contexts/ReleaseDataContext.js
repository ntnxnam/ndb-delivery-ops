import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authenticatedGet } from '../utils/api';
import { useSelectedRelease } from './SelectedReleaseContext';
import { useTeam } from './TeamContext';

const ReleaseDataContext = createContext(null);

const RELEASE_DATA_TTL_MS = 5 * 60 * 1000;
const releaseDataCache = new Map();
const releaseDataInFlight = new Map();

function cacheKey(productId, release) {
  return `${productId || ''}::${release || ''}`;
}

function readReleaseCache(productId, release) {
  if (!release) return null;
  const key = cacheKey(productId, release);
  const entry = releaseDataCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.fetchedAt > RELEASE_DATA_TTL_MS) {
    releaseDataCache.delete(key);
    return null;
  }
  return entry;
}

function isJiraUnreachable(err) {
  const status = err?.response?.status;
  if (status === 503) return true;
  const reason = err?.response?.data?.reason;
  return reason === 'jira_unreachable';
}

export function ReleaseDataProvider({ children }) {
  const { selectedRelease, productId } = useSelectedRelease();
  const { teamEpoch, selectedTeam } = useTeam();
  const loadedEpochRef = useRef(0);
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

  const [releaseTickets, setReleaseTickets] = useState([]);
  const [releaseMeta, setReleaseMeta] = useState(null);
  const [loadingRelease, setLoadingRelease] = useState(false);
  const [releaseError, setReleaseError] = useState(null);
  const [jiraUnreachable, setJiraUnreachable] = useState(false);

  const loadRelease = useCallback(async (release, force = false) => {
    const pinnedNames = Array.isArray(selectedTeam?.activeVersionNames)
      ? selectedTeam.activeVersionNames
      : [];
    const isPinnedCatchAll = !release || pinnedNames.includes(release);

    if (!release || !jiraToken || !productId || isPinnedCatchAll) {
      setReleaseTickets([]);
      setReleaseMeta(null);
      setReleaseError(null);
      return;
    }

    const key = cacheKey(productId, release);

    if (!force) {
      const cached = readReleaseCache(productId, release);
      if (cached) {
        setReleaseTickets(cached.tickets);
        setReleaseMeta(cached.meta);
        setReleaseError(null);
        return;
      }
    } else {
      releaseDataCache.delete(key);
    }

    const existing = releaseDataInFlight.get(key);
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
        releaseDataCache.set(key, { ...next, fetchedAt: Date.now() });
        return next;
      } catch (err) {
        if (isJiraUnreachable(err)) {
          return { tickets: [], meta: null, error: 'jira_unreachable' };
        }
        return { tickets: [], meta: null, error: 'load_failed' };
      } finally {
        releaseDataInFlight.delete(key);
      }
    })();

    releaseDataInFlight.set(key, promise);
    try {
      const result = await promise;
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
    } finally {
      setLoadingRelease(false);
    }
  }, [jiraToken, productId, selectedTeam?.activeVersionNames, username]);

  useEffect(() => {
    const force = teamEpoch > loadedEpochRef.current;
    loadedEpochRef.current = teamEpoch;
    loadRelease(selectedRelease, force);
  }, [selectedRelease, loadRelease, teamEpoch]);

  const value = useMemo(() => ({
    releaseTickets,
    releaseMeta,
    loadingRelease,
    releaseError,
    cacheStatus: { synced: [], meta: {} },
    jiraUnreachable,
    refreshRelease: () => loadRelease(selectedRelease, true),
    refreshCacheStatus: async () => {},
  }), [
    jiraUnreachable,
    loadRelease,
    loadingRelease,
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
