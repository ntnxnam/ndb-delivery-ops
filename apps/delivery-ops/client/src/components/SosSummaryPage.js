/**
 * SoS Summary Page — Scrum of Scrums status view for engineering leadership.
 *
 * Shows all active releases in one scrollable view. Each release section has:
 *   - Features subsection with AI exec summary + task breakdown per row
 *   - Initiatives subsection (same columns)
 *   - KPI widgets subsection (lazy-loaded)
 * Email SoS sends an HTML snapshot of the already-loaded view via SMTP.
 */

import React, { useEffect, useState, useMemo, useCallback, useRef } from 'react';
import { useSosItems } from '../hooks/useSosItems';
import { useSosHistory } from '../hooks/useSosHistory';
import { useTeam } from '../contexts/TeamContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { authenticatedPost, authenticatedPut, authenticatedGet } from '../utils/api';
import { formatDateWithHistory } from '../utils/dateHistoryDisplay';
import { formatRiskWithHistory } from '../utils/riskHistoryDisplay';
import ExecSummaryCell from './ExecSummaryCell';
import TaskBreakdownCell from './TaskBreakdownCell';
import ReleaseGantt from './ReleaseGantt';
import SosEmailBar from './SosEmailBar';

/* ─────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────── */

const STALE_DAYS = 7;
const DATE_PREFIX_REGEX = /^\[(\d{4}-\d{2}-\d{2})\]\s*/;

