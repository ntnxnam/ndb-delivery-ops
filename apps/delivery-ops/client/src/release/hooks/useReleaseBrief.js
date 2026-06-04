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

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchGateTimeline,
  fetchLandingForecast,
  fetchOutstanding,
  fetchReleaseKpiBatch,
  fetchReleasePayloadSynopsis,
  fetchSprintVelocity,
  listReleaseVersions,
  listTeamKpis,
  pickDefaultRelease,
} from '../services/releaseBriefService';

const DEFAULT_PREFERRED_RELEASE = 'NDB-2.11';

export function useReleaseBrief({
  teamId,
  productId = 'ndb',
  jiraToken,
  username,
  jiraBaseUrl,
}) {
  const [versions, setVersions] = useState([]);
  const [kpis, setKpis] = useState([]);
  const [results, setResults] = useState({});
  const [synopsis, setSynopsis] = useState(null);
  const [velocity, setVelocity] = useState(null);
  const [forecast, setForecast] = useState(null);
  const [gateTimeline, setGateTimeline] = useState(null);
  const [outstanding, setOutstanding] = useState(null);
  const [selectedRelease, setSelectedRelease] = useState(() => {
    return (
      localStorage.getItem('releaseBriefSelectedRelease') ||
      DEFAULT_PREFERRED_RELEASE
    );
  });
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [loadingKpis, setLoadingKpis] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [loadingSynopsis, setLoadingSynopsis] = useState(false);
  const [loadingVelocity, setLoadingVelocity] = useState(false);
  const [loadingForecast, setLoadingForecast] = useState(false);
  const [loadingGates, setLoadingGates] = useState(false);
  const [loadingOutstanding, setLoadingOutstanding] = useState(false);
  const [error, setError] = useState('');

  const ready = !!teamId && !!jiraToken;

  // 1. versions
  const loadVersions = useCallback(async () => {
    if (!ready) return;
    setLoadingVersions(true);
    setError('');
    try {
      const { versions: v } = await listReleaseVersions({
        teamId,
        jiraToken,
        username,
      });
      setVersions(v);
      setSelectedRelease((prev) => {
        const next = pickDefaultRelease(v, prev || DEFAULT_PREFERRED_RELEASE);
        if (next && next !== prev) {
          localStorage.setItem('releaseBriefSelectedRelease', next);
        }
        return next || prev;
      });
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load versions');
    } finally {
      setLoadingVersions(false);
    }
  }, [ready, teamId, jiraToken, username]);

  // 2. KPI defs
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

  // 3. results for the picked release
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
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load KPI results');
      setResults({});
    } finally {
      setLoadingResults(false);
    }
  }, [ready, teamId, selectedRelease, jiraToken, username]);

  // 4. Engineering Payload synopsis (D36) — independent of team KPIs.
  // Only needs a JIRA token + a release; bypasses the team-KPI permission
  // gate because it's just JIRA counts the user can already see in JIRA.
  const loadSynopsis = useCallback(async () => {
    if (!jiraToken || !selectedRelease) {
      setSynopsis(null);
      return;
    }
    setLoadingSynopsis(true);
    try {
      const { synopsis: s } = await fetchReleasePayloadSynopsis({
        productId,
        release: selectedRelease,
        jiraToken,
        username,
      });
      setSynopsis(s);
    } catch (e) {
      setError(
        e.response?.data?.error || e.message || 'Failed to load payload synopsis'
      );
      setSynopsis(null);
    } finally {
      setLoadingSynopsis(false);
    }
  }, [productId, selectedRelease, jiraToken, username]);

  // 5. Sprint Velocity (3-stream per `sprint-velocity-types.mdc`) — independent
  // of team KPIs and payload synopsis. Backed by Path B (shared/JiraConnector).
  //
  // Intentionally **NOT** scoped to `selectedRelease`. Sprint velocity is a
  // team-capacity metric, not a release metric — the team's pace in a sprint
  // doesn't change just because you switch which release you're looking at.
  // Filtering velocity by a single release was misleading: it under-counted
  // work the team did on parallel releases / patches and gave a false sense
  // of slowdown. Drop the release filter and report whole-team velocity.
  const loadVelocity = useCallback(async () => {
    if (!jiraToken) {
      setVelocity(null);
      return;
    }
    setLoadingVelocity(true);
    try {
      const { velocity: v } = await fetchSprintVelocity({
        productId,
        // release omitted on purpose — see comment above.
        sprintsBack: 3,
        jiraToken,
        username,
      });
      setVelocity(v);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load velocity');
      setVelocity(null);
    } finally {
      setLoadingVelocity(false);
    }
  }, [productId, jiraToken, username]);

  // 6. Release-gate timeline (EC + CC + CG + PG + GA per the RM-curated
  // releaseVersionsEmailConfig.json). Independent of JIRA — pure config
  // read, so fast. Becomes the canonical source of `plannedGaIso` for
  // the Landing Forecast below.
  const loadGates = useCallback(async () => {
    if (!jiraToken || !selectedRelease) {
      setGateTimeline(null);
      return;
    }
    setLoadingGates(true);
    try {
      const { timeline } = await fetchGateTimeline({
        release: selectedRelease,
        jiraToken,
        username,
      });
      setGateTimeline(timeline);
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load gate timeline');
      setGateTimeline(null);
    } finally {
      setLoadingGates(false);
    }
  }, [selectedRelease, jiraToken, username]);

  // 7. Outstanding & Deferred (5 tiles, JQL semantics approved 2026-05-20).
  // Independent of team KPIs and synopsis. Counts open/closed/blocked
  // within the engineering payload, plus deferred-by-label and
  // pushed-out-by-fixVersion-history outside the payload.
  const loadOutstanding = useCallback(async () => {
    if (!jiraToken || !selectedRelease) {
      setOutstanding(null);
      return;
    }
    setLoadingOutstanding(true);
    try {
      const { outstanding: o } = await fetchOutstanding({
        productId,
        release: selectedRelease,
        jiraToken,
        username,
      });
      setOutstanding(o);
    } catch (e) {
      setError(
        e.response?.data?.error || e.message || 'Failed to load outstanding tiles'
      );
      setOutstanding(null);
    } finally {
      setLoadingOutstanding(false);
    }
  }, [productId, selectedRelease, jiraToken, username]);

  // 8. Landing forecast (MVP — first fusion of Streamlit's landing_forecast.py).
  // Sources `plannedGaIso` in this priority order:
  //   1. Last 'solid' GA event from the gate timeline (the committed date)
  //   2. First 'dotted' GA event (planned but not yet committed)
  //   3. A KPI whose key contains 'ga' or 'promotion' with an ISO value
  // If none, send no plannedGaIso → server returns verdict='unknown'.
  const loadForecast = useCallback(async () => {
    if (!jiraToken || !selectedRelease) {
      setForecast(null);
      return;
    }
    setLoadingForecast(true);
    try {
      let plannedGaIso;

      // (1)(2) gate timeline GA events — preferred source.
      const gaEvents = (gateTimeline?.gates || []).filter((g) => g.kind === 'GA');
      const solidGa = [...gaEvents].reverse().find((g) => g.style === 'solid');
      const dottedGa = gaEvents.find((g) => g.style === 'dotted');
      const pickedGa = solidGa || dottedGa || null;
      if (pickedGa) plannedGaIso = pickedGa.iso;

      // (3) KPI fallback for teams that haven't configured gate dates.
      if (!plannedGaIso) {
        for (const [key, val] of Object.entries(results || {})) {
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
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Failed to load forecast');
      setForecast(null);
    } finally {
      setLoadingForecast(false);
    }
  }, [productId, selectedRelease, jiraToken, username, results, gateTimeline]);

  useEffect(() => {
    loadVersions();
    loadKpis();
  }, [loadVersions, loadKpis]);

  useEffect(() => {
    loadResults();
    loadSynopsis();
    loadVelocity();
    loadGates();
    loadOutstanding();
  }, [loadResults, loadSynopsis, loadVelocity, loadGates, loadOutstanding]);

  // Forecast load runs after `results` and `gateTimeline` change so the
  // planned-GA hint can come from the gate config first, KPI results
  // second. Safe to depend on `loadForecast` — it's `useCallback`-stable.
  useEffect(() => {
    loadForecast();
  }, [loadForecast]);

  const refresh = useCallback(() => {
    loadResults();
    loadSynopsis();
    loadVelocity();
    loadGates();
    loadOutstanding();
    loadForecast();
  }, [
    loadResults,
    loadSynopsis,
    loadVelocity,
    loadGates,
    loadOutstanding,
    loadForecast,
  ]);

  const onSelectRelease = useCallback((name) => {
    setSelectedRelease(name);
    if (name) localStorage.setItem('releaseBriefSelectedRelease', name);
  }, []);

  const loading =
    loadingVersions ||
    loadingKpis ||
    loadingResults ||
    loadingSynopsis ||
    loadingVelocity ||
    loadingForecast ||
    loadingGates ||
    loadingOutstanding;

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
      error,
      versions,
      kpis,
      results,
      synopsis,
      velocity,
      forecast,
      gateTimeline,
      outstanding,
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
      error,
      versions,
      kpis,
      results,
      synopsis,
      velocity,
      forecast,
      gateTimeline,
      outstanding,
      jiraBaseUrl,
      selectedRelease,
      onSelectRelease,
      refresh,
    ]
  );
}
