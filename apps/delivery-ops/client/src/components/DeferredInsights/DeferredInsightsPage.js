import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, ComposedChart, Line } from 'recharts';
import { useTeam } from '../../contexts/TeamContext';
import { TeamRequiredGate } from '../../layout/components/TeamRequiredGate';
import { PageLoading } from '../../shared/components/PageLoading';
import { useDeferredInsights } from '../../hooks/useDeferredInsights';
import { jiraHref, ticketHref } from '../Oncalls/OncallsParts';
import './DeferredInsights.css';

function HeroCard({ label, count, meta, explain, jql, jiraBase, onOpen }) {
  const jiraUrl = jiraHref(jiraBase, jql);
  const showJira = Boolean(jiraUrl);
  const clickable = Boolean(onOpen);
  return (
    <div className="di-hero">
      <div className="di-hero-label">{label}</div>
      {clickable ? (
        <button type="button" className="di-hero-value di-hero-open" onClick={onOpen} aria-label={`Show ${label}: ${count}`}>{String(count)}</button>
      ) : (
        <div className="di-hero-value">{String(count)}</div>
      )}
      {meta ? <div className="di-hero-meta">{meta}</div> : null}
      {explain ? <div className="di-hero-explain">{explain}</div> : null}
      {showJira ? <a className="di-jira-link" href={jiraUrl} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a> : null}
    </div>
  );
}

