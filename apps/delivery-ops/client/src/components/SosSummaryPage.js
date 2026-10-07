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
import { useEraComponents } from '../hooks/useEraComponents';
import { useSosHistory } from '../hooks/useSosHistory';
import { useSosTierSummary, SOS_TIERS } from '../hooks/useSosTierSummary';
import { useTeam } from '../contexts/TeamContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { authenticatedPost, authenticatedPut, authenticatedGet } from '../utils/api';
import { formatDateWithHistory } from '../utils/dateHistoryDisplay';
import { formatRiskWithHistory } from '../utils/riskHistoryDisplay';
import ExecSummaryCell from './ExecSummaryCell';
import TaskBreakdownCell from './TaskBreakdownCell';
import ReleaseVersionGantt from './ReleaseVersionGantt';
import SosEmailBar from './SosEmailBar';
import SosTierSummaryBox from './SosTierSummaryBox';
import SosReleaseCharts, { SosRagHeatmap, KpiBreakdownStrip } from './SosReleaseCharts';
import { useReleaseKpiBreakdown } from '../hooks/useReleaseKpiBreakdown';
import ReleaseVersionFilterBar, { applyFilters } from './ReleaseVersionFilterBar';

/* ─────────────────────────────────────────────────────────────
   Constants
───────────────────────────────────────────────────────────── */

const STALE_DAYS = 7;
const DATE_PREFIX_REGEX = /^\[(\d{4}-\d{2}-\d{2})\]\s*/;
// Rolling / placeholder fixVersion buckets we never fetch task breakdowns for
// (they can hold thousands of tickets). Everything else is a real release.
const PLACEHOLDER_VERSIONS = new Set(['master', 'era future', 'unversioned']);

/** JIRA user field → display string. Empty and the live-fetch sentinel "N/A" are blank. */
function personName(value) {
  if (value == null) return null;
  const text = typeof value === 'string'
    ? value
    : (value.displayName || value.name || value.emailAddress || value.email || '');
  const trimmed = String(text).trim();
  if (!trimmed || trimmed === 'N/A' || trimmed === '—') return null;
  return trimmed;
}

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
   Hook: useReleaseDatesConfig — loads release gate dates config
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
  { key: 'identity',   label: 'Feature / Initiative', width: '200px' },
  { key: 'state',      label: 'State',                width: '90px'  },
  { key: 'dates',      label: 'Dates',                width: '130px' },
  { key: 'aiSummary',  label: 'AI Summary',           width: '300px' },
  { key: 'breakdown',  label: 'Breakdown',            width: '180px' },
];

const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c', NotSet: '#9e9e9e' };

/* ─────────────────────────────────────────────────────────────
   Helpers
───────────────────────────────────────────────────────────── */

function formatDate(val) {
  if (!val) return '—';
  try { return new Date(val).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }); }
  catch { return val; }
}

function getRagColor(riskIndicator) {
  if (!riskIndicator) return RAG_COLORS.NotSet;
  const val = typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator?.value || '');
  const key = val.split(' ')[0];
  return RAG_COLORS[key] || RAG_COLORS.NotSet;
}

