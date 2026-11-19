import { useState, useEffect, useCallback } from 'react';
import { useTeam } from '../contexts/TeamContext';
import { countWorkingDays, getNutanixQuarterRange, fetchSprints, fetchSprintReport, fetchSprintTrends, fetchProjectComponents, fetchPastReport, fetchStoryPointFields, getSprintReportCsvText, getPastReportCsvText, getSprintReportHtml } from '../services/sprintReportService';

export const MODES = { PAST: 'past', CURRENT: 'current', TRENDS: 'trends' };
export const INACTIVE_MODES = [MODES.TRENDS];

export function useSprintReport() {
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
  const { selectedTeamId: teamId, hasTeamSelected, isTransitioning, selectedTeam } = useTeam();
  const [sprints, setSprints] = useState([]);
  const [loadingSprints, setLoadingSprints] = useState(false);
  const [mode, setMode] = useState(MODES.CURRENT);
  const [selectedSprintId, setSelectedSprintId] = useState('');
  const [selectedSprintIds, setSelectedSprintIds] = useState([]);
  const [reportResult, setReportResult] = useState(null);
  const [trendsResult, setTrendsResult] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [loadingTrends, setLoadingTrends] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [spFields, setSpFields] = useState(null);
  const [loadingSpFields, setLoadingSpFields] = useState(false);
  const [periodType, setPeriodType] = useState('custom');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [fiscalYear, setFiscalYear] = useState('');
  const [fiscalQuarter, setFiscalQuarter] = useState('');
  const [components, setComponents] = useState([]);
  const [selectedComponentNames, setSelectedComponentNames] = useState([]);
  const [pastReportResult, setPastReportResult] = useState(null);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [loadingPastReport, setLoadingPastReport] = useState(false);
  const [pastValidationError, setPastValidationError] = useState(null);
  const [refreshingLive, setRefreshingLive] = useState(false);

  const baseFilter = selectedTeam?.baseFilter || '';

  const fetchSprintsCb = useCallback(async () => {
    if (!teamId || !jiraToken) { setSprints([]); return; }
    setLoadingSprints(true); setError(null);
    try {
      let state;
      if (mode === MODES.CURRENT) state = 'active';
      if (mode === MODES.TRENDS) state = 'closed';
      const data = await fetchSprints(teamId, state, { jiraToken, username });
      setSprints(data);
    } catch (err) { setError(err.response?.data?.message || err.message || 'Failed to load sprints'); setSprints([]); }
    finally { setLoadingSprints(false); }
  }, [teamId, jiraToken, username, mode]);

  useEffect(() => {
    if (!teamId) { setSprints([]); return; }
    if (mode === MODES.PAST) { setSprints([]); return; }
    fetchSprintsCb();
  }, [teamId, mode, fetchSprintsCb]);

  const runReport = useCallback(async () => {
    if (!teamId || !selectedSprintId || !jiraToken) return;
    setLoadingReport(true); setError(null); setReportResult(null);
    try { const data = await fetchSprintReport(teamId, selectedSprintId, { jiraToken, username }); setReportResult(data); }
    catch (err) { setError(err.response?.data?.message || err.message || 'Failed to load report'); }
    finally { setLoadingReport(false); }
  }, [teamId, selectedSprintId, jiraToken, username]);

  const runTrends = useCallback(async () => {
    const ids = selectedSprintIds.length > 0 ? selectedSprintIds : sprints.slice(0, 10).map((s) => s.id);
    if (!teamId || ids.length === 0 || !jiraToken) return;
    setLoadingTrends(true); setError(null); setTrendsResult(null);
    try { const data = await fetchSprintTrends(teamId, ids, { jiraToken, username }); setTrendsResult(data); }
    catch (err) { setError(err.response?.data?.message || err.message || 'Failed to load trends'); }
    finally { setLoadingTrends(false); }
  }, [teamId, selectedSprintIds, sprints, jiraToken, username]);

  const toggleSprintForTrends = (id) => setSelectedSprintIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const fetchProjectComponentsCb = useCallback(async () => {
    if (!teamId || !jiraToken) { setComponents([]); return; }
    setLoadingComponents(true);
    try { const data = await fetchProjectComponents(teamId, { jiraToken, username }); setComponents(data); }
    catch (err) { console.error('Failed to load components:', err); setComponents([]); }
    finally { setLoadingComponents(false); }
  }, [teamId, jiraToken, username]);

  useEffect(() => {
    if (mode === MODES.PAST && teamId) fetchProjectComponentsCb();
    else setComponents([]);
  }, [mode, teamId, fetchProjectComponentsCb]);

  const runPastReport = useCallback(async () => {
    setPastValidationError(null);
    let from = startDate; let to = endDate;
    if (periodType === 'quarter') { const range = getNutanixQuarterRange(fiscalYear, fiscalQuarter); if (!range) { setPastValidationError('Select year and quarter.'); return; } from = range.startDate; to = range.endDate; }
    else { if (!from || !to) { setPastValidationError('Select start and end date.'); return; } if (new Date(from) > new Date(to)) { setPastValidationError('Start date must be before or equal to end date.'); return; } }
    if (!teamId || !jiraToken) return;
    setLoadingPastReport(true); setError(null); setPastReportResult(null);
    try { const data = await fetchPastReport(teamId, from, to, selectedComponentNames, { jiraToken, username }); setPastReportResult(data); }
    catch (err) { setError(err.response?.data?.message || err.message || 'Failed to load past report'); }
    finally { setLoadingPastReport(false); }
  }, [teamId, jiraToken, username, periodType, startDate, endDate, fiscalYear, fiscalQuarter, selectedComponentNames]);

  const toggleComponent = (name) => setSelectedComponentNames((prev) => prev.includes(name) ? prev.filter((n) => n !== name) : (prev.length >= 5 ? prev : [...prev, name]));

  const discoverSpFields = useCallback(async () => {
    setLoadingSpFields(true); setSpFields(null);
    try { const fields = await fetchStoryPointFields('story', { jiraToken, username }); setSpFields(fields); }
    catch { setSpFields([]); } finally { setLoadingSpFields(false); }
  }, [jiraToken, username]);

  const downloadReportCsv = useCallback(() => {
    if (!reportResult) return;
    const csv = getSprintReportCsvText(reportResult);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `sprint-report-${reportResult.sprint?.name || reportResult.sprint?.id || 'sprint'}.csv`.replace(/\s+/g, '-'); a.click(); URL.revokeObjectURL(url);
  }, [reportResult]);

  const copyReportToClipboard = useCallback(async () => {
    if (!reportResult) return;
    const plain = getSprintReportCsvText(reportResult); const html = getSprintReportHtml(reportResult);
    try {
      if (html && typeof navigator.clipboard.write === 'function' && window.ClipboardItem) {
        await navigator.clipboard.write([new window.ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html;charset=utf-8' }), 'text/plain': new Blob([plain], { type: 'text/plain;charset=utf-8' }) })]);
      } else await navigator.clipboard.writeText(plain);
      setCopied(true); setTimeout(() => setCopied(false), 2000);
    } catch (err) { try { await navigator.clipboard.writeText(plain); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch (e2) { console.error('Copy failed:', e2); } }
  }, [reportResult]);

  const downloadPastReportCsv = useCallback(() => {
    if (!pastReportResult) return;
    const csv = getPastReportCsvText(pastReportResult); const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; const rangeLabel = periodType === 'quarter' && fiscalYear && fiscalQuarter ? `quarter-${fiscalYear}-${fiscalQuarter}` : `${startDate || 'start'}-${endDate || 'end'}`; a.download = `past-sprint-report-${rangeLabel}.csv`.replace(/\s+/g, '-'); a.click(); URL.revokeObjectURL(url);
  }, [pastReportResult, periodType, fiscalYear, fiscalQuarter, startDate, endDate]);

  const handleRefreshNow = useCallback(async () => {
    setRefreshingLive(true); setError(null);
    try { if (mode === MODES.CURRENT && selectedSprintId) await runReport(); else if (mode === MODES.PAST) await runPastReport(); }
    catch (err) { setError(err?.message || 'Failed to refresh live data'); } finally { setRefreshingLive(false); }
  }, [mode, runPastReport, runReport, selectedSprintId]);

  return {
    teamId, hasTeamSelected, isTransitioning, selectedTeam, baseFilter,
    sprints, loadingSprints, mode, setMode, selectedSprintId, setSelectedSprintId, selectedSprintIds, setSelectedSprintIds,
    reportResult, trendsResult, loadingReport, loadingTrends, error, setError,
    copied, spFields, loadingSpFields, discoverSpFields,
    periodType, setPeriodType, startDate, setStartDate, endDate, setEndDate, fiscalYear, setFiscalYear, fiscalQuarter, setFiscalQuarter,
    components, selectedComponentNames, pastReportResult, loadingComponents, loadingPastReport, pastValidationError,
    refreshingLive, toggleSprintForTrends, toggleComponent, runReport, runTrends, runPastReport, downloadReportCsv, copyReportToClipboard, downloadPastReportCsv, handleRefreshNow,
    countWorkingDays, getNutanixQuarterRange,
  };
}
export default useSprintReport;
