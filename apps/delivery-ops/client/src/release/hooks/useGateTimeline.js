import { useCallback, useEffect, useState } from 'react';
import { fetchGateTimeline } from '../services/releaseBriefService';

/**
 * Lightweight gate-timeline loader for legacy pages that need the shared
 * release-gate chips without pulling all Release Brief state.
 */
export function useGateTimeline({ release, jiraToken, username }) {
  const [gates, setGates] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!release || !jiraToken || !username) {
      setGates([]);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { timeline } = await fetchGateTimeline({ release, jiraToken, username });
      setGates(Array.isArray(timeline?.gates) ? timeline.gates : []);
    } catch (err) {
      setGates([]);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [release, jiraToken, username]);

  useEffect(() => {
    load();
  }, [load]);

  return { gates, loading, error, refresh: load };
}
