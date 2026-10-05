/**
 * useTeamAdmin
 *
 * Team Management list / save / test (super-admin /api/admin/* endpoints).
 * Returns { teams, loading, error, loadTeams, saveTeam, testTeam }.
 */
import { useState, useCallback } from 'react';
import { authenticatedGet, authenticatedPost, authenticatedPut } from '../utils/api';
import { getUserFacingMessage } from '../utils/errorMessages';

export function adminAuth() {
  return {
    jiraToken: localStorage.getItem('jiraToken'),
    username: localStorage.getItem('username') || '',
  };
}

export function adminErrorMessage(err, fallback) {
  const data = err?.response?.data;
  return data?.message || data?.error || getUserFacingMessage(err, { fallback });
}

export function useTeamAdmin() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await authenticatedGet('/api/admin/teams', {}, adminAuth());
      const list = response.data?.success ? response.data.teams || [] : [];
      setTeams(list);
      return list;
    } catch (err) {
      setError(adminErrorMessage(err, 'Failed to load teams'));
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  /** Create (no editId) or update a team. Throws a user-facing Error on failure. */
  const saveTeam = useCallback(async (payload, editId = null) => {
    try {
      const response = editId
        ? await authenticatedPut(`/api/admin/teams/${encodeURIComponent(editId)}`, payload, adminAuth())
        : await authenticatedPost('/api/admin/teams', payload, adminAuth());
      const team = response.data?.team;
      if (!response.data?.success || !team) throw new Error(response.data?.message || 'Failed to save team');
      setTeams((prev) => {
        const kpiCount = prev.find((t) => t.id === team.id)?.kpiCount ?? 0;
        const next = { ...team, kpiCount };
        return prev.some((t) => t.id === team.id)
          ? prev.map((t) => (t.id === team.id ? next : t))
          : [...prev, next];
      });
      return team;
    } catch (err) {
      throw new Error(err.response ? adminErrorMessage(err, 'Failed to save team') : err.message);
    }
  }, []);

  const testTeam = useCallback(async (teamId) => {
    try {
      const response = await authenticatedPost('/api/admin/test-team-config', { teamId }, adminAuth());
      return response.data;
    } catch (err) {
      return { success: false, error: adminErrorMessage(err, 'Test failed') };
    }
  }, []);

  return { teams, loading, error, loadTeams, saveTeam, testTeam };
}