function daysOld(dateVal) {
  if (!dateVal) return null;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

/** Returns true if this item needs a fresh AI summary generated. */
function needsSummary(item) {
  // Stale status update → skip entirely
  const statusDays = daysOld(item?.customfield_45660);
  if (statusDays !== null && statusDays >= STALE_DAYS) return false;

  // Already has a fresh summary → skip
  const raw = item?.customfield_38460 || '';
  if (raw) {
    const match = raw.match(DATE_PREFIX_REGEX);
    if (match) {
      const age = daysOld(new Date(match[1]));
      if (age !== null && age < STALE_DAYS) return false;
    }
  }
  return true;
}

/* ─────────────────────────────────────────────────────────────
   Hook: useMultiReleaseGateData
───────────────────────────────────────────────────────────── */

function useMultiReleaseGateData(releases) {
  const [gateDataMap, setGateDataMap] = useState({});
  const [loadingGates, setLoadingGates] = useState(false);
  const [gateError, setGateError] = useState(null);

  const fetchGateData = useCallback(async (releaseList) => {
    if (!releaseList || releaseList.length === 0) {
      setGateDataMap({});
      return;
    }

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    setLoadingGates(true);
    setGateError(null);

    try {
      const gatePromises = releaseList.map(async (release) => {
        try {
          const resp = await authenticatedGet(
            '/api/release-dataset/gates',
            { release },
            { jiraToken, username }
          );
          if (resp.data?.success && resp.data?.data) {
            return { release, data: resp.data.data };
          }
          return { release, data: null };
        } catch (err) {
          console.warn(`Failed to fetch gate data for ${release}:`, err.message);
          return { release, data: null };
        }
      });

      const results = await Promise.all(gatePromises);
      const newGateDataMap = {};
      results.forEach(({ release, data }) => {
        if (data) {
          newGateDataMap[release] = data;
        }
      });
      setGateDataMap(newGateDataMap);
    } catch (err) {
      console.error('Error fetching gate data:', err);
      setGateError(err.message || 'Failed to fetch gate data');
    } finally {
      setLoadingGates(false);
    }
  }, []);

  useEffect(() => {
    if (releases && releases.length > 0) {
      fetchGateData(releases);
    }
  }, [releases, fetchGateData]);

  return { gateDataMap, loadingGates, gateError, refetchGateData: () => fetchGateData(releases) };
}

/* ─────────────────────────────────────────────────────────────
   Hook: useReleaseDatesConfig — loads the same config that
   ReleaseConfigPage uses, so we can feed ReleaseGantt
───────────────────────────────────────────────────────────── */

function useReleaseDatesConfig() {
  const [releases, setReleases] = useState({});
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/config/release-dates')
      .then(res => res.ok ? res.json() : Promise.reject(res.status))
      .then(data => { if (!cancelled) setReleases(data.releases || {}); })
      .catch(() => { /* non-fatal — Gantt just won't render */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return { releases, loading };
}

/* ─────────────────────────────────────────────────────────────
   Helper: convert /api/release-dataset/gates response into the
   ganttConfig shape that execSummarySignals.js expects.

   /gates returns: { gates: [{ kind: 'CG', iso: '2026-09-15', style: 'solid', label: 'CG' }] }
   execSummarySignals expects keys like: commitGate1, promotionGate1, ga1, ccm1
   where each value is { date: 'YYYY-MM-DD', style: 'solid', label: '...' }
───────────────────────────────────────────────────────────── */

function gatesResponseToGanttConfig(gatesData) {
  if (!gatesData?.gates?.length) return null;
  const config = {};
  const counters = {};
  for (const gate of gatesData.gates) {
    if (!gate.iso) continue;
    const kind = (gate.kind || '').toUpperCase();
    let prefix;
    if (kind === 'CG') prefix = 'commitGate';
    else if (kind === 'PG') prefix = 'promotionGate';
    else if (kind === 'GA') prefix = 'ga';
    else if (kind === 'CC' || kind === 'CCM') prefix = 'ccm';
    else if (kind === 'EC') {
      // EC goes directly as ecDate (flat field, not array)
      config.ecDate = gate.iso;
      continue;
    } else continue;
    counters[prefix] = (counters[prefix] || 0) + 1;
    const key = `${prefix}${counters[prefix]}`;
    config[key] = { date: gate.iso, style: gate.style || 'solid', label: gate.label || kind };
  }
  return Object.keys(config).length > 0 ? config : null;
}

/* ─────────────────────────────────────────────────────────────
   Hook: useBatchExecSummary
───────────────────────────────────────────────────────────── */

function useBatchExecSummary() {
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null); // { done, total, current }
  const [batchError, setBatchError] = useState(null);
  // Map of itemKey → { item, summary } awaiting user review before push
  const [pendingReviews, setPendingReviews] = useState({});

  const runBatch = useCallback(async (allItems, gateDataByVersion) => {
    const toGenerate = allItems.filter(needsSummary);
    if (toGenerate.length === 0) return;

    setBatchRunning(true);
    setBatchError(null);
    setBatchProgress({ done: 0, total: toGenerate.length, current: null });
    setPendingReviews({});

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    const collected = {};
    let done = 0;
    for (const item of toGenerate) {
      setBatchProgress({ done, total: toGenerate.length, current: item.key });
      try {
        const release = item.fixVersions?.split(',')[0]?.trim() || '';
        const rawGateData = gateDataByVersion?.[release] || null;
        // Convert /gates response shape → ganttConfig shape expected by the AI signals util
        const ganttConfig = gatesResponseToGanttConfig(rawGateData);
        const resp = await authenticatedPost(
          '/api/ai/exec-summary',
          { item, ganttConfig, breakdownData: null, release, releaseContext: null },
          { jiraToken, username }
        );
        const summary = resp.data?.summary || '';
        if (summary.replace(DATE_PREFIX_REGEX, '').trim()) {
          collected[item.key] = { item, summary, release, ganttConfig };
        }
      } catch (err) {
        console.warn(`[batchExecSummary] Failed for ${item.key}:`, err.message);
      }
      done++;
    }

    setBatchProgress({ done, total: toGenerate.length, current: null });
    setBatchRunning(false);
    // Surface all results for user review — do NOT auto-push
    setPendingReviews(collected);
  }, []);

  const regenerateOne = useCallback(async (key) => {
    const entry = pendingReviews[key];
    if (!entry) return;
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    // Mark as regenerating in state
    setPendingReviews(prev => ({ ...prev, [key]: { ...prev[key], regenerating: true, regenerateError: null } }));
    try {
      const resp = await authenticatedPost(
        '/api/ai/exec-summary',
        { item: entry.item, ganttConfig: entry.ganttConfig || null, breakdownData: null, release: entry.release || '', releaseContext: null },
        { jiraToken, username }
      );
      const summary = resp.data?.summary || '';
      if (!summary.replace(DATE_PREFIX_REGEX, '').trim()) {
        setPendingReviews(prev => ({ ...prev, [key]: { ...prev[key], regenerating: false, regenerateError: 'AI returned empty summary' } }));
        return;
      }
      setPendingReviews(prev => ({ ...prev, [key]: { ...prev[key], summary, regenerating: false, regenerateError: null } }));
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Regeneration failed';
      setPendingReviews(prev => ({ ...prev, [key]: { ...prev[key], regenerating: false, regenerateError: msg } }));
    }
  }, [pendingReviews]);

  const pushOne = useCallback(async (key) => {    const entry = pendingReviews[key];
    if (!entry) return;
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    await authenticatedPut(`/api/ai/exec-summary/${key}`, { summary: entry.summary }, { jiraToken, username });
    // Update in-memory so the cell shows "Generated today"
    entry.item.customfield_38460 = entry.summary;
    setPendingReviews(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, [pendingReviews]);

  const discardOne = useCallback((key) => {
    setPendingReviews(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const pushAll = useCallback(async () => {
    const keys = Object.keys(pendingReviews);
    for (const key of keys) {
      try { await pushOne(key); } catch (err) {
        console.warn(`[batchExecSummary] Push failed for ${key}:`, err.message);
      }
    }
  }, [pendingReviews, pushOne]);

  const discardAll = useCallback(() => setPendingReviews({}), []);

  return { batchRunning, batchProgress, batchError, pendingReviews, runBatch, regenerateOne, pushOne, discardOne, pushAll, discardAll };
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: bulk review panel (shown after Generate All)
───────────────────────────────────────────────────────────── */

function BulkReviewPanel({ pendingReviews, onPushOne, onDiscardOne, onPushAll, onDiscardAll, onRegenerateOne }) {
  const entries = Object.entries(pendingReviews);
  if (entries.length === 0) return null;

  return (
    <div style={{
      border: '2px solid #6a1b9a',
      borderRadius: '8px',
      padding: '16px',
      marginBottom: '20px',
      backgroundColor: '#fdf8ff',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div>
          <span style={{ fontWeight: 700, fontSize: '13px', color: '#6a1b9a' }}>
            ✨ AI Generated — Review before pushing ({entries.length} item{entries.length !== 1 ? 's' : ''})
          </span>
          <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#888' }}>
            Review each summary below. Regenerate if needed, then push individually or push all at once.
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={onPushAll}
            style={{
              padding: '5px 12px', fontSize: '12px', borderRadius: '4px',
              border: 'none', background: '#28a745', color: '#fff',
              cursor: 'pointer', fontWeight: 600,
            }}
          >
            📤 Push All ({entries.length})
          </button>
          <button
            onClick={onDiscardAll}
            style={{
              padding: '5px 12px', fontSize: '12px', borderRadius: '4px',
              border: '1px solid #ccc', background: '#fff', color: '#666',
              cursor: 'pointer',
            }}
          >
            Discard All
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {entries.map(([key, { item, summary, regenerating, regenerateError }]) => {
          const displayText = (summary || '').replace(/^\[\d{4}-\d{2}-\d{2}\]\s*/, '').trim();
          return (
            <div key={key} style={{
              backgroundColor: '#f0f7ff',
              border: '1px solid #b3d7ff',
              borderRadius: '5px',
              padding: '10px 12px',
              display: 'flex',
              gap: '12px',
              alignItems: 'flex-start',
              opacity: regenerating ? 0.7 : 1,
            }}>
              <div style={{ flexShrink: 0, width: '80px' }}>
                <a
                  href={`#${key}`}
                  style={{ fontSize: '12px', fontWeight: 600, color: '#1565c0' }}
                >
                  {key}
                </a>
                <div style={{ fontSize: '10px', color: '#888', marginTop: '2px', wordBreak: 'break-word' }}>
                  {item.summary?.slice(0, 50)}{item.summary?.length > 50 ? '…' : ''}
                </div>
              </div>
              <div style={{ flex: 1, fontSize: '12px', color: '#1a1a2e', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                {regenerating
                  ? <span style={{ color: '#888', fontStyle: 'italic' }}>⏳ Regenerating…</span>
                  : displayText
                }
                {regenerateError && (
                  <div style={{ color: '#dc3545', fontSize: '10px', marginTop: '4px' }}>⚠ {regenerateError}</div>
                )}
              </div>
              <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <button
                  onClick={() => onPushOne(key)}
                  disabled={regenerating}
                  style={{
                    padding: '4px 10px', fontSize: '11px', borderRadius: '3px',
                    border: 'none', background: regenerating ? '#ccc' : '#28a745', color: '#fff',
                    cursor: regenerating ? 'not-allowed' : 'pointer', fontWeight: 600, whiteSpace: 'nowrap',
                  }}
                >
                  📤 Push
                </button>
                <button
                  onClick={() => onRegenerateOne(key)}
                  disabled={regenerating}
                  style={{
                    padding: '4px 10px', fontSize: '11px', borderRadius: '3px',
                    border: '1px solid #6a1b9a', background: regenerating ? '#f3e5f5' : '#fff',
                    color: regenerating ? '#aaa' : '#6a1b9a',
                    cursor: regenerating ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap',
                  }}
                >
                  ↺ Regenerate
                </button>
                <button
                  onClick={() => onDiscardOne(key)}
                  disabled={regenerating}
                  style={{
                    padding: '4px 10px', fontSize: '11px', borderRadius: '3px',
                    border: '1px solid #ccc', background: '#fff', color: '#666',
                    cursor: regenerating ? 'not-allowed' : 'pointer',
                  }}
                >
                  Discard
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const SOS_COLUMNS = [
  { key: 'key',        label: 'Key',        width: '90px' },
  { key: 'summary',    label: 'Summary',    width: '220px' },
  { key: 'status',     label: 'Status',     width: '100px' },
  { key: 'risk',       label: 'Risk',       width: '70px' },
  { key: 'ccDate',     label: 'CC',         width: '140px' },
  { key: 'cgDate',     label: 'CG',         width: '140px' },
  { key: 'pgDate',     label: 'PG',         width: '140px' },
  { key: 'assignee',   label: 'Assignee',   width: '110px' },
  { key: 'aiSummary',  label: 'AI Summary', width: '260px' },
  { key: 'breakdown',  label: 'Breakdown',  width: '180px' },
];

const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c' };

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */

function formatDate(val) {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }); }
  catch { return val; }
}

function getRagColor(riskIndicator) {
  if (!riskIndicator) return '#9e9e9e';
  const val = typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator?.value || '');
  const key = val.split(' ')[0]; // "Red", "Yellow", "Green"
  return RAG_COLORS[key] || '#9e9e9e';
}

function getRagLabel(riskIndicator) {
  if (!riskIndicator) return '?';
  const val = typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator?.value || '?');
  return val.split(' ')[0] || '?'; // "Red", "Yellow", "Green"
}


/* ─────────────────────────────────────────────────────────────
   Sub-component: release header gate-date strip
───────────────────────────────────────────────────────────── */

function GateDateStrip({ ganttConfig }) {
  if (!ganttConfig) return null;
  const gates = [];
  const addGate = (label, key) => {
    const entries = Object.values(ganttConfig).filter(g => g[key]);
    if (entries.length > 0) gates.push({ label, date: entries[0][key] });
  };
  addGate('CC', 'codeCompleteDate');
  addGate('CG', 'commitGateDate');
  addGate('PG', 'promotionGateDate');
  addGate('GA', 'gaDate');

  if (gates.length === 0) return null;
  return (
    <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginTop: '4px' }}>
      {gates.map(({ label, date }) => (
        <span key={label} style={{ fontSize: '11px', color: '#555' }}>
          <strong style={{ color: '#333' }}>{label}</strong> {formatDate(date)}
        </span>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: single item row
───────────────────────────────────────────────────────────── */

const SosItemRow = React.memo(function SosItemRow({ item, version, ganttConfig, breakdownDataMap, loadingBreakdowns = false, jiraBaseUrl, checkpointHistory = {} }) {
  const breakdown = breakdownDataMap[item.key] || null;
  const ragColor = getRagColor(item.customfield_23560);
  const ragLabel = getRagLabel(item.customfield_23560);

  return (
    <tr style={{ borderBottom: '1px solid #eee', verticalAlign: 'top' }}>
      {/* Key */}
      <td style={{ padding: '6px 8px', width: '90px', whiteSpace: 'nowrap' }}>
        <a
          href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${item.key}` : `#`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#1565c0', fontSize: '12px', fontWeight: 600 }}
        >
          {item.key}
        </a>
      </td>
      {/* Summary */}
      <td style={{ padding: '6px 8px', fontSize: '12px', maxWidth: '220px' }}>
        <span title={item.summary}>{item.summary}</span>
      </td>
      {/* Status */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#444' }}>
        {item.status || '—'}
      </td>
      {/* Risk — RAG dot plus a movement trail when the indicator has changed */}
      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: ragColor,
            verticalAlign: 'middle',
          }}
          title={ragLabel}
        />
        {formatRiskWithHistory(item.key, item.customfield_23560, checkpointHistory)}
      </td>
      {/* CC */}
      <td style={{ padding: '6px 8px', fontSize: '11px', color: '#555', verticalAlign: 'top' }}>
        {formatDateWithHistory(item.key, 'codeComplete', item.customfield_11067, checkpointHistory)}
      </td>
      {/* CG */}
      <td style={{ padding: '6px 8px', fontSize: '11px', color: '#555', verticalAlign: 'top' }}>
        {formatDateWithHistory(item.key, 'commitGate', item.customfield_35863, checkpointHistory)}
      </td>
      {/* PG */}
      <td style={{ padding: '6px 8px', fontSize: '11px', color: '#555', verticalAlign: 'top' }}>
        {formatDateWithHistory(item.key, 'promotionGate', item.customfield_35864, checkpointHistory)}
      </td>
      {/* Assignee */}
      <td style={{ padding: '6px 8px', fontSize: '11px', color: '#444', whiteSpace: 'nowrap' }}>
        {item.assignee || '—'}
      </td>
      {/* AI Exec Summary */}
      <td style={{ padding: '6px 8px', minWidth: '260px' }}>
        <ExecSummaryCell
          item={item}
          selectedVersion={version}
          ganttConfig={ganttConfig}
          breakdownData={breakdown}
          releaseContext={null}
        />
      </td>
      {/* Task Breakdown */}
      <td style={{ padding: '6px 8px', minWidth: '180px' }}>
        <TaskBreakdownCell
          jiraKey={item.key}
          breakdownData={breakdown}
          loading={loadingBreakdowns && !breakdown}
          compact={true}
        />
      </td>
    </tr>
  );
});

/* ─────────────────────────────────────────────────────────────
   Sub-component: items table (Features or Initiatives)
───────────────────────────────────────────────────────────── */

function SosItemsTable({ items, version, ganttConfig, breakdownDataMap, loadingBreakdowns = false, jiraBaseUrl, checkpointHistory = {} }) {
  if (!items || items.length === 0) {
    return <p style={{ color: '#aaa', fontSize: '12px', padding: '8px 0' }}>No tickets found.</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '1250px' }}>
        <thead>
          <tr style={{ background: '#f5f5f5', borderBottom: '2px solid #ddd' }}>
            {SOS_COLUMNS.map((col) => (
              <th key={col.key} style={{ padding: '6px 8px', fontSize: '11px', fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', width: col.width }}>
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <SosItemRow
              key={item.key}
              item={item}
              version={version}
              ganttConfig={ganttConfig}
              breakdownDataMap={breakdownDataMap}
              loadingBreakdowns={loadingBreakdowns}
              jiraBaseUrl={jiraBaseUrl}
              checkpointHistory={checkpointHistory}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: collapsible section
───────────────────────────────────────────────────────────── */

function CollapsibleSection({ title, count, defaultOpen = true, children, accentColor = '#1565c0' }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: '16px' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          background: 'none', border: 'none', cursor: 'pointer',
          fontSize: '13px', fontWeight: 600, color: accentColor, padding: '4px 0',
        }}
      >
        <span style={{ fontSize: '10px' }}>{open ? '▾' : '▸'}</span>
        {title}
        {count != null && (
          <span style={{
            background: accentColor, color: '#fff', borderRadius: '10px',
            padding: '1px 7px', fontSize: '10px', fontWeight: 600,
          }}>
            {count}
          </span>
        )}
      </button>
      {open && <div style={{ marginTop: '8px' }}>{children}</div>}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: per-release section
───────────────────────────────────────────────────────────── */

function ReleaseSection({ version, items, breakdownDataMap, loadingBreakdowns = false, jiraBaseUrl, onRefresh, checkpointHistory = {}, gateData = null }) {
  // Convert gate data to ganttConfig format for compatibility with existing components
  const ganttConfig = useMemo(() => {
    if (!gateData || !gateData.gates || !Array.isArray(gateData.gates)) return null;
    
    // Convert gate data format to match what GateDateStrip expects
    // Gate data has: { kind, label, iso, color, style, source, past }
    const config = {};
    gateData.gates.forEach((gate) => {
      if (gate.kind && gate.iso) {
        switch (gate.kind.toUpperCase()) {
          case 'CC':
            config.codeCompleteDate = gate.iso;
            break;
          case 'CG':
            config.commitGateDate = gate.iso;
            break;
          case 'PG':
            config.promotionGateDate = gate.iso;
            break;
          case 'GA':
            config.gaDate = gate.iso;
            break;
          case 'EC':
            // EC (Early Commitment) doesn't have a field in GateDateStrip, but we can track it
            config.ecDate = gate.iso;
            break;
        }
      }
    });
    
    // Return in format expected by GateDateStrip component
    return { [version]: config };
  }, [gateData, version]);

  const features = useMemo(() => items.filter((i) => (i.issuetype || i.issueType || '').toLowerCase() === 'feature'), [items]);
  const initiatives = useMemo(() => items.filter((i) => (i.issuetype || i.issueType || '').toLowerCase() === 'initiative'), [items]);

  // Derive a rough RAG from items
  const ragCounts = useMemo(() => {
    const counts = { Red: 0, Yellow: 0, Green: 0 };
    items.forEach((i) => {
      const raw = typeof i.customfield_23560 === 'string' ? i.customfield_23560 : (i.customfield_23560?.value || '');
      const v = raw.split(' ')[0]; // normalize "Red - Big Risk to Plan" → "Red"
      if (v in counts) counts[v]++;
    });
    return counts;
  }, [items]);

  const overallRag = ragCounts.Red > 0 ? 'Red' : ragCounts.Yellow > 0 ? 'Yellow' : 'Green';
  const ragColor = RAG_COLORS[overallRag] || '#9e9e9e';

  return (
    <div style={{
      border: '1px solid #ddd', borderRadius: '8px', marginBottom: '24px',
      padding: '16px', background: '#fafafa',
    }}>
      {/* Release header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <h3 style={{ margin: 0, fontSize: '15px', color: '#1a1a2e', fontWeight: 700 }}>{version}</h3>
            {items.length > 0 && (
              <span style={{
                background: ragColor, color: '#fff', borderRadius: '4px',
                padding: '1px 8px', fontSize: '11px', fontWeight: 700,
              }}>
                {overallRag}
              </span>
            )}
          </div>
          <GateDateStrip ganttConfig={ganttConfig} />
        </div>
        <button
          onClick={onRefresh}
          title="Refresh from JIRA"
          style={{
            fontSize: '11px', border: '1px solid #ccc', borderRadius: '4px',
            background: '#fff', color: '#555', cursor: 'pointer', padding: '3px 8px',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Features */}
      <CollapsibleSection title="Features" count={features.length} accentColor="#1565c0">
        <SosItemsTable
          items={features}
          version={version}
          ganttConfig={ganttConfig}
          breakdownDataMap={breakdownDataMap}
          loadingBreakdowns={loadingBreakdowns}
          jiraBaseUrl={jiraBaseUrl}
          checkpointHistory={checkpointHistory}
        />
      </CollapsibleSection>

      {/* Initiatives */}
      <CollapsibleSection title="Initiatives" count={initiatives.length} accentColor="#6a1b9a">
        <SosItemsTable
          items={initiatives}
          version={version}
          ganttConfig={ganttConfig}
          breakdownDataMap={breakdownDataMap}
          loadingBreakdowns={loadingBreakdowns}
          jiraBaseUrl={jiraBaseUrl}
          checkpointHistory={checkpointHistory}
        />
      </CollapsibleSection>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────── */

function SosSummaryPage() {
  const { jiraBaseUrl } = useJiraConfig();
  const { selectedTeamId } = useTeam();

  const {
    byVersion,
    loading,
    error,
    source,
    degraded,
    lastSyncIso,
    breakdownDataMap,
    loadingBreakdowns,
    fetchAll,
    fetchBreakdowns,
  } = useSosItems();

  const { batchRunning, batchProgress, pendingReviews, runBatch, regenerateOne, pushOne, discardOne, pushAll, discardAll } = useBatchExecSummary();

  const { checkpointHistory, fetchHistory } = useSosHistory();

  // Sort versions: NDB-2.12 before NDB-2.11 etc, Unversioned last
  const sortedVersions = useMemo(() => {
    return Object.keys(byVersion).sort((a, b) => {
      if (a === 'Unversioned') return 1;
      if (b === 'Unversioned') return -1;
      return b.localeCompare(a, undefined, { numeric: true });
    });
  }, [byVersion]);

  // Fetch gate data for all active releases
  const { gateDataMap, loadingGates } = useMultiReleaseGateData(sortedVersions);

  // Fetch on mount — live JIRA first
  useEffect(() => {
    if (!selectedTeamId) return;
    fetchAll(selectedTeamId);
  }, [fetchAll, selectedTeamId]);

  // All items that need a summary (for batch button label)
  const needsCount = useMemo(() => {
    return Object.values(byVersion).flat().filter(needsSummary).length;
  }, [byVersion]);

  const { releases: releaseDatesConfig } = useReleaseDatesConfig();

  // Keys to enrich = only items whose fixVersions include a tracked upcoming
  // release (the release-dates config list, e.g. NDB-2.11, NDB-2.12, NDB-3.0).
  // This deliberately excludes master / Era Future / untracked releases so we
  // never walk their changelogs or fetch their task breakdowns.
  const enrichKeys = useMemo(() => {
    const tracked = new Set(
      Object.keys(releaseDatesConfig || {}).map((v) => v.trim().toLowerCase())
    );
    if (tracked.size === 0) return [];
    const seen = new Set();
    const keys = [];
    Object.values(byVersion).flat().forEach((it) => {
      if (!it || !it.key || seen.has(it.key)) return;
      const versions = String(it.fixVersions || '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      if (versions.some((v) => tracked.has(v))) {
        seen.add(it.key);
        keys.push(it.key);
      }
    });
    return keys;
  }, [byVersion, releaseDatesConfig]);

  // Drive BOTH follow-on JIRA passes (date+risk history and task breakdowns)
  // from the same scoped key list. De-duped per team + key-set so React
  // StrictMode's double-invoke and the cache→live byVersion update don't fire
  // duplicate walks. Runs even in degraded mode — the server serves history
  // from its snapshot rather than re-tripping JIRA.
  const lastEnrichRef = useRef('');
  useEffect(() => {
    if (!selectedTeamId) return;
    if (enrichKeys.length === 0) return;
    const signature = `${selectedTeamId}|${enrichKeys.length}|${enrichKeys[0]}|${enrichKeys[enrichKeys.length - 1]}`;
    if (lastEnrichRef.current === signature) return;
    lastEnrichRef.current = signature;
    fetchHistory(selectedTeamId, enrichKeys);
    fetchBreakdowns(enrichKeys);
  }, [selectedTeamId, enrichKeys, fetchHistory, fetchBreakdowns]);

  const handleBatchGenerate = useCallback(() => {
    const allItems = Object.values(byVersion).flat();
    runBatch(allItems, gateDataMap);
  }, [byVersion, gateDataMap, runBatch]);

  return (
    <div>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#1a1a2e', fontWeight: 700 }}>
              📡 SoS Summary
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
              Feature &amp; Initiative status across active releases
              {source === 'cache' && lastSyncIso
                ? ` · showing cached dataset (synced ${new Date(lastSyncIso).toLocaleString()})`
                : source === 'jira'
                  ? ' · live from JIRA'
                  : ''}
            </p>
          </div>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {/* Batch AI summary button — only shown when there's data and items needing summaries */}
            {!loading && needsCount > 0 && (
              <button
                onClick={handleBatchGenerate}
                disabled={batchRunning}
                title={`Generate AI summaries for ${needsCount} items missing or stale summaries`}
                style={{
                  padding: '6px 14px', fontSize: '12px', borderRadius: '5px',
                  border: '1px solid #6a1b9a', background: batchRunning ? '#f3e5f5' : '#6a1b9a', color: batchRunning ? '#6a1b9a' : '#fff',
                  cursor: batchRunning ? 'not-allowed' : 'pointer',
                  fontWeight: 600,
                }}
              >
                {batchRunning
                  ? `✨ Generating… ${batchProgress?.done ?? 0}/${batchProgress?.total ?? needsCount} (${batchProgress?.current || ''})`
                  : `✨ Generate All (${needsCount})`}
              </button>
            )}
            {!loading && needsCount === 0 && sortedVersions.length > 0 && (
              <span style={{ fontSize: '11px', color: '#388e3c', fontWeight: 600 }}>✓ All summaries fresh</span>
            )}
            <SosEmailBar
              byVersion={byVersion}
              breakdownDataMap={breakdownDataMap}
              gateDataMap={gateDataMap}
              checkpointHistory={checkpointHistory}
              jiraBaseUrl={jiraBaseUrl}
              sortedVersions={sortedVersions}
              disabled={loading || sortedVersions.length === 0}
            />
            <button
              onClick={() => fetchAll(selectedTeamId, { forceLive: true })}
              disabled={loading}
              style={{
                padding: '6px 14px', fontSize: '12px', borderRadius: '5px',
                border: '1px solid #1565c0', background: '#1565c0', color: '#fff',
                cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.6 : 1,
              }}
            >
              {loading ? 'Loading…' : '↻ Refresh All'}
            </button>
          </div>
        </div>

        {loading && <p style={{ color: '#888', fontSize: '13px' }}>Loading SoS items…</p>}
      {loadingGates && !loading && <p style={{ color: '#888', fontSize: '13px' }}>Loading gate data…</p>}

        {!loading && source === 'cache' && (
          <p style={{
            color: degraded ? '#856404' : '#555',
            background: degraded ? '#fff3cd' : '#f1f3f5',
            border: `1px solid ${degraded ? '#ffc107' : '#dee2e6'}`,
            borderRadius: '4px',
            padding: '8px 12px',
            fontSize: '12px',
            marginBottom: '16px',
          }}>
            {degraded
              ? 'JIRA is rate-limited, so this view is from the last synced dataset. Wait a minute, then click Refresh All for live data.'
              : 'Showing the last synced dataset. Click Refresh All to pull live JIRA.'}
          </p>
        )}

        {error && !loading && (
          <p style={{ color: '#d32f2f', fontSize: '13px' }}>
            {error}&nbsp;
            <button
              onClick={() => fetchAll(selectedTeamId)}
              style={{ fontSize: '12px', border: 'none', background: 'none', color: '#1565c0', cursor: 'pointer', textDecoration: 'underline' }}
            >
              Retry
            </button>
          </p>
        )}

        {!loading && !error && sortedVersions.length === 0 && (
          <p style={{ color: '#aaa', fontSize: '13px' }}>No items found. Click ↻ Refresh All to load from JIRA.</p>
        )}

        {Object.keys(releaseDatesConfig).length > 0 && (
          <ReleaseGantt releases={releaseDatesConfig} />
        )}

        <BulkReviewPanel
          pendingReviews={pendingReviews}
          onPushOne={pushOne}
          onDiscardOne={discardOne}
          onPushAll={pushAll}
          onDiscardAll={discardAll}
          onRegenerateOne={regenerateOne}
        />

        {sortedVersions.map((version) => (
          <ReleaseSection
            key={version}
            version={version}
            items={byVersion[version] || []}
            breakdownDataMap={breakdownDataMap}
            loadingBreakdowns={loadingBreakdowns}
            jiraBaseUrl={jiraBaseUrl}
            onRefresh={() => fetchAll(selectedTeamId)}
            checkpointHistory={checkpointHistory}
            gateData={gateDataMap[version] || null}
          />
        ))}
    </div>
  );
}

export default SosSummaryPage;
