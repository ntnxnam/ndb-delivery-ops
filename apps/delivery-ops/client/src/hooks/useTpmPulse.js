import { useState, useEffect, useCallback, useRef } from 'react';
import { getApiBase, getAuthHeaders, authenticatedPost } from '../shared/services/apiService';

const PHASE_ORDER = ['postRelease', 'execution', 'release', 'overall'];
const PHASE_LABELS = { postRelease: 'Post-release', execution: 'Execution', release: 'At release', overall: 'Overall' };

function buildReleaseJql(release, baseQuery) {
  const baseFilter = `filter=${release}-All`;
  if (!baseQuery || !baseQuery.trim()) return baseFilter;
  const q = baseQuery.trim();
  if (/^\s*filter\s*=/i.test(q)) return q;
  return `${baseFilter} AND (${q})`;
}

export default function useTpmPulse(teamId) {
  const [releases, setReleases] = useState([]);
  const [activeRelease, setActiveRelease] = useState('');
  const [phases, setPhases] = useState([]);
  const [gates, setGates] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [fetchedAt, setFetchedAt] = useState(null);
  const abortRef = useRef(null);

  const fetchAll = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setLoading(true);
    setError('');
    try {
      const apiBase = getApiBase();
      const { headers: authH } = getAuthHeaders();
      const authHeaders = { 'Content-Type': 'application/json', ...authH };

      const [kpiRes, pulseRes] = await Promise.all([
        fetch(`${apiBase}/api/config/kpi?teamId=${encodeURIComponent(teamId || 'ndb')}`, { headers: authHeaders, signal: ctrl.signal }).then(async (r) => { if (!r.ok) throw new Error(`KPI ${r.status}`); return r.json(); }).catch((e) => ({ kpis: [], _error: e.message })),
        fetch(`${apiBase}/api/tpm/pulse?teamId=${encodeURIComponent(teamId || 'ndb')}`, { headers: authHeaders, signal: ctrl.signal }).then(async (r) => { if (!r.ok) throw new Error(`Pulse ${r.status}`); return r.json(); }).catch((e) => ({ releases: [], gateDates: {}, _error: e.message })),
      ]);

      if (kpiRes._error) setError(`KPI load failed: ${kpiRes._error}`);
      if (pulseRes._error) setError((prev) => prev ? `${prev}; Pulse: ${pulseRes._error}` : `Pulse load failed: ${pulseRes._error}`);

      const kpis = Array.isArray(kpiRes.kpis) ? kpiRes.kpis : [];
      const gateDates = pulseRes.gateDates || {};
      const relList = Array.isArray(pulseRes.releases) ? pulseRes.releases : [];
      // For teams with no matching releases (e.g. cerebro-dr with only NDB gates), show empty guidance, not NDB demo
      if (!relList.length) {
        setReleases([]);
        setGates({});
        // Still show phases if kpis exist (without release scoping)
        if (!kpis.length) {
          setPhases([]);
          setFetchedAt(new Date().toISOString());
          setLoading(false);
          return;
        }
      }
      const active = relList[0] || null;
      setReleases(relList);
      setGates(gateDates);
      if (!activeRelease && active) setActiveRelease(active);

      const grouped = {};
      PHASE_ORDER.forEach((p) => { grouped[p] = []; });
      kpis.forEach((k) => {
        const ph = PHASE_ORDER.includes(k.lifecyclePhase) ? k.lifecyclePhase : 'overall';
        grouped[ph].push(k);
      });

      const phaseResults = await Promise.all(
        PHASE_ORDER.map(async (phase) => {
          const kpisInPhase = grouped[phase] || [];
          if (!kpisInPhase.length) return { phase, label: PHASE_LABELS[phase], total: 0, open: 0, kpis: [], jql: '', fetchedAt: null };
          const curRelease = activeRelease || active || relList[0] || null;
          const perKpi = await Promise.all(
            kpisInPhase.map(async (k) => {
              const jql = curRelease ? buildReleaseJql(curRelease, k.baseQuery) : (k.baseQuery || '').trim();
              try {
                const res = await authenticatedPost('/api/jira/search-by-jql', { jql, maxResults: 0 });
                const total = res?.data?.issues ? res.data.issues.length : (res?.issues ? res.issues.length : (res.total ?? 0));
                const count = typeof total === 'number' ? total : 0;
                return { id: k.id, name: k.name, jql, count, error: null };
              } catch (e) {
                return { id: k.id, name: k.name, jql, count: null, error: e.message || 'fetch failed' };
              }
            })
          );
          const total = perKpi.reduce((s, x) => s + (x.count ?? 0), 0);
          return { phase, label: PHASE_LABELS[phase], total, open: total, kpis: perKpi, jql: perKpi.map((x) => x.jql).join(' OR '), fetchedAt: new Date().toISOString() };
        })
      );

      if (!ctrl.signal.aborted) {
        setPhases(phaseResults);
        setFetchedAt(new Date().toISOString());
      }
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message || 'Failed to load TPM pulse');
    } finally {
      if (!ctrl.signal.aborted) setLoading(false);
    }
  }, [teamId]);

  useEffect(() => { fetchAll(); return () => { if (abortRef.current) abortRef.current.abort(); }; }, [fetchAll]);

  const refresh = useCallback(() => fetchAll(), [fetchAll]);

  return { releases, activeRelease, setActiveRelease, phases, gates, loading, error, fetchedAt, refresh };
}

export { PHASE_ORDER, PHASE_LABELS };
