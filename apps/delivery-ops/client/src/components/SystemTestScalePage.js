import React, { useEffect, useMemo, useState } from 'react';
import { useSystemTestScale } from '../hooks/useSystemTestScale';
import { useTeam } from '../contexts/TeamContext';
import { TeamRequiredGate } from '../layout/components/TeamRequiredGate';
import { selectReleaseView } from '../utils/systemTestScaleView';
import SystemTestScaleTrends from './SystemTestScale/SystemTestScaleTrends';
import SystemTestScaleHeatmap from './SystemTestScale/SystemTestScaleHeatmap';
import './SystemTestScale/SystemTestScale.css';

function jiraHref(base, jql) {
  if (!jql) return null;
  return `${String(base || 'https://jira.nutanix.com').replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

function Num({ cell, jiraBaseUrl, className, suffix = '' }) {
  const count = cell?.count ?? cell ?? 0;
  const href = jiraHref(jiraBaseUrl, cell?.jql);
  if (!href) return <span className={className}>{count}{suffix}</span>;
  return (
    <a className={`sts-num ${className || ''}`} href={href} target="_blank" rel="noopener noreferrer">
      {count}{suffix}
    </a>
  );
}

function tone(v) {
  if (v == null) return '';
  if (v >= 40) return 'bad';
  if (v >= 15) return 'warn';
  return 'good';
}

function deltaClass(d) {
  if (d > 0) return 'sts-delta-up';
  if (d < 0) return 'sts-delta-down';
  return 'sts-delta-flat';
}

export default function SystemTestScalePage() {
  const {
    teams,
    selectedTeamId,
    selectedTeam,
    hasTeamSelected,
    changeTeam,
    isTransitioning,
  } = useTeam();

  const [currentRelease, setCurrentRelease] = useState('');
  const [compareRelease, setCompareRelease] = useState('');

  // Fetch once per team — Current/Compare applied client-side (instant).
  const { data, loading, refreshing, error, refresh } = useSystemTestScale(selectedTeamId);

  useEffect(() => {
    setCurrentRelease('');
    setCompareRelease('');
  }, [selectedTeamId]);

  useEffect(() => {
    if (!data) return;
    if (!currentRelease && data.currentRelease) setCurrentRelease(data.currentRelease);
    if (!compareRelease && data.compareRelease) setCompareRelease(data.compareRelease);
  }, [data, currentRelease, compareRelease]);

  const view = useMemo(
    () => selectReleaseView(data, currentRelease, compareRelease),
    [data, currentRelease, compareRelease]
  );

  const {
    current: curr,
    compare: prev,
    rag,
    carry,
    components: comps,
    activeCurrent,
    activeCompare,
  } = view;

  const jiraBaseUrl = data?.jiraBaseUrl || 'https://jira.nutanix.com';
  const releases = data?.releases?.length ? data.releases : [];
  const teamCode = data?.teamCode || selectedTeam?.releasePrefix?.replace(/-+$/, '') || (selectedTeam?.name || '').toUpperCase() || '—';
  const kpiFilter = data?.kpiFilter || (teamCode !== '—' ? `filter=${teamCode}-System-Test` : 'filter={teamCode}-System-Test');

  const heroes = useMemo(() => {
    if (!data) return [];
    return [
      { k: 'Open bugs', cell: curr.open, sub: <>of <Num cell={curr.total} jiraBaseUrl={jiraBaseUrl} /> total</>, cls: tone(curr.open?.count) },
      { k: 'Typed regressions', cell: curr.any, sub: <><Num cell={curr.b2b} jiraBaseUrl={jiraBaseUrl} /> B2B · <Num cell={curr.r2r} jiraBaseUrl={jiraBaseUrl} /> R2R</>, cls: tone(curr.any?.count) },
      { k: 'Regression rate', display: `${curr.rates?.regressionRate ?? 0}%`, cell: curr.any, sub: 'click → Yes* numerator', cls: tone(curr.rates?.regressionRate) },
      { k: 'Escape rate (R2R)', display: `${curr.rates?.escapeRate ?? 0}%`, cell: curr.r2r, sub: 'click → R2R numerator', cls: tone(curr.rates?.escapeRate) },
      { k: 'Longevity open', cell: curr.longevityOpen, sub: <><Num cell={curr.longevity} jiraBaseUrl={jiraBaseUrl} /> longevity total</>, cls: tone(curr.longevityOpen?.count) },
      { k: 'Aged ≥90d open', cell: curr.age90, sub: <><Num cell={curr.age30} jiraBaseUrl={jiraBaseUrl} /> ≥30d · <Num cell={curr.age60} jiraBaseUrl={jiraBaseUrl} /> ≥60d</>, cls: tone(curr.age90?.count) },
      { k: 'TBV (awaiting QA)', cell: curr.tbv, sub: 'status = Resolved', cls: tone(curr.tbv?.count) },
      { k: 'Deferred open', cell: curr.deferredOpen, sub: <><Num cell={curr.deferred} jiraBaseUrl={jiraBaseUrl} /> labeled deferred</>, cls: tone(curr.deferredOpen?.count) },
    ];
  }, [data, curr, jiraBaseUrl]);

  const deltaRows = useMemo(() => {
    if (!data) return [];
    return [
      { label: 'Total bugs', c: curr.total, p: prev.total },
      { label: 'Open', c: curr.open, p: prev.open },
      { label: 'Typed regressions', c: curr.any, p: prev.any },
      { label: 'B2B', c: curr.b2b, p: prev.b2b },
      { label: 'R2R', c: curr.r2r, p: prev.r2r },
      { label: 'Longevity open', c: curr.longevityOpen, p: prev.longevityOpen },
      { label: 'Aged ≥90d', c: curr.age90, p: prev.age90 },
      { label: 'TBV', c: curr.tbv, p: prev.tbv },
      { label: 'Reopened', c: curr.reopen, p: prev.reopen },
    ];
  }, [data, curr, prev]);

  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        title="Select a team for System-Test Scale"
        description="System-Test metrics are scoped by team filter: filter={teamCode}-System-Test."
      />
    );
  }

  return (
    <div className="sts-page">
      <div className="sts-header">
        <div>
          <h1>System-Test Scale</h1>
          <p>
            Team <strong>{selectedTeam?.name || selectedTeamId}</strong>
            {' · '}KPI <code>{kpiFilter}</code>
            {' · '}regression <code>cf[13260]</code>
            {' · '}audience: tpm
          </p>
        </div>
        <div className="sts-actions">
          <button type="button" className="sts-btn primary" onClick={refresh} disabled={loading || refreshing || isTransitioning}>
            {refreshing ? 'Pulling from JIRA…' : 'Pull from JIRA'}
          </button>
          <span className="sts-chip">
            {data?.generatedAt
              ? `as of ${String(data.generatedAt).replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC')}`
              : 'no snapshot'}
          </span>
        </div>
      </div>

      {error ? <div className="sts-error">{error}</div> : null}
      {loading && !data ? <p className="sts-muted">Loading System-Test counts from JIRA…</p> : null}

      {data ? (
        <>
          <section className="sts-section sts-section-filtered" aria-labelledby="sts-filtered-heading">
            <div className="sts-section-banner">
              <div>
                <h2 id="sts-filtered-heading">Filtered view</h2>
                <p>
                  Current / Compare update this band instantly (no submit).
                  Team change or Pull from JIRA reloads live counts.
                  KPI scope: <code>{kpiFilter}</code>
                </p>
              </div>
              <span className="sts-scope-badge filtered">Uses filters</span>
            </div>

            <div className="sts-controls">
              <label>
                Team
                <select
                  value={selectedTeamId || ''}
                  onChange={(e) => changeTeam(e.target.value)}
                  disabled={isTransitioning || loading || refreshing}
                >
                  {(teams || []).map((t) => (
                    <option key={t.id} value={t.id}>{t.name || t.id}</option>
                  ))}
                </select>
              </label>
              <label>
                Current release
                <select value={activeCurrent} onChange={(e) => setCurrentRelease(e.target.value)}>
                  {releases.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label>
                Compare to
                <select value={activeCompare} onChange={(e) => setCompareRelease(e.target.value)}>
                  {releases.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
            </div>

            <div className="sts-rag">
              <div className="sts-rag-card sts-card-filtered">
                <div className="sts-card-head">
                  <div className="lbl">Release health — {activeCurrent}</div>
                  <span className="sts-scope-badge filtered">Filtered</span>
                </div>
                <div className={`sts-pill ${rag?.level || 'yellow'}`}>{(rag?.level || '—').toUpperCase()}</div>
                <div className="sts-why">{rag?.why}</div>
                <div className="sts-legend">
                  <span><span className="sts-swatch" style={{ background: '#047857' }} />GREEN</span>
                  <span><span className="sts-swatch" style={{ background: '#b45309' }} />YELLOW</span>
                  <span><span className="sts-swatch" style={{ background: '#be123c' }} />RED</span>
                </div>
              </div>
              <div className="sts-stats">
                {heroes.map((h) => (
                  <div className="sts-stat sts-card-filtered" key={h.k}>
                    <div className="k">{h.k}</div>
                    <div className={`v ${h.cls}`}>
                      {h.display != null ? (
                        <a className="sts-num" href={jiraHref(jiraBaseUrl, h.cell?.jql)} target="_blank" rel="noopener noreferrer">{h.display}</a>
                      ) : (
                        <Num cell={h.cell} jiraBaseUrl={jiraBaseUrl} />
                      )}
                    </div>
                    <div className="s">{h.sub}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="sts-grid2">
              <div className="sts-card sts-card-filtered">
                <div className="sts-card-head">
                  <h3>Cross-release comparison</h3>
                  <span className="sts-scope-badge filtered">Filtered</span>
                </div>
                <p className="sts-hint">{activeCurrent} vs {activeCompare}</p>
                <table className="sts-table">
                  <thead>
                    <tr>
                      <th>Metric</th>
                      <th>{activeCurrent}</th>
                      <th>{activeCompare}</th>
                      <th>Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deltaRows.map((row) => {
                      const d = (row.c?.count || 0) - (row.p?.count || 0);
                      return (
                        <tr key={row.label}>
                          <td>{row.label}</td>
                          <td className="num"><Num cell={row.c} jiraBaseUrl={jiraBaseUrl} /></td>
                          <td className="num"><Num cell={row.p} jiraBaseUrl={jiraBaseUrl} /></td>
                          <td className={`num ${deltaClass(d)}`}>{d > 0 ? `+${d}` : d}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="sts-legend">
                  <span><span className="sts-swatch" style={{ background: '#be123c' }} />Δ up</span>
                  <span><span className="sts-swatch" style={{ background: '#047857' }} />Δ down</span>
                  <span><span className="sts-swatch" style={{ background: '#94a3b8' }} />unchanged</span>
                </div>
              </div>

              <div className="sts-card sts-card-filtered">
                <div className="sts-card-head">
                  <h3>Carry-over / known issues</h3>
                  <span className="sts-scope-badge filtered">Filtered</span>
                </div>
                <p className="sts-hint">Scoped to Current (+ Compare for carry pair)</p>
                <table className="sts-table">
                  <tbody>
                    <tr>
                      <td>Deferred open (current)</td>
                      <td className="num"><Num cell={curr.deferredOpen} jiraBaseUrl={jiraBaseUrl} /></td>
                    </tr>
                    <tr>
                      <td>Deferred labeled</td>
                      <td className="num"><Num cell={curr.deferred} jiraBaseUrl={jiraBaseUrl} /></td>
                    </tr>
                    <tr>
                      <td>Carry {(activeCompare || '').replace(/^[A-Z]+-/, '')}→{(activeCurrent || '').replace(/^[A-Z]+-/, '')}</td>
                      <td className="num"><Num cell={carry} jiraBaseUrl={jiraBaseUrl} /></td>
                    </tr>
                    <tr>
                      <td>Open typed regressions</td>
                      <td className="num"><Num cell={curr.anyOpen} jiraBaseUrl={jiraBaseUrl} /></td>
                    </tr>
                    <tr>
                      <td>Regression? unset</td>
                      <td className="num"><Num cell={curr.empty} jiraBaseUrl={jiraBaseUrl} /></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="sts-card sts-card-filtered">
              <div className="sts-card-head">
                <h3>Component map — {activeCurrent}</h3>
                <span className="sts-scope-badge filtered">Filtered</span>
              </div>
              <p className="sts-hint">Current release only · open · Yes* · open R2R</p>
              {comps.length === 0 ? (
                <p className="sts-muted">No component rows for this release (components are loaded for configured component releases only).</p>
              ) : (
                <div className="sts-comp-map">
                  {comps.map((c) => {
                    const openN = c.open?.count || 0;
                    const anyN = c.any?.count || 0;
                    const r2rN = c.r2rOpen?.count || 0;
                    let cls = '';
                    if (openN >= 3 || anyN >= 1) cls = 'warm';
                    if (r2rN > 0 || openN >= 4) cls = 'hot';
                    return (
                      <div className={`sts-comp ${cls}`} key={c.name}>
                        <div className="n">{c.name}</div>
                        <div className="m">
                          <Num cell={c.open} jiraBaseUrl={jiraBaseUrl} /> open ·{' '}
                          <Num cell={c.any} jiraBaseUrl={jiraBaseUrl} /> Yes* ·{' '}
                          <Num cell={c.r2rOpen} jiraBaseUrl={jiraBaseUrl} /> R2R∩open
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="sts-legend">
                <span><span className="sts-swatch" style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }} />Cool</span>
                <span><span className="sts-swatch" style={{ background: '#fcd34d' }} />Warm</span>
                <span><span className="sts-swatch" style={{ background: '#fda4af' }} />Hot</span>
              </div>
            </div>
          </section>

          <section className="sts-section sts-section-all" aria-labelledby="sts-all-heading">
            <div className="sts-section-banner all">
              <div>
                <h2 id="sts-all-heading">All-release view</h2>
                <p>
                  Heatmap and trends always show every release for this team.
                  Changing Current only moves the highlight — the bars/cells do not filter down.
                </p>
              </div>
              <span className="sts-scope-badge all">Ignores release filters</span>
            </div>

            <SystemTestScaleHeatmap
              byRelease={data.byRelease}
              releaseOrder={releases}
              currentRelease={activeCurrent}
              jiraBaseUrl={jiraBaseUrl}
            />

            <SystemTestScaleTrends
              trends={data.trends}
              jiraBaseUrl={jiraBaseUrl}
              currentRelease={activeCurrent}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}
