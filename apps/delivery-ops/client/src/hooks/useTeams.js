import { useState, useEffect } from 'react';
import { getApiBase } from '../utils/api';

const API_BASE = getApiBase();

// Module-level cache so /api/config/teams is hit at most once per app load,
// regardless of how many components mount this hook. (TeamProvider already
// caches teams in context; this hook predates that and is still used by
// a handful of legacy consumers — long-term they should switch to useTeam()
// from TeamContext. Until then, this dedupe is cheap insurance.)
let teamsCache = null;
let teamsPromise = null;

async function loadTeamsOnce() {
  if (teamsCache) return teamsCache;
  if (teamsPromise) return teamsPromise;
  teamsPromise = (async () => {
    try {
      const res = await fetch(`${API_BASE}/api/config/teams`, {
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Teams fetch failed: ${res.status}`);
      const data = await res.json();
      teamsCache = Array.isArray(data) ? data : data.teams || [];
      return teamsCache;
    } catch (err) {
      teamsPromise = null;
      throw err;
    }
  })();
  return teamsPromise;
}

/**
 * Fetches the list of configured teams from /api/config/teams.
 *
 * Previously duplicated inline with `axios.get` in KPIPage, SprintReportPage,
 * ReleaseTrendsPage, and GenericEmailer. Use this hook in all of those instead,
 * or prefer useTeam() from TeamContext if you also need selectedTeamId.
 *
 * @returns {{ teams: Array, loading: boolean, error: string|null }}
 */
export function useTeams() {
  const [teams, setTeams] = useState(teamsCache || []);
  const [loading, setLoading] = useState(!teamsCache);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchTeams() {
      if (teamsCache) {
        setTeams(teamsCache);
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await loadTeamsOnce();
        if (!cancelled) setTeams(data);
      } catch (err) {
        if (!cancelled) setError(err.message || 'Failed to load teams');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchTeams();
    return () => { cancelled = true; };
  }, []);

  return { teams, loading, error };
}
