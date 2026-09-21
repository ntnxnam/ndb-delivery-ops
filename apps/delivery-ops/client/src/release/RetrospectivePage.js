import React, { useMemo } from 'react';
import { useTeam } from '../contexts/TeamContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { useReleaseData } from '../contexts/ReleaseDataContext';
import { useRetrospective } from './hooks/useRetrospective';
import { useRetroComparison } from './hooks/useRetroComparison';
import { pickComparisonReleases } from './utils/releaseCompareSet';
import { deriveQualityMetricsFromBundle } from './utils/bundleUtils';
import { jiraSearchUrl } from './services/retrospectiveService';
import { GateTimelineRuler } from './components/GateTimelineRuler';
import { GateComplianceCard } from './components/GateComplianceCard';
import { ProjectGateHealthTable } from './components/ProjectGateHealthTable';
import { ReleaseComparisonTable } from './components/ReleaseComparisonTable';
import { NaughtyListTable, ReopenQualityPanel } from './components/NaughtyListTable';
import { CompanionReadinessPanel } from './components/CompanionReadinessPanel';
import { PgToGaPanel } from './components/PgToGaPanel';
import { SectionPanel } from '../design-system';
import './RetrospectivePage.css';
import './ReleaseBriefPage.css';

function gateCardData(retro, jiraBaseUrl) {
  const checks = retro?.gateChecks || null;
  // When no checks data is available yet, use '—' placeholders so the user
  // can distinguish "still loading" from a genuine zero count.
  const val = (v) => (checks == null ? '—' : v);
  return [
    {
      title: 'CCM',
      contract: 'Task + Unit Test should be closed by code complete',
      metrics: [
        {
          label: 'Open at gate',
          value: val(checks?.ccm?.openAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.ccm?.links?.openAtGate),
          rag: checks?.ccm?.rag,
        },
        {
          label: 'Closed %',
          value: checks == null ? '—' : `${checks?.ccm?.closedPct ?? 0}%`,
          href: jiraSearchUrl(jiraBaseUrl, checks?.ccm?.links?.total),
        },
      ],
    },
    {
      title: 'CG',
      contract: 'P0/P1 bugs should be closed by commit gate',
      metrics: [
        {
          label: 'P0/P1 open at gate',
          value: val(checks?.cg?.p0p1OpenAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.cg?.links?.p0p1OpenAtGate),
          rag: checks?.cg?.ragOpen,
        },
        {
          label: 'P0/P1 found after gate',
          value: val(checks?.cg?.p0p1FoundAfter ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.cg?.links?.p0p1FoundAfter),
          rag: checks?.cg?.ragAfter,
        },
      ],
    },
    {
      title: 'PG',
      contract: 'Tests and bugs should be closed or deferred',
      metrics: [
        {
          label: 'Tests open at gate',
          value: val(checks?.pg?.testsOpenAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.pg?.links?.testsOpenAtGate),
          rag: checks?.pg?.ragTests,
        },
        {
          label: 'Bugs open at gate',
          value: val(checks?.pg?.bugsOpenAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.pg?.links?.bugsOpenAtGate),
          rag: checks?.pg?.ragBugs,
        },
      ],
    },
    {
      title: 'GA',
      contract: 'All release work should be closed by GA',
      metrics: [
        {
          label: 'Open at gate',
          value: val(checks?.ga?.openAtGate ?? 0),
          href: jiraSearchUrl(jiraBaseUrl, checks?.ga?.links?.openAtGate),
          rag: checks?.ga?.rag,
        },
      ],
    },
  ];
}

function _StatusPill({ value }) {
  if (!value) return <span style={{ color: 'var(--ds-muted)' }}>—</span>;
  const MAP = {
    on_time_or_early: { label: 'On time / Early', cls: 'success' },
    slipped: { label: 'Slipped', cls: 'danger' },
    at_risk: { label: 'At risk', cls: 'warning' },
    not_complete: { label: 'Not complete', cls: 'muted' },
    code_complete: { label: 'Code complete', cls: 'success' },
  };
  const { label, cls } = MAP[value] || { label: value.replace(/_/g, ' '), cls: 'muted' };
  return <span className={`retro-status-pill retro-status-pill--${cls}`}>{label}</span>;
}

