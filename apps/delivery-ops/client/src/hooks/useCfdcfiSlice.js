/**
 * useCfdcfiSlice — view-specific AI 2-liner for CFD/CFI drill drawers.
 * POST /api/ai/cfdcfi-slice { teamId, view, keys, timeframe, meta }
 * Mirrors useOncallSlice.js.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { authenticatedPost } from '../shared/services/apiService';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

export function useCfdcfiSlice({ teamId, view, keys, timeframe, meta, enabled }) {
  const [slice, setSlice] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cacheRef = useRef(new Map());
  const keySig = (keys || []).slice(0, 20).join(',');
  const fetchSlice = useCallback(async () => {
    if (!enabled || !teamId || !view || !keys || !keys.length) return;
    const cacheKey = `${teamId}|${view}|${timeframe}|${keySig}`;
    if (cacheRef.current.has(cacheKey)) { setSlice(cacheRef.current.get(cacheKey)); return; }
    setLoading(true); setError(null);
    try {
      const resp = await authenticatedPost('/api/ai/cfdcfi-slice', { teamId, view, keys: keys.slice(0, 20), timeframe, meta: meta || {} }, creds(), { timeout: 90000 });
      const text = resp.data?.summary || ''; cacheRef.current.set(cacheKey, text); setSlice(text);
    } catch (err) { setError(err.response?.data?.error || err.message || 'Slice failed'); } finally { setLoading(false); }
  }, [teamId, view, keySig, timeframe, meta, enabled, keys]);
  useEffect(() => {
    if (!enabled) return undefined;
    setSlice(null); fetchSlice(); return undefined;
  }, [enabled, teamId, view, keySig, timeframe, fetchSlice]);
  return { slice, loading, error, refetch: fetchSlice };
}
export default useCfdcfiSlice;
