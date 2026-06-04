/*
 * ReleaseBriefPage — the first real surface composed entirely from the
 * new design-system primitives, talking to live JIRA via the existing
 * release-kpi-results-batch endpoint.
 *
 * Anatomy:
 *
 *   ┌───────────────────────────────────────────────────────────────┐
 *   │ PORTFOLIO DELIVERY OPS · RELEASE BRIEF                        │
 *   │ Release Brief                              [picker] [refresh] │
 *   │                                                               │
 *   │ Team: <name>   ·   Showing <N> metrics   ·   Synced just now │
 *   │                                                               │
 *   │ ┌──── KPI ────┐ ┌──── KPI ────┐ ┌──── KPI ────┐ ┌──── KPI ─┐ │
 *   │ │  count + jql│ │             │ │             │ │          │ │
 *   │ └─────────────┘ └─────────────┘ └─────────────┘ └──────────┘ │
 *   └───────────────────────────────────────────────────────────────┘
 *
 * Routing:
 *   - /release/brief                → uses persisted/default release
 *   - /release/:name/brief          → forces a specific release name
 *
 * Default release: localStorage('releaseBriefSelectedRelease') falling
 * back to NDB-2.11 (per D13). Picker change persists.
 *
 * Every KPI's number is wrapped in a JIRA link
 * (per jira-authenticity-links.mdc).
 */

import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import {
  KPICard,
  GateTimeline,
  MutedLabel,
  Pill,
  SectionPanel,
} from '../design-system';
import { useTeam } from '../contexts/TeamContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { useReleaseBrief } from './hooks/useReleaseBrief';
import { jiraSearchUrl } from './services/releaseBriefService';
import { ProjectBreakdownMatrix } from './components/ProjectBreakdownMatrix';
import './ReleaseBriefPage.css';

