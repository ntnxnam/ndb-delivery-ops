/**
 * useComponentCounts — live JIRA component breakdown for Outstanding / TBV donuts.
 *
 * POST /api/release-dataset/component-counts { productId, release }
 * Counts use filter = "{release}-All" so they match click-through URLs.
 */

import { useState, useEffect, useRef } from 'react';
import { authenticatedPost } from '../utils/api';
import { getUserFacingMessage } from '../utils/errorMessages';

/**
 * @param {{ productId: string, release: string, enabled?: boolean }} opts
 * @returns {{
 *   loading: boolean,
 *   outstanding: Array<{name: string, count: number}> | null,
 *   tbv: Array<{name: string, count: number}> | null,
 *   jql: { outstanding: string|null, tbv: string|null },
 *   error: string|null,
 * }}
 */
export function useComponentCounts({ productId, release, enabled = true }) {
  const [loading, setLoading] = useState(false);
  const [outstanding, setOutstanding] = useState(null);
  const [tbv, setTbv] = useState(null);
  const [jql, setJql] = useState({ outstanding: null, tbv: null });
  const [error, setError] = useState(null);
  const reqIdRef = useRef(0);

  useEffect(() => {
    if (!enabled || !productId || !release) {
      setOutstanding(null);
      setTbv(null);
      setJql({ outstanding: null, tbv: null });
      setError(null);
      setLoading(false);
      return undefined;
    }

    const reqId = ++reqIdRef.current;
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setError(null);
      const jiraToken = localStorage.getItem('jiraToken') || '';
      const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
      try {
        const resp = await authenticatedPost(
          '/api/release-dataset/component-counts',
          { productId, release },
          { jiraToken, username }
        );
        if (cancelled || reqId !== reqIdRef.current) return;
        if (!resp.data?.success) {
          throw new Error(resp.data?.error || 'Component counts failed');
        }
        setOutstanding(Array.isArray(resp.data.outstanding) ? resp.data.outstanding : []);
        setTbv(Array.isArray(resp.data.tbv) ? resp.data.tbv : []);
        setJql({
          outstanding: resp.data.jql?.outstanding || null,
          tbv: resp.data.jql?.tbv || null,
        });
      } catch (err) {
        if (cancelled || reqId !== reqIdRef.current) return;
        setOutstanding(null);
        setTbv(null);
        setJql({ outstanding: null, tbv: null });
        const serverErr = err.response?.data?.error;
        // Prefer the API's concrete message (e.g. missing filter) over the
        // generic 5xx mapping in getUserFacingMessage.
        setError(
          (serverErr && String(serverErr).length < 200)
            ? serverErr
            : getUserFacingMessage(err, {
                context: 'component-counts',
                fallback: err.message || 'Failed to load component counts',
              })
        );
      } finally {
        if (!cancelled && reqId === reqIdRef.current) setLoading(false);
      }
    };

    run();
    return () => { cancelled = true; };
  }, [productId, release, enabled]);

  return { loading, outstanding, tbv, jql, error };
}

export default useComponentCounts;