function FilterBar({ releases, selectedReleases, setSelectedReleases, priority, setPriority, component, setComponent, onClear }) {
  const allPriorities = ['Blocker - P0', 'Critical - P1', 'Major - P2', 'Minor - P3'];
  const allSelected = selectedReleases.length === releases.length;
  const toggleRelease = (r) => {
    setSelectedReleases((prev) => {
      if (prev.includes(r)) {
        const next = prev.filter((x) => x !== r);
        return next.length ? next : prev;
      }
      return [...prev, r].sort();
    });
  };
  return (
    <div className="di-filter-bar">
      <div className="di-filter-group di-filter-group-releases">
        <span className="di-filter-label">Releases</span>
        <div className="di-chip-row" role="group" aria-label="Release filter">
          <button
            type="button"
            className={`di-filter-chip ${allSelected ? 'active' : ''}`}
            onClick={() => setSelectedReleases([...releases])}
            aria-pressed={allSelected}
          >
            All ({releases.length})
          </button>
          {releases.map((r) => {
            const active = selectedReleases.includes(r);
            return (
              <button key={r} type="button" className={`di-filter-chip ${active ? 'active' : ''}`} onClick={() => toggleRelease(r)} aria-pressed={active}>{r}</button>
            );
          })}
        </div>
      </div>
      <div className="di-filter-group">
        <label className="di-filter-label" htmlFor="di-priority">Priority</label>
        <select id="di-priority" className="di-select" value={priority || ''} onChange={(e) => setPriority(e.target.value || null)}>
          <option value="">All priorities</option>
          {allPriorities.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <div className="di-filter-group">
        <label className="di-filter-label" htmlFor="di-component">Component</label>
        <input id="di-component" className="di-input" placeholder="Filter by component" value={component || ''} onChange={(e) => setComponent(e.target.value || null)} />
      </div>
      {(priority || component || !allSelected) && (
        <button type="button" className="di-btn di-btn-ghost" onClick={onClear}>Clear filters</button>
      )}
    </div>
  );
}

function DeferredLineChart({ data, onPointClick }) {
  const chartData = useMemo(() => {
    if (!data || !data.releases) return [];
    return data.releases.map((r) => ({
      name: r.release,
      deferred: r.total,
      fixed: r.fixed,
      pending: r.pending,
      fixRate: r.fixRate,
    }));
  }, [data]);

  if (!chartData.length) return <div className="di-empty-chart">No release data to chart.</div>;

  const handleChartClick = (payload) => {
    const label = payload?.activeLabel || payload?.activePayload?.[0]?.payload?.name;
    if (label && onPointClick) onPointClick(label);
  };

  return (
    <div className="di-chart-wrap">
      <h3 className="di-chart-title">Deferred trend — oldest → newest</h3>
      <p className="di-chart-sub">Total deferred per release. Click a point or label to jump to that release.</p>
      <ResponsiveContainer width="100%" height={300}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }} onClick={handleChartClick}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #e5e7eb)" />
          <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-18} dy={10} height={48} />
          <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload || !payload.length) return null;
              const row = payload[0]?.payload;
              return (
                <div className="di-tooltip">
                  <div className="di-tooltip-title">{label}</div>
                  <div>Deferred: <strong>{row.deferred}</strong></div>
                  <div>Fixed elsewhere: <strong>{row.fixed}</strong></div>
                  <div>Still pending: <strong>{row.pending}</strong></div>
                  <div>Fix rate: <strong>{row.fixRate}%</strong></div>
                </div>
              );
            }}
          />
          <Legend />
          <Area type="monotone" dataKey="fixed" name="Fixed elsewhere" stackId="a" stroke="var(--success, #16a34a)" fill="var(--success-soft, #bbf7d0)" fillOpacity={0.5} />
          <Area type="monotone" dataKey="pending" name="Still pending" stackId="a" stroke="var(--warning, #d97706)" fill="var(--warning-soft, #fde68a)" fillOpacity={0.5} />
          <Line type="monotone" dataKey="deferred" name="Total deferred" stroke="var(--accent, #2563eb)" strokeWidth={2.5} dot={{ r: 4, fill: 'var(--accent, #2563eb)', strokeWidth: 1, stroke: '#fff' }} activeDot={{ r: 6 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function ReleaseCard({ entry, jiraBase, onDrill, expandedRelease, setExpandedRelease }) {
  const isExpanded = expandedRelease === entry.release;
  const hasError = Boolean(entry.error);
  const rows = entry.sample || [];
  const byFixVersion = entry.breakdowns?.byFixVersion || {};
  const byPriority = entry.breakdowns?.byPriority || {};
  const byComponent = entry.breakdowns?.byComponent || {};

  return (
    <div className="di-release-card" id={`di-release-${entry.release}`}>
      <div className="di-release-head">
        <span className="di-release-title">
          <span className="di-release-name">{entry.release}</span>
          <span className="di-release-badge">{entry.deferredLabel}</span>
        </span>
        <span className="di-release-counts">
          <button type="button" className="di-count di-count-total" title={entry.jql} onClick={() => onDrill(entry.release, entry.jql, entry.total)} aria-label={`View ${entry.total} deferred tickets for ${entry.release}`}>{entry.total} deferred</button>
          <button type="button" className="di-count di-count-fixed" onClick={() => onDrill(entry.release, entry.jql, entry.total)} aria-label={`View fixed breakdown for ${entry.release}`}>{entry.fixed} fixed</button>
          <button type="button" className="di-count di-count-pending" onClick={() => onDrill(entry.release, entry.jql, entry.total)} aria-label={`View pending for ${entry.release}`}>{entry.pending} pending</button>
          <span className={`di-count di-count-rate ${entry.fixRate >= 70 ? 'good' : entry.fixRate >= 40 ? 'mid' : 'low'}`} aria-label={`${entry.fixRate} percent fixed`}>{entry.fixRate}% fixed</span>
        </span>
        <button type="button" className="di-expand-btn" onClick={() => setExpandedRelease(isExpanded ? null : entry.release)} aria-expanded={isExpanded} aria-controls={`di-release-table-${entry.release}`} aria-label={isExpanded ? `Collapse ${entry.release}` : `Expand ${entry.release}`}>
          <span className="di-expand-icon" aria-hidden="true">{isExpanded ? '▴' : '▾'}</span>
        </button>
      </div>

      {hasError && <p className="di-error">Failed to load {entry.release}: {entry.error}</p>}

      <div className="di-release-meta">
        <span className="di-meta-item">Label: <code>{entry.deferredLabel}</code></span>
        {entry.jql && <a className="di-jira-link" href={jiraHref(jiraBase, entry.jql)} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a>}
        <button type="button" className="di-btn di-btn-sm" onClick={() => onDrill(entry.release, entry.jql, entry.total)}>View tickets ({entry.total})</button>
      </div>

      <div className="di-mini-breakdowns">
        {Object.keys(byFixVersion).length > 0 && (
          <div className="di-mini-block">
            <div className="di-mini-title">Where they landed</div>
            <div className="di-mini-chips">
              {Object.entries(byFixVersion).slice(0, 6).map(([fv, cnt]) => (
                <span key={fv} className="di-chip" title={`${fv}: ${cnt}`}>{fv} <strong>{cnt}</strong></span>
              ))}
              {Object.keys(byFixVersion).length > 6 && <span className="di-chip di-chip-more">+{Object.keys(byFixVersion).length - 6} more</span>}
            </div>
          </div>
        )}
        {Object.keys(byPriority).length > 0 && (
          <div className="di-mini-block">
            <div className="di-mini-title">By priority</div>
            <div className="di-mini-chips">
              {Object.entries(byPriority).map(([pri, cnt]) => (
                <span key={pri} className="di-chip di-chip-pri" title={`${pri}: ${cnt}`}>{pri} <strong>{cnt}</strong></span>
              ))}
            </div>
          </div>
        )}
        {Object.keys(byComponent).length > 0 && (
          <div className="di-mini-block">
            <div className="di-mini-title">By component</div>
            <div className="di-mini-chips">
              {Object.entries(byComponent).slice(0, 6).map(([comp, cnt]) => (
                <span key={comp} className="di-chip" title={`${comp}: ${cnt}`}>{comp} <strong>{cnt}</strong></span>
              ))}
              {Object.keys(byComponent).length > 6 && <span className="di-chip di-chip-more">+{Object.keys(byComponent).length - 6} more</span>}
            </div>
          </div>
        )}
      </div>

      {isExpanded && (
        <div className="di-release-table-wrap" id={`di-release-table-${entry.release}`}>
          {rows.length === 0 ? (
            <p className="di-muted">No sample tickets (count is {entry.total} but fetch returned 0 — may be a JIRA permission or page limit).</p>
          ) : (
            <>
              <table className="di-table" aria-label={`Sample deferred tickets for ${entry.release}`}>
                <caption className="sr-only">Sample deferred tickets for {entry.release}</caption>
                <thead>
                  <tr>
                    <th scope="col">Key</th>
                    <th scope="col">Summary</th>
                    <th scope="col">Status</th>
                    <th scope="col">Priority</th>
                    <th scope="col">Now in</th>
                    <th scope="col">Component</th>
                    <th scope="col">Assignee</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 100).map((r) => (
                    <tr key={r.key} className={r.done ? 'di-row-done' : ''}>
                      <td><a href={ticketHref(jiraBase, r.key)} target="_blank" rel="noopener noreferrer">{r.key}</a></td>
                      <td className="di-cell-summary" title={r.summary}>{r.summary || '—'}</td>
                      <td><span className={`di-pill ${r.done ? 'di-pill-done' : 'di-pill-open'}`}>{r.status || '—'}</span></td>
                      <td>{r.priority || '—'}</td>
                      <td>{r.fixVersionLabel || '—'}</td>
                      <td>{r.component || '—'}</td>
                      <td>{r.assignee || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {entry.sampleTruncated && <p className="di-muted">Showing {rows.length} of {entry.total} — open in JIRA for the full list.</p>}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DrillDrawer({ open, release, jql, total, tickets, jiraBase, onClose }) {
  const closeRef = useRef(null);
  const isOpen = Boolean(open);
  const closeCb = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    if (!isOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') closeCb(); };
    document.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', onKey); };
  }, [isOpen, closeCb]);
  if (!isOpen) return null;
  const jiraUrl = jiraHref(jiraBase, jql);
  const rows = Array.isArray(tickets) ? tickets : [];
  return (
    <div className="di-drawer" role="dialog" aria-modal="true" aria-label={`Deferred: ${release}`} onClick={(e) => { if (e.target === e.currentTarget) closeCb(); }}>
      <div className="di-drawer-panel">
        <div className="di-drawer-head">
          <div>
            <h3>Deferred from {release} · {total} tickets</h3>
            <p className="di-mono">Deferred label · click count in-page, Open in JIRA for exact JQL</p>
          </div>
          <button type="button" className="di-btn" ref={closeRef} onClick={closeCb} aria-label="Close drill">Close ✕</button>
        </div>
        <p className="di-mono di-drawer-jql">
          {jiraUrl ? <a href={jiraUrl} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a> : 'No JQL'}
          {jql ? <span className="di-mono-jql">{jql}</span> : null}
        </p>
        {rows.length === 0 ? <p className="di-muted">No tickets in this view.</p> : (
          <div className="di-table-wrap">
            <table className="di-table">
              <thead><tr><th>Key</th><th>Summary</th><th>Status</th><th>Priority</th><th>Now in</th><th>Component</th><th>Assignee</th></tr></thead>
              <tbody>
                {rows.slice(0, 100).map((r) => (
                  <tr key={r.key} className={r.done ? 'di-row-done' : ''}>
                    <td><a href={ticketHref(jiraBase, r.key)} target="_blank" rel="noopener noreferrer">{r.key}</a></td>
                    <td className="di-cell-summary">{r.summary || '—'}</td>
                    <td><span className={`di-pill ${r.done ? 'di-pill-done' : 'di-pill-open'}`}>{r.status || '—'}</span></td>
                    <td>{r.priority || '—'}</td>
                    <td>{r.fixVersionLabel || '—'}</td>
                    <td>{r.component || '—'}</td>
                    <td>{r.assignee || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DeferredInsightsPage() {
  const { selectedTeamId, hasTeamSelected } = useTeam();
  const [selectedReleases, setSelectedReleases] = useState([]);
  const [priority, setPriority] = useState(null);
  const [component, setComponent] = useState(null);
  const [expandedRelease, setExpandedRelease] = useState(null);
  const [drill, setDrill] = useState(null);

  const { data, loading, refreshing, error, refresh } = useDeferredInsights(selectedTeamId, {
    priority: priority || undefined,
    component: component || undefined,
  });

  const allReleases = useMemo(() => (data?.releases || []).map((r) => r.release), [data]);

  // Track whether we've seeded selectedReleases from discovered releases — avoid double-fetch loop
  const seededRef = useRef(false);
  useEffect(() => {
    if (!seededRef.current && allReleases.length) {
      seededRef.current = true;
      setSelectedReleases([...allReleases]);
    }
    if (seededRef.current && allReleases.length && selectedReleases.length === 0) {
      setSelectedReleases([...allReleases]);
    }
  }, [allReleases, selectedReleases.length]);

  const filteredReleases = useMemo(() => {
    if (!data?.releases) return [];
    if (!selectedReleases.length || selectedReleases.length === allReleases.length) return data.releases;
    const set = new Set(selectedReleases);
    return data.releases.filter((r) => set.has(r.release));
  }, [data, selectedReleases, allReleases]);

  const chartData = useMemo(() => {
    if (!filteredReleases.length) return null;
    return { releases: filteredReleases };
  }, [filteredReleases]);

  const handlePointClick = useCallback((releaseName) => {
    if (!releaseName) return;
    const el = document.getElementById(`di-release-${releaseName}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setExpandedRelease(releaseName);
  }, []);

  const openDrill = useCallback((release, jql, total) => {
    const entry = (data?.releases || []).find((r) => r.release === release);
    setDrill({ release, jql, total, tickets: entry?.sample || [] });
  }, [data]);

  const openHeroDrill = useCallback((kind) => {
    if (!data?.hero) return;
    const h = data.hero;
    if (kind === 'total') openDrill('All releases', h.jql, h.totalDeferred);
    else if (kind === 'fixed') openDrill('Fixed elsewhere', h.fixedJql, h.totalFixed);
    else if (kind === 'pending') openDrill('Still pending', h.pendingJql, h.totalPending);
  }, [data, openDrill]);

  const handleCloseDrill = useCallback(() => setDrill(null), []);

  const handleClearFilters = useCallback(() => {
    setPriority(null);
    setComponent(null);
    if (allReleases.length) setSelectedReleases([...allReleases]);
  }, [allReleases]);

  const jiraBase = data?.jiraBaseUrl || 'https://jira.nutanix.com';
  const hero = data?.hero || {};

  if (!hasTeamSelected) {
    return <TeamRequiredGate title="Select a team for Deferred Insights" description="Deferred Insights follows the selected team's releases and label prefix. Pick a team in the sidebar." />;
  }

  return (
    <div className="deferred-insights-page">
      <header className="di-header">
        <div>
          <h1>Deferred Insights</h1>
          <p className="di-subtitle">Per release: how many bugs got deferred, where they landed, what is still pending.</p>
          {data?.asOf && <p className="di-asof">As of {new Date(data.asOf).toLocaleString()} · team {data.teamId}</p>}
        </div>
        <div className="di-header-actions">
          <button type="button" className="di-btn di-btn-primary" onClick={refresh} disabled={loading || refreshing}>{refreshing ? 'Pulling…' : 'Pull from JIRA'}</button>
        </div>
      </header>

      {error && <div className="di-error-banner">{error}</div>}
      {data?.emptyReason && <div className="di-empty-banner">{data.emptyReason}</div>}

      {loading && !data && <PageLoading message="Loading Deferred Insights…" />}

      {data && (
        <>
          <FilterBar
            releases={allReleases}
            selectedReleases={selectedReleases}
            setSelectedReleases={setSelectedReleases}
            priority={priority}
            setPriority={setPriority}
            component={component}
            setComponent={setComponent}
            onClear={handleClearFilters}
          />

          <div className="di-card">
            <DeferredLineChart data={chartData} onPointClick={handlePointClick} />
          </div>

          <div className="di-heroes">
            <HeroCard label="Total deferred" count={hero.totalDeferred ?? 0} meta={`${hero.releaseCount ?? 0} releases`} explain="Bugs with deferred label across all selected releases" jql={hero.jql} jiraBase={jiraBase} onOpen={hero.totalDeferred ? () => openHeroDrill('total') : null} />
            <HeroCard label="Fixed elsewhere" count={hero.totalFixed ?? 0} meta={`${hero.fixRate ?? 0}% fix rate`} explain="Deferred bugs that are now Closed/Resolved" jql={hero.fixedJql} jiraBase={jiraBase} onOpen={hero.totalFixed ? () => openHeroDrill('fixed') : null} />
            <HeroCard label="Still pending" count={hero.totalPending ?? 0} meta={`${hero.totalDeferred ? Math.round((hero.totalPending / hero.totalDeferred) * 100) : 0}% of total`} explain="Deferred bugs still open" jql={hero.pendingJql} jiraBase={jiraBase} onOpen={hero.totalPending ? () => openHeroDrill('pending') : null} />
            <HeroCard label="Fix rate" count={`${hero.fixRate ?? 0}%`} meta={hero.totalDeferred ? `${hero.totalFixed} of ${hero.totalDeferred}` : '—'} explain="Fixed / total deferred" jql={null} jiraBase={jiraBase} />
            <HeroCard label="Releases" count={hero.releaseCount ?? 0} meta={allReleases.join(', ') || '—'} explain="Releases in scope (oldest → newest)" jql={null} jiraBase={jiraBase} />
          </div>

          <div className="di-section">
            <h2 className="di-section-title">By release</h2>
            <p className="di-section-sub">Oldest → newest. Expand a release to see tickets and where they landed.</p>
            <div className="di-release-list">
              {filteredReleases.length === 0 ? (
                <p className="di-muted">No releases in scope. Adjust filters.</p>
              ) : (
                filteredReleases.map((entry) => (
                  <ReleaseCard
                    key={entry.release}
                    entry={entry}
                    jiraBase={jiraBase}
                    onDrill={openDrill}
                    expandedRelease={expandedRelease}
                    setExpandedRelease={setExpandedRelease}
                  />
                ))
              )}
            </div>
          </div>

          <DrillDrawer open={Boolean(drill)} release={drill?.release} jql={drill?.jql} total={drill?.total} tickets={drill?.tickets} jiraBase={jiraBase} onClose={handleCloseDrill} />
        </>
      )}
    </div>
  );
}