function getRagLabel(riskIndicator) {
  if (!riskIndicator) return 'not set';
  const val = typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator?.value || '');
  const key = val.split(' ')[0];
  if (key === 'Red' || key === 'Yellow' || key === 'Green') return key;
  return 'not set';
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
  const testLead = personName(item.customfield_11065);
  const qaContact = personName(item.customfield_10860);
  const pmOwner = personName(item.customfield_11260);
  const programMgr = personName(item.customfield_27764);

  // Date rows: label → field mapping for the stacked Dates cell
  const DATE_ROWS = [
    { label: 'FS/DS', field: 'fsdsDone',     raw: item.customfield_13861 },
    { label: 'CCM',   field: 'codeComplete',  raw: item.customfield_11067 },
    { label: 'CG',    field: 'commitGate',    raw: item.customfield_35863 },
    { label: 'PG',    field: 'promotionGate', raw: item.customfield_35864 },
  ];

  return (
    <tr style={{ borderBottom: '1px solid #eee', verticalAlign: 'top' }}>

      {/* ── Identity: key + summary + assignee stacked ── */}
      <td style={{ padding: '8px 10px', width: '200px' }}>
        <a
          href={jiraBaseUrl ? `${jiraBaseUrl}/browse/${item.key}` : '#'}
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: '#1565c0', fontSize: '12px', fontWeight: 700, display: 'block', marginBottom: '3px' }}
        >
          {item.key}
        </a>
        <div style={{ fontSize: '11px', color: '#333', lineHeight: '1.4', marginBottom: '4px' }}
             title={item.summary}>
          {item.summary}
        </div>
        {item.assignee && (
          <div style={{ fontSize: '10px', color: '#888' }}>
            👤 {item.assignee}
          </div>
        )}
        {(testLead || qaContact || pmOwner || programMgr) && (
          <div style={{ fontSize: '10px', color: '#888', marginTop: 2 }}>
            {testLead && (
              <div title="Test Lead">🧪 {testLead}</div>
            )}
            {qaContact && qaContact !== testLead && (
              <div title="QA Contact">🧪 QA {qaContact}</div>
            )}
            {pmOwner && (
              <div title="PM Owner">📋 {pmOwner}</div>
            )}
            {programMgr && (
              <div title="Program Mgr">🗂 {programMgr}</div>
            )}
          </div>
        )}
      </td>

      {/* ── State: RAG dot + status stacked ── */}
      <td style={{ padding: '8px 10px', width: '90px', verticalAlign: 'top' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '4px' }}>
          <span
            style={{
              display: 'inline-block', width: '10px', height: '10px',
              borderRadius: '50%', background: ragColor, flexShrink: 0,
            }}
            title={ragLabel}
          />
          <span style={{ fontSize: '11px', fontWeight: 600, color: ragColor }}>
            {ragLabel === 'not set' ? <span style={{ color: '#bbb' }}>—</span> : ragLabel}
          </span>
        </div>
        {ragLabel !== 'not set' && (
          <div style={{ fontSize: '10px', color: '#888' }}>
            {formatRiskWithHistory(item.key, item.customfield_23560, checkpointHistory)}
          </div>
        )}
        <div style={{ fontSize: '10px', color: '#555', marginTop: '4px', fontStyle: 'italic' }}>
          {item.status || '—'}
        </div>
      </td>

      {/* ── Dates: FS/DS / CCM / CG / PG stacked ── */}
      <td style={{ padding: '8px 10px', width: '130px', verticalAlign: 'top' }}>
        {DATE_ROWS.map(({ label, field, raw }) => (
          <div key={label} style={{ marginBottom: '6px' }}>
            <span style={{
              fontSize: '9px', fontWeight: 700, color: '#aaa',
              textTransform: 'uppercase', letterSpacing: '0.5px',
              display: 'block', marginBottom: '1px',
            }}>
              {label}
            </span>
            <span style={{ fontSize: '11px' }}>
              {raw ? formatDateWithHistory(item.key, field, raw, checkpointHistory) : <span style={{ color: '#ccc' }}>—</span>}
            </span>
          </div>
        ))}
      </td>

      {/* ── AI Exec Summary ── */}
      <td style={{ padding: '8px 10px', verticalAlign: 'top' }}>
        <ExecSummaryCell
          item={item}
          selectedVersion={version}
          ganttConfig={ganttConfig}
          breakdownData={breakdown}
          releaseContext={null}
        />
      </td>

      {/* ── Task Breakdown ── */}
      <td style={{ padding: '8px 10px', width: '180px', verticalAlign: 'top' }}>
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
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '820px' }}>
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

