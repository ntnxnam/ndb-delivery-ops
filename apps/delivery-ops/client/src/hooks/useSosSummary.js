import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useTeam } from '../contexts/TeamContext';
import { getFieldValue } from '../utils/jiraFields';
import { useSosItems } from './useSosItems';
import { useSosHistory } from './useSosHistory';
import { useSosTierSummary } from './useSosTierSummary';
import { useEraComponents } from './useEraComponents';
import { useReleaseKpiBreakdown } from './useReleaseKpiBreakdown';
import { applyFilters } from '../components/ReleaseVersionFilterBar';
import { fetchGateData, fetchReleaseDates, generateExecSummary, pushExecSummary, gatesResponseToGanttConfig } from '../services/sosSummaryService';

const STALE_DAYS = 7;
const DATE_PREFIX_REGEX = /^\[(\d{4}-\d{2}-\d{2})\]\s*/;
export const PLACEHOLDER_VERSIONS = new Set(['master', 'era future', 'unversioned']);
export const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c', NotSet: '#9e9e9e' };

function daysOld(dateVal) {
  if (!dateVal) return null;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function needsSummary(item) {
  const statusDays = daysOld(getFieldValue(item, 'statusUpdateDate'));
  if (statusDays !== null && statusDays >= STALE_DAYS) return false;
  const raw = getFieldValue(item, 'executiveStatusUpdate') || '';
  if (raw) { const m = raw.match(DATE_PREFIX_REGEX); if (m) { const age = daysOld(new Date(m[1])); if (age !== null && age < STALE_DAYS) return false; } }
  return true;
}

export function useMultiReleaseGateData(releases) {
  const [gateDataMap, setGateDataMap] = useState({});
  const [loadingGates, setLoadingGates] = useState(false);
  const [gateError, setGateError] = useState(null);
  const fetchGateDataCb = useCallback(async (releaseList) => {
    if (!releaseList || releaseList.length === 0) { setGateDataMap({}); return; }
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    setLoadingGates(true); setGateError(null);
    try {
      const results = await Promise.all(releaseList.map(async (release) => {
        try { const data = await fetchGateData(release, { jiraToken, username }); return { release, data }; }
        catch (e) { return { release, data: null }; }
      }));
      const m = {}; results.forEach(({ release, data }) => { if (data) m[release] = data; });
      setGateDataMap(m);
    } catch (e) { setGateError(e.message || 'Failed'); } finally { setLoadingGates(false); }
  }, []);
  useEffect(() => { if (releases && releases.length > 0) fetchGateDataCb(releases); }, [releases, fetchGateDataCb]);
  return { gateDataMap, loadingGates, gateError, refetchGateData: () => fetchGateDataCb(releases) };
}

export function useReleaseDatesConfig() {
  const [releases, setReleases] = useState({});
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let cancelled = false; setLoading(true);
    fetchReleaseDates().then((r) => { if (!cancelled) setReleases(r); }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);
  return { releases, loading };
}

function useBatchExecSummary() {
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null);
  const [pendingReviews, setPendingReviews] = useState({});
  const runBatch = useCallback(async (allItems, gateDataByVersion) => {
    const toGenerate = allItems.filter(needsSummary);
    if (toGenerate.length === 0) return;
    setBatchRunning(true); setBatchProgress({ done: 0, total: toGenerate.length, current: null }); setPendingReviews({});
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    const collected = {}; let done = 0;
    for (const item of toGenerate) {
      setBatchProgress({ done, total: toGenerate.length, current: item.key });
      try {
        const release = item.fixVersions?.split(',')[0]?.trim() || '';
        const ganttConfig = gatesResponseToGanttConfig(gateDataByVersion?.[release] || null);
        const summary = await generateExecSummary(item, ganttConfig, release, { jiraToken, username });
        if (summary.replace(DATE_PREFIX_REGEX, '').trim()) collected[item.key] = { item, summary, release, ganttConfig };
      } catch (e) { /* ignore per-item */ }
      done++;
    }
    setBatchProgress({ done, total: toGenerate.length, current: null }); setBatchRunning(false); setPendingReviews(collected);
  }, []);
  const regenerateOne = useCallback(async (key) => {
    const entry = pendingReviews[key]; if (!entry) return;
    const jiraToken = localStorage.getItem('jiraToken') || ''; const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    setPendingReviews((p) => ({ ...p, [key]: { ...p[key], regenerating: true, regenerateError: null } }));
    try {
      const summary = await generateExecSummary(entry.item, entry.ganttConfig || null, entry.release || '', { jiraToken, username });
      if (!summary.replace(DATE_PREFIX_REGEX, '').trim()) { setPendingReviews((p) => ({ ...p, [key]: { ...p[key], regenerating: false, regenerateError: 'AI returned empty summary' } })); return; }
      setPendingReviews((p) => ({ ...p, [key]: { ...p[key], summary, regenerating: false, regenerateError: null } }));
    } catch (e) { const msg = e.response?.data?.error || e.message || 'Regeneration failed'; setPendingReviews((p) => ({ ...p, [key]: { ...p[key], regenerating: false, regenerateError: msg } })); }
  }, [pendingReviews]);
  const pushOne = useCallback(async (key) => {
    const entry = pendingReviews[key]; if (!entry) return;
    const jiraToken = localStorage.getItem('jiraToken') || ''; const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    await pushExecSummary(key, entry.summary, { jiraToken, username });
    setPendingReviews((prev) => { const n = { ...prev }; delete n[key]; return n; });
  }, [pendingReviews]);
  const discardOne = useCallback((key) => setPendingReviews((prev) => { const n = { ...prev }; delete n[key]; return n; }), []);
  const pushAll = useCallback(async () => { for (const k of Object.keys(pendingReviews)) try { await pushOne(k); } catch (e) { /* ignore */ } }, [pendingReviews, pushOne]);
  const discardAll = useCallback(() => setPendingReviews({}), []);
  return { batchRunning, batchProgress, pendingReviews, runBatch, regenerateOne, pushOne, discardOne, pushAll, discardAll, batchError: null };
}

