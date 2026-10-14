/**
 * SoS by Leader (temp) — Overall (RAG, KPI, overall summary, category, Gantts)
 * then Leader → Release → one leader-context summary + SoS details (no tier boxes).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSosItems } from '../hooks/useSosItems';
import { useSosHistory } from '../hooks/useSosHistory';
import { useSosTierSummary } from '../hooks/useSosTierSummary';
import { useSosLeaderAiSummaries } from '../hooks/useSosLeaderAiSummaries';
import { useReleaseKpiBreakdown } from '../hooks/useReleaseKpiBreakdown';
import { useTeam } from '../contexts/TeamContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { authenticatedGet } from '../utils/api';
import {
  ReleaseSection,
  useMultiReleaseGateData,
  useReleaseDatesConfig,
} from './SosSummaryPage';
import { SosRagHeatmap, KpiBreakdownStrip } from './SosReleaseCharts';
import SosTierSummaryBox from './SosTierSummaryBox';
import ReleaseVersionGantt from './ReleaseVersionGantt';
import {
  regroupByLeader,
  sortVersionKeys,
  listAssigneeManagerNamesForLeader,
  buildAssigneeManagerJqlClause,
  extractAssigneeManagerName,
} from '../utils/sosLeaderGrouping';

const PLACEHOLDER_VERSIONS = new Set(['master', 'era future', 'unversioned']);

const ROLE_LABELS = {
  dev_senior_director: 'Dev Senior Director',
  qa_director: 'QA Director',
  dev_director: 'Dev Director',
  manager: 'Manager',
  qa_owner: 'QA Owner',
};

function Collapsible({ title, count, badge, defaultOpen = true, accent = '#1565c0', children }) {
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
        {badge}
      </button>
      {open && <div style={{ marginTop: 8 }}>{children}</div>}
    </div>
  );
}

function CategoryChips({ counts }) {
  const rows = [
    { key: 'feat', label: 'FEAT Work', n: counts.feat || 0, color: '#1565c0' },
    { key: 'standalone', label: 'Standalone Epics', n: counts.standalone || 0, color: '#6a1b9a' },
    { key: 'direct', label: 'Direct Tickets', n: counts.direct || 0, color: '#e65100' },
  ];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      {rows.map((r) => (
        <div
          key={r.key}
          style={{
            border: `1px solid ${r.color}33`,
            background: '#fff',
            borderRadius: 6,
            padding: '8px 14px',
            minWidth: 120,
          }}
        >
          <div style={{ fontSize: 10, fontWeight: 700, color: r.color, textTransform: 'uppercase' }}>
            {r.label}
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#1a1a2e', marginTop: 2 }}>{r.n}</div>
        </div>
      ))}
    </div>
  );
}

function LeaderBucket({
  title,
  roleLabel,
  leaderId,
  itemCount,
  byVersion,
  defaultOpen,
  accent,
  scopeKey,
  shared,
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
    leaderSummaries,
    onRetryLeaderSummary,
  } = shared;

  const kpiKey = (version) => (scopeKey ? `${version}::${scopeKey}` : version);
  const summaryKey = (version) => `${version}::${scopeKey}`;

  return (
    <div
      style={{
        border: `1px solid ${accent === '#e65100' ? '#ffcc80' : '#cfd8dc'}`,
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 20,
        background: accent === '#e65100' ? '#fff3e0' : '#fafbfc',
      }}
    >
      <Collapsible
        title={title}
        count={itemCount}
        defaultOpen={defaultOpen}
        accent={accent}
        badge={
          roleLabel ? (
            <span style={{ fontSize: 11, fontWeight: 500, color: '#78909c', marginLeft: 4 }}>{roleLabel}</span>
          ) : null
        }
      >
        {versions.length === 0 ? (
          <p style={{ color: '#aaa', fontSize: 12 }}>No Feature/Initiative tickets in this section.</p>
        ) : (
          versions.map((version) => {
            const sectionItems = byVersion[version] || [];
            const key = kpiKey(version);
            const sk = summaryKey(version);
            return (
              <div key={`${title}-${version}`} style={{ marginBottom: 16 }}>
                <div style={{ marginBottom: 10 }}>
                  <SosTierSummaryBox
                    title={`${title} — ${version}`}
                    tierState={leaderSummaries[sk] || { state: 'loading' }}
                    onRetry={() => onRetryLeaderSummary({
                      summaryKey: sk,
                      leaderId,
                      leaderName: title,
                      release: version,
                      items: sectionItems,
                      gateData: gateDataMap[version] || null,
                    })}
                  />
                </div>
                <ReleaseSection
                  version={version}
                  items={sectionItems}
                  breakdownDataMap={breakdownDataMap}
                  loadingBreakdowns={loadingBreakdowns}
                  jiraBaseUrl={jiraBaseUrl}
                  onRefresh={onRefresh}
                  checkpointHistory={checkpointHistory}
                  gateData={gateDataMap[version] || null}
                  projectStatus={projectStatusByRelease[version] || null}
                  showTierSummary={false}
                  kpiData={kpiDataByRelease[key] || null}
                  kpiLoading={kpiLoadingByRelease[key] || false}
                  kpiError={kpiErrorByRelease[key] || null}
                  ganttConfigFromDates={releaseDatesConfig[version] || null}
                  productId={productId}
                />
              </div>
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

  const { projectStatusByRelease, fetchProjectStatus } = useSosTierSummary();

  const {
    overall,
    byKey: leaderSummaries,
    reset: resetAi,
    generateOverall,
    retryOverall,
    runLeaderReleaseQueue,
    retryLeaderRelease,
    categoryCountsFromProjectStatus,
  } = useSosLeaderAiSummaries();

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
    return () => { cancelled = true; };
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

  const { gateDataMap, loadingGates } = useMultiReleaseGateData(sortedVersions);

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

  // Unscoped overall KPIs (no leader jqlExtra)
  const lastOverallKpiSigRef = useRef('');
  useEffect(() => {
    if (!selectedTeamId || activeVersions.length === 0) return;
    const sig = `${selectedTeamId}|${activeVersions.join(',')}|overall`;
    if (lastOverallKpiSigRef.current === sig) return;
    lastOverallKpiSigRef.current = sig;
    activeVersions.forEach((v) => {
      loadKpiForRelease(v, selectedTeamId);
    });
  }, [activeVersions, selectedTeamId, loadKpiForRelease]);

  // Leader-scoped KPIs
  const leaderKpiScopes = useMemo(() => {
    if (!orgConfig) return [];
    const scopes = (orgConfig.leaders || []).map((leader) => {
      const names = listAssigneeManagerNamesForLeader(orgConfig, leader.id);
      const jqlExtra = buildAssigneeManagerJqlClause(names);
      return { scopeKey: leader.id, jqlExtra, leaderId: leader.id };
    });
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

  const lastKpiSigRef = useRef('');
  useEffect(() => {
    if (!selectedTeamId || activeVersions.length === 0 || leaderKpiScopes.length === 0) return;
    const scopeSig = leaderKpiScopes.map((s) => `${s.scopeKey}:${s.jqlExtra}`).join('|');
    const sig = `${selectedTeamId}|${activeVersions.join(',')}|${scopeSig}`;
    if (lastKpiSigRef.current === sig) return;
    lastKpiSigRef.current = sig;
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
    resetAi();
    fetchAll(selectedTeamId, { forceLive: true });
  }, [fetchAll, selectedTeamId, resetAi]);

  // Overall category rollup across active releases
  const overallCategoryCounts = useMemo(() => {
    const tot = { feat: 0, standalone: 0, direct: 0 };
    activeVersions.forEach((v) => {
      const c = categoryCountsFromProjectStatus(projectStatusByRelease[v]);
      tot.feat += c.feat;
      tot.standalone += c.standalone;
      tot.direct += c.direct;
    });
    return tot;
  }, [activeVersions, projectStatusByRelease, categoryCountsFromProjectStatus]);

  const projectStatusReady = useMemo(
    () => activeVersions.length > 0 && activeVersions.every((v) => projectStatusByRelease[v]),
    [activeVersions, projectStatusByRelease]
  );

  // Reset AI when team changes (Refresh All also calls resetAi).
  useEffect(() => {
    resetAi();
  }, [selectedTeamId, resetAi]);

  // Auto overall summary once JIRA deps ready
  useEffect(() => {
    if (loading || loadingBreakdowns || loadingGates || error || !activeVersions.length) return;
    if (!projectStatusReady) return;
    generateOverall({
      activeVersions,
      byVersion,
      gateDataMap,
      projectStatusByRelease,
    });
  }, [
    loading,
    loadingBreakdowns,
    loadingGates,
    error,
    activeVersions,
    byVersion,
    gateDataMap,
    projectStatusByRelease,
    projectStatusReady,
    generateOverall,
    lastSyncIso,
  ]);

  // Auto leader×release queue
  const byVersionRef = useRef(byVersion);
  const gateDataMapRef = useRef(gateDataMap);
  byVersionRef.current = byVersion;
  gateDataMapRef.current = gateDataMap;

  useEffect(() => {
    if (!grouped || !orgConfig) return;
    if (loading || loadingBreakdowns || loadingGates || error || orgError) return;

    const jobs = [];
    const pushJobs = (byVer, leaderId, leaderName) => {
      Object.entries(byVer || {}).forEach(([version, items]) => {
        if (PLACEHOLDER_VERSIONS.has(String(version).trim().toLowerCase())) return;
        if (!items || items.length === 0) return;
        jobs.push({
          summaryKey: `${version}::${leaderId}`,
          leaderId,
          leaderName,
          release: version,
          items,
          gateData: gateDataMapRef.current[version] || null,
        });
      });
    };

    (orgConfig.leaders || []).forEach((leader) => {
      const bucket = grouped.byLeader[leader.id];
      if (bucket) pushJobs(bucket.byVersion, leader.id, leader.displayName);
    });
    if (grouped.unmapped?.itemCount > 0) {
      pushJobs(grouped.unmapped.byVersion, 'unmapped', 'Unmapped');
    }

    if (!jobs.length) return;
    runLeaderReleaseQueue(jobs);
  }, [
    grouped,
    orgConfig,
    loading,
    loadingBreakdowns,
    loadingGates,
    error,
    orgError,
    runLeaderReleaseQueue,
    lastSyncIso,
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
    leaderSummaries,
    onRetryLeaderSummary: retryLeaderRelease,
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
    leaderSummaries,
    retryLeaderRelease,
  ]);

  const totalItems = useMemo(
    () => Object.values(byVersion || {}).reduce((n, arr) => n + (arr?.length || 0), 0),
    [byVersion]
  );

  return (
    <div>
      <div
        style={{
          background: '#fff8e1',
          border: '1px solid #ffe082',
          borderRadius: 6,
          padding: '10px 14px',
          marginBottom: 16,
          fontSize: 13,
          color: '#5d4037',
        }}
      >
        <strong>TEMP — leader SoS layout review.</strong> Overall rollup at top; then Leader → Release
        with one context summary + SoS details. Email / Friday cron not wired yet.
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: 18, color: '#1a1a2e', fontWeight: 700 }}>SoS by Leader (temp)</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#888' }}>
            {orgConfig?.root ? `Root: ${orgConfig.root} · ` : ''}
            Anil · Naveen · Jovan · Ashish
            {source === 'cache' && lastSyncIso
              ? ` · cached ${new Date(lastSyncIso).toLocaleString()}`
              : source === 'jira'
                ? ' · live from JIRA'
                : ''}
            {totalItems > 0 ? ` · ${totalItems} items` : ''}
          </p>
        </div>
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

      {/* ── Overall ── */}
      {!loading && !error && activeVersions.length > 0 && (
        <section
          style={{
            border: '1px solid #cfd8dc',
            borderRadius: 10,
            padding: '14px 16px',
            marginBottom: 24,
            background: '#fff',
          }}
        >
          <h3 style={{ margin: '0 0 12px', fontSize: 15, color: '#0d47a1', fontWeight: 700 }}>Overall</h3>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>
              RAG breakdown
            </div>
            <SosRagHeatmap
              byVersion={byVersion}
              sortedVersions={activeVersions}
              defaultOpen
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>
              KPI
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {activeVersions.map((v) => (
                <div key={`kpi-${v}`}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: '#455a64', marginBottom: 4 }}>{v}</div>
                  {(kpiDataByRelease[v] || kpiLoadingByRelease[v]) ? (
                    <KpiBreakdownStrip
                      kpiData={kpiDataByRelease[v] || null}
                      loading={kpiLoadingByRelease[v] || false}
                      error={kpiErrorByRelease[v] || null}
                      jiraBaseUrl={jiraBaseUrl}
                    />
                  ) : (
                    <span style={{ fontSize: 12, color: '#aaa' }}>Loading KPIs…</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>
              Overall summary
            </div>
            <SosTierSummaryBox
              title="Overall SoS"
              tierState={overall.state === 'idle' ? { state: 'loading' } : overall}
              onRetry={() => retryOverall({
                activeVersions,
                byVersion,
                gateDataMap,
                projectStatusByRelease,
              })}
            />
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>
              Category of work
            </div>
            {projectStatusReady ? (
              <CategoryChips counts={overallCategoryCounts} />
            ) : (
              <span style={{ fontSize: 12, color: '#aaa' }}>Loading category counts…</span>
            )}
          </div>

          <div>
            <div style={{ fontSize: 10, fontWeight: 700, color: '#888', marginBottom: 6, textTransform: 'uppercase' }}>
              Release Gantts
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {activeVersions.map((v) => (
                releaseDatesConfig[v] ? (
                  <div key={`gantt-${v}`}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#455a64', marginBottom: 4 }}>{v}</div>
                    <ReleaseVersionGantt
                      ganttConfig={releaseDatesConfig[v]}
                      selectedVersion={v}
                      items={{ commit: [], longTermFunded: [] }}
                      checkpointHistory={{}}
                      sortItems={(arr) => arr}
                      sprintDates={[]}
                      timelineOnly
                    />
                  </div>
                ) : null
              ))}
              {activeVersions.every((v) => !releaseDatesConfig[v]) && (
                <span style={{ fontSize: 12, color: '#aaa' }}>No release-dates config for active versions.</span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Leaders ── */}
      {grouped && orgConfig && (
        <>
          {(orgConfig.leaders || []).map((leader, idx) => {
            const bucket = grouped.byLeader[leader.id] || { byVersion: {}, itemCount: 0 };
            return (
              <LeaderBucket
                key={leader.id}
                title={leader.displayName}
                roleLabel={ROLE_LABELS[leader.role] || leader.role || ''}
                leaderId={leader.id}
                itemCount={bucket.itemCount}
                byVersion={bucket.byVersion}
                defaultOpen={idx === 0}
                accent="#0d47a1"
                scopeKey={leader.id}
                shared={shared}
              />
            );
          })}

          {grouped.unmapped.itemCount > 0 && (
            <LeaderBucket
              title="Unmapped"
              roleLabel="Add Assignee Manager to ndbLeaderOrgConfig.json"
              leaderId="unmapped"
              itemCount={grouped.unmapped.itemCount}
              byVersion={grouped.unmapped.byVersion}
              defaultOpen
              accent="#e65100"
              scopeKey="unmapped"
              shared={shared}
            />
          )}
        </>
      )}
    </div>
  );
}
