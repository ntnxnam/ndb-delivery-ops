import { useTeam } from '../contexts/TeamContext';

/**
 * Back-compat wrapper. All team list consumers should go through TeamContext
 * so /api/config/teams is fetched once per session, not once per page.
 */
export function useTeams() {
  const { teams, loading, error, fetchTeams } = useTeam();
  return { teams, loading, error, refetch: fetchTeams };
}
