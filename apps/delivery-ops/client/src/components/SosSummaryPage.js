/**
 * SoS Summary Page — Scrum of Scrums status view for engineering leadership.
 *
 * Shows all active releases in one scrollable view. Each release section has:
 *   - Features subsection with AI exec summary + task breakdown per row
 *   - Initiatives subsection (same columns)
 *   - KPI widgets subsection (lazy-loaded)
 * A compose panel at the bottom handles drafting and sending the SoS email.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { useSosItems } from '../hooks/useSosItems';
import { useSosHistory } from '../hooks/useSosHistory';
import { useJiraConfig } from '../utils/jiraConfig';
import { authenticatedPost, authenticatedPut, authenticatedGet } from '../utils/api';
import { formatDateWithHistory } from '../utils/dateHistoryDisplay';
import ExecSummaryCell from './ExecSummaryCell';
import TaskBreakdownCell from './TaskBreakdownCell';
import ReleaseGantt from './ReleaseGantt';

// Simple layout wrapper that doesn't depend on ReleaseDataContext
function SosLayout({ children }) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved !== null ? JSON.parse(saved) : false;
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebar-width');
    return saved ? parseInt(saved) : 280;
  });

  // Listen for sidebar state changes
  useEffect(() => {
    const handleStorageChange = () => {
      const savedCollapsed = localStorage.getItem('sidebar-collapsed');
      const savedWidth = localStorage.getItem('sidebar-width');
      
      setSidebarCollapsed(savedCollapsed !== null ? JSON.parse(savedCollapsed) : false);
      setSidebarWidth(savedWidth ? parseInt(savedWidth) : 280);
    };

    window.addEventListener('storage', handleStorageChange);
    const interval = setInterval(handleStorageChange, 100);

    return () => {
      window.removeEventListener('storage', handleStorageChange);
      clearInterval(interval);
    };
  }, []);

  return (
    <div className="app-layout">
      {/* Import Sidebar component inline to avoid Layout dependency */}
      <div 
        className={`sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}
        style={{ width: sidebarCollapsed ? '60px' : `${sidebarWidth}px` }}
      >
        {/* Minimal sidebar - user can navigate via browser back/forward */}
        <div style={{
          padding: '16px',
          borderBottom: '1px solid #dee2e6',
          display: 'flex',
          alignItems: 'center',
          gap: '12px'
        }}>
          <span style={{ fontSize: '20px' }}>📡</span>
          {!sidebarCollapsed && (
            <span style={{ fontWeight: 600, color: '#1a1a2e', fontSize: '14px' }}>
              SoS Summary
            </span>
          )}
        </div>
        <div style={{ padding: '16px' }}>
          <button
            onClick={() => window.history.back()}
            style={{
              width: '100%',
              padding: '8px 12px',
              border: '1px solid #ccc',
              borderRadius: '4px',
              background: '#fff',
              cursor: 'pointer',
              fontSize: '12px'
            }}
          >
            ← Back
          </button>
        </div>
      </div>
      
      <main 
        className={`main-content ${sidebarCollapsed ? 'sidebar-collapsed' : 'sidebar-expanded'}`}
        style={{
          marginLeft: sidebarCollapsed ? '60px' : `${sidebarWidth}px`
        }}
      >
        {children}
      </main>

      <style>{`
        .app-layout {
          min-height: 100vh;
          display: flex;
          background: #f8f9fa;
        }
        
        .sidebar {
          position: fixed;
          top: 0;
          left: 0;
          height: 100vh;
          background: #fff;
          border-right: 1px solid #dee2e6;
          z-index: 1000;
          transition: width 0.3s ease;
        }

        .main-content {
          flex: 1;
          padding: 0;
          transition: margin-left 0.3s ease;
          min-height: 100vh;
          box-sizing: border-box;
        }

        @media (max-width: 768px) {
          .main-content {
            margin-left: 0 !important;
            padding: 16px;
          }
          
          .sidebar {
            display: none;
          }
        }
      `}</style>
    </div>
  );
}

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
   Hook: useBatchExecSummary
───────────────────────────────────────────────────────────── */

function useBatchExecSummary() {
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null); // { done, total, current }
  const [batchError, setBatchError] = useState(null);

  const runBatch = useCallback(async (allItems, gateDataByVersion) => {
    const toGenerate = allItems.filter(needsSummary);
    if (toGenerate.length === 0) return;

    setBatchRunning(true);
    setBatchError(null);
    setBatchProgress({ done: 0, total: toGenerate.length, current: null });

    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';

    let done = 0;
    for (const item of toGenerate) {
      setBatchProgress({ done, total: toGenerate.length, current: item.key });
      try {
        const release = item.fixVersions?.split(',')[0]?.trim() || '';
        const gateData = gateDataByVersion?.[release] || null;
        const resp = await authenticatedPost(
          '/api/ai/exec-summary',
          { item, ganttConfig: gateData, breakdownData: null, release, releaseContext: null },
          { jiraToken, username }
        );
        const summary = resp.data?.summary || '';
        if (summary.replace(DATE_PREFIX_REGEX, '').trim()) {
          // Auto-push to JIRA
          await authenticatedPut(`/api/ai/exec-summary/${item.key}`, { summary }, { jiraToken, username });
          // Update in-memory so the cell shows "Generated today"
          item.customfield_38460 = summary;
        }
      } catch (err) {
        console.warn(`[batchExecSummary] Failed for ${item.key}:`, err.message);
      }
      done++;
    }

    setBatchProgress({ done, total: toGenerate.length, current: null });
    setBatchRunning(false);
  }, []);

  return { batchRunning, batchProgress, batchError, runBatch };
}

const SOS_COLUMNS = [
  { key: 'key',        label: 'Key',        width: '90px' },
  { key: 'summary',    label: 'Summary',    width: '220px' },
  { key: 'status',     label: 'Status',     width: '100px' },
  { key: 'risk',       label: 'Risk',       width: '70px' },
  { key: 'ccDate',     label: 'CC',         width: '90px' },
  { key: 'cgDate',     label: 'CG',         width: '90px' },
  { key: 'pgDate',     label: 'PG',         width: '90px' },
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

const SosItemRow = React.memo(function SosItemRow({ item, version, ganttConfig, breakdownDataMap, jiraBaseUrl, checkpointHistory = {} }) {
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
      {/* Risk */}
      <td style={{ padding: '6px 8px', textAlign: 'center' }}>
        <span
          style={{
            display: 'inline-block',
            width: '14px',
            height: '14px',
            borderRadius: '50%',
            background: ragColor,
            verticalAlign: 'middle',
            title: ragLabel,
          }}
          title={ragLabel}
        />
      </td>
      {/* CC */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#555' }}>
        {formatDateWithHistory(item.key, 'codeComplete', item.customfield_11067, checkpointHistory)}
      </td>
      {/* CG */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#555' }}>
        {formatDateWithHistory(item.key, 'commitGate', item.customfield_35863, checkpointHistory)}
      </td>
      {/* PG */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#555' }}>
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
          loading={!breakdown}
          compact={true}
        />
      </td>
    </tr>
  );
});

/* ─────────────────────────────────────────────────────────────
   Sub-component: items table (Features or Initiatives)
───────────────────────────────────────────────────────────── */

function SosItemsTable({ items, version, ganttConfig, breakdownDataMap, jiraBaseUrl, checkpointHistory = {} }) {
  if (!items || items.length === 0) {
    return <p style={{ color: '#aaa', fontSize: '12px', padding: '8px 0' }}>No tickets found.</p>;
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: '1100px' }}>
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

function ReleaseSection({ version, items, breakdownDataMap, jiraBaseUrl, onRefresh, checkpointHistory = {}, gateData = null }) {
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

  const {
    byVersion,
    loading,
    error,
    breakdownDataMap,
    fetchAll,
  } = useSosItems();

  const { batchRunning, batchProgress, runBatch } = useBatchExecSummary();

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

  // Fetch on mount
  useEffect(() => {
    fetchAll('ndb');
  }, [fetchAll]);

  // Fire-and-forget: load checkpoint history once items are present
  useEffect(() => {
    if (Object.keys(byVersion).length > 0) {
      fetchHistory('ndb');
    }
  }, [byVersion, fetchHistory]);

  // All items that need a summary (for batch button label)
  const needsCount = useMemo(() => {
    return Object.values(byVersion).flat().filter(needsSummary).length;
  }, [byVersion]);

  const { releases: releaseDatesConfig } = useReleaseDatesConfig();

  const handleBatchGenerate = useCallback(() => {
    const allItems = Object.values(byVersion).flat();
    runBatch(allItems, gateDataMap);
  }, [byVersion, gateDataMap, runBatch]);

  return (
    <SosLayout>
      <div style={{ padding: '20px 24px', maxWidth: '1400px', margin: '0 auto' }}>
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <h2 style={{ margin: 0, fontSize: '18px', color: '#1a1a2e', fontWeight: 700 }}>
              📡 SoS Summary
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: '12px', color: '#888' }}>
              Live Feature &amp; Initiative status across all active releases · data fetched directly from JIRA
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
            <button
              onClick={() => fetchAll('ndb')}
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

        {loading && <p style={{ color: '#888', fontSize: '13px' }}>Fetching from JIRA…</p>}
      {loadingGates && !loading && <p style={{ color: '#888', fontSize: '13px' }}>Loading gate data…</p>}

        {error && !loading && (
          <p style={{ color: '#d32f2f', fontSize: '13px' }}>
            {error}&nbsp;
            <button
              onClick={() => fetchAll('ndb')}
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

        {sortedVersions.map((version) => (
          <ReleaseSection
            key={version}
            version={version}
            items={byVersion[version] || []}
            breakdownDataMap={breakdownDataMap}
            jiraBaseUrl={jiraBaseUrl}
            onRefresh={() => fetchAll('ndb')}
            checkpointHistory={checkpointHistory}
            gateData={gateDataMap[version] || null}
          />
        ))}
      </div>
    </SosLayout>
  );
}

export default SosSummaryPage;
