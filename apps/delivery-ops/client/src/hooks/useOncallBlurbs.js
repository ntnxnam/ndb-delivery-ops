/**
 * Lazy-load OnCall about + comments for drill drawers.
 * Fixes: cancelled inflight must not stick loading forever.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { authenticatedPost } from '../utils/api';

const creds = () => ({
  jiraToken: localStorage.getItem('jiraToken') || '',
  username: localStorage.getItem('username') || localStorage.getItem('userEmail') || '',
});

function seedEntry(s) {
  if (!s?.key) return null;
  return {
    key: s.key,
    status: s.status || null,
    // Briefing stacks have blurb/stack but usually no true "about" or comments —
    // do not treat them as complete (would skip fetch).
    about: s.about || null,
    comments: Array.isArray(s.comments) ? s.comments : undefined,
    stack: s.blurb || null,
    dwellDays: s.dwell?.currentDwellDays ?? null,
    source: 'briefing',
  };
}

export function useOncallBlurbs({ teamId, keys, enabled, seedStacks }) {
  const [blurbs, setBlurbs] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const cacheRef = useRef({});
  const inflightRef = useRef('');

  const keyList = useMemo(
    () => [...new Set((keys || []).filter(Boolean))].sort(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Array.isArray(keys) ? keys.join(',') : '']
  );
  const keySig = keyList.join(',');

  const seedSig = useMemo(() => {
    return (seedStacks || [])
      .map((s) => s?.key)
      .filter(Boolean)
      .sort()
      .join(',');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(seedStacks) ? seedStacks.map((s) => s?.key).filter(Boolean).sort().join(',') : '']);

  useEffect(() => {
    if (!enabled || !teamId || !keyList.length) {
      setLoading(false);
      return undefined;
    }

    (seedStacks || []).forEach((s) => {
      const entry = seedEntry(s);
      if (!entry) return;
      const prev = cacheRef.current[entry.key] || {};
      // Merge status/stack from briefing; never invent empty comments array
      cacheRef.current[entry.key] = {
        ...entry,
        ...prev,
        status: prev.status || entry.status,
        stack: prev.stack || entry.stack,
        about: prev.about || entry.about || null,
        comments: Array.isArray(prev.comments) ? prev.comments : entry.comments,
      };
    });

    const missing = keyList.filter((k) => {
      const b = cacheRef.current[k];
      return !Array.isArray(b?.comments);
    });
    setBlurbs({ ...cacheRef.current });

    if (!missing.length) {
      setLoading(false);
      return undefined;
    }

    const flight = `${teamId}|${missing.join(',')}`;
    // Allow retry after cancel — only skip if same flight still actively running
    if (inflightRef.current === flight) {
      return undefined;
    }
    inflightRef.current = flight;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const resp = await authenticatedPost(
          '/api/ai/oncall-blurbs',
          { teamId, keys: missing },
          creds(),
          { timeout: 90000 }
        );
        if (cancelled) return;
        const next = resp.data?.blurbs || {};
        Object.assign(cacheRef.current, next);
        setBlurbs({ ...cacheRef.current });
      } catch (err) {
        if (cancelled) return;
        // Mark missing keys as empty comments so UI stops spinning
        missing.forEach((k) => {
          if (!Array.isArray(cacheRef.current[k]?.comments)) {
            cacheRef.current[k] = {
              ...(cacheRef.current[k] || { key: k }),
              about: cacheRef.current[k]?.about || null,
              comments: [],
              source: 'error',
            };
          }
        });
        setBlurbs({ ...cacheRef.current });
        setError(err.response?.data?.error || err.message || 'Failed to load OnCall blurbs');
      } finally {
        if (inflightRef.current === flight) inflightRef.current = '';
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      // Critical: clear inflight so the next effect can retry
      if (inflightRef.current === flight) inflightRef.current = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, teamId, keySig, seedSig]);

  return { blurbs, loading, error };
}
