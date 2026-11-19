import React from 'react';
import { useTeam } from '../../contexts/TeamContext';
import useTpmPulse from '../../hooks/useTpmPulse';
import { formatDate } from '../../shared/utils/dateFormatter';
import './TpmPulsePage.css';

function getJiraBase() {
  return process.env.REACT_APP_JIRA_BASE_URL || 'https://jira.nutanix.com';
}
function jiraUrl(jql) {
  return `${getJiraBase()}/issues/?jql=${encodeURIComponent(jql)}`;
}

function GateStrip({ gates }) {
  if (!gates || !Object.keys(gates).length) return null;
  const entries = Object.entries(gates).filter(([, v]) => v && v.date);
  if (!entries.length) return <p className="ds-muted-label">No gates configured</p>;
  return (
    <div className="ds-gate-strip">
      {entries.map(([key, g]) => (
        <span key={key} className="ds-gate-chip" style={{ '--ds-gate-color': g.color || 'var(--accent)' }}>
          <span className="ds-gate-chip__tick" />
          <span className="ds-gate-chip__kind">{key}</span>
          <span className="ds-gate-chip__label">{g.label || key}</span>
          <span className="ds-gate-chip__date">{formatDate(g.date) || g.date}</span>
        </span>
      ))}
    </div>
  );
}

export default function TpmPulsePage() {
  const { selectedTeamId } = useTeam();
  const { releases, activeRelease, setActiveRelease, phases, gates, loading, error, fetchedAt, refresh } = useTpmPulse(selectedTeamId);

  if (loading && !phases.length) {
    return (
      <div className="tpm-pulse">
        <div className="page-header">
          <h1 className="page-header__title">Release health</h1>
          <p className="page-header__subtitle">Loading TPM pulse…</p>
        </div>
        <div className="ds-skeleton ds-skeleton--card" />
      </div>
    );
  }

  const activeGates = (activeRelease && gates[activeRelease]) || {};

  return (
    <div className="tpm-pulse">
      <div className="page-header">
        <div className="page-header__titles">
          <h1 className="page-header__title">Release health — 4 lifecycle cards</h1>
          <p className="page-header__subtitle">TPM Pulse · {releases.length} active release{releases.length !== 1 ? 's' : ''} · team {selectedTeamId || '—'}</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="ds-btn ds-btn--secondary ds-btn--sm" onClick={refresh}>Refresh</button>
        </div>
      </div>

      {error && <div className="page-error" role="alert">{error}</div>}

      <div className="tpm-pulse__tabs" role="tablist">
        {releases.map((r) => (
          <button key={r} type="button" role="tab" aria-selected={r === activeRelease} className={`ds-pill ${r === activeRelease ? 'ds-pill--accent' : 'ds-pill--muted'}`} onClick={() => setActiveRelease(r)}>
            {r}
          </button>
        ))}
      </div>

      {activeRelease && (
        <div className="ds-section">
          <div className="ds-section__header">
            <h2 className="ds-section__title">{activeRelease} — gates</h2>
            <span className="ds-muted-label">{fetchedAt ? new Date(fetchedAt).toLocaleString() : ''}</span>
          </div>
          <div className="ds-section__body">
            <GateStrip gates={activeGates} />
          </div>
        </div>
      )}

      <div className="stat-row tpm-pulse__cards">
        {phases.map((ph) => (
          <div key={ph.phase} className="stat-card">
            <div className="stat-card__label">{ph.label}</div>
            <button type="button" className="stat-card__value tpm-pulse__drill-btn" onClick={() => ph.jql && window.open(jiraUrl(ph.jql), '_blank')} aria-label={`Drill ${ph.label} ${ph.total} open`} title="In-app drill — opens filtered view">
              {ph.total ?? '—'}
            </button>
            <div className="stat-card__caption">open · {ph.kpis.length} KPI{ph.kpis.length !== 1 ? 's' : ''}</div>
            {ph.fetchedAt && <div className="tpm-pulse__provenance">at {new Date(ph.fetchedAt).toLocaleString()} {ph.kpis[0]?.jql ? <a href={jiraUrl(ph.kpis[0].jql)} target="_blank" rel="noreferrer" className="ds-muted-label">· Open in Jira ↗</a> : null}</div>}
            {ph.kpis.length > 0 && (
              <ul className="tpm-pulse__kpi-list">
                {ph.kpis.map((k) => (
                  <li key={k.id} className="tpm-pulse__kpi-item">
                    <span className="tpm-pulse__kpi-name">{k.name}</span>
                    <button type="button" className="ds-badge ds-badge--neutral tpm-pulse__drill-btn--badge" onClick={() => k.jql && window.open(jiraUrl(k.jql), '_blank')} title="Drill to KPI tickets">{k.count ?? '—'}</button>
                    <a className="tpm-pulse__jql-link" href={jiraUrl(k.jql)} target="_blank" rel="noreferrer" title={k.jql}>JQL</a>
                  </li>
                ))}
              </ul>
            )}
            {ph.jql && (
              <details className="tpm-pulse__jql-detail">
                <summary className="ds-muted-label">Cited JQL — Open in Jira is exact JQL, count drills in-app</summary>
                <code className="tpm-pulse__jql-code">{ph.jql.slice(0, 400)}</code>
                <a href={jiraUrl(ph.jql)} target="_blank" rel="noreferrer" className="ds-btn ds-btn--ghost ds-btn--sm">Open in Jira ↗ exact</a>
              </details>
            )}
          </div>
        ))}
      </div>

      {!phases.length && !loading && !releases.length && (
        <div className="ds-empty">
          <p className="ds-empty__title">No releases or KPIs for {selectedTeamId || 'this team'}</p>
          <p className="ds-empty__hint">This team has no KPIs configured. Add them at <a href="/kpis">KPIs → {selectedTeamId}</a> and ensure releaseGateDates covers its release prefix ({releases.length ? '' : 'e.g. AOS for cerebro-dr'}). Showing NDB example requires switching team to NDB.</p>
        </div>
      )}
      {!phases.length && !loading && releases.length > 0 && (
        <div className="ds-empty">
          <p className="ds-empty__title">No KPIs for {selectedTeamId}</p>
          <p className="ds-empty__hint">Add KPIs with lifecyclePhase in <a href="/kpis">KPIs</a> — {releases.length} release(s) found but no KPI cards.</p>
        </div>
      )}
    </div>
  );
}