export function useSosSummary() {
  const { selectedTeamId, selectedTeam } = useTeam();
  const productId = selectedTeam?.id || selectedTeam?.productId || selectedTeamId || '';
  const sosItems = useSosItems();
  const { byVersion, loading, error, source, degraded, lastSyncIso, breakdownDataMap, loadingBreakdowns } = sosItems;
  const batch = useBatchExecSummary();
  const { checkpointHistory, fetchHistory } = useSosHistory();
  const { dataByRelease: kpiDataByRelease, loadingRelease: kpiLoadingByRelease, errorByRelease: kpiErrorByRelease, load: loadKpiForRelease } = useReleaseKpiBreakdown();
  const tier = useSosTierSummary();
  const { tierSummaries, projectStatusByRelease, generateError, generateForRelease, retryTier, fetchProjectStatus } = tier;

  const sortedVersions = useMemo(() => Object.keys(byVersion).sort((a, b) => {
    if (a === 'Unversioned') return 1; if (b === 'Unversioned') return -1; return b.localeCompare(a, undefined, { numeric: true });
  }), [byVersion]);
  const activeVersions = useMemo(() => sortedVersions.filter((v) => !PLACEHOLDER_VERSIONS.has(String(v).trim().toLowerCase())), [sortedVersions]);
  const { gateDataMap, loadingGates } = useMultiReleaseGateData(sortedVersions);
  const { releases: releaseDatesConfig } = useReleaseDatesConfig();

  useEffect(() => {
    if (!productId || activeVersions.length === 0) return;
    activeVersions.forEach((v) => { fetchProjectStatus(productId, v).catch(() => {}); });
  }, [productId, activeVersions, fetchProjectStatus]);
  useEffect(() => { if (selectedTeamId) sosItems.fetchAll(selectedTeamId); }, [selectedTeamId]); // eslint-disable-line
  useEffect(() => {
    if (!selectedTeamId || activeVersions.length === 0) return;
    activeVersions.forEach((v) => loadKpiForRelease(v, selectedTeamId));
  }, [activeVersions, selectedTeamId, loadKpiForRelease]);

  const needsCount = useMemo(() => Object.values(byVersion).flat().filter(needsSummary).length, [byVersion]);
  const enrichKeys = useMemo(() => {
    const tracked = new Set(Object.keys(releaseDatesConfig || {}).map((v) => v.trim().toLowerCase()));
    if (tracked.size === 0) return [];
    const seen = new Set(); const keys = [];
    Object.values(byVersion).flat().forEach((it) => {
      if (!it || !it.key || seen.has(it.key)) return;
      const versions = String(it.fixVersions || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (versions.some((v) => tracked.has(v))) { seen.add(it.key); keys.push(it.key); }
    }); return keys;
  }, [byVersion, releaseDatesConfig]);
  const breakdownKeys = useMemo(() => {
    const seen = new Set(); const keys = [];
    Object.entries(byVersion).forEach(([version, items]) => {
      if (PLACEHOLDER_VERSIONS.has(String(version).trim().toLowerCase())) return;
      (items || []).forEach((it) => { if (!it || !it.key || seen.has(it.key)) return; seen.add(it.key); keys.push(it.key); });
    }); return keys;
  }, [byVersion]);

  const lastEnrichRef = useRef(''); const lastBreakdownRef = useRef('');
  useEffect(() => {
    if (!selectedTeamId) return;
    if (enrichKeys.length > 0) { const sig = `${selectedTeamId}|${lastSyncIso || ''}|${enrichKeys.length}|${enrichKeys[0]}|${enrichKeys[enrichKeys.length - 1]}`; if (lastEnrichRef.current !== sig) { lastEnrichRef.current = sig; fetchHistory(selectedTeamId, enrichKeys); } }
    if (breakdownKeys.length > 0) { const sig = `${selectedTeamId}|${lastSyncIso || ''}|${breakdownKeys.length}|${breakdownKeys[0]}|${breakdownKeys[breakdownKeys.length - 1]}`; if (lastBreakdownRef.current !== sig) { lastBreakdownRef.current = sig; sosItems.fetchBreakdowns(breakdownKeys); } }
  }, [selectedTeamId, lastSyncIso, enrichKeys, breakdownKeys, fetchHistory, sosItems]);

  const [selectedVersions, setSelectedVersions] = useState([]);
  const toggleVersion = useCallback((v) => setSelectedVersions((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]), []);
  const [selectedRags, setSelectedRags] = useState([]);
  const toggleRag = useCallback((r) => setSelectedRags((prev) => prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]), []);
  const releaseRagMap = useMemo(() => {
    const map = {};
    for (const [version, items] of Object.entries(byVersion)) {
      const counts = { Red: 0, Yellow: 0, Green: 0, NotSet: 0 };
      items.forEach((i) => { const raw = typeof getFieldValue(i, 'riskIndicator') === 'string' ? getFieldValue(i, 'riskIndicator') : (getFieldValue(i, 'riskIndicator')?.value || ''); const v = String(raw).split(' ')[0]; if (v === 'Red' || v === 'Yellow' || v === 'Green') counts[v]++; else counts.NotSet++; });
      map[version] = counts.Red > 0 ? 'Red' : counts.Yellow > 0 ? 'Yellow' : counts.Green > 0 ? 'Green' : 'NotSet';
    } return map;
  }, [byVersion]);
  const visibleVersions = useMemo(() => sortedVersions.filter((v) => {
    if (selectedVersions.length > 0 && !selectedVersions.includes(v)) return false;
    if (selectedRags.length > 0 && !selectedRags.includes(releaseRagMap[v])) return false;
    return true;
  }), [sortedVersions, selectedVersions, selectedRags, releaseRagMap]);

  const [selectedComponent, setSelectedComponent] = useState('');
  const { components: eraComponents } = useEraComponents(productId);
  useEffect(() => { setSelectedComponent(''); }, [productId]);
  const filterItemsByComponent = useCallback((items) => {
    if (!selectedComponent) return items;
    return items.filter((item) => {
      const pc = item.primaryComponent;
      if (pc && (pc.parent === selectedComponent || pc.child === selectedComponent)) return true;
      const comps = item.components;
      if (Array.isArray(comps)) return comps.some((c) => (typeof c === 'string' ? c : (c?.name || '')) === selectedComponent);
      if (typeof comps === 'string') return comps === selectedComponent;
      return false;
    });
  }, [selectedComponent]);

  const handleBatchGenerate = useCallback(() => { runBatch(Object.values(byVersion).flat(), gateDataMap); }, [byVersion, gateDataMap, batch.runBatch]); // eslint-disable-line
  const runBatch = batch.runBatch;
  const handleRetryTier = useCallback((version, tierName) => {
    if (!productId) return;
    retryTier({ productId, release: version, tier: tierName, items: byVersion[version] || [], gateData: gateDataMap[version] || null, breakdownDataMap, checkpointHistory });
  }, [productId, byVersion, gateDataMap, breakdownDataMap, checkpointHistory, retryTier]);

  const autoTierStartedRef = useRef(new Set()); const autoTierRunningRef = useRef(false);
  const byVersionRef = useRef(byVersion); const gateDataMapRef = useRef(gateDataMap); const breakdownDataMapRef = useRef(breakdownDataMap); const checkpointHistoryRef = useRef(checkpointHistory);
  byVersionRef.current = byVersion; gateDataMapRef.current = gateDataMap; breakdownDataMapRef.current = breakdownDataMap; checkpointHistoryRef.current = checkpointHistory;
  useEffect(() => { autoTierStartedRef.current.clear(); autoTierRunningRef.current = false; }, [lastSyncIso, selectedTeamId]);
  useEffect(() => {
    if (!productId || loading || loadingBreakdowns || loadingGates || error) return;
    if (!activeVersions.length) return;
    if (autoTierRunningRef.current) return;
    const jobs = activeVersions.filter((v) => (byVersionRef.current[v] || []).length > 0).filter((v) => !autoTierStartedRef.current.has(v)).map((v) => ({ release: v, items: byVersionRef.current[v] || [] }));
    if (jobs.length === 0) return;
    let cancelled = false; autoTierRunningRef.current = true;
    (async () => {
      try { for (const job of jobs) { if (cancelled) break; autoTierStartedRef.current.add(job.release); await generateForRelease({ productId, release: job.release, items: job.items, gateData: gateDataMapRef.current[job.release] || null, breakdownDataMap: breakdownDataMapRef.current, checkpointHistory: checkpointHistoryRef.current }); } } finally { autoTierRunningRef.current = false; }
    })();
    return () => { cancelled = true; autoTierRunningRef.current = false; };
  }, [productId, loading, loadingBreakdowns, loadingGates, error, activeVersions, generateForRelease]);

  const [sosFilters, setSosFilters] = useState({ risk: '', status: '', assignee: '', assigneeManager: '', staleness: '' });
  const handleSosFilterChange = useCallback((key, value) => setSosFilters((prev) => ({ ...prev, [key]: value })), []);
  const allSosItems = useMemo(() => Object.values(byVersion).flat(), [byVersion]);
  const hasSosFilters = useMemo(() => Object.values(sosFilters).some((v) => v !== ''), [sosFilters]);
  const filteredByVersion = useMemo(() => {
    if (!hasSosFilters) return byVersion;
    const out = {}; Object.entries(byVersion).forEach(([version, items]) => { const kept = applyFilters(items || [], sosFilters); if (kept.length > 0) out[version] = kept; });
    return out;
  }, [byVersion, sosFilters, hasSosFilters]);
  const filteredSortedVersions = useMemo(() => Object.keys(filteredByVersion).sort((a, b) => { if (a === 'Unversioned') return 1; if (b === 'Unversioned') return -1; return b.localeCompare(a, undefined, { numeric: true }); }), [filteredByVersion]);
  const filteredSosCount = useMemo(() => Object.values(filteredByVersion).reduce((n, arr) => n + arr.length, 0), [filteredByVersion]);
  const displayVersions = useMemo(() => { const base = hasSosFilters ? filteredSortedVersions : visibleVersions; return base.filter((v) => visibleVersions.includes(v)); }, [hasSosFilters, filteredSortedVersions, visibleVersions]);

  return {
    productId, selectedTeamId, byVersion, loading, error, source, degraded, lastSyncIso, breakdownDataMap, loadingBreakdowns, gateDataMap, loadingGates,
    checkpointHistory, tierSummaries, projectStatusByRelease, generateError, kpiDataByRelease, kpiLoadingByRelease, kpiErrorByRelease,
    sortedVersions, activeVersions, visibleVersions, displayVersions, releaseDatesConfig,
    needsCount, allSosItems, filteredByVersion, filteredSosCount, hasSosFilters,
    selectedVersions, setSelectedVersions, toggleVersion, selectedRags, setSelectedRags, toggleRag, selectedComponent, setSelectedComponent, eraComponents, filterItemsByComponent,
    sosFilters, handleSosFilterChange, handleBatchGenerate, handleRetryTier, fetchAll: sosItems.fetchAll,
    ...batch,
  };
}
export default useSosSummary;
