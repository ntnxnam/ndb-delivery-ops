/**
 * SoS by Leader (temp) — same SoS release body as SosSummaryPage, regrouped
 * Leader → Release. Reuses ReleaseSection (tables, date history, risk trend,
 * KPIs, charts; gate timelines once at page top).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSosItems } from '../hooks/useSosItems';
import { useSosHistory } from '../hooks/useSosHistory';
import { useSosTierSummary, classifyRiskWord } from '../hooks/useSosTierSummary';
import { useSosLeaderCoaching } from '../hooks/useSosLeaderCoaching';
import { useReleaseKpiBreakdown } from '../hooks/useReleaseKpiBreakdown';
import { useTeam } from '../contexts/TeamContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { authenticatedGet } from '../utils/api';
import {
  ReleaseSection,
  useMultiReleaseGateData,
  useReleaseDatesConfig,
} from './SosSummaryPage';
import { SosRagHeatmap } from './SosReleaseCharts';
import ReleaseVersionGantt from './ReleaseVersionGantt';
import SosEmailBar from './SosEmailBar';
import {
  regroupByLeader,
  sortVersionKeys,
  listAssigneeManagerNamesForLeader,
  buildAssigneeManagerJqlClause,
  extractAssigneeManagerName,
} from '../utils/sosLeaderGrouping';

const STALE_DAYS = 7;
const RAG_COLORS = { Red: '#d32f2f', Yellow: '#f57c00', Green: '#388e3c', NotSet: '#9e9e9e' };

function flattenByVersion(byVersion) {
  return Object.values(byVersion || {}).flat().filter(Boolean);
}

function daysOld(dateVal) {
  if (!dateVal) return null;
  const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function outstandingFromBreakdown(bd) {
  if (!bd) return 0;
  if (bd.outstandingCount != null) return Number(bd.outstandingCount) || 0;
  const s = bd.overallStats || {};
  return (Number(s.toDo) || 0)
    + (Number(s.inProgress) || 0)
    + (Number(s.blocked) || 0)
    + (Number(s.other) || 0);
}

/** Deterministic per-leader / page rollup for the exec strip (no AI). */
function computeLeaderRollup(byVersion, breakdownDataMap = {}) {
  const items = flattenByVersion(byVersion);
  const rag = { Red: 0, Yellow: 0, Green: 0, NotSet: 0 };
  let stale = 0;
  let outstanding = 0;
  for (const item of items) {
    rag[classifyRiskWord(item.customfield_23560)] += 1;
    const age = daysOld(item?.customfield_45660);
    if (age === null || age >= STALE_DAYS) stale += 1;
    outstanding += outstandingFromBreakdown(breakdownDataMap[item.key]);
  }
  const overallRag = rag.Red > 0 ? 'Red' : rag.Yellow > 0 ? 'Yellow' : rag.Green > 0 ? 'Green' : 'NotSet';
  return {
    count: items.length,
    releases: Object.keys(byVersion || {}).filter((v) => (byVersion[v] || []).length > 0).length,
    rag,
    overallRag,
    stale,
    outstanding,
  };
}

function askUrgencyCounts(asks) {
  const u = { P0: 0, P1: 0, P2: 0 };
  for (const a of asks || []) {
    const key = String(a.urgency || '').toUpperCase();
    if (u[key] != null) u[key] += 1;
  }
  return u;
}

