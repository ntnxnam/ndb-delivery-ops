import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageLoading } from '../shared/components/PageLoading';
import { useCfdCfi } from '../hooks/useCfdCfi';
import { useTeam } from '../contexts/TeamContext';
import { TeamRequiredGate } from '../layout/components/TeamRequiredGate';
import { usePermissions } from '../auth/hooks/usePermissions';
import { useExecPageBriefing } from '../hooks/useExecPageBriefing';
import ExecPageBriefing from './ExecPageBriefing';
import KpiPulseBand from './KpiPulse/KpiPulseBand';
import OpenTicketsDrill from './CfdCfi/OpenTicketsDrill';
import './CfdCfi/CfdCfi.css';

function openCount(kpi) {
  const fromPulse = kpi?.pulse?.heroes?.openNow?.count;
  if (typeof fromPulse === 'number') return fromPulse;
  return kpi?.openTickets?.total ?? 0;
}

export default function CfdCfiPage() {
  const { selectedTeamId, hasTeamSelected } = useTeam();
  const { isExecAudience } = usePermissions();
  const { data, loading, refreshing, error, refresh } = useCfdCfi(selectedTeamId);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeKpiId, setActiveKpiId] = useState(null);
  /** @type {[{ mode: string, cell: object|null }|null, Function]} */
  const [drill, setDrill] = useState(null);

  const kpis = useMemo(() => data?.kpis || [], [data?.kpis]);
  const jiraBase = data?.jiraBaseUrl || 'https://jira.nutanix.com';
  const kpiParam = searchParams.get('kpi');

  const cfdSnapshot = useMemo(() => {
    if (!kpis.length) return null;
    return {
      label: `CFD/CFI · ${selectedTeamId || ''}`,
      story: null,
      kpis: kpis.map((k) => ({ id: k.id, name: k.name, count: openCount(k) })),
      pulse: kpis[0]?.pulse || null,
    };
  }, [kpis, selectedTeamId]);

  const cfdSnapshotKey = useMemo(
    () => (cfdSnapshot ? cfdSnapshot.kpis.map((k) => `${k.id}:${k.count}`).join(',') : ''),
    [cfdSnapshot]
  );

  const {
    state: execBriefState,
    summary: execBriefSummary,
    meta: execBriefMeta,
    error: execBriefError,
    refresh: refreshExecBrief,
  } = useExecPageBriefing({
    enabled: isExecAudience,
    surface: 'kpi',
    teamId: selectedTeamId,
    snapshot: cfdSnapshot,
    snapshotKey: `cfdcfi|${cfdSnapshotKey}`,
    ready: Boolean(cfdSnapshot),
  });

  useEffect(() => {
    setDrill(null);
    if (kpiParam && kpis.some((k) => k.id === kpiParam)) {
      setActiveKpiId(kpiParam);
      return;
    }
    if (kpis.length) {
      setActiveKpiId((prev) => {
        if (prev && kpis.some((k) => k.id === prev)) return prev;
        return kpis[0].id;
      });
    } else {
      setActiveKpiId(null);
    }
  }, [selectedTeamId, kpis, kpiParam]);

  const activeKpi = useMemo(
    () => kpis.find((k) => k.id === activeKpiId) || kpis[0] || null,
    [kpis, activeKpiId]
  );

  const selectTab = useCallback(
    (id) => {
      setActiveKpiId(id);
      setDrill(null);
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('kpi', id);
        return next;
      }, { replace: true });
    },
    [setSearchParams]
  );

  const openHeroDrill = useCallback((mode, cell) => {
    setDrill({ mode, cell: cell || null });
  }, []);

  const story = useMemo(() => {
    if (!kpis.length) {
      return data?.emptyReason || 'No CFD/CFI KPIs for this team yet.';
    }
    const parts = kpis.map((k) => `${k.name}: ${openCount(k)} open`);
    return `${kpis.length} CFD/CFI KPI(s). ${parts.join(' · ')}.`;
  }, [kpis, data]);

  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        title="Select a team for CFD / CFI"
        description="CFD/CFI pulse follows the selected team’s KPI config. Pick a team in the sidebar, then Pull from JIRA."
      />
    );
  }

  return (
    <div className="cfdcfi-page">
      <header className="cfdcfi-header">
        <div>
          <h1>CFD / CFI</h1>
          <p className="cfdcfi-meta">
            Team KPIs matching {data?.kpiNamePattern || 'CFD|CFI'}
            {data?.asOf ? ` · as of ${new Date(data.asOf).toLocaleString()}` : null}
          </p>
        </div>
        <div className="cfdcfi-actions">
          <button
            type="button"
            className="primary"
            onClick={refresh}
            disabled={loading || refreshing}
          >
            {refreshing ? 'Pulling…' : 'Pull from JIRA'}
          </button>
        </div>
      </header>

      {error ? <div className="cfdcfi-error">{error}</div> : null}

      <ExecPageBriefing
        state={execBriefState}
        summary={execBriefSummary}
        meta={execBriefMeta}
        error={execBriefError}
        onRetry={refreshExecBrief}
        jiraBase={jiraBase}
      />

      {loading && !data ? (
        <PageLoading message="Loading CFD/CFI pulse…" />
      ) : null}

      {!loading && data && !kpis.length ? (
        <div className="cfdcfi-empty">{data.emptyReason || story}</div>
      ) : null}

      {kpis.length > 0 ? (
        <>
          <p className="cfdcfi-story">{story}</p>
          <div className="cfdcfi-tabs" role="tablist" aria-label="CFD and CFI KPIs">
            {kpis.map((k) => {
              const active = activeKpi?.id === k.id;
              return (
                <button
                  key={k.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className={`cfdcfi-tab${active ? ' cfdcfi-tab--active' : ''}`}
                  onClick={() => selectTab(k.id)}
                >
                  {k.name}
                  <span className="cfdcfi-tab-count">{openCount(k)}</span>
                </button>
              );
            })}
          </div>

          {activeKpi ? (
            <div className="cfdcfi-panel" role="tabpanel">
              {activeKpi.error ? (
                <div className="cfdcfi-error">Pulse failed for {activeKpi.name}: {activeKpi.error}</div>
              ) : null}
              <div className="cfdcfi-panel-actions">
                <button
                  type="button"
                  onClick={() =>
                    openHeroDrill('openNow', activeKpi.pulse?.heroes?.openNow || null)
                  }
                >
                  Open tickets ({activeKpi.openTickets?.total ?? 0})
                </button>
              </div>
              <KpiPulseBand
                pulse={activeKpi.pulse}
                jiraBaseUrl={jiraBase}
                title={`${activeKpi.name} · last 2 Nutanix Qs`}
                domainHint="CFD/CFI"
                loading={false}
                error={activeKpi.pulse ? null : activeKpi.error}
                onHeroClick={openHeroDrill}
              />
            </div>
          ) : null}

          <OpenTicketsDrill
            open={Boolean(drill)}
            mode={drill?.mode || 'openNow'}
            kpiName={activeKpi?.name || ''}
            openTickets={activeKpi?.openTickets}
            heroCell={drill?.cell}
            heroCount={drill?.cell?.count}
            agedDays={activeKpi?.pulse?.agedOpenDays ?? 14}
            jiraBase={jiraBase}
            onClose={() => setDrill(null)}
          />
        </>
      ) : null}
    </div>
  );
}
