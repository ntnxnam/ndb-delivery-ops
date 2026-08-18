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
import { useAllVersionsConfig } from '../hooks/useGanttConfig';
import { useSosItems } from '../hooks/useSosItems';
import { useJiraConfig } from '../utils/jiraConfig';
import { authenticatedPost, authenticatedPut } from '../utils/api';
import ExecSummaryCell from './ExecSummaryCell';
import TaskBreakdownCell from './TaskBreakdownCell';

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
   Hook: useBatchExecSummary
───────────────────────────────────────────────────────────── */

function useBatchExecSummary() {
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState(null); // { done, total, current }
  const [batchError, setBatchError] = useState(null);

  const runBatch = useCallback(async (allItems, ganttConfigByVersion) => {
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
        const ganttConfig = ganttConfigByVersion?.[item.fixVersions?.split(',')[0]?.trim()] || null;
        const resp = await authenticatedPost(
          '/api/ai/exec-summary',
          { item, ganttConfig, breakdownData: null, release: item.fixVersions?.split(',')[0]?.trim() || '', releaseContext: null },
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
  return RAG_COLORS[val] || '#9e9e9e';
}

function getRagLabel(riskIndicator) {
  if (!riskIndicator) return '?';
  return typeof riskIndicator === 'string' ? riskIndicator : (riskIndicator?.value || '?');
}

function getReleaseGanttConfig(allVersionsConfig, version) {
  if (!allVersionsConfig || !version) return null;
  return allVersionsConfig[version] || null;
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

function SosItemRow({ item, version, ganttConfig, breakdownDataMap, jiraBaseUrl }) {
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
        {formatDate(item.customfield_11067)}
      </td>
      {/* CG */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#555' }}>
        {formatDate(item.customfield_35863)}
      </td>
      {/* PG */}
      <td style={{ padding: '6px 8px', fontSize: '11px', whiteSpace: 'nowrap', color: '#555' }}>
        {formatDate(item.customfield_35864)}
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
}

/* ─────────────────────────────────────────────────────────────
   Sub-component: items table (Features or Initiatives)
───────────────────────────────────────────────────────────── */

function SosItemsTable({ items, version, ganttConfig, breakdownDataMap, jiraBaseUrl }) {
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

function ReleaseSection({ version, allVersionsConfig, items, breakdownDataMap, jiraBaseUrl, onRefresh }) {
  const ganttConfig = useMemo(() => getReleaseGanttConfig(allVersionsConfig, version), [allVersionsConfig, version]);

  const features = useMemo(() => items.filter((i) => (i.issuetype || i.issueType || '').toLowerCase() === 'feature'), [items]);
  const initiatives = useMemo(() => items.filter((i) => (i.issuetype || i.issueType || '').toLowerCase() === 'initiative'), [items]);

  // Derive a rough RAG from items
  const ragCounts = useMemo(() => {
    const counts = { Red: 0, Yellow: 0, Green: 0 };
    items.forEach((i) => {
      const v = typeof i.customfield_23560 === 'string' ? i.customfield_23560 : (i.customfield_23560?.value || '');
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
        />
      </CollapsibleSection>

      {/* Initiatives */}
      <CollapsibleSection title="Initiatives" count={initiatives.length} defaultOpen={false} accentColor="#6a1b9a">
        <SosItemsTable
          items={initiatives}
          version={version}
          ganttConfig={ganttConfig}
          breakdownDataMap={breakdownDataMap}
          jiraBaseUrl={jiraBaseUrl}
        />
      </CollapsibleSection>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Main page
───────────────────────────────────────────────────────────── */

function SosSummaryPage() {
  const { allVersionsConfig } = useAllVersionsConfig();
  const { jiraBaseUrl } = useJiraConfig();

  const {
    byVersion,
    loading,
    error,
    breakdownDataMap,
    fetchAll,
  } = useSosItems();

  const { batchRunning, batchProgress, runBatch } = useBatchExecSummary();

  // Fetch on mount
  useEffect(() => {
    fetchAll('ndb');
  }, [fetchAll]);

  // Sort versions: NDB-2.12 before NDB-2.11 etc, Unversioned last
  const sortedVersions = useMemo(() => {
    return Object.keys(byVersion).sort((a, b) => {
      if (a === 'Unversioned') return 1;
      if (b === 'Unversioned') return -1;
      return b.localeCompare(a, undefined, { numeric: true });
    });
  }, [byVersion]);

  // All items that need a summary (for batch button label)
  const needsCount = useMemo(() => {
    return Object.values(byVersion).flat().filter(needsSummary).length;
  }, [byVersion]);

  const handleBatchGenerate = useCallback(() => {
    const allItems = Object.values(byVersion).flat();
    runBatch(allItems, allVersionsConfig);
  }, [byVersion, allVersionsConfig, runBatch]);

  return (
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

      {sortedVersions.map((version) => (
        <ReleaseSection
          key={version}
          version={version}
          allVersionsConfig={allVersionsConfig}
          items={byVersion[version] || []}
          breakdownDataMap={breakdownDataMap}
          jiraBaseUrl={jiraBaseUrl}
          onRefresh={() => fetchAll('ndb')}
        />
      ))}
    </div>
  );
}

export default SosSummaryPage;
