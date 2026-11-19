import React, { useState, useCallback } from 'react';
import { useTeam } from '../../contexts/TeamContext';
import useTpmPulse from '../../hooks/useTpmPulse';
import useTpmStage from '../../hooks/useTpmStage';
import { formatDate } from '../../shared/utils/dateFormatter';
import { getApiBase, getAuthHeaders } from '../../shared/services/apiService';
import './TpmPulsePage.css';

function getJiraBase() {
  return process.env.REACT_APP_JIRA_BASE_URL || 'https://jira.nutanix.com';
}
function jiraUrl(jql) {
  return `${getJiraBase()}/issues/?jql=${encodeURIComponent(jql)}`;
}

const STAGE_LABELS = { execution: 'Execution', release: 'At release', postRelease: 'Post-release', overall: 'Overall' };
const STAGE_TONE = { execution: 'var(--accent)', release: 'var(--warning)', postRelease: 'var(--success)', overall: 'var(--muted)' };

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

function StageBadge({ stage, nextGate }) {
  if (!stage) return null;
  return (
    <span className="ds-badge" style={{ background: 'var(--surface)', border: `1px solid ${STAGE_TONE[stage] || 'var(--border)'}`, color: STAGE_TONE[stage] || 'var(--text)' }}>
      {STAGE_LABELS[stage] || stage}
      {nextGate ? ` · next: ${nextGate.label} ${nextGate.date}` : ''}
    </span>
  );
}

function ReportPreviewModal({ open, onClose, teamId, releaseVersion, onSent }) {
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [testMode, setTestMode] = useState(true);
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const apiBase = getApiBase();
      const { headers } = getAuthHeaders();
      const res = await fetch(`${apiBase}/api/tpm/reports/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ teamId, releaseVersion, today: new Date().toISOString().slice(0, 10) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Preview ${res.status}`);
      setPreview(data);
    } catch (e) {
      setError(e.message || 'Failed to load preview');
    } finally {
      setLoading(false);
    }
  }, [teamId, releaseVersion]);

  React.useEffect(() => {
    if (open) fetchPreview();
    else { setPreview(null); setError(''); setToast(''); }
  }, [open, fetchPreview]);

  const handleSend = async () => {
    setSending(true);
    setError('');
    setToast('');
    try {
      const apiBase = getApiBase();
      const { headers } = getAuthHeaders();
      const res = await fetch(`${apiBase}/api/tpm/reports/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ teamId, releaseVersion, testMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Send ${res.status}`);
      setToast(`Sent to ${data.to ? data.to.join(', ') : 'recipients'}`);
      if (onSent) onSent(data);
    } catch (e) {
      setError(e.message || 'Send failed');
    } finally {
      setSending(false);
    }
  };

  if (!open) return null;
  return (
    <div className="ds-modal-overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="ds-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="ds-modal__header">
          <h3 className="ds-modal__title">Send report — {releaseVersion}</h3>
          <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="ds-modal__body">
          {loading && <div className="ds-skeleton ds-skeleton--card" />}
          {error && <div className="page-error" role="alert">{error}</div>}
          {toast && <div className="ds-toast ds-toast--success" role="status">{toast}</div>}
          {preview && (
            <>
              <div className="ds-muted-label" style={{ marginBottom: 'var(--space-3)' }}>
                Stage: <strong style={{ color: STAGE_TONE[preview.stage] }}>{STAGE_LABELS[preview.stage] || preview.stage}</strong> · {preview.reason}
                {preview.nextGate ? ` · Next gate: ${preview.nextGate.label} (${preview.nextGate.date})` : ''}
                <span style={{ marginLeft: 'var(--space-2)' }}>· {preview.fetchedAt ? new Date(preview.fetchedAt).toLocaleString() : ''}</span>
              </div>
              <div className="stat-row" style={{ marginBottom: 'var(--space-4)' }}>
                {preview.kpiBreakdown && preview.kpiBreakdown.map((k) => (
                  <div key={k.id} className="stat-card" style={{ minWidth: 160 }}>
                    <div className="stat-card__label">{k.name}</div>
                    <div className="stat-card__value">{k.count ?? '—'}</div>
                    <div className="stat-card__caption ds-muted-label" style={{ fontSize: 'var(--fs-muted)' }}>{k.lifecyclePhase}</div>
                    <a className="tpm-pulse__jql-link" href={jiraUrl(k.jql)} target="_blank" rel="noreferrer" title={k.jql}>JQL ↗</a>
                    <div className="tpm-pulse__provenance">Cited: {k.jql ? k.jql.slice(0, 120) : ''} · at {k.citedAt ? new Date(k.citedAt).toLocaleString() : ''}</div>
                    {k.error && <div className="ds-muted-label" style={{ color: 'var(--danger)' }}>{k.error}</div>}
                  </div>
                ))}
              </div>
              {preview.total != null && <div className="ds-muted-label">Total: {preview.total} open (sum of stage KPIs)</div>}
              <label className="ds-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginTop: 'var(--space-4)' }}>
                <input type="checkbox" checked={testMode} onChange={(e) => setTestMode(e.target.checked)} />
                <span>Test report (send only to me)</span>
              </label>
              <p className="ds-muted-label" style={{ fontSize: 'var(--fs-muted)', marginTop: 'var(--space-1)' }}>
                {testMode ? 'To: you only (CC empty) — safe for verification (D26).' : 'To/CC per release config — requires TPM/PortfolioMgr/RM role.'}
              </p>
            </>
          )}
        </div>
        <div className="ds-modal__footer">
          <button type="button" className="ds-btn ds-btn--secondary" onClick={onClose}>Close</button>
          <button type="button" className="ds-btn ds-btn--primary" onClick={handleSend} disabled={sending || loading}>
            {sending ? 'Sending…' : testMode ? 'Send test to me' : 'Send report'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TpmPulsePage() {
  const { selectedTeamId } = useTeam();
  const { releases, activeRelease, setActiveRelease, phases, gates, loading, error, fetchedAt, refresh } = useTpmPulse(selectedTeamId);
  const { stage, nextGate } = useTpmStage(selectedTeamId, activeRelease);
  const [showModal, setShowModal] = useState(false);

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
          {activeRelease && <button type="button" className="ds-btn ds-btn--primary ds-btn--sm" onClick={() => setShowModal(true)}>Send Report</button>}
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
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
              <StageBadge stage={stage} nextGate={nextGate} />
              <span className="ds-muted-label">{fetchedAt ? new Date(fetchedAt).toLocaleString() : ''}</span>
            </span>
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

      <ReportPreviewModal open={showModal} onClose={() => setShowModal(false)} teamId={selectedTeamId} releaseVersion={activeRelease} />
    </div>
  );
}