export default function ReleaseBriefPage() {
  const { name: nameFromUrl } = useParams();
  const { selectedTeamId, teams } = useTeam();
  const { jiraBaseUrl } = useJiraConfig();
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || '';

  const team = teams?.find((t) => t.id === selectedTeamId);

  const {
    ready,
    loading,
    loadingResults,
    loadingSynopsis,
    loadingVelocity,
    loadingForecast,
    loadingGates,
    loadingOutstanding,
    loadingProjectBreakdown,
    error,
    versions,
    kpis,
    results,
    synopsis,
    velocity,
    forecast,
    gateTimeline,
    outstanding,
    projectBreakdown,
    selectedRelease,
    setSelectedRelease,
    refresh,
  } = useReleaseBrief({
    teamId: selectedTeamId,
    productId: team?.id || 'ndb',
    jiraToken,
    username,
    jiraBaseUrl,
  });

  // If a release name is in the URL and it's different, sync it in.
  useEffect(() => {
    if (nameFromUrl && nameFromUrl !== selectedRelease) {
      setSelectedRelease(nameFromUrl);
    }
    // intentionally not depending on selectedRelease to avoid a loop —
    // user-driven changes via the picker should win after the first sync
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nameFromUrl]);

  const hasResults = kpis.length > 0;

  return (
    <div className="ds-scope">
      <div className="ds-page">
        <div className="ds-page__inner">
          <PageHeader
            team={team}
            versions={versions}
            selectedRelease={selectedRelease}
            onChangeRelease={setSelectedRelease}
            onRefresh={refresh}
            refreshing={loadingResults}
            disabled={!ready}
          />

          <MetaStrip
            team={team}
            kpiCount={kpis.length}
            loading={loading}
            selectedRelease={selectedRelease}
          />

          {error && <div className="rb-error">{error}</div>}
          {!ready && (
            <div className="rb-empty">
              Pick a team in the header to load the release brief.
            </div>
          )}

          {ready && (
            <LandingForecastPanel
              forecast={forecast?.forecast}
              loading={loadingForecast}
              jiraBaseUrl={jiraBaseUrl}
            />
          )}

          {ready && (
            <ReleaseGatesPanel
              gateTimeline={gateTimeline}
              selectedRelease={selectedRelease}
              loading={loadingGates}
            />
          )}

          {ready && (
            <PayloadSynopsisPanel
              synopsis={synopsis}
              loading={loadingSynopsis}
              jiraBaseUrl={jiraBaseUrl}
            />
          )}

          {ready && (
            <OutstandingPanel
              outstanding={outstanding}
              loading={loadingOutstanding}
              jiraBaseUrl={jiraBaseUrl}
            />
          )}

          {ready && (
            <ProjectBreakdownMatrix
              projectBreakdown={projectBreakdown}
              selectedRelease={selectedRelease}
              loading={loadingProjectBreakdown}
            />
          )}

          {ready && (
            <SprintVelocityPanel
              velocity={velocity}
              loading={loadingVelocity}
              jiraBaseUrl={jiraBaseUrl}
            />
          )}

          {ready && (
            <SectionPanel
              title="Release KPIs"
              caption={
                selectedRelease
                  ? `Live counts for ${selectedRelease}, scoped to ${team?.name || selectedTeamId}.`
                  : 'No release selected.'
              }
              actions={
                selectedRelease && (
                  <Pill tone="muted">scope · {selectedRelease}</Pill>
                )
              }
            >
              {!hasResults && !loading && (
                <div className="rb-empty">
                  No KPIs configured for this team yet — add some on the
                  KPIs page and they'll appear here scoped to the release.
                </div>
              )}
              <KpiGrid
                kpis={kpis}
                results={results}
                loading={loadingResults}
                jiraBaseUrl={jiraBaseUrl}
              />
            </SectionPanel>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageHeader({
  team,
  versions,
  selectedRelease,
  onChangeRelease,
  onRefresh,
  refreshing,
  disabled,
}) {
  return (
    <div className="rb-header">
      <div>
        <div style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.08em', color: '#888', textTransform: 'uppercase', marginBottom: '0.25rem' }}>
          Portfolio Delivery Ops · Release Brief
        </div>
        <div className="rb-header__title">
          {selectedRelease || 'Release Brief'}
        </div>
      </div>
      <div className="rb-header__controls">
        <select
          className="rb-release-select"
          value={selectedRelease || ''}
          onChange={(e) => onChangeRelease(e.target.value)}
          disabled={disabled || versions.length === 0}
        >
          {versions.map((v) => (
            <option key={v.name} value={v.name}>
              {v.name}
            </option>
          ))}
        </select>
        <button
          className="rb-refresh-btn"
          onClick={onRefresh}
          disabled={disabled || refreshing}
        >
          {refreshing ? '↻ Refreshing…' : '↻ Refresh'}
        </button>
      </div>
    </div>
  );
}

function MetaStrip({ team, kpiCount, loading, selectedRelease }) {
  return (
    <div className="rb-meta">
      {team && (
        <>
          <MutedLabel>Team: {team.name}</MutedLabel>
          <span className="rb-meta__divider">·</span>
        </>
      )}
      {selectedRelease && (
        <>
          <MutedLabel>Release: {selectedRelease}</MutedLabel>
          <span className="rb-meta__divider">·</span>
        </>
      )}
      <MutedLabel>
        {loading
          ? 'Loading…'
          : kpiCount > 0
          ? `${kpiCount} KPI${kpiCount !== 1 ? 's' : ''} configured`
          : 'No KPIs configured'}
      </MutedLabel>
    </div>
  );
}

function KpiGrid({ kpis, results, loading, jiraBaseUrl }) {
  if (loading && kpis.length === 0) {
    return (
      <div className="ds-grid-kpis">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rb-skeleton" />
        ))}
      </div>
    );
  }
  if (kpis.length === 0) return null;
  return (
    <div className="ds-grid-kpis">
      {kpis.map((kpi, idx) => (
        <KpiTile
          key={kpi.id || kpi.key || idx}
          kpi={kpi}
          result={results[kpi.id || kpi.key]}
          jiraBaseUrl={jiraBaseUrl}
        />
      ))}
    </div>
  );
}

function KpiTile({ kpi, result, jiraBaseUrl }) {
  if (!result) {
    return (
      <KPICard
        label={kpi.name}
        value="—"
        caption="Not yet loaded"
        rag="grey"
      />
    );
  }
  if (result.error) {
    return (
      <KPICard
        label={kpi.name}
        value="!"
        caption={result.error}
        rag="red"
      />
    );
  }
  const count = typeof result.total === 'number' ? result.total : null;
  const href = result.combinedJql
    ? jiraSearchUrl(jiraBaseUrl, result.combinedJql)
    : undefined;
  return (
    <KPICard
      label={kpi.name}
      value={count != null ? count.toLocaleString() : '—'}
      unit={count === 1 ? 'issue' : 'issues'}
      caption="Click to verify in JIRA"
      href={href}
      title={result.combinedJql || undefined}
      rag={count === 0 ? 'grey' : count > 50 ? 'amber' : 'green'}
    />
  );
}

function LandingForecastPanel({ forecast, loading }) {
  if (!forecast && !loading) return null;

  // LandingForecastResult field names (from landingForecastService.ts)
  const verdict = forecast?.verdict;
  const ragMap = {
    on_time: 'green',
    slipping: 'amber',
    at_risk: 'red',
    shipped: 'grey',
    not_started: 'grey',
    unknown: 'grey',
  };
  const rag = ragMap[verdict] || 'grey';
  const verdictLabel = {
    on_time: 'On Time',
    slipping: 'Slipping',
    at_risk: 'At Risk',
    shipped: 'Shipped',
    not_started: 'Not Started',
    unknown: 'Unknown',
  }[verdict] || '—';

  const confidence = forecast?.confidence;       // 'high' | 'medium' | 'low'
  const oneLiner = forecast?.oneLiner || '';
  const plannedGaDate = forecast?.plannedGaDate || null;
  const forecastGaDate = forecast?.forecastGaDate || null;
  const gapWeeks = typeof forecast?.gapWeeks === 'number' ? forecast.gapWeeks : null;

  return (
    <SectionPanel
      title="Landing Forecast"
      caption={forecast ? `${oneLiner || `Confidence: ${confidence || '—'}`}` : 'Loading…'}
      actions={
        verdict && verdict !== 'unknown' ? (
          <Pill tone={rag === 'green' ? 'success' : rag === 'red' ? 'danger' : 'muted'}>
            {verdictLabel}
          </Pill>
        ) : null
      }
    >
      {loading && !forecast && (
        <div className="ds-grid-kpis">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rb-skeleton" />
          ))}
        </div>
      )}
      {forecast && (
        <div className="ds-grid-kpis">
          {plannedGaDate && (
            <KPICard
              label="Planned GA"
              value={plannedGaDate}
              caption="RM-committed date from gate config"
              rag="grey"
            />
          )}
          {forecastGaDate && (
            <KPICard
              label="Forecast Landing"
              value={forecastGaDate}
              caption={confidence ? `${confidence} confidence` : 'forecast date'}
              rag={rag}
            />
          )}
          {gapWeeks !== null && (
            <KPICard
              label="Gap"
              value={`${gapWeeks > 0 ? '+' : ''}${gapWeeks}w`}
              caption="vs planned GA (weeks)"
              rag={gapWeeks <= 0 ? 'green' : gapWeeks <= 3 ? 'amber' : 'red'}
            />
          )}
          {typeof forecast.unresolved === 'number' && (
            <KPICard
              label="Unresolved"
              value={forecast.unresolved.toLocaleString()}
              caption={`At current velocity (${forecast.recentVelocity ?? '—'} tix/sprint)`}
              rag={forecast.unresolved === 0 ? 'green' : 'amber'}
            />
          )}
          {typeof forecast.pendingVerification === 'number' && (
            <KPICard
              label="Pending Verification"
              value={forecast.pendingVerification.toLocaleString()}
              caption="Bug & Improvement in Resolved status"
              rag={forecast.pendingVerification === 0 ? 'green' : 'amber'}
            />
          )}
        </div>
      )}
    </SectionPanel>
  );
}