export default function RetrospectivePage() {
  const { selectedTeamId, selectedTeam } = useTeam();
  const { jiraBaseUrl } = useJiraConfig();
  const { releaseTickets } = useReleaseData();
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || '';
  const team = selectedTeam;

  const {
    ready,
    activeVersions,
    inactiveVersions,
    hasFetched,
    bootstrap,
    projectsPage,
    selectedProjectKey,
    selectProject,
    projectDetail,
    retroFallback,
    selectedRelease,
    setSelectedRelease,
    loading,
    loadingBootstrap,
    loadingProjects,
    loadingDetail,
    error,
    refresh,
  } = useRetrospective({
    teamId: selectedTeamId,
    jiraToken,
    username,
    productId: team?.id || '',
    topN: 10,
  });

  // Cross-release comparison: selected release vs the latest big releases.
  const comparisonReleases = useMemo(
    () => pickComparisonReleases(
      [...(activeVersions || []), ...(inactiveVersions || [])],
      selectedRelease,
      3
    ),
    [activeVersions, inactiveVersions, selectedRelease]
  );

  const comparison = useRetroComparison({
    releases: comparisonReleases,
    teamId: selectedTeamId,
    productId: team?.id || selectedTeamId || '',
    jiraToken,
    username,
    enabled: hasFetched && ready,
  });

  // Priority: per-project detail (when a project row is selected) >
  //           release-level checks from bootstrap (fast, loads with gate timeline) >
  //           full retroFallback (legacy aggregate endpoint, only on error).
  const retro = useMemo(() => {
    if (projectDetail) {
      return {
        gateChecks: projectDetail.checks,
        companionReadiness: null,
        pgToGa: null,
        gateTimeline: bootstrap?.gateTimeline,
      };
    }
    if (bootstrap?.gateChecks) {
      return {
        gateChecks: bootstrap.gateChecks,
        companionReadiness: null,
        pgToGa: bootstrap.pgToGa ?? null,
        gateTimeline: bootstrap?.gateTimeline,
      };
    }
    return retroFallback;
  }, [projectDetail, bootstrap, retroFallback]);

  // Gate compliance cards should always use bootstrap data (standalone epics + tickets only),
  // not projectDetail. Row selection should NOT change the cards.
  const cards = useMemo(() => gateCardData({
    gateChecks: bootstrap?.gateChecks || retroFallback?.gateChecks
  }, jiraBaseUrl), [bootstrap, retroFallback, jiraBaseUrl]);

  const companionWithUrls = useMemo(() => {
    const rows = retro?.companionReadiness?.rows || [];
    return rows.map((r) => ({
      ...r,
      links: {
        openAtPg: jiraSearchUrl(jiraBaseUrl, r.links?.openAtPg),
        openAtGa: jiraSearchUrl(jiraBaseUrl, r.links?.openAtGa),
      },
    }));
  }, [retro, jiraBaseUrl]);

  const qualityMetrics = useMemo(
    () => deriveQualityMetricsFromBundle({ tickets: releaseTickets }, selectedRelease),
    [releaseTickets, selectedRelease]
  );

  const naughtyWithUrls = useMemo(() => {
    const rows = retro?.naughtyList?.rows || [];
    return {
      ...retro?.naughtyList,
      rows: rows.map((r) => ({
        ...r,
        links: {
          ccmSlip: jiraSearchUrl(jiraBaseUrl, r.links?.ccmSlip),
          cgOpenAtGate: jiraSearchUrl(jiraBaseUrl, r.links?.cgOpenAtGate),
          cgFoundAfter: jiraSearchUrl(jiraBaseUrl, r.links?.cgFoundAfter),
          pgTests: jiraSearchUrl(jiraBaseUrl, r.links?.pgTests),
          pgBugs: jiraSearchUrl(jiraBaseUrl, r.links?.pgBugs),
          deferredCount: jiraSearchUrl(jiraBaseUrl, r.links?.deferredCount),
        },
      })),
    };
  }, [retro, jiraBaseUrl]);

  const pgToGaWithUrls = useMemo(
    () => ({
      ...retro?.pgToGa,
      links: {
        closedInWindow: jiraSearchUrl(jiraBaseUrl, retro?.pgToGa?.links?.closedInWindow),
        deferredInWindow: jiraSearchUrl(jiraBaseUrl, retro?.pgToGa?.links?.deferredInWindow),
      },
    }),
    [retro, jiraBaseUrl]
  );

  return (
    <div className="ds-scope">
      <div className="ds-page">
        <div className="ds-page__inner retrospective-page">
          <div className="retro-header">
            <div>
              <h2>Release Retrospective</h2>
              <div className="retro-hint">Team: {team?.name || '—'}</div>
            </div>
            <div className="retro-actions">
              <label htmlFor="retro-release-select">Release</label>
              <select
                id="retro-release-select"
                value={selectedRelease || ''}
                onChange={(e) => setSelectedRelease(e.target.value)}
                disabled={loading}
              >
                <option value="">— select —</option>
                {activeVersions.map((v) => (
                  <option key={v.name} value={v.name}>{v.name}</option>
                ))}
                {inactiveVersions.length > 0 && (
                  <optgroup label="── Past Releases ──">
                    {inactiveVersions.map((v) => (
                      <option key={v.name} value={v.name}>{v.name}</option>
                    ))}
                  </optgroup>
                )}
              </select>
              <button onClick={refresh} type="button" disabled={loading || !selectedRelease || !ready}>
                {loading ? 'Loading...' : 'Fetch'}
              </button>
            </div>
          </div>

          {error ? <div className="rb-error">{error}</div> : null}
          {!ready ? (
            <div className="rb-empty">Pick a team in the header to load retrospective data.</div>
          ) : !hasFetched ? (
            <div className="rb-empty">Select a release and press <strong>Fetch</strong>.</div>
          ) : null}

          {hasFetched && <>
          <SectionPanel
            title="Cross-Release Comparison"
            subtitle={`Selected vs latest big releases · ${comparison.releases.join(' → ') || '—'}`}
          >
            {comparison.loading ? (
              <div className="rb-empty">Loading comparison…</div>
            ) : comparison.releases.length < 2 ? (
              <div className="rb-empty">Need at least two comparable releases to show a comparison.</div>
            ) : (
              <ReleaseComparisonTable
                releases={comparison.releases}
                scorecards={comparison.scorecards}
                verifications={comparison.verifications}
                kpiByRelease={comparison.kpiByRelease}
                kpiDefs={comparison.kpiDefs}
                jiraBaseUrl={jiraBaseUrl}
              />
            )}
            {comparison.error ? (
              <div className="rb-error" style={{ marginTop: 8 }}>{comparison.error}</div>
            ) : null}
          </SectionPanel>

          <SectionPanel
            title="Gate Timeline"
            subtitle={`EC, CCM, CG, PG, GA${bootstrap?.parentCount ? ` · ${bootstrap.parentCount} projects` : ''}`}
          >
            {loadingBootstrap ? (
              <div className="rb-empty">Loading bootstrap...</div>
            ) : (
              <GateTimelineRuler gateTimeline={bootstrap?.gateTimeline} />
            )}
          </SectionPanel>

          <ProjectGateHealthTable
            loadingProjects={loadingProjects}
            projectsPage={projectsPage}
            bootstrap={bootstrap}
            selectedProjectKey={selectedProjectKey}
            selectProject={selectProject}
            jiraBaseUrl={jiraBaseUrl}
          />

          <SectionPanel
            title="Gate Compliance"
            subtitle={loadingBootstrap ? `Loading for ${selectedRelease}…` : `Standalone Epics & Tickets · ${selectedRelease}`}
          >
            <div className="retro-grid">
              {cards.map((c) => (
                <GateComplianceCard key={c.title} {...c} />
              ))}
            </div>
          </SectionPanel>

          {/* Standalone Deferred Tickets Tile */}
          {retro?.pgToGa != null && (
            <div
              style={{
                marginTop: 16,
                marginBottom: 12,
                padding: 'var(--ds-space-3) var(--ds-space-4)',
                backgroundColor: 'var(--ds-surface-raised)',
                border: '1px solid var(--ds-border)',
                borderRadius: 'var(--ds-radius-lg)',
                display: 'flex',
                alignItems: 'center',
                gap: 'var(--ds-space-3)',
                fontSize: 'var(--ds-fs-small)',
              }}
            >
              <div
                style={{
                  display: 'inline-block',
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  backgroundColor: 'var(--ds-warning)',
                  flexShrink: 0,
                }}
              />
              <span style={{ color: 'var(--ds-text-strong)' }}>
                <strong>Standalone Deferred Tickets:</strong>{' '}
                {pgToGaWithUrls?.links?.deferredInWindow ? (
                  <a
                    href={pgToGaWithUrls.links.deferredInWindow}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--ds-warning)', textDecoration: 'none', fontWeight: 'bold' }}
                  >
                    {pgToGaWithUrls?.deferredInWindow ?? 0}
                  </a>
                ) : (
                  pgToGaWithUrls?.deferredInWindow ?? '—'
                )}
              </span>
            </div>
          )}

          {loadingBootstrap ? (
            <div className="rb-empty" style={{ textAlign: 'center', marginTop: 8 }}>
              Loading release gate checks…
            </div>
          ) : loadingDetail ? (
            <div className="rb-empty" style={{ textAlign: 'center', marginTop: 8 }}>
              Loading project detail…
            </div>
          ) : null}

          {retroFallback ? <NaughtyListTable naughtyList={naughtyWithUrls} /> : null}
          <ReopenQualityPanel qualityMetrics={qualityMetrics} />
          {retroFallback ? (
            <CompanionReadinessPanel
              companionReadiness={{ ...retro?.companionReadiness, rows: companionWithUrls }}
            />
          ) : null}
          {retroFallback ? <PgToGaPanel pgToGa={pgToGaWithUrls} /> : null}
          </>}
        </div>
      </div>
    </div>
  );
}
