/**
 * useSosHistory — fetches checkpoint-field date history for all SoS items.
 *
 * Calls POST /api/jira/sos-items-history (team sosBaseFilter or baseFilter).
 *
 * No fixVersion or item keys needed from the client — the server owns the
 * filter resolution the same way /sos-items does.
 */

import { useState, useCallback } from 'react';
import { authenticatedPost } from '../utils/api';

export function useSosHistory() {
  const [checkpointHistory, setCheckpointHistory] = useState({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState(null);

  const fetchHistory = useCallback(async (teamId, keys) => {
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    // The page scopes history to the tracked upcoming releases and passes the
    // exact keys to walk. Without keys the server falls back to its own search.
    if (Array.isArray(keys) && keys.length === 0) return;

    setLoadingHistory(true);
    setHistoryError(null);

    try {
      const resp = await authenticatedPost(
        '/api/jira/sos-items-history',
        { teamId, keys },
        { jiraToken, username }
      );

      if (!resp.data.success) {
        throw new Error(resp.data.error || 'Failed to fetch history');
      }

      setCheckpointHistory(resp.data.data?.history || {});
    } catch (err) {
      console.warn('[useSosHistory] History fetch failed (non-fatal):', err.message);
      setHistoryError(err.message);
      // Leave checkpointHistory as {} — dates will render without history overlay
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  return { checkpointHistory, loadingHistory, historyError, fetchHistory };
}
