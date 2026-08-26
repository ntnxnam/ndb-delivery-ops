import React, { createContext, useContext, useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { getApiBase, getAuthHeaders } from '../utils/api';
import { STORAGE_KEYS } from '../shared/utils/constants';

const TEAM_STORAGE_KEY = STORAGE_KEYS.SELECTED_TEAM;
const TEAMS_FETCH_TIMEOUT_MS = 8000;

const TeamContext = createContext(null);

export function findTeamById(teams, teamId) {
  if (!teamId || !Array.isArray(teams)) return null;
  const needle = String(teamId).trim().toLowerCase();
  return teams.find((t) => String(t.id || '').trim().toLowerCase() === needle) || null;
}

/**
 * Hook to access team context
 * Must be used within TeamProvider
 */
export const useTeam = () => {
  const context = useContext(TeamContext);
  if (!context) {
    throw new Error('useTeam must be used within TeamProvider');
  }
  return context;
};

/**
 * Team context provider that manages team selection and ensures all pages
 * work in the context of the selected team. One fetch per app session.
 */
export const TeamProvider = ({ children }) => {
  const [teams, setTeams] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(() =>
    localStorage.getItem(TEAM_STORAGE_KEY) || ''
  );
  const [pendingTeamId, setPendingTeamId] = useState(() =>
    localStorage.getItem(TEAM_STORAGE_KEY) || ''
  );
  const [teamEpoch, setTeamEpoch] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [isTransitioning, setIsTransitioning] = useState(false);

  const activeRequestsRef = useRef(new Set());
  const teamChangeCallbacksRef = useRef(new Set());
  const inFlightRef = useRef(null);
  const selectedTeamIdRef = useRef(selectedTeamId);
  selectedTeamIdRef.current = selectedTeamId;

  const registerTeamChangeCallback = useCallback((callback) => {
    teamChangeCallbacksRef.current.add(callback);
    return () => teamChangeCallbacksRef.current.delete(callback);
  }, []);

  const clearTeamData = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.SELECTED_RELEASE);
    localStorage.removeItem('selectedVersion');

    activeRequestsRef.current.forEach((controller) => {
      if (controller && typeof controller.abort === 'function') {
        controller.abort();
      }
    });
    activeRequestsRef.current.clear();

    teamChangeCallbacksRef.current.forEach((callback) => {
      try {
        callback();
      } catch (cbError) {
        console.error('Error in team change callback:', cbError);
      }
    });
  }, []);

  /**
   * Apply a team and refresh team-scoped data on every page.
   * Always runs — including when the id is unchanged — so Fetch
   * can force a reload. Login restore must not call this (it would remount).
   */
  const applyTeam = useCallback((newTeamId) => {
    const nextId = newTeamId || '';
    const previousTeamId = selectedTeamIdRef.current;

    setIsTransitioning(true);
    clearTeamData();
    setSelectedTeamId(nextId);
    setPendingTeamId(nextId);
    localStorage.setItem(TEAM_STORAGE_KEY, nextId);
    setTeamEpoch((n) => n + 1);

    window.dispatchEvent(new CustomEvent('teamChanged', {
      detail: {
        previousTeamId,
        newTeamId: nextId,
        timestamp: Date.now(),
      },
    }));

    setTimeout(() => setIsTransitioning(false), 100);
  }, [clearTeamData]);

  const changeTeam = applyTeam;

  const registerApiRequest = useCallback((controller) => {
    if (controller && typeof controller.abort === 'function') {
      activeRequestsRef.current.add(controller);
      return () => activeRequestsRef.current.delete(controller);
    }
    return () => {};
  }, []);

  const applyTeamsPayload = useCallback((responseData) => {
    const list = Array.isArray(responseData?.teams) ? responseData.teams : [];
    setTeams(list);

    const stored = localStorage.getItem(TEAM_STORAGE_KEY);
    const defaultId = responseData.defaultTeamId || list[0]?.id;
    const teamExists = stored && findTeamById(list, stored);
    const effective = teamExists ? stored : defaultId;

    if (effective) {
      setSelectedTeamId((prev) => {
        if (effective !== prev) {
          localStorage.setItem(TEAM_STORAGE_KEY, effective);
        }
        return effective;
      });
      setPendingTeamId(effective);
    }
    return list;
  }, []);

  const fetchTeams = useCallback(async (opts = {}) => {
    const force = opts.force === true;
    if (inFlightRef.current && !force) {
      return inFlightRef.current;
    }

    const run = (async () => {
      setLoading(true);
      setError('');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), TEAMS_FETCH_TIMEOUT_MS);
      try {
        const { headers: authHeaders } = getAuthHeaders();
        const response = await fetch(`${getApiBase()}/api/config/teams`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const responseData = await response.json();
        if (!responseData || !Array.isArray(responseData.teams)) {
          throw new Error('Invalid teams data received');
        }
        applyTeamsPayload(responseData);
      } catch (fetchError) {
        if (fetchError.name === 'AbortError') {
          setError('Timed out loading teams. Retry to try again.');
        } else {
          setError('Failed to load teams: ' + (fetchError?.message || 'Unknown error'));
        }
      } finally {
        clearTimeout(timeoutId);
        setLoading(false);
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = run;
    return run;
  }, [applyTeamsPayload]);

  const updateTeam = useCallback((teamId, patch) => {
    setTeams((prev) =>
      prev.map((team) =>
        String(team.id || '').trim().toLowerCase() === String(teamId || '').trim().toLowerCase()
          ? { ...team, ...patch }
          : team
      )
    );
  }, []);

  const replaceTeams = useCallback((nextTeams) => {
    if (!Array.isArray(nextTeams)) return;
    setTeams(nextTeams);
  }, []);

  const upsertTeam = useCallback((team) => {
    if (!team || !team.id) return;
    const id = String(team.id).trim().toLowerCase();
    setTeams((prev) => {
      const idx = prev.findIndex((t) => String(t.id || '').trim().toLowerCase() === id);
      if (idx === -1) return [...prev, team];
      const next = [...prev];
      next[idx] = { ...next[idx], ...team };
      return next;
    });
  }, []);

  useEffect(() => {
    fetchTeams();
  }, [fetchTeams]);

  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key === TEAM_STORAGE_KEY && e.newValue !== selectedTeamId) {
        applyTeam(e.newValue || '');
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [selectedTeamId, applyTeam]);

  useEffect(() => {
    const activeRequests = activeRequestsRef.current;
    const teamChangeCallbacks = teamChangeCallbacksRef.current;
    return () => {
      activeRequests.forEach((controller) => {
        if (controller && typeof controller.abort === 'function') {
          controller.abort();
        }
      });
      activeRequests.clear();
      teamChangeCallbacks.clear();
    };
  }, []);

  const selectedTeam = useMemo(
    () => findTeamById(teams, selectedTeamId),
    [teams, selectedTeamId]
  );

  const hasTeamSelected = Boolean(selectedTeamId);

  const contextValue = useMemo(() => ({
    teams,
    selectedTeamId,
    pendingTeamId,
    setPendingTeamId,
    selectedTeam,
    hasTeamSelected,
    teamEpoch,
    loading,
    error,
    isTransitioning,
    applyTeam,
    changeTeam,
    fetchTeams,
    clearTeamData,
    updateTeam,
    replaceTeams,
    upsertTeam,
    registerTeamChangeCallback,
    registerApiRequest,
    showTeamSelector: true,
  }), [
    teams,
    selectedTeamId,
    pendingTeamId,
    selectedTeam,
    hasTeamSelected,
    teamEpoch,
    loading,
    error,
    isTransitioning,
    applyTeam,
    changeTeam,
    fetchTeams,
    clearTeamData,
    updateTeam,
    replaceTeams,
    upsertTeam,
    registerTeamChangeCallback,
    registerApiRequest,
  ]);

  return (
    <TeamContext.Provider value={contextValue}>
      {children}
    </TeamContext.Provider>
  );
};

export default TeamContext;