function ReleaseGatesPanel({ gateTimeline, selectedRelease, loading }) {
  const gates = gateTimeline?.gates || [];
  const hasGates = gates.length > 0;

  return (
    <SectionPanel
      title="Release Gates Timeline"
      caption={
        selectedRelease
          ? `EC → CC → CG → PG → GA for ${selectedRelease}`
          : 'Loading…'
      }
      actions={
        selectedRelease ? (
          <Pill tone="muted">{selectedRelease}</Pill>
        ) : null
      }
    >
      {loading && !hasGates && (
        <div className="rb-skeleton" style={{ height: '100px' }} />
      )}
      {!loading && !hasGates && (
        <div className="rb-empty">
          No gate dates configured for {selectedRelease}. Add them via Release Config.
        </div>
      )}
      {hasGates && (
        <div className="rb-gantt-wrap" style={{ padding: '1rem 0' }}>
          <GateTimeline gates={gates} />
        </div>
      )}
    </SectionPanel>
  );
}

function PayloadSynopsisPanel({ synopsis, loading, jiraBaseUrl }) {
  const total = synopsis?.total;
  const totalCount = typeof total?.count === 'number' ? total.count : null;
  const rawSum =
    typeof synopsis?.rawComponentSum === 'number'
      ? synopsis.rawComponentSum
      : null;
  const dedupSavings =
    totalCount != null && rawSum != null && rawSum > 0
      ? Math.max(0, rawSum - totalCount)
      : 0;

  const totalHref =
    total?.jql && jiraBaseUrl ? jiraSearchUrl(jiraBaseUrl, total.jql) : undefined;

  return (
    <SectionPanel
      title="Engineering Payload"
      caption={
        synopsis
          ? `5-bucket composition per D36. Deduped total vs raw bucket sum makes the overlap legible.`
          : 'Loading composition…'
      }
      actions={
        totalCount != null ? (
          <Pill tone={dedupSavings > 0 ? 'accent' : 'muted'}>
            {dedupSavings > 0
              ? `${dedupSavings.toLocaleString()} overlap removed by dedup`
              : 'no overlap'}
          </Pill>
        ) : null
      }
    >
      {loading && !synopsis && (
        <div className="ds-grid-kpis">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rb-skeleton" />
          ))}
        </div>
      )}
      {synopsis && (
        <div className="ds-grid-kpis">
          {(synopsis.components || []).map((c) => (
            <KPICard
              key={c.key}
              label={c.label}
              value={c.count != null ? c.count.toLocaleString() : '!'}
              caption={c.error ? `Error: ${c.error}` : 'bucket count · may overlap'}
              href={c.jql ? jiraSearchUrl(jiraBaseUrl, c.jql) : undefined}
              title={c.error || c.jql}
              rag={c.error ? 'red' : 'grey'}
            />
          ))}
          {(synopsis.sidecars || []).map((c) => (
            <KPICard
              key={c.key}
              label={c.label}
              value={c.count != null ? c.count.toLocaleString() : '!'}
              caption={c.error ? `Error: ${c.error}` : 'sidecar · outside payload'}
              href={c.jql ? jiraSearchUrl(jiraBaseUrl, c.jql) : undefined}
              title={c.error || c.jql}
              rag={c.error ? 'red' : 'amber'}
            />
          ))}
          {total && (
            <KPICard
              label={total.label || 'Engineering Payload'}
              value={totalCount != null ? totalCount.toLocaleString() : '!'}
              caption="Deduped union of all buckets"
              href={totalHref}
              title={total.jql}
              rag={total.error ? 'red' : 'green'}
            />
          )}
        </div>
      )}
    </SectionPanel>
  );
}