function ReleaseSection({
  version,
  items,
  breakdownDataMap,
  loadingBreakdowns = false,
  jiraBaseUrl,
  onRefresh,
  checkpointHistory = {},
  gateData = null,
  tierSummaries = null,
  projectStatus = null,
  onRetryTier = null,
  onGenerate = null,
  generating = false,
  kpiData = null,
  kpiLoading = false,
  kpiError = null,
  ganttConfigFromDates = null,  // Per-version config from /api/config/release-dates (drives ReleaseVersionGantt)
  productId = '',
}) {
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

  const ragCounts = useMemo(() => {
    const counts = { Red: 0, Yellow: 0, Green: 0, NotSet: 0 };
    items.forEach((i) => {
      const raw = typeof i.customfield_23560 === 'string' ? i.customfield_23560 : (i.customfield_23560?.value || '');
      const v = String(raw).split(' ')[0];
      if (v === 'Red' || v === 'Yellow' || v === 'Green') counts[v]++;
      else counts.NotSet++;
    });
    return counts;
  }, [items]);

  const overallRag = ragCounts.Red > 0 ? 'Red' : ragCounts.Yellow > 0 ? 'Yellow' : ragCounts.Green > 0 ? 'Green' : 'NotSet';
  const ragColor = RAG_COLORS[overallRag] || RAG_COLORS.NotSet;

  const TIER_TITLES = {
    feat: 'FEAT Work',
    standalone: 'Standalone Epics',
    direct: 'Direct Tickets',
  };

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
                {overallRag === 'NotSet' ? 'not set' : overallRag}
              </span>
            )}
          </div>
          <GateDateStrip ganttConfig={ganttConfig} />
          {/* KPI breakdown per release — only mount when loading or data is present; errors are silently suppressed inside KpiBreakdownStrip */}
          {(kpiData || kpiLoading) && (
            <KpiBreakdownStrip
              kpiData={kpiData}
              loading={kpiLoading}
              error={kpiError}
              jiraBaseUrl={jiraBaseUrl}
            />
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {onGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={generating}
              title={`Team-exec briefing for FEAT / Standalone / Direct — ${version} only`}
              style={{
                fontSize: '11px', border: '1px solid #0d47a1', borderRadius: '4px',
                background: generating ? '#e3f2fd' : '#0d47a1',
                color: generating ? '#0d47a1' : '#fff',
                cursor: generating ? 'not-allowed' : 'pointer',
                padding: '3px 10px', fontWeight: 600,
              }}
            >
              {generating ? '✦ Generating…' : '✦ Generate Exec Summary'}
            </button>
          )}
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
      </div>

      {/* Per-release gate timeline — reuses ReleaseVersionGantt (timelineOnly) so the
          visual language (binding vs soft gates, Today bubble, proportional spacing)
          is identical to Project Status. Only shown when release-dates config exists. */}
      {ganttConfigFromDates && (
        <div style={{ marginBottom: '12px' }}>
          <ReleaseVersionGantt
            ganttConfig={ganttConfigFromDates}
            selectedVersion={version}
            items={{ commit: [], longTermFunded: [] }}
            checkpointHistory={{}}
            sortItems={(arr) => arr}
            sprintDates={[]}
            timelineOnly={true}
          />
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 8 }}>
        {SOS_TIERS.map((tier) => (
          <SosTierSummaryBox
            key={tier}
            title={TIER_TITLES[tier]}
            tierState={tierSummaries?.[tier] || { state: 'idle' }}
            onRetry={onRetryTier ? () => onRetryTier(tier) : null}
          />
        ))}
      </div>

      <SosReleaseCharts
        ragCounts={ragCounts}
        gateData={gateData}
        projectStatus={projectStatus}
        items={items}
        release={version}
        productId={productId}
        jiraBaseUrl={jiraBaseUrl}
      />

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
  const { selectedTeamId, selectedTeam } = useTeam();
  const productId = selectedTeam?.id || selectedTeam?.productId || selectedTeamId || '';

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

  // KPI breakdown per release — loaded once activeVersions are known
  const { dataByRelease: kpiDataByRelease, loadingRelease: kpiLoadingByRelease, errorByRelease: kpiErrorByRelease, load: loadKpiForRelease } = useReleaseKpiBreakdown();

  const {
    tierSummaries,
    projectStatusByRelease,
    generating,
    generatingRelease,
    generateError,
    generateForRelease,
    retryTier,
    fetchProjectStatus,
  } = useSosTierSummary();

  // Sort versions: NDB-2.12 before NDB-2.11 etc, Unversioned last
  const sortedVersions = useMemo(() => {
    return Object.keys(byVersion).sort((a, b) => {
      if (a === 'Unversioned') return 1;
      if (b === 'Unversioned') return -1;
      return b.localeCompare(a, undefined, { numeric: true });
    });
  }, [byVersion]);

  const activeVersions = useMemo(
    () => sortedVersions.filter((v) => !PLACEHOLDER_VERSIONS.has(String(v).trim().toLowerCase())),
    [sortedVersions]
  );

  // Fetch gate data for all active releases
  const { gateDataMap, loadingGates } = useMultiReleaseGateData(sortedVersions);

  // Eagerly fetch project-status (component donuts) for every active release
  // as soon as we know productId + versions — no need to wait for Exec Summary.
  useEffect(() => {
    if (!productId || activeVersions.length === 0) return;
    activeVersions.forEach((v) => {
      fetchProjectStatus(productId, v).catch(() => {/* silently ignore — chart shows placeholder */});
    });
  }, [productId, activeVersions, fetchProjectStatus]);

  // Fetch on mount — live JIRA first
  useEffect(() => {
    if (!selectedTeamId) return;
    fetchAll(selectedTeamId);
  }, [fetchAll, selectedTeamId]);

  // Load KPI breakdown for each active release (lazy — fires once per version)
  useEffect(() => {
    if (!selectedTeamId || activeVersions.length === 0) return;
    activeVersions.forEach((v) => {
      loadKpiForRelease(v, selectedTeamId);
    });
  }, [activeVersions, selectedTeamId, loadKpiForRelease]);

  // All items that need a summary (for batch button label)
  const needsCount = useMemo(() => {
    return Object.values(byVersion).flat().filter(needsSummary).length;
  }, [byVersion]);

  const { releases: releaseDatesConfig } = useReleaseDatesConfig();

  // History walk is rate-limit sensitive (per-ticket changelog fetch), so it
  // stays scoped to items in the tracked upcoming releases (the release-dates
  // config list, e.g. NDB-2.11, NDB-2.12, NDB-3.0). master / Era Future /
  // untracked versions are never walked.
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

  // Task breakdowns render for EVERY real Feature/Initiative row, independent
  // of the release-dates config. Only the huge rolling buckets (master / Era
  // Future / Unversioned) are skipped. Keeping this OFF the tracked-release
  // allow-list is deliberate: an empty or mismatched release-dates config used
  // to silently blank the entire Breakdown column.
  const breakdownKeys = useMemo(() => {
    const seen = new Set();
    const keys = [];
    Object.entries(byVersion).forEach(([version, items]) => {
      if (PLACEHOLDER_VERSIONS.has(String(version).trim().toLowerCase())) return;
      (items || []).forEach((it) => {
        if (!it || !it.key || seen.has(it.key)) return;
        seen.add(it.key);
        keys.push(it.key);
      });
    });
    return keys;
  }, [byVersion]);

  // Drive the two follow-on JIRA passes. Each is de-duped on its own key-set so
  // React StrictMode's double-invoke and the cache→live byVersion update don't
  // fire duplicate walks. Both run even in degraded mode — the server serves
  // history from its snapshot rather than re-tripping JIRA.
  const lastEnrichRef = useRef('');
  const lastBreakdownRef = useRef('');
  useEffect(() => {
    if (!selectedTeamId) return;

    if (enrichKeys.length > 0) {
      const sig = `${selectedTeamId}|${enrichKeys.length}|${enrichKeys[0]}|${enrichKeys[enrichKeys.length - 1]}`;
      if (lastEnrichRef.current !== sig) {
        lastEnrichRef.current = sig;
        fetchHistory(selectedTeamId, enrichKeys);
      }
    }

    if (breakdownKeys.length > 0) {
      const sig = `${selectedTeamId}|${breakdownKeys.length}|${breakdownKeys[0]}|${breakdownKeys[breakdownKeys.length - 1]}`;
      if (lastBreakdownRef.current !== sig) {
        lastBreakdownRef.current = sig;
        fetchBreakdowns(breakdownKeys);
      }
    }
  }, [selectedTeamId, enrichKeys, breakdownKeys, fetchHistory, fetchBreakdowns]);

  // ── Filters ────────────────────────────────────────────────────────────────

  // Release filter — which versions to show
  const [selectedVersions, setSelectedVersions] = useState([]); // empty = all

  const toggleVersion = useCallback((v) => {
    setSelectedVersions((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]
    );
  }, []);

  // RAG filter — drive by overall RAG of each release section
  const RAG_FILTER_OPTIONS = ['Red', 'Yellow', 'Green', 'NotSet'];
  const [selectedRags, setSelectedRags] = useState([]); // empty = all

  const toggleRag = useCallback((r) => {
    setSelectedRags((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]
    );
  }, []);

  // Pre-compute per-release overall RAG so the release filter can use it
  const releaseRagMap = useMemo(() => {
    const map = {};
    for (const [version, items] of Object.entries(byVersion)) {
      const counts = { Red: 0, Yellow: 0, Green: 0, NotSet: 0 };
      items.forEach((i) => {
        const raw = typeof i.customfield_23560 === 'string' ? i.customfield_23560 : (i.customfield_23560?.value || '');
        const v = String(raw).split(' ')[0];
        if (v === 'Red' || v === 'Yellow' || v === 'Green') counts[v]++;
        else counts.NotSet++;
      });
      map[version] = counts.Red > 0 ? 'Red' : counts.Yellow > 0 ? 'Yellow' : counts.Green > 0 ? 'Green' : 'NotSet';
    }
    return map;
  }, [byVersion]);

  // Versions visible after both filters applied
  const visibleVersions = useMemo(() => {
    return sortedVersions.filter((v) => {
      if (selectedVersions.length > 0 && !selectedVersions.includes(v)) return false;
      if (selectedRags.length > 0 && !selectedRags.includes(releaseRagMap[v])) return false;
      return true;
    });
  }, [sortedVersions, selectedVersions, selectedRags, releaseRagMap]);

  // Component filter — names from the selected team's JIRA project
  const [selectedComponent, setSelectedComponent] = useState('');
  const { components: eraComponents } = useEraComponents(productId);

  useEffect(() => {
    setSelectedComponent('');
  }, [productId]);

  const filterItemsByComponent = useCallback((items) => {
    if (!selectedComponent) return items;
    return items.filter((item) => {
      // Match CF[15160] Primary Component (cascading select — match on parent value)
      const pc = item.primaryComponent;
      if (pc && (pc.parent === selectedComponent || pc.child === selectedComponent)) return true;
      // Match JIRA standard components field
      const comps = item.components;
      if (Array.isArray(comps)) return comps.some((c) => (typeof c === 'string' ? c : (c?.name || '')) === selectedComponent);
      if (typeof comps === 'string') return comps === selectedComponent;
      return false;
    });
  }, [selectedComponent]);

  const handleBatchGenerate = useCallback(() => {
    const allItems = Object.values(byVersion).flat();
    runBatch(allItems, gateDataMap);
  }, [byVersion, gateDataMap, runBatch]);

  const handleGenerateExecSummary = useCallback((version) => {
    if (!productId || !version) return;
    generateForRelease({
      productId,
      release: version,
      items: byVersion[version] || [],
      gateData: gateDataMap[version] || null,
      breakdownDataMap,
      checkpointHistory,
    });
  }, [productId, byVersion, gateDataMap, breakdownDataMap, checkpointHistory, generateForRelease]);

  const handleRetryTier = useCallback((version, tier) => {
    if (!productId) return;
    retryTier({
      productId,
      release: version,
      tier,
      items: byVersion[version] || [],
      gateData: gateDataMap[version] || null,
      breakdownDataMap,
      checkpointHistory,
    });
  }, [productId, byVersion, gateDataMap, breakdownDataMap, checkpointHistory, retryTier]);

  const RAG_CHIP_STYLE = (rag, active) => ({
    display: 'inline-flex', alignItems: 'center', gap: '4px',
    padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 700,
    cursor: 'pointer', userSelect: 'none',
    border: `1px solid ${RAG_COLORS[rag] || '#9e9e9e'}`,
    background: active ? (RAG_COLORS[rag] || '#9e9e9e') : '#fff',
    color: active ? '#fff' : (RAG_COLORS[rag] || '#9e9e9e'),
    transition: 'all 0.15s',
  });

  const RAG_LABELS = { Red: 'Red', Yellow: 'Yellow', Green: 'Green', NotSet: 'Not Set' };

  // Client-side filters (shared bar with the Release Versions page). Applied to
  // what is rendered only — batch/email/enrich passes still act on the full set.
  const [sosFilters, setSosFilters] = useState({ risk: '', status: '', assignee: '', assigneeManager: '', staleness: '' });
  const handleSosFilterChange = useCallback((key, value) => {
    setSosFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const allSosItems = useMemo(() => Object.values(byVersion).flat(), [byVersion]);

  const hasSosFilters = useMemo(
    () => Object.values(sosFilters).some((v) => v !== ''),
    [sosFilters]
  );

  // byVersion narrowed by the active filters; versions with no surviving items
  // are dropped so we don't render empty sections.
  const filteredByVersion = useMemo(() => {
    if (!hasSosFilters) return byVersion;
    const out = {};
    Object.entries(byVersion).forEach(([version, items]) => {
      const kept = applyFilters(items || [], sosFilters);
      if (kept.length > 0) out[version] = kept;
    });
    return out;
  }, [byVersion, sosFilters, hasSosFilters]);

  const filteredSortedVersions = useMemo(() => {
    return Object.keys(filteredByVersion).sort((a, b) => {
      if (a === 'Unversioned') return 1;
      if (b === 'Unversioned') return -1;
      return b.localeCompare(a, undefined, { numeric: true });
    });
  }, [filteredByVersion]);

  const filteredSosCount = useMemo(
    () => Object.values(filteredByVersion).reduce((n, arr) => n + arr.length, 0),
    [filteredByVersion]
  );

  // Combine Assignee-Mgr filter with release/RAG/component visibility from SoS chrome.
  const displayVersions = useMemo(() => {
    const base = hasSosFilters ? filteredSortedVersions : visibleVersions;
    return base.filter((v) => visibleVersions.includes(v));
  }, [hasSosFilters, filteredSortedVersions, visibleVersions]);

  return (
    <div>
        {/* ── Filter bar ─────────────────────────────────────────── */}
        {sortedVersions.length > 0 && (
          <div style={{
            display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '16px',
            marginBottom: '14px', padding: '8px 12px',
            background: '#f8f9fa', border: '1px solid #e9ecef', borderRadius: '6px',
          }}>

            {/* Release filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>Release:</span>
              {sortedVersions.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => toggleVersion(v)}
                  style={{
                    padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                    cursor: 'pointer', border: '1px solid #6a1b9a', userSelect: 'none',
                    background: selectedVersions.includes(v) ? '#6a1b9a' : '#fff',
                    color: selectedVersions.includes(v) ? '#fff' : '#6a1b9a',
                    transition: 'all 0.15s',
                  }}
                >
                  {v}
                </button>
              ))}
              {selectedVersions.length > 0 && (
                <button type="button" onClick={() => setSelectedVersions([])}
                  style={{ fontSize: '10px', border: 'none', background: 'none', color: '#888', cursor: 'pointer', padding: '0 2px' }}>
                  ✕ clear
                </button>
              )}
            </div>

            {/* RAG filter */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>RAG:</span>
              {RAG_FILTER_OPTIONS.map((rag) => (
                <button
                  key={rag}
                  type="button"
                  onClick={() => toggleRag(rag)}
                  style={RAG_CHIP_STYLE(rag, selectedRags.includes(rag))}
                >
                  {RAG_LABELS[rag]}
                </button>
              ))}
              {selectedRags.length > 0 && (
                <button type="button" onClick={() => setSelectedRags([])}
                  style={{ fontSize: '10px', border: 'none', background: 'none', color: '#888', cursor: 'pointer', padding: '0 2px' }}>
                  ✕ clear
                </button>
              )}
            </div>

            {/* Component filter — selected team's JIRA project */}
            {eraComponents.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '11px', fontWeight: 600, color: '#555', whiteSpace: 'nowrap' }}>Component:</span>
                <select
                  value={selectedComponent}
                  onChange={(e) => setSelectedComponent(e.target.value)}
                  style={{
                    fontSize: '12px', padding: '3px 8px', borderRadius: '4px',
                    border: '1px solid #ced4da', background: '#fff', color: '#333',
                    cursor: 'pointer',
                  }}
                >
                  <option value="">All</option>
                  {eraComponents.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
                {selectedComponent && (
                  <button type="button" onClick={() => setSelectedComponent('')}
                    style={{ fontSize: '10px', border: 'none', background: 'none', color: '#888', cursor: 'pointer', padding: '0 2px' }}>
                    ✕
                  </button>
                )}
              </div>
            )}

            {/* Active filter summary */}
            {(selectedVersions.length > 0 || selectedRags.length > 0 || selectedComponent) && (
              <span style={{ fontSize: '11px', color: '#888', marginLeft: 'auto' }}>
                Showing {visibleVersions.length} of {sortedVersions.length} releases
              </span>
            )}
          </div>
        )}

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
              tierSummaries={tierSummaries}
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
        {!loading && !error && sortedVersions.length > 0 && visibleVersions.length === 0 && (
          <p style={{ color: '#aaa', fontSize: '13px' }}>No releases match the active filters.</p>
        )}

        {generateError && (
          <p style={{ color: '#d32f2f', fontSize: '12px', marginBottom: 12 }}>{generateError}</p>
        )}

        <SosRagHeatmap
          byVersion={byVersion}
          sortedVersions={activeVersions}
          defaultOpen={false}
        />

        <BulkReviewPanel
          pendingReviews={pendingReviews}
          onPushOne={pushOne}
          onDiscardOne={discardOne}
          onPushAll={pushAll}
          onDiscardAll={discardAll}
          onRegenerateOne={regenerateOne}
        />

        {!loading && !error && allSosItems.length > 0 && (
          <ReleaseVersionFilterBar
            items={{ commit: allSosItems, longTermFunded: [] }}
            activeFilters={sosFilters}
            onFilterChange={handleSosFilterChange}
            activeSection=""
            onSectionChange={() => {}}
            showSection={false}
            totalCount={allSosItems.length}
            filteredCount={filteredSosCount}
          />
        )}

        {!loading && !error && hasSosFilters && displayVersions.length === 0 && (
          <p style={{ color: '#aaa', fontSize: '13px' }}>No items match the current filters.</p>
        )}

        {displayVersions.map((version) => (
          <ReleaseSection
            key={version}
            version={version}
            items={filterItemsByComponent(filteredByVersion[version] || [])}
            breakdownDataMap={breakdownDataMap}
            loadingBreakdowns={loadingBreakdowns}
            jiraBaseUrl={jiraBaseUrl}
            onRefresh={() => fetchAll(selectedTeamId)}
            checkpointHistory={checkpointHistory}
            gateData={gateDataMap[version] || null}
            tierSummaries={tierSummaries[version] || null}
            projectStatus={projectStatusByRelease[version] || null}
            onRetryTier={(tier) => handleRetryTier(version, tier)}
            onGenerate={() => handleGenerateExecSummary(version)}
            generating={generating && generatingRelease === version}
            kpiData={kpiDataByRelease[version] || null}
            kpiLoading={kpiLoadingByRelease[version] || false}
            kpiError={kpiErrorByRelease[version] || null}
            ganttConfigFromDates={releaseDatesConfig[version] || null}
            productId={productId}
          />
        ))}
    </div>
  );
}

export default SosSummaryPage;
