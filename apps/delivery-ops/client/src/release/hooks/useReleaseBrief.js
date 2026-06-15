/*
 * useReleaseBrief — orchestrates the data load for the Release Brief page.
 *
 * Three serial-ish loads:
 *   1. release versions (so the picker has options)
 *   2. team KPI definitions (names, display types)
 *   3. release-scoped KPI batch (the actual counts per KPI for the
 *      selected release)
 *
 * Returns:
 *   {
 *     loading, error, versions, kpis, results, jiraBaseUrl,
 *     selectedRelease, setSelectedRelease, refresh
 *   }
 *
 * All `useCallback`/`useMemo` guarded per react-useeffect-infinite-loop-prevention.mdc.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  fetchLandingForecast,
  fetchReleaseKpiBatch,
  listTeamKpis,
} from '../services/releaseBriefService';
import { useSelectedRelease } from '../../contexts/SelectedReleaseContext';
import { useReleaseData } from '../../contexts/ReleaseDataContext';
import {
  deriveSynopsisFromBundle,
  deriveOutstandingFromBundle,
  deriveVelocityFromBundle,
  deriveBurndownFromBundle,
  deriveProjectBreakdownFromBundle,
} from '../utils/bundleUtils';

export function useReleaseBrief({
  teamId,
  productId = 'ndb',
  jiraToken,
  username,
  jiraBaseUrl,
}) {
  const [kpis, setKpis] = useState([]);
  const [results, setResults] = useState({});
  const [synopsis, setSynopsis] = useState(null);
  const [velocity, setVelocity] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [outstanding, setOutstanding] = useState(null);
  const [projectBreakdown, setProjectBreakdown] = useState(null);
  const [burndown, setBurndown] = useState(null);
  const {
    versions,
    selectedRelease,
    setSelectedRelease,
    gateTimeline,
    loadingGateTimeline,
  } = useSelectedRelease();
  const { releaseTickets, releaseError } = useReleaseData();

  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingKpis, setLoadingKpis] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [loadingSynopsis, setLoadingSynopsis] = useState(false);
  const [loadingVelocity, setLoadingVelocity] = useState(false);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [loadingGates, setLoadingGates] = useState(false);
  const [loadingOutstanding, setLoadingOutstanding] = useState(false);
  const [loadingProjectBreakdown, setLoadingProjectBreakdown] = useState(false);
  const [loadingBurndown, setLoadingBurndown] = useState(false);
  const [error, setError] = useState('');
  
  // Debounce ref for project-breakdown to prevent duplicate concurrent requests.
  // If loadProjectBreakdown is called again within 500ms of a successful response,
  // it will be ignored, preventing the second request from timing out and
  // overwriting the good data.
  const projectBreakdownTimeoutRef = useRef(null);

  // Refs so loadForecast can read the latest results/gateTimeline without
  // taking them as useCallback dependencies. Without these, every time
  // loadResults or loadGates completes, loadForecast gets a new function
  // reference → useEffect re-fires → forecast is called 3+ times per page
  // load, toggling loadingForecast and making the full page reload repeatedly.
  const resultsRef = useRef(results);
  const gateTimelineRef = useRef(gateTimeline);
  useEffect(() => { resultsRef.current = results; }, [results]);
  useEffect(() => { gateTimelineRef.current = gateTimeline; }, [gateTimeline]);

  const ready = !!teamId && !!jiraToken;

  // 1. KPI defs
  const loadKpis = useCallback(async () => {
    if (!ready) return;
    setLoadingKpis(true);
    try {
      const { kpis: list } = await listTeamKpis({
        teamId,
        jiraToken,
        username,
      });
      setKpis(list);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load KPI list');
    } finally {
      setLoadingKpis(false);
    }
  }, [ready, teamId, jiraToken, username]);

  // 2. results for the picked release
  const loadResults = useCallback(async () => {
    if (!ready || !selectedRelease) return;
    setLoadingResults(true);
    try {
      const { results: r } = await fetchReleaseKpiBatch({
        teamId,
        releaseVersion: selectedRelease,
        jiraToken,
        username,
      });
      setResults(r);
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load KPI results');
      setResults({});
    } finally {
      setLoadingResults(false);
    }
  }, [ready, teamId, selectedRelease, jiraToken, username]);

  // 3. Engineering Payload synopsis — from per-release dataset.
  const loadSynopsis = useCallback(async () => {
    if (!selectedRelease) {
      setSynopsis(null);
      return;
    }
    setLoadingSynopsis(true);
    try {
      setSynopsis(deriveSynopsisFromBundle(releaseTickets, selectedRelease));
    } finally {
      setLoadingSynopsis(false);
    }
  }, [releaseTickets, selectedRelease]);

  // 4. Sprint Velocity — from dataset.
  // NOT release-scoped (team capacity metric, not per-release).
  const loadVelocity = useCallback(async () => {
    setLoadingVelocity(true);
    try {
      setVelocity(deriveVelocityFromBundle(releaseTickets, 3));
    } finally {
      setLoadingVelocity(false);
    }
  }, [releaseTickets]);

  // 5. Outstanding & Deferred — from dataset.
  const loadOutstanding = useCallback(async () => {
    if (!selectedRelease) {
      setOutstanding(null);
      return;
    }
    setLoadingOutstanding(true);
    try {
      setOutstanding(deriveOutstandingFromBundle(releaseTickets, selectedRelease, productId));
    } finally {
      setLoadingOutstanding(false);
    }
  }, [productId, releaseTickets, selectedRelease]);

  // 8. Landing forecast (MVP — first fusion of Streamlit's landing_forecast.py).
  // Sources `plannedGaIso` in this priority order:
  //   1. Last 'solid' GA event from the gate timeline (the committed date)
  //   2. First 'dotted' GA event (planned but not yet committed)
  //   3. A KPI whose key contains 'ga' or 'promotion' with an ISO value
  // If none, send no plannedGaIso → server returns verdict='unknown'.
  //
  // IMPORTANT: reads results/gateTimeline via refs (not as deps) so this
  // callback is only recreated when release/token changes, not every time
  // other data loads complete. Without refs, loadForecast would be called
  // 3+ times per page load (mount + results arrive + gateTimeline arrives),
  // causing the full-page loading state to flicker repeatedly.
  const loadForecast = useCallback(async () => {
    if (!jiraToken || !selectedRelease) {
      setForecast(null);
      return;
    }
    setLoadingForecast(true);
    try {
      let plannedGaIso;

      // (1)(2) gate timeline GA events — preferred source. Read via ref.
      const currentGateTimeline = gateTimelineRef.current;
      const gaEvents = (currentGateTimeline?.gates || []).filter((g) => g.kind === 'GA');
      const solidGa = [...gaEvents].reverse().find((g) => g.style === 'solid');
      const dottedGa = gaEvents.find((g) => g.style === 'dotted');
      const pickedGa = solidGa || dottedGa || null;
      if (pickedGa) plannedGaIso = pickedGa.iso;

      // (3) KPI fallback for teams that haven't configured gate dates. Read via ref.
      if (!plannedGaIso) {
        const currentResults = resultsRef.current;
        for (const [key, val] of Object.entries(currentResults || {})) {
          if (val && typeof val.value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(val.value)) {
            if (/ga|promotion/i.test(key)) {
              plannedGaIso = val.value.slice(0, 10);
              break;
            }
          }
        }
      }

      const { forecast: f } = await fetchLandingForecast({
        productId,
        release: selectedRelease,
        plannedGaIso,
        jiraToken,
        username,
      });
      setForecast(f);
      setError('');
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load forecast');
      setForecast(null);
    } finally {
      setLoadingForecast(false);
    }
  }, [productId, selectedRelease, jiraToken, username]);

  // 6. Project breakdown — from dataset.
  const loadProjectBreakdown = useCallback(async () => {
    if (!selectedRelease) { setProjectBreakdown(null); return; }
    setLoadingProjectBreakdown(true);
    try {
      if (projectBreakdownTimeoutRef.current) return; // debounce guard
      setProjectBreakdown(deriveProjectBreakdownFromBundle(releaseTickets, selectedRelease));
      if (projectBreakdownTimeoutRef.current) clearTimeout(projectBreakdownTimeoutRef.current);
      projectBreakdownTimeoutRef.current = setTimeout(() => {
        projectBreakdownTimeoutRef.current = null;
      }, 500);
    } finally {
      setLoadingProjectBreakdown(false);
    }
  }, [releaseTickets, selectedRelease]);

  // 7. Burndown (Created vs Resolved) — from dataset.
  const loadBurndown = useCallback(async () => {
    if (!selectedRelease) { setBurndown(null); return; }
    setLoadingBurndown(true);
    try {
      setBurndown(deriveBurndownFromBundle(releaseTickets, selectedRelease, 52));
    } finally {
      setLoadingBurndown(false);
    }
  }, [releaseTickets, selectedRelease]);

  useEffect(() => {
    setLoadingVersions(false);
    loadKpis();
  }, [loadKpis]);

  useEffect(() => {
    loadResults();
    loadSynopsis();
    loadVelocity();
    loadOutstanding();
    loadBurndown();
    // Debounce project breakdown: only call it if ref is not set
    // (i.e., we haven't called it in the last 500ms)
    if (!projectBreakdownTimeoutRef.current) {
      loadProjectBreakdown();
    }
  }, [loadResults, loadSynopsis, loadVelocity, loadOutstanding, loadBurndown, loadProjectBreakdown]);

  // Forecast fires once per release/token change. loadForecast is stable
  // (no results/gateTimeline deps) so this effect only runs when the release
  // or token actually changes — not every time other data arrives.
  useEffect(() => {
    loadForecast();
  }, [loadForecast]);

  // Re-run the forecast once gates have loaded so the plannedGaIso hint is
  // available. We track whether this effect has already re-fired for the
  // current (release + gateTimeline) pair to avoid a duplicate call.
  const lastForecastedGateRef = useRef(null);
  useEffect(() => {
    if (!gateTimeline || !selectedRelease) return;
    const key = `${selectedRelease}:${JSON.stringify(gateTimeline)}`;
    if (lastForecastedGateRef.current === key) return;
    lastForecastedGateRef.current = key;
    loadForecast();
  }, [gateTimeline, selectedRelease, loadForecast]);

  const refresh = useCallback(() => {
    loadResults();
    loadSynopsis();
    loadVelocity();
    loadOutstanding();
    loadBurndown();
    loadProjectBreakdown();
    loadForecast();
  }, [
    loadResults,
    loadSynopsis,
    loadVelocity,
    loadOutstanding,
    loadBurndown,
    loadProjectBreakdown,
    loadForecast,
  ]);

  const onSelectRelease = useCallback((name) => {
    setSelectedRelease(name);
  }, [setSelectedRelease]);

  useEffect(() => {
    setLoadingGates(loadingGateTimeline);
  }, [loadingGateTimeline]);

  useEffect(() => {
    if (releaseError === 'not_synced') {
      setError(`Release ${selectedRelease || ''} is not synced yet. Run Sync to load per-release data.`);
    } else if (releaseError === 'load_failed') {
      setError('Failed to load per-release cached data.');
    }
  }, [releaseError, selectedRelease]);

  const loading =
    loadingVersions ||
    loadingKpis ||
    loadingResults ||
    loadingSynopsis ||
    loadingVelocity ||
    loadingForecast ||
    loadingGates ||
    loadingOutstanding ||
    loadingProjectBreakdown ||
    loadingBurndown;

  return useMemo(
    () => ({
      ready,
      loading,
      loadingVersions,
      loadingKpis,
      loadingResults,
      loadingSynopsis,
      loadingVelocity,
      loadingForecast,
      loadingGates,
      loadingOutstanding,
      loadingProjectBreakdown,
      loadingBurndown,
      error,
      versions,
      kpis,
      results,
      synopsis,
      velocity,
      forecast,
      gateTimeline,
      outstanding,
      projectBreakdown,
      burndown,
      jiraBaseUrl,
      selectedRelease,
      setSelectedRelease: onSelectRelease,
      refresh,
    }),
    [
      ready,
      loading,
      loadingVersions,
      loadingKpis,
      loadingResults,
      loadingSynopsis,
      loadingVelocity,
      loadingForecast,
      loadingGates,
      loadingOutstanding,
      loadingProjectBreakdown,
      loadingBurndown,
      error,
      versions,
      kpis,
      results,
      synopsis,
      velocity,
      forecast,
      gateTimeline,
      outstanding,
      projectBreakdown,
      burndown,
      jiraBaseUrl,
      selectedRelease,
      onSelectRelease,
      refresh,
    ]
  );
}