function OutstandingPanel({ outstanding, loading, jiraBaseUrl }) {
  const tiles = outstanding?.tiles || [];
  const labelPrefix = outstanding?.labelPrefix || null;
  const release = outstanding?.release || null;
  const projectKey = outstanding?.projectKey || null;

  const totalOpen = tiles.find((t) => t.key === 'open_in_release');
  const totalClosed = tiles.find((t) => t.key === 'closed_in_release');
  const completion =
    typeof totalOpen?.count === 'number' && typeof totalClosed?.count === 'number'
      ? (() => {
          const sum = totalOpen.count + totalClosed.count;
          if (sum <= 0) return null;
          return Math.round((totalClosed.count / sum) * 100);
        })()
      : null;

  return (
    <SectionPanel
      title="Outstanding & Deferred"
      caption={
        release
          ? `What's still open in ${release} plus what's been pushed out. Tiles wrap the engineering payload where it makes sense; deferred-by-label and pushed-out tiles are scoped to ${projectKey} only.`
          : 'Loading…'
      }
      actions={
        <span style={{ display: 'inline-flex', gap: 'var(--ds-space-2)' }}>
          {labelPrefix && release && (
            <Pill tone="muted">
              label: {labelPrefix}-{release.toLowerCase().replace(`${labelPrefix.toLowerCase()}-`, '')}-deferred
            </Pill>
          )}
          {completion != null && <Pill tone="accent">{completion}% closed</Pill>}
        </span>
      }
    >
      {loading && tiles.length === 0 && (
        <div className="ds-grid-kpis">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="rb-skeleton" />
          ))}
        </div>
      )}
      {!loading && tiles.length === 0 && (
        <div className="rb-empty">No outstanding data available.</div>
      )}
      {tiles.length > 0 && (
        <div className="ds-grid-kpis">
          {tiles.map((t) => (
            <OutstandingTile key={t.key} tile={t} jiraBaseUrl={jiraBaseUrl} />
          ))}
        </div>
      )}
    </SectionPanel>
  );
}