function RagMini({ rag }) {
  return (
    <span style={{ display: 'inline-flex', gap: 6, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
      {['Red', 'Yellow', 'Green', 'NotSet'].map((k) => (
        <span key={k} style={{ color: RAG_COLORS[k] }} title={k === 'NotSet' ? 'not set' : k}>
          {rag[k] || 0}
          <span style={{ fontWeight: 500, color: '#888', marginLeft: 1 }}>
            {k === 'NotSet' ? 'n' : k[0]}
          </span>
        </span>
      ))}
    </span>
  );
}

/**
 * Page-top exec data summary — skim before drilling into leader sections.
 */
function SosLeaderExecSummary({ rows, totals, activeVersions }) {
  if (!rows?.length) return null;
  return (
    <div
      style={{
        border: '1px solid #cfd8dc',
        borderRadius: 8,
        background: '#fff',
        padding: '10px 12px',
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase' }}>
          Exec snapshot
        </div>
        <div style={{ fontSize: 12, color: '#333' }}>
          <strong>{totals.count}</strong> FEAT/Init
          <span style={{ color: '#888' }}> · </span>
          <strong>{activeVersions?.length || 0}</strong> releases
          <span style={{ color: '#888' }}> · </span>
          <span style={{ color: RAG_COLORS.Red, fontWeight: 700 }}>{totals.rag.Red} Red</span>
          <span style={{ color: '#888' }}> · </span>
          <span style={{ color: '#bf360c', fontWeight: 700 }}>{totals.stale} stale</span>
          <span style={{ color: '#888' }}> · </span>
          <strong>{totals.outstanding}</strong> outstanding child
          {totals.unmapped > 0 && (
            <>
              <span style={{ color: '#888' }}> · </span>
              <span style={{ color: '#e65100', fontWeight: 700 }}>{totals.unmapped} unmapped</span>
            </>
          )}
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ textAlign: 'left', color: '#888', fontSize: 10, textTransform: 'uppercase' }}>
            <th style={{ padding: '2px 8px 6px 0', fontWeight: 700 }}>Leader</th>
            <th style={{ padding: '2px 8px 6px', fontWeight: 700 }}>Items</th>
            <th style={{ padding: '2px 8px 6px', fontWeight: 700 }}>RAG</th>
            <th style={{ padding: '2px 8px 6px', fontWeight: 700 }}>Stale</th>
            <th style={{ padding: '2px 8px 6px', fontWeight: 700 }}>Outstanding</th>
            <th style={{ padding: '2px 8px 6px', fontWeight: 700 }}>Asks</th>
            <th style={{ padding: '2px 0 6px 8px', fontWeight: 700 }}>Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const healthColor = RAG_COLORS[row.overallRag] || RAG_COLORS.NotSet;
            const askLabel = row.asks.P0 > 0
              ? `${row.asks.P0} P0`
              : row.asks.P1 > 0
                ? `${row.asks.P1} P1`
                : row.askTotal > 0
                  ? `${row.askTotal} ask${row.askTotal === 1 ? '' : 's'}`
                  : '—';
            const askColor = row.asks.P0 > 0 ? '#c62828' : row.asks.P1 > 0 ? '#e65100' : '#555';
            return (
              <tr
                key={row.id}
                style={{ borderTop: '1px solid #eee', cursor: 'pointer' }}
                onClick={() => {
                  const el = document.getElementById(`sos-leader-${row.id}`);
                  if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
                title={`Jump to ${row.name}`}
              >
                <td style={{ padding: '6px 8px 6px 0', fontWeight: 700, color: '#0d47a1' }}>
                  {row.name}
                </td>
                <td style={{ padding: '6px 8px' }}>{row.count}</td>
                <td style={{ padding: '6px 8px' }}><RagMini rag={row.rag} /></td>
                <td style={{ padding: '6px 8px', fontWeight: row.stale ? 700 : 400, color: row.stale ? '#bf360c' : '#555' }}>
                  {row.stale}
                </td>
                <td style={{ padding: '6px 8px' }}>{row.outstanding}</td>
                <td style={{ padding: '6px 8px', fontWeight: 700, color: askColor }}>{askLabel}</td>
                <td style={{ padding: '6px 0 6px 8px' }}>
                  <span
                    style={{
                      background: healthColor,
                      color: '#fff',
                      borderRadius: 4,
                      padding: '1px 8px',
                      fontSize: 11,
                      fontWeight: 700,
                    }}
                  >
                    {row.overallRag === 'NotSet' ? 'not set' : row.overallRag}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function buildSummaryByKey(byVersion) {
  const map = {};
  for (const item of flattenByVersion(byVersion)) {
    if (!item?.key) continue;
    const s = String(item.summary || '').replace(/\s+/g, ' ').trim();
    if (s) map[item.key] = s.length > 72 ? `${s.slice(0, 71)}…` : s;
  }
  return map;
}

/**
 * Render ask/why: show short ticket summary (linked); key only in tooltip.
 * Handles both `"summary" (KEY)` cites and bare KEY tokens.
 */
function CoachingText({ text, summaryByKey, jiraBaseUrl }) {
  const raw = String(text || '');
  if (!raw) return null;
  const re = /"([^"]{1,120})"\s*\(([A-Z][A-Z0-9]+-\d+)\)|\b([A-Z][A-Z0-9]+-\d+)\b/g;
  const nodes = [];
  let last = 0;
  let m;
  let idx = 0;
  while ((m = re.exec(raw)) !== null) {
    if (m.index > last) {
      nodes.push(<React.Fragment key={`t${idx++}`}>{raw.slice(last, m.index)}</React.Fragment>);
    }
    const key = m[2] || m[3];
    const citedSummary = m[1] || '';
    const summary = citedSummary || summaryByKey?.[key] || '';
    const href = jiraBaseUrl ? `${String(jiraBaseUrl).replace(/\/+$/, '')}/browse/${key}` : null;
    const label = summary || key;
    const title = summary ? `${key}: ${summary}` : key;
    if (href) {
      nodes.push(
        <a
          key={`k${idx++}`}
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          title={title}
          style={{ color: '#0d47a1', textDecoration: 'none', fontWeight: 600 }}
        >
          {summary ? `"${label}"` : key}
        </a>
      );
    } else {
      nodes.push(
        <span key={`k${idx++}`} title={title} style={{ fontWeight: 600 }}>
          {summary ? `"${label}"` : key}
        </span>
      );
    }
    last = m.index + m[0].length;
  }
  if (last < raw.length) {
    nodes.push(<React.Fragment key={`t${idx++}`}>{raw.slice(last)}</React.Fragment>);
  }
  return <>{nodes}</>;
}

function LeaderCoachingPanel({
  entry,
  generating,
  error,
  onGenerate,
  leaderName,
  summaryByKey = {},
  jiraBaseUrl = '',
}) {
  const asks = entry?.asks || [];
  return (
    <div
      style={{
        background: '#f5f7fa',
        border: '1px solid #cfd8dc',
        borderRadius: 6,
        padding: '10px 12px',
        marginBottom: 12,
        fontSize: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 6 }}>
        <strong style={{ color: '#0d47a1', fontSize: 12 }}>Asks for {leaderName}</strong>
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          style={{
            fontSize: 11,
            border: '1px solid #0d47a1',
            borderRadius: 4,
            background: generating ? '#e3f2fd' : '#0d47a1',
            color: generating ? '#0d47a1' : '#fff',
            cursor: generating ? 'not-allowed' : 'pointer',
            padding: '3px 10px',
            fontWeight: 600,
          }}
        >
          {generating ? '✦ Generating…' : asks.length ? '✦ Regen Asks' : '✦ Generate Asks'}
        </button>
      </div>
      {error && <div style={{ color: '#c62828', marginBottom: 6 }}>{error}</div>}
      {entry?.state === 'loading' && <div style={{ color: '#888' }}>Building release + sprint coaching packet…</div>}
      {asks.length > 0 && (
        <ol style={{ margin: '4px 0 0', paddingLeft: 18 }}>
          {asks.map((a, i) => (
            <li key={i} style={{ marginBottom: 4 }}>
              <strong>
                <CoachingText text={a.ask} summaryByKey={summaryByKey} jiraBaseUrl={jiraBaseUrl} />
              </strong>
              <span style={{ color: '#555' }}>
                {' '}
                | Why:{' '}
                <CoachingText text={a.why} summaryByKey={summaryByKey} jiraBaseUrl={jiraBaseUrl} />
                {' '}
                | Owner: {a.owner} | Urgency: {a.urgency}
              </span>
            </li>
          ))}
        </ol>
      )}
      {entry?.source === 'rules' && (
        <div style={{ fontSize: 10, color: '#888', marginTop: 4 }}>Rule-based fallback (NAI unavailable)</div>
      )}
    </div>
  );
}

const PLACEHOLDER_VERSIONS = new Set(['master', 'era future', 'unversioned']);

function Collapsible({ title, count, defaultOpen = true, accent = '#1565c0', children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: 16 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 700,
          color: accent,
          padding: '6px 0',
          width: '100%',
          textAlign: 'left',
        }}
      >
        <span style={{ fontSize: 11 }}>{open ? '▾' : '▸'}</span>
        <span>{title}</span>
        {count != null && (
          <span
            style={{
              background: accent,
              color: '#fff',
              borderRadius: 10,
              padding: '1px 8px',
              fontSize: 11,
              fontWeight: 600,
            }}
          >
            {count}
          </span>
        )}
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

function LeaderBucket({
  title,
  itemCount,
  byVersion,
  defaultOpen,
  accent,
  scopeKey,
  shared,
  coaching,
  onGenerateCoaching,
}) {
  const versions = useMemo(() => sortVersionKeys(Object.keys(byVersion || {})), [byVersion]);
  const {
    breakdownDataMap,
    loadingBreakdowns,
    jiraBaseUrl,
    onRefresh,
    checkpointHistory,
    gateDataMap,
    projectStatusByRelease,
    kpiDataByRelease,
    kpiLoadingByRelease,
    kpiErrorByRelease,
    releaseDatesConfig,
    productId,
  } = shared;

  const kpiKey = (version) => (scopeKey ? `${version}::${scopeKey}` : version);
  const summaryByKey = useMemo(() => buildSummaryByKey(byVersion), [byVersion]);

  return (
    <div
      id={scopeKey ? `sos-leader-${scopeKey}` : undefined}
      style={{
        border: `1px solid ${accent === '#e65100' ? '#ffcc80' : '#cfd8dc'}`,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 20,
        background: accent === '#e65100' ? '#fff3e0' : '#fafbfc',
        scrollMarginTop: 12,
      }}
    >
      <Collapsible
        title={title}
        count={itemCount}
        defaultOpen={defaultOpen}
        accent={accent}
      >
        {coaching && (
          <LeaderCoachingPanel
            entry={coaching.entry}
            generating={coaching.generating}
            error={coaching.error}
            onGenerate={onGenerateCoaching}
            leaderName={title}
            summaryByKey={summaryByKey}
            jiraBaseUrl={jiraBaseUrl}
          />
        )}
        {versions.length === 0 ? (
          <p style={{ color: '#aaa', fontSize: 12 }}>No Feature/Initiative tickets in this section.</p>
        ) : (
          versions.map((version) => {
            const sectionItems = byVersion[version] || [];
            const key = kpiKey(version);
            return (
              <ReleaseSection
                key={`${title}-${version}`}
                version={version}
                items={sectionItems}
                breakdownDataMap={breakdownDataMap}
                loadingBreakdowns={loadingBreakdowns}
                jiraBaseUrl={jiraBaseUrl}
                onRefresh={onRefresh}
                checkpointHistory={checkpointHistory}
                gateData={gateDataMap[version] || null}
                projectStatus={projectStatusByRelease[version] || null}
                kpiData={kpiDataByRelease[key] || null}
                kpiLoading={kpiLoadingByRelease[key] || false}
                kpiError={kpiErrorByRelease[key] || null}
                ganttConfigFromDates={null}
                productId={productId}
                suppressComponentCounts
                suppressTierSummaries
                suppressTimeline
              />
            );
          })
        )}
      </Collapsible>
    </div>
  );
}

export default function SosLeaderSummaryPage() {
  const { jiraBaseUrl } = useJiraConfig();
  const { selectedTeamId, selectedTeam } = useTeam();
  const productId = selectedTeam?.id || selectedTeam?.productId || selectedTeamId || '';

  const {
    byVersion,
    loading,
    error,
    source,
    lastSyncIso,
    breakdownDataMap,
    loadingBreakdowns,
    fetchAll,
    fetchBreakdowns,
  } = useSosItems();

  const { checkpointHistory, fetchHistory } = useSosHistory();
  const {
    dataByRelease: kpiDataByRelease,
    loadingRelease: kpiLoadingByRelease,
    errorByRelease: kpiErrorByRelease,
    load: loadKpiForRelease,
  } = useReleaseKpiBreakdown();

  const {
    projectStatusByRelease,
    fetchProjectStatus,
  } = useSosTierSummary();

  const {
    asksByLeader,
    generatingLeader,
    errorByLeader,
    generateForLeader,
  } = useSosLeaderCoaching();

  const autoCoachingSigRef = useRef('');

  const { releases: releaseDatesConfig } = useReleaseDatesConfig();

  const [orgConfig, setOrgConfig] = useState(null);
  const [orgError, setOrgError] = useState(null);
  const [orgLoading, setOrgLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setOrgLoading(true);
    setOrgError(null);
    const jiraToken = localStorage.getItem('jiraToken') || '';
    const username = localStorage.getItem('username') || localStorage.getItem('userEmail') || '';
    authenticatedGet('/api/config/ndb-leader-org', {}, { jiraToken, username })
      .then((resp) => {
        if (!cancelled) setOrgConfig(resp.data);
      })
      .catch((err) => {
        if (!cancelled) setOrgError(err.response?.data?.error || err.message || 'Failed to load org config');
      })
      .finally(() => {
        if (!cancelled) setOrgLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedTeamId) return;
    fetchAll(selectedTeamId);
  }, [selectedTeamId, fetchAll]);

  const sortedVersions = useMemo(() => sortVersionKeys(Object.keys(byVersion || {})), [byVersion]);
  const activeVersions = useMemo(
    () => sortedVersions.filter((v) => !PLACEHOLDER_VERSIONS.has(String(v).trim().toLowerCase())),
    [sortedVersions]
  );

  const { gateDataMap } = useMultiReleaseGateData(sortedVersions);

  useEffect(() => {
    if (!productId || activeVersions.length === 0) return;
    activeVersions.forEach((v) => {
      fetchProjectStatus(productId, v).catch(() => {});
    });
  }, [productId, activeVersions, fetchProjectStatus]);

  const grouped = useMemo(() => {
    if (!orgConfig) return null;
    return regroupByLeader(byVersion, orgConfig);
  }, [byVersion, orgConfig]);

  // Per-leader Assignee Manager JQL scopes (counts + click-through must match).
  const leaderKpiScopes = useMemo(() => {
    if (!orgConfig) return [];
    const scopes = (orgConfig.leaders || []).map((leader) => {
      const names = listAssigneeManagerNamesForLeader(orgConfig, leader.id);
      const jqlExtra = buildAssigneeManagerJqlClause(names);
      return { scopeKey: leader.id, jqlExtra, leaderId: leader.id };
    });

    // Unmapped: managers present on unmapped items + EMPTY
    if (grouped?.unmapped?.itemCount > 0) {
      const names = new Set();
      let hasEmpty = false;
      Object.values(grouped.unmapped.byVersion || {}).forEach((items) => {
        (items || []).forEach((it) => {
          const n = extractAssigneeManagerName(it);
          if (!n) hasEmpty = true;
          else names.add(n);
        });
      });
      const jqlExtra = buildAssigneeManagerJqlClause([...names], { includeEmpty: hasEmpty });
      if (jqlExtra) scopes.push({ scopeKey: 'unmapped', jqlExtra, leaderId: null });
    }
    return scopes.filter((s) => s.jqlExtra);
  }, [orgConfig, grouped]);

  useEffect(() => {
    if (!selectedTeamId || activeVersions.length === 0 || leaderKpiScopes.length === 0) return;
    activeVersions.forEach((v) => {
      leaderKpiScopes.forEach(({ scopeKey, jqlExtra }) => {
        loadKpiForRelease(v, selectedTeamId, { jqlExtra, scopeKey });
      });
    });
  }, [activeVersions, selectedTeamId, leaderKpiScopes, loadKpiForRelease]);

  const enrichKeys = useMemo(() => {
    const tracked = new Set(
      Object.keys(releaseDatesConfig || {}).map((v) => v.trim().toLowerCase())
    );
    if (tracked.size === 0) return [];
    const seen = new Set();
    const keys = [];
    Object.values(byVersion || {}).flat().forEach((it) => {
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

  const breakdownKeys = useMemo(() => {
    const seen = new Set();
    const keys = [];
    Object.entries(byVersion || {}).forEach(([version, items]) => {
      if (PLACEHOLDER_VERSIONS.has(String(version).trim().toLowerCase())) return;
      (items || []).forEach((it) => {
        if (!it || !it.key || seen.has(it.key)) return;
        seen.add(it.key);
        keys.push(it.key);
      });
    });
    return keys;
  }, [byVersion]);

  const lastEnrichRef = useRef('');
  const lastBreakdownRef = useRef('');
  useEffect(() => {
    if (!selectedTeamId) return;

    if (enrichKeys.length > 0) {
      const sig = `${selectedTeamId}|${lastSyncIso || ''}|${enrichKeys.length}|${enrichKeys[0]}|${enrichKeys[enrichKeys.length - 1]}`;
      if (lastEnrichRef.current !== sig) {
        lastEnrichRef.current = sig;
        fetchHistory(selectedTeamId, enrichKeys);
      }
    }

    if (breakdownKeys.length > 0) {
      const sig = `${selectedTeamId}|${lastSyncIso || ''}|${breakdownKeys.length}|${breakdownKeys[0]}|${breakdownKeys[breakdownKeys.length - 1]}`;
      if (lastBreakdownRef.current !== sig) {
        lastBreakdownRef.current = sig;
        fetchBreakdowns(breakdownKeys);
      }
    }
  }, [selectedTeamId, lastSyncIso, enrichKeys, breakdownKeys, fetchHistory, fetchBreakdowns]);

  const handleRefresh = useCallback(() => {
    if (!selectedTeamId) return;
    fetchAll(selectedTeamId, { forceLive: true });
  }, [fetchAll, selectedTeamId]);

  const enrichmentReady = useMemo(() => {
    if (loading || orgLoading || loadingBreakdowns) return false;
    if (!grouped || !orgConfig) return false;
    if (activeVersions.length === 0) return false;
    // KPIs: at least one scope loaded (or none required)
    const scopes = leaderKpiScopes;
    if (scopes.length > 0) {
      const anyLoading = activeVersions.some((v) =>
        scopes.some((s) => kpiLoadingByRelease[`${v}::${s.scopeKey}`])
      );
      if (anyLoading) return false;
    }
    return true;
  }, [
    loading,
    orgLoading,
    loadingBreakdowns,
    grouped,
    orgConfig,
    activeVersions,
    leaderKpiScopes,
    kpiLoadingByRelease,
  ]);

  // Send enabled once enrichment settles; coaching is optional (included in HTML when present).
  const emailReady = enrichmentReady;

  const runCoachingForScope = useCallback(async (scopeKey, leaderMeta, byVersionMap) => {
    const items = flattenByVersion(byVersionMap);
    const expectedManagerNames = leaderMeta?.id
      ? listAssigneeManagerNamesForLeader(orgConfig, leaderMeta.id)
      : [];
    await generateForLeader({
      scopeKey,
      leaderId: leaderMeta?.id || scopeKey,
      leaderName: leaderMeta?.displayName || scopeKey,
      role: leaderMeta?.role || null,
      items,
      gateDataByRelease: gateDataMap,
      breakdownDataMap,
      checkpointHistory,
      expectedManagerNames,
    });
  }, [orgConfig, gateDataMap, breakdownDataMap, checkpointHistory, generateForLeader]);

  const handleGenerateAllCoaching = useCallback(async () => {
    if (!grouped || !orgConfig || !enrichmentReady) return;
    for (const leader of orgConfig.leaders || []) {
      const bucket = grouped.byLeader[leader.id] || { byVersion: {} };
      await runCoachingForScope(leader.id, leader, bucket.byVersion);
    }
    if (grouped.unmapped?.itemCount > 0) {
      await runCoachingForScope('unmapped', { id: 'unmapped', displayName: 'Unmapped' }, grouped.unmapped.byVersion);
    }
  }, [grouped, orgConfig, enrichmentReady, runCoachingForScope]);

  // After SoS items + org + breakdowns + KPIs settle, auto-run coaching Asks once per load.
  useEffect(() => {
    if (!enrichmentReady || !grouped || !orgConfig || generatingLeader) return;
    const leaderIds = (orgConfig.leaders || []).map((l) => l.id).join(',');
    const sig = `${selectedTeamId}|${lastSyncIso || ''}|${leaderIds}|${grouped.unmapped?.itemCount || 0}`;
    if (autoCoachingSigRef.current === sig) return;
    autoCoachingSigRef.current = sig;
    handleGenerateAllCoaching();
  }, [
    enrichmentReady,
    grouped,
    orgConfig,
    generatingLeader,
    selectedTeamId,
    lastSyncIso,
    handleGenerateAllCoaching,
  ]);

  const shared = useMemo(() => ({
    breakdownDataMap,
    loadingBreakdowns,
    jiraBaseUrl,
    onRefresh: handleRefresh,
    checkpointHistory,
    gateDataMap,
    projectStatusByRelease,
    kpiDataByRelease,
    kpiLoadingByRelease,
    kpiErrorByRelease,
    releaseDatesConfig,
    productId,
  }), [
    breakdownDataMap,
    loadingBreakdowns,
    jiraBaseUrl,
    handleRefresh,
    checkpointHistory,
    gateDataMap,
    projectStatusByRelease,
    kpiDataByRelease,
    kpiLoadingByRelease,
    kpiErrorByRelease,
    releaseDatesConfig,
    productId,
  ]);

  const totalItems = useMemo(
    () => Object.values(byVersion || {}).reduce((n, arr) => n + (arr?.length || 0), 0),
    [byVersion]
  );

  const execSnapshot = useMemo(() => {
    if (!grouped || !orgConfig) return null;
    const rows = (orgConfig.leaders || []).map((leader) => {
      const bucket = grouped.byLeader[leader.id] || { byVersion: {}, itemCount: 0 };
      const rollup = computeLeaderRollup(bucket.byVersion, breakdownDataMap);
      const asks = asksByLeader[leader.id]?.asks || [];
      const urgency = askUrgencyCounts(asks);
      return {
        id: leader.id,
        name: leader.displayName,
        ...rollup,
        asks: urgency,
        askTotal: asks.length,
      };
    });
    if (grouped.unmapped?.itemCount > 0) {
      const rollup = computeLeaderRollup(grouped.unmapped.byVersion, breakdownDataMap);
      const asks = asksByLeader.unmapped?.asks || [];
      rows.push({
        id: 'unmapped',
        name: 'Unmapped',
        ...rollup,
        asks: askUrgencyCounts(asks),
        askTotal: asks.length,
      });
    }
    const totals = rows.reduce(
      (acc, r) => {
        acc.count += r.count;
        acc.stale += r.stale;
        acc.outstanding += r.outstanding;
        acc.rag.Red += r.rag.Red;
        acc.rag.Yellow += r.rag.Yellow;
        acc.rag.Green += r.rag.Green;
        acc.rag.NotSet += r.rag.NotSet;
        return acc;
      },
      { count: 0, stale: 0, outstanding: 0, rag: { Red: 0, Yellow: 0, Green: 0, NotSet: 0 }, unmapped: grouped.unmapped?.itemCount || 0 }
    );
    return { rows, totals };
  }, [grouped, orgConfig, breakdownDataMap, asksByLeader]);

  // Heatmap uses leader-filtered items when a single leader is expanded? Keep full byVersion for overview.
  const heatmapByVersion = byVersion;

  const leaderEmailSnapshot = useMemo(() => {
    if (!grouped || !orgConfig) return null;
    const leaders = (orgConfig.leaders || []).map((leader) => ({
      id: leader.id,
      displayName: leader.displayName,
      role: leader.role,
      byVersion: grouped.byLeader[leader.id]?.byVersion || {},
      asks: asksByLeader[leader.id]?.asks || [],
      coachingText: asksByLeader[leader.id]?.text || '',
    }));
    if (grouped.unmapped?.itemCount > 0) {
      leaders.push({
        id: 'unmapped',
        displayName: 'Unmapped',
        role: 'unmapped',
        byVersion: grouped.unmapped.byVersion || {},
        asks: asksByLeader.unmapped?.asks || [],
        coachingText: asksByLeader.unmapped?.text || '',
      });
    }
    return {
      leaders,
      breakdownDataMap,
      gateDataMap,
      checkpointHistory,
      jiraBaseUrl,
      sortedVersions: activeVersions,
      tierSummaries: {},
      mode: 'leader',
    };
  }, [
    grouped,
    orgConfig,
    asksByLeader,
    breakdownDataMap,
    gateDataMap,
    checkpointHistory,
    jiraBaseUrl,
    activeVersions,
  ]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#1a1a2e', fontWeight: 700 }}>SoS by Leader</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>
            {orgConfig?.root ? `Root: ${orgConfig.root} · ` : ''}
            Anil · Naveen · Jovan · Ashish
            {source === 'cache' && lastSyncIso
              ? ` · cached ${new Date(lastSyncIso).toLocaleString()}`
              : source === 'jira'
                ? ' · live from JIRA'
                : ''}
            {totalItems > 0 ? ` · ${totalItems} items` : ''}
            {enrichmentReady ? ' · enrichment ready' : ' · loading enrichment…'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={handleGenerateAllCoaching}
            disabled={!enrichmentReady || !!generatingLeader}
            title="Generate NAI coaching asks for every leader (release + sprint packet)"
            style={{
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: 5,
              border: '1px solid #0d47a1',
              background: !enrichmentReady || generatingLeader ? '#e3f2fd' : '#0d47a1',
              color: !enrichmentReady || generatingLeader ? '#0d47a1' : '#fff',
              cursor: !enrichmentReady || generatingLeader ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {generatingLeader ? '✦ Generating Asks…' : '✦ Generate All Asks'}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading}
            style={{
              padding: '6px 14px',
              fontSize: 12,
              borderRadius: 5,
              border: '1px solid #1565c0',
              background: loading ? '#e3f2fd' : '#1565c0',
              color: loading ? '#1565c0' : '#fff',
              cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600,
            }}
          >
            {loading ? 'Loading…' : 'Refresh All'}
          </button>
          {leaderEmailSnapshot && (
            <SosEmailBar
              byVersion={{}}
              breakdownDataMap={breakdownDataMap}
              gateDataMap={gateDataMap}
              checkpointHistory={checkpointHistory}
              jiraBaseUrl={jiraBaseUrl}
              sortedVersions={activeVersions}
              tierSummaries={{}}
              leaderSnapshot={leaderEmailSnapshot}
              disabled={!emailReady || !!generatingLeader}
            />
          )}
        </div>
      </div>

      {(error || orgError) && (
        <div
          style={{
            background: '#ffebee',
            border: '1px solid #ef9a9a',
            borderRadius: 6,
            padding: '10px 14px',
            marginBottom: 14,
            fontSize: 13,
            color: '#b71c1c',
          }}
        >
          {error || orgError}
        </div>
      )}

      {(loading || orgLoading) && !grouped && (
        <p style={{ color: '#888', fontSize: 13 }}>Loading SoS items and org map…</p>
      )}

      {execSnapshot && (
        <SosLeaderExecSummary
          rows={execSnapshot.rows}
          totals={execSnapshot.totals}
          activeVersions={activeVersions}
        />
      )}

      {!loading && !error && activeVersions.length > 0 && (
        <SosRagHeatmap
          byVersion={heatmapByVersion}
          sortedVersions={activeVersions}
          defaultOpen={false}
        />
      )}

      {/* Gate timelines once per page (not repeated under every leader × release). */}
      {!loading && !error && activeVersions.some((v) => releaseDatesConfig[v]) && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#888', textTransform: 'uppercase', marginBottom: 6 }}>
            Release timelines
          </div>
          {activeVersions.filter((v) => releaseDatesConfig[v]).map((version) => (
            <div key={version} style={{ marginBottom: 8 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#333', marginBottom: 4 }}>{version}</div>
              <ReleaseVersionGantt
                ganttConfig={releaseDatesConfig[version]}
                selectedVersion={version}
                items={{ commit: [], longTermFunded: [] }}
                checkpointHistory={{}}
                sortItems={(arr) => arr}
                sprintDates={[]}
                timelineOnly
              />
            </div>
          ))}
        </div>
      )}

      {grouped && orgConfig && (
        <>
          {(orgConfig.leaders || []).map((leader, idx) => {
            const bucket = grouped.byLeader[leader.id] || { byVersion: {}, itemCount: 0 };
            return (
              <LeaderBucket
                key={leader.id}
                title={leader.displayName}
                itemCount={bucket.itemCount}
                byVersion={bucket.byVersion}
                defaultOpen={idx === 0}
                accent="#0d47a1"
                scopeKey={leader.id}
                shared={shared}
                coaching={{
                  entry: asksByLeader[leader.id],
                  generating: generatingLeader === leader.id,
                  error: errorByLeader[leader.id],
                }}
                onGenerateCoaching={() => runCoachingForScope(leader.id, leader, bucket.byVersion)}
              />
            );
          })}

          {grouped.unmapped.itemCount > 0 && (
            <LeaderBucket
              title="Unmapped"
              itemCount={grouped.unmapped.itemCount}
              byVersion={grouped.unmapped.byVersion}
              defaultOpen
              accent="#e65100"
              scopeKey="unmapped"
              shared={shared}
              coaching={{
                entry: asksByLeader.unmapped,
                generating: generatingLeader === 'unmapped',
                error: errorByLeader.unmapped,
              }}
              onGenerateCoaching={() =>
                runCoachingForScope('unmapped', { id: 'unmapped', displayName: 'Unmapped' }, grouped.unmapped.byVersion)
              }
            />
          )}
        </>
      )}
    </div>
  );
}
