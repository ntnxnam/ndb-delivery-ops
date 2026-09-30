/**
 * useEraComponents
 *
 * Component names for the selected team's JIRA project
 * (GET /api/component/list?productId=). Cached per team for the session.
 * Returns { components: string[], loading, error }
 */
import { useState, useEffect } from 'react';
import { authenticatedGet } from '../utils/api';

const cache = {};

export function useEraComponents(teamId) {
  const key = (teamId || '').trim();
  const [components, setComponents] = useState(cache[key] || []);
  const [loading, setLoading] = useState(Boolean(key) && !cache[key]);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!key) {
      setComponents([]);
      setLoading(false);
      return undefined;
    }
    if (cache[key]) {
      setComponents(cache[key]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    authenticatedGet('/api/component/list', { productId: key }, { jiraToken, username })
      .then((resp) => {
        if (cancelled) return;
        const names = (resp.data?.components || []).map((c) => c.name).filter(Boolean);
        cache[key] = names;
        setComponents(names);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Failed to load components');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [key]);

  return { components, loading, error };
}
