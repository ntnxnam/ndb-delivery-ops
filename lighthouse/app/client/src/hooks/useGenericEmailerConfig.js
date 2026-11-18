import { useState, useEffect } from 'react';

/**
 * Fetches the generic emailer configuration from /api/config/generic-emailer.
 *
 * Previously inline inside GenericEmailer.js with a raw axios.get call.
 *
 * @returns {{ config: Object|null, loading: boolean, error: string|null }}
 */
export function useGenericEmailerConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/config/generic-emailer')
      .then(res => {
        if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
        return res.json();
      })
      .then(data => {
        if (!cancelled) {
          setConfig(data);
          setLoading(false);
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(err.message || 'Failed to load emailer config');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  return { config, loading, error };
}
