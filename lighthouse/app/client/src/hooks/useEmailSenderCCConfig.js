import { useState, useEffect } from 'react';

/**
 * Fetches Email Sender CC options from /api/config/email-sender.
 * @returns {{ config: { defaultCC: string[], defaultTO: string[] }|null, loading: boolean, error: string|null }}
 */
export function useEmailSenderCCConfig() {
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    fetch('/api/config/email-sender')
      .then((res) => {
        if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setConfig(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || 'Failed to load Email Sender CC config');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, []);

  return { config, loading, error };
}
