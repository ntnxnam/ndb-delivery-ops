/**
 * useEraComponents
 *
 * Fetches the full ERA project component list from GET /api/component/list.
 * Result is cached in-memory for the session (the server also caches for 1 h).
 * Returns { components: string[], loading, error }
 */
import { useState, useEffect } from 'react';
import { authenticatedGet } from '../utils/api';

let _cached = null; // module-level cache so it survives re-renders

export function useEraComponents() {
  const [components, setComponents] = useState(_cached || []);
  const [loading, setLoading] = useState(!_cached);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (_cached) return; // already loaded

    let cancelled = false;
    setLoading(true);

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    authenticatedGet('/api/component/list', {}, { jiraToken, username })
      .then((resp) => {
        if (cancelled) return;
        const names = (resp.data?.components || []).map((c) => c.name).filter(Boolean);
        _cached = names;
        setComponents(names);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load components');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  return { components, loading, error };
}
