import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchPerReleaseTickets,
  fetchKpiBreakdown,
} from '../services/retroComparisonService';
import { fetchGateTimeline, listTeamKpis } from '../services/releaseBriefService';
import {
  deriveReleaseScorecardFromBundle,
  deriveBugVerificationAtPG,
} from '../utils/bundleUtils';

/** Pull the PG date (prefer latest solid) out of a gate timeline payload. */
function pgDateFromTimeline(timeline) {
  const gates = (timeline?.gates || []).filter((g) => g.kind === 'PG' && g.iso);
  if (!gates.length) return null;
  const solid = gates.filter((g) => g.style === 'solid');
  const pool = solid.length ? solid : gates;
  const latest = pool.reduce((a, b) => (a.iso > b.iso ? a : b));
  // Normalise to YYYY-MM-DD for the ON "<date>" JQL and day math.
  return (latest.iso || '').slice(0, 10) || null;
}

/**
 * useRetroComparison — loads the cross-release comparison for the
 * retrospective. Offline scorecards + PG bug/improvement verification
 * from per-release bundles, plus live KPI-by-resolution breakdowns.
 *
 * Request-storm safe: only loads when `enabled` is true and the release
 * set changes (guarded by a key ref). No auto-refetch on empty results.
 */
export function useRetroComparison({
  releases,
  teamId,
  productId,
  jiraToken,
  username,
  enabled,
}) {
  const [scorecards, setScorecards] = useState({});
  const [verifications, setVerifications] = useState({});
  const [kpiByRelease, setKpiByRelease] = useState({});
  const [kpiDefs, setKpiDefs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const loadedKeyRef = useRef('');

  const releasesKey = useMemo(
    () => (releases || []).join('|'),
    [releases]
  );

  const load = useCallback(async () => {
    if (!enabled || !teamId || !productId || !jiraToken || !releasesKey) return;
    const list = releasesKey.split('|').filter(Boolean);
    if (!list.length) return;

    setLoading(true);
    setError('');

    // KPI definitions (for stable row order). Non-fatal if it fails.
    try {
      const { kpis } = await listTeamKpis({ teamId, jiraToken, username });
      setKpiDefs(kpis || []);
    } catch (_e) {
      setKpiDefs([]);
    }

    const nextScore = {};
    const nextVerify = {};
    const nextKpi = {};
    let anyError = '';

    await Promise.all(
      list.map(async (release) => {
        try {
          const [bundle, gate] = await Promise.all([
            fetchPerReleaseTickets({ release, productId, jiraToken, username }),
            fetchGateTimeline({ release, jiraToken, username }).catch(() => ({ timeline: null })),
          ]);
          const tickets = bundle.tickets || [];
          const pgDate = pgDateFromTimeline(gate?.timeline);
          nextScore[release] = deriveReleaseScorecardFromBundle(tickets, release);
          nextVerify[release] = deriveBugVerificationAtPG(tickets, release, pgDate);
        } catch (e) {
          anyError = e?.response?.data?.error || e?.message || 'Failed to load release bundle';
        }
        // KPI breakdown is live + heavier; failure here must not block scorecards.
        try {
          nextKpi[release] = await fetchKpiBreakdown({ release, teamId, jiraToken, username });
        } catch (_e) {
          nextKpi[release] = {};
        }
      })
    );

    setScorecards(nextScore);
    setVerifications(nextVerify);
    setKpiByRelease(nextKpi);
    if (anyError) setError(anyError);
    setLoading(false);
    loadedKeyRef.current = `${teamId}::${releasesKey}`;
  }, [enabled, teamId, productId, jiraToken, username, releasesKey]);

  useEffect(() => {
    if (!enabled) return;
    const key = `${teamId}::${releasesKey}`;
    if (loadedKeyRef.current === key) return;
    load();
  }, [enabled, teamId, releasesKey, load]);

  return useMemo(
    () => ({
      releases: (releasesKey ? releasesKey.split('|') : []).filter(Boolean),
      scorecards,
      verifications,
      kpiByRelease,
      kpiDefs,
      loading,
      error,
      reload: load,
    }),
    [releasesKey, scorecards, verifications, kpiByRelease, kpiDefs, loading, error, load]
  );
}