function OutstandingTile({ tile, jiraBaseUrl }) {
  if (!tile) return null;
  const url = jiraSearchUrl(jiraBaseUrl, tile.jql);
  const value =
    tile.count == null
      ? (tile.error ? '!' : '—')
      : tile.count.toLocaleString();
  const rag = tile.wrapped ? 'green' : 'amber';
  const caption = tile.wrapped
    ? tile.caption
    : `${tile.caption} · scope: project only`;
  return (
    <KPICard
      label={tile.label}
      value={value}
      caption={caption}
      href={url || undefined}
      rag={rag}
      title={tile.error ? `Search error: ${tile.error}` : tile.jql}
    />
  );
}

function SprintVelocityPanel({ velocity, loading, jiraBaseUrl }) {
  const sprints = velocity?.sprints || [];
  const current = sprints[sprints.length - 1] || null;
  const previous = sprints[sprints.length - 2] || null;

  const delta = (curr, prev) => {
    if (curr == null || prev == null || prev === 0) return null;
    return curr - prev;
  };

  const trendOf = (d) => {
    if (d == null) return undefined;
    return d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
  };

  const formatDelta = (d, suffix = '') => {
    if (d == null) return undefined;
    const sign = d > 0 ? '+' : '';
    return `${sign}${d}${suffix} vs prev`;
  };

  return (
    <SectionPanel
      title="Sprint Velocity"
      caption={
        current
          ? `Whole-team velocity (not scoped to any release). ${current.sprintLabel} (current) · ${current.window.startIso} → ${current.window.endIso}. Scoped to project ${current.projectKey}. Three streams per sprint-velocity-types.mdc.`
          : 'Loading current sprint velocity…'
      }
      actions={
        <span style={{ display: 'inline-flex', gap: 'var(--ds-space-2)' }}>
          <Pill tone="muted">
            {current?.projectKey ? `project: ${current.projectKey}` : 'all releases'}
          </Pill>
          {sprints.length > 0 && (
            <Pill tone="muted">
              {sprints.length} sprint{sprints.length > 1 ? 's' : ''} loaded
            </Pill>
          )}
        </span>
      }
    >
      {loading && !current && (
        <div className="ds-grid-kpis">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rb-skeleton" />
          ))}
        </div>
      )}
      {!loading && !current && (
        <div className="rb-empty">No sprint data available.</div>
      )}
      {current && (
        <div className="ds-grid-kpis">
          <VelocityTile
            label="Dev Velocity"
            stream={current.dev}
            prev={previous?.dev}
            unit="issues"
            jiraBaseUrl={jiraBaseUrl}
            delta={delta(current.dev.count, previous?.dev.count)}
            formatDelta={(d) => formatDelta(d)}
            trendOf={trendOf}
            caption="Whole team · non-portfolio, non-Test issues resolved this sprint"
          />
          <VelocityTile
            label="QA Verification"
            stream={current.qaVerification}
            prev={previous?.qaVerification}
            unit="tickets"
            jiraBaseUrl={jiraBaseUrl}
            delta={delta(current.qaVerification.count, previous?.qaVerification.count)}
            formatDelta={(d) => formatDelta(d)}
            trendOf={trendOf}
            caption={`Whole team · Bug/Improvement → Closed · adjusted ${current.qaVerification.adjustedCount} (1:3 ratio)`}
          />
          <VelocityTile
            label="QA Test Tasks"
            stream={current.qaTestTasks}
            prev={previous?.qaTestTasks}
            unit="tests"
            jiraBaseUrl={jiraBaseUrl}
            delta={delta(current.qaTestTasks.count, previous?.qaTestTasks.count)}
            formatDelta={(d) => formatDelta(d)}
            trendOf={trendOf}
            caption="Whole team · Test-typed issues resolved this sprint"
          />
        </div>
      )}
    </SectionPanel>
  );
}

function VelocityTile({
  label,
  stream,
  unit,
  jiraBaseUrl,
  delta,
  formatDelta,
  trendOf,
  caption,
}) {
  if (!stream) return null;
  if (stream.error) {
    return (
      <KPICard
        label={label}
        value="!"
        caption={stream.error}
        rag="red"
      />
    );
  }
  const count = stream.count;
  const href = stream.jql ? jiraSearchUrl(jiraBaseUrl, stream.jql) : undefined;
  const trend = trendOf(delta);
  const deltaLabel = formatDelta(delta);
  return (
    <KPICard
      label={label}
      value={count != null ? count.toLocaleString() : '—'}
      unit={unit}
      delta={deltaLabel}
      deltaTrend={trend}
      caption={caption}
      href={href}
      title={stream.jql}
      rag={count === 0 ? 'grey' : 'green'}
    />
  );
}
