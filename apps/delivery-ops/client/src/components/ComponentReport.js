/**
 * Component Report Page
 *
 * Director-focused component health dashboard.
 * Layout: Filters → Health Card → Section A (Current) → Section B (Other) → Section C (Cleanup)
 * Widgets per section: 1=P0 Blockers | 2=P1 Criticals | 3=Other Priority | 4=Projects | 5=KPI | 6=Deferrals
 * Data is fetched ONCE per component. Release filter is applied client-side.
 */

import React, { useState, useEffect } from 'react';
import { authenticatedGet, getApiBase } from '../utils/api';
import { useTeam } from '../contexts/TeamContext';
import './ComponentReport.css';

const API_BASE = getApiBase();
const JIRA_BASE = 'https://jira.nutanix.com';

// ── Client-side release classifier ─────────────────────────────────────────
// Returns true if any fixVersion on this issue is in the selectedReleases set
const isInSelected = (fixVersionsStr, selectedReleases) => {
  if (!fixVersionsStr || !selectedReleases || selectedReleases.size === 0) return false;
  return fixVersionsStr.split(',').some(v => selectedReleases.has(v.trim()));
};

// Returns true if this issue's fixVersions include "NDB-*" or "master"
const isCurrent = (fixVersionsStr) => {
  if (!fixVersionsStr) return false;
  return fixVersionsStr.split(',').some(v => {
    const trimmed = v.trim();
    return /^NDB-\d+\.\d+/.test(trimmed) || trimmed.toLowerCase() === 'master';
  });
};

// ── Priority helpers ────────────────────────────────────────────────────────
const CHIP = {
  'Blocker - P0': { label: 'P0', cls: 'chip-p0' },
  'Critical - P1': { label: 'P1', cls: 'chip-p1' },
  'Major - P2':    { label: 'P2', cls: 'chip-p2' },
  'Minor - P3':    { label: 'P3', cls: 'chip-p3' },
  'Trivial - P4':  { label: 'P4', cls: 'chip-p4' },
};

const PriorityChip = ({ priority }) => {
  const c = CHIP[priority] || { label: priority || '—', cls: 'chip-other' };
  return <span className={`cr-priority-chip ${c.cls}`}>{c.label}</span>;
};

const AgeBadge = ({ age }) => {
  const cls = age >= 60 ? 'age-critical' : age >= 30 ? 'age-warn' : 'age-ok';
  return <span className={`cr-age-badge ${cls}`}>{age}d</span>;
};

const HealthDot = ({ health }) => (
  <span className={`cr-health-dot health-${health}`}>
    {health === 'red' ? '🔴' : health === 'yellow' ? '🟡' : '🟢'}
  </span>
);

const JiraLink = ({ jiraKey }) => (
  <a
    href={`${JIRA_BASE}/browse/${jiraKey}`}
    target="_blank"
    rel="noopener noreferrer"
    className="cr-jira-link"
  >
    {jiraKey}
  </a>
);

// ── Issue table (shared by W1/W2/W3 sub-widgets) ────────────────────────────
const IssueTable = ({ issues }) => {
  if (!issues || issues.length === 0) {
    return <p className="cr-empty-inline">None</p>;
  }
  return (
    <div className="cr-table-scroll">
      <table className="cr-issue-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Summary</th>
            <th>Type</th>
            <th>Priority</th>
            <th>Assignee</th>
            <th>Age</th>
            <th>Status</th>
            <th>Fix Version</th>
          </tr>
        </thead>
        <tbody>
          {issues.map(i => (
            <tr key={i.key} className={i.priorityOrder === 0 ? 'row-p0' : i.priorityOrder === 1 ? 'row-p1' : ''}>
              <td><JiraLink jiraKey={i.key} /></td>
              <td className="cr-summary-cell" title={i.summary}>{i.summary}</td>
              <td><span className="cr-type-badge">{i.issuetype}</span></td>
              <td><PriorityChip priority={i.priority} /></td>
              <td className="cr-assignee-cell">{i.assignee}</td>
              <td><AgeBadge age={i.age} /></td>
              <td><span className="cr-status-badge">{i.status}</span></td>
              <td className="cr-fixver-cell">{i.fixVersions || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ── Widget 1 / 2 / 3 — Priority widget with type sub-widgets ───────────────
const PriorityWidget = ({ title, widgetClass, issues }) => {
  const [activeType, setActiveType] = useState('Bug');

  const TYPES = ['Bug', 'Improvement', 'Test', 'Other'];
  const countByType = {};
  TYPES.forEach(t => {
    countByType[t] = issues.filter(i => {
      if (t === 'Other') return !['Bug', 'Improvement', 'Test'].includes(i.issuetype);
      return i.issuetype === t;
    }).length;
  });

  const filtered = issues.filter(i => {
    if (activeType === 'Other') return !['Bug', 'Improvement', 'Test'].includes(i.issuetype);
    return i.issuetype === activeType;
  });

  return (
    <div className={`cr-widget-inner ${widgetClass}`}>
      <div className="cr-type-pills">
        {TYPES.map(t => (
          <button
            key={t}
            className={`cr-type-pill${activeType === t ? ' active' : ''}${countByType[t] === 0 ? ' empty' : ''}`}
            onClick={() => setActiveType(t)}
          >
            {t}
            <span className="cr-type-count">{countByType[t]}</span>
          </button>
        ))}
      </div>
      <IssueTable issues={filtered} />
    </div>
  );
};

// ── Widget 4 — Project Level Info ───────────────────────────────────────────
const WORK_TYPE_COLS = ['Bug', 'Improvement', 'Task', 'Test', 'Other'];

const ProjectBreakdownRow = ({ project }) => {
  const [expanded, setExpanded] = useState(false);
  const { counts, topBugAssignees } = project.breakdown || { counts: {}, topBugAssignees: [] };

  return (
    <>
      <tr
        className={`cr-proj-row${expanded ? ' expanded' : ''}`}
        onClick={() => setExpanded(e => !e)}
      >
        <td><JiraLink jiraKey={project.key} /></td>
        <td className="cr-summary-cell" title={project.summary}>{project.summary}</td>
        <td><span className="cr-type-badge">{project.issuetype}</span></td>
        <td><span className="cr-status-badge">{project.status}</span></td>
        <td><HealthDot health={project.health} /></td>
        {WORK_TYPE_COLS.map(t => {
          const c = counts[t] || { outstanding: 0, done: 0, p0: 0, p1: 0 };
          return (
            <td key={t} className="cr-count-cell">
              {c.outstanding > 0 ? (
                <span>
                  <strong>{c.outstanding}</strong>
                  {(c.p0 > 0 || c.p1 > 0) && (
                    <span className="cr-prio-sub">
                      {c.p0 > 0 && <span className="cr-p0-sub">P0:{c.p0}</span>}
                      {c.p1 > 0 && <span className="cr-p1-sub">P1:{c.p1}</span>}
                    </span>
                  )}
                </span>
              ) : <span className="cr-zero">—</span>}
            </td>
          );
        })}
        <td className="cr-done-cell">
          {WORK_TYPE_COLS.reduce((s, t) => s + (counts[t]?.done || 0), 0)}
        </td>
        <td className="cr-expand-btn">{expanded ? '▲' : '▼'}</td>
      </tr>
      {expanded && (
        <tr className="cr-expand-row">
          <td colSpan={WORK_TYPE_COLS.length + 6}>
            <div className="cr-expand-content">
              {topBugAssignees && topBugAssignees.length > 0 && (
                <div className="cr-assignee-breakdown">
                  <strong>Top bug owners:</strong>{' '}
                  {topBugAssignees.map(a => (
                    <span key={a.name} className="cr-assignee-tag">
                      {a.name}: {a.count}
                    </span>
                  ))}
                </div>
              )}
              <div className="cr-type-breakdown">
                {WORK_TYPE_COLS.map(t => {
                  const c = counts[t] || { outstanding: 0, done: 0 };
                  if (c.outstanding + c.done === 0) return null;
                  return (
                    <span key={t} className="cr-type-summary">
                      {t}: <strong>{c.outstanding}</strong> outstanding / {c.done} done
                    </span>
                  );
                })}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
};

const ProjectsWidget = ({ title, features, epics, directTickets }) => {
  const hasData = features.length > 0 || epics.length > 0 || directTickets.length > 0;

  const ProjectTable = ({ rows, label }) => {
    if (!rows || rows.length === 0) return null;
    return (
      <div className="cr-proj-section">
        <h4 className="cr-proj-section-heading">{label} ({rows.length})</h4>
        <div className="cr-table-scroll">
          <table className="cr-proj-table">
            <thead>
              <tr>
                <th>Key</th>
                <th>Summary</th>
                <th>Type</th>
                <th>Status</th>
                <th>Health</th>
                {WORK_TYPE_COLS.map(t => <th key={t}>{t}s ↑</th>)}
                <th>Done ✓</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(p => <ProjectBreakdownRow key={p.key} project={p} />)}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  const DirectTable = ({ rows }) => {
    if (!rows || rows.length === 0) return null;
    return (
      <div className="cr-proj-section">
        <h4 className="cr-proj-section-heading">Direct Tickets — No Epic ({rows.length})</h4>
        <div className="cr-table-scroll">
          <table className="cr-issue-table">
            <thead>
              <tr>
                <th>Key</th><th>Summary</th><th>Type</th><th>Priority</th>
                <th>Assignee</th><th>Age</th><th>Status</th><th>Fix Version</th>
              </tr>
            </thead>
            <tbody>
              {rows.sort((a, b) => a.priorityOrder - b.priorityOrder).map(i => (
                <tr key={i.key}>
                  <td><JiraLink jiraKey={i.key} /></td>
                  <td className="cr-summary-cell" title={i.summary}>{i.summary}</td>
                  <td><span className="cr-type-badge">{i.issuetype}</span></td>
                  <td><PriorityChip priority={i.priority} /></td>
                  <td>{i.assignee}</td>
                  <td><AgeBadge age={i.age} /></td>
                  <td><span className="cr-status-badge">{i.status}</span></td>
                  <td className="cr-fixver-cell">{i.fixVersions || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="cr-widget-inner cr-widget-projects">
      {!hasData && <p className="cr-empty-inline">No projects found for this filter.</p>}
      <ProjectTable rows={features} label="Features / Initiatives" />
      <ProjectTable rows={epics} label="Standalone Epics" />
      <DirectTable rows={directTickets} />
    </div>
  );
};

// ── Widget 5 (KPI) placeholder ──────────────────────────────────────────────
const KpiWidget = () => (
  <p className="cr-placeholder-text">
    Will show: counts from active KPI filters for this component.
    KPI hits will be flagged in the action items panel above.
  </p>
);

// ── Widget 6 (Deferrals) placeholder ───────────────────────────────────────
const DeferralsWidget = () => (
  <p className="cr-placeholder-text">
    Will show: tickets kicked across releases (fixVersion changelog),
    chronic deferrals (3+ kicks), trend per release, KPI-blocking deferrals.
  </p>
);

// ── Cleanup section (standalone accordion, no data yet) ─────────────────────
const CleanupSection = () => {
  const [open, setOpen] = useState(false);
  return (
    <section className={`cr-section cr-section-accordion${open ? ' cr-section-accordion--open' : ''}`}>
      <button className="cr-section-header cr-section-toggle" onClick={() => setOpen(o => !o)}>
        <h2 className="cr-section-title">Stale Projects — Cleanup</h2>
        <span className="cr-section-badge cr-badge-soon">Coming soon</span>
        <span className="cr-section-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="cr-section-body">
          <p className="cr-placeholder-text">
            Will show: closed/cancelled projects with open children, unassigned P0s,
            chronic deferrals (3+ kicks), fixVersion anomalies.
          </p>
        </div>
      )}
    </section>
  );
};

// ── Accordion widget wrapper ─────────────────────────────────────────────────
const AccordionWidget = ({ title, badge, badgeClass, children, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`cr-widget cr-accordion${open ? ' cr-accordion--open' : ''}`}>
      <button className="cr-accordion-header" onClick={() => setOpen(o => !o)}>
        <span className="cr-widget-title">{title}</span>
        {badge != null && (
          <span className={`cr-widget-count ${badgeClass || ''}`}>{badge}</span>
        )}
        <span className="cr-accordion-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && <div className="cr-accordion-body">{children}</div>}
    </div>
  );
};

// ── Section (Selected or Other) ─────────────────────────────────────────────
// isSelectedSection=true  → show issues IN selectedReleases
// isSelectedSection=false → show issues NOT IN selectedReleases
const ReportSection = ({ title, badge, outstanding, projectBreakdown, isSelectedSection, selectedReleases, defaultOpen = true }) => {
  const [open, setOpen] = useState(defaultOpen);

  const filterFn = isSelectedSection
    ? i => isInSelected(i.fixVersions, selectedReleases)
    : i => !isInSelected(i.fixVersions, selectedReleases);

  const filtered = outstanding.filter(filterFn);
  const p0 = filtered.filter(i => i.priorityOrder === 0);
  const p1 = filtered.filter(i => i.priorityOrder === 1);
  const other = filtered.filter(i => i.priorityOrder >= 2);

  const filterProject = (rows) =>
    rows.filter(p => isSelectedSection
      ? isInSelected(p.fixVersions, selectedReleases)
      : !isInSelected(p.fixVersions, selectedReleases)
    );

  const features = filterProject(projectBreakdown?.features || []);
  const epics = filterProject(projectBreakdown?.epics || []);
  const directTickets = filterProject(projectBreakdown?.directTickets || []);

  const isEmpty = filtered.length === 0 && features.length === 0 && epics.length === 0;

  return (
    <section className={`cr-section cr-section-accordion${open ? ' cr-section-accordion--open' : ''}`}>
      <button className="cr-section-header cr-section-toggle" onClick={() => setOpen(o => !o)}>
        <h2 className="cr-section-title">{title}</h2>
        <span className="cr-section-badge">{badge}</span>
        <span className="cr-section-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        isEmpty ? (
          <div className="cr-section-empty">No data for this filter.</div>
        ) : (
          <div className="cr-section-body">
            <AccordionWidget
              title="P0 Blockers"
              badge={`${p0.length} issues`}
              badgeClass={p0.length > 0 ? 'cr-badge-p0' : ''}
              defaultOpen={p0.length > 0}
            >
              <PriorityWidget issues={p0} widgetClass="cr-widget-p0" />
            </AccordionWidget>

            <AccordionWidget
              title="P1 Criticals"
              badge={`${p1.length} issues`}
              badgeClass={p1.length > 0 ? 'cr-badge-p1' : ''}
              defaultOpen={p1.length > 0}
            >
              <PriorityWidget issues={p1} widgetClass="cr-widget-p1" />
            </AccordionWidget>

            <AccordionWidget
              title="Other Priority (P2+)"
              badge={`${other.length} issues`}
              defaultOpen={false}
            >
              <PriorityWidget issues={other} widgetClass="cr-widget-other" />
            </AccordionWidget>

            <AccordionWidget
              title="Project Level Info"
              badge={`${features.length + epics.length} projects · ${directTickets.length} direct`}
              defaultOpen={true}
            >
              <ProjectsWidget
                features={features}
                epics={epics}
                directTickets={directTickets}
              />
            </AccordionWidget>

            {isSelectedSection && (
              <>
                <AccordionWidget title="KPI Counts" badge="coming soon" defaultOpen={false}>
                  <KpiWidget />
                </AccordionWidget>
                <AccordionWidget title="Deferral Behaviour" badge="coming soon" defaultOpen={false}>
                  <DeferralsWidget />
                </AccordionWidget>
              </>
            )}
          </div>
        )
      )}
    </section>
  );
};

// ── Main component ──────────────────────────────────────────────────────────
export const ComponentReport = () => {
  const { selectedTeamId } = useTeam();

  const [componentList, setComponentList] = useState([]);
  const [componentListLoading, setComponentListLoading] = useState(false);
  const [componentListError, setComponentListError] = useState(null);
  const [selectedComponent, setSelectedComponent] = useState(null);

  // availableReleases: list returned by /data after fetch
  // selectedReleases: set of release names the user has checked (multi-select)
  const [availableReleases, setAvailableReleases] = useState([]);
  const [selectedReleases, setSelectedReleases] = useState(new Set());

  const [healthData, setHealthData] = useState(null);
  const [actionItems, setActionItems] = useState([]);
  const [tabData, setTabData] = useState(null);
  const [tabDataLoading, setTabDataLoading] = useState(false);
  const [tabDataError, setTabDataError] = useState(null);

  // ── Fetch component list ──────────────────────────────────────────────────
  const fetchComponents = async (forceRefresh = false) => {
    setComponentListLoading(true);
    setComponentListError(null);
    try {
      const url = forceRefresh
        ? `${API_BASE}/api/component/list?refresh=true`
        : `${API_BASE}/api/component/list`;
      const res = await authenticatedGet(url);
      const list = res.data?.components || [];
      setComponentList(list);
      if (list.length > 0 && !selectedComponent) {
        setSelectedComponent(list[0].name);
      }
    } catch (err) {
      setComponentListError(err.message);
    } finally {
      setComponentListLoading(false);
    }
  };

  // No auto-fetch on mount — user must explicitly click "Fetch Components"

  // ── Fetch data ONCE per component. releaseFilter applied client-side. ────
  // ── Fetch report data — only runs when user clicks "Fetch" ───────────────
  const fetchReportData = () => {
    if (!selectedComponent) return;
    setTabDataLoading(true);
    setTabDataError(null);
    setTabData(null);
    setHealthData(null);
    setActionItems([]);

    Promise.all([
      authenticatedGet(`${API_BASE}/api/component/health?component=${encodeURIComponent(selectedComponent)}`),
      authenticatedGet(`${API_BASE}/api/component/data?component=${encodeURIComponent(selectedComponent)}`),
    ])
      .then(([healthRes, dataRes]) => {
        setHealthData(healthRes.data?.health || null);
        setActionItems(healthRes.data?.actions || []);
        setTabData(dataRes.data || null);

        // Populate release multi-select; default = NDB-* versions + master
        const releases = dataRes.data?.availableReleases || [];
        setAvailableReleases(releases);
        const defaultSelected = new Set(
          releases.filter(r => /^NDB-\d+\.\d+/.test(r) || r.toLowerCase() === 'master')
        );
        setSelectedReleases(defaultSelected);
      })
      .catch(err => setTabDataError(err.message))
      .finally(() => setTabDataLoading(false));
  };

  const toggleRelease = (name) => {
    setSelectedReleases(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const outstanding = tabData?.outstanding || [];
  const projectBreakdown = tabData?.projectBreakdown || { features: [], epics: [], directTickets: [] };

  return (
    <div className="component-report">

      {/* ── Filter bar ───────────────────────────────────────────────────── */}
      <div className="cr-filter-bar">
        <div className="cr-filter-group">
          <label className="cr-filter-label">Component</label>

          {/* Step 1: no list yet — show Fetch button */}
          {componentList.length === 0 && !componentListLoading && (
            <button
              className="cr-btn-fetch"
              onClick={() => fetchComponents(false)}
              disabled={componentListLoading}
            >
              {componentListError ? `⚠ Error — retry` : 'Fetch Components'}
            </button>
          )}

          {/* Loading state */}
          {componentListLoading && (
            <span className="cr-loading-badge">⏳ Fetching components…</span>
          )}

          {/* List loaded — show dropdown + refresh */}
          {componentList.length > 0 && (
            <>
              <select
                className="cr-select"
                value={selectedComponent || ''}
                onChange={e => setSelectedComponent(e.target.value)}
              >
                <option value="">Select component…</option>
                {componentList.map(c => (
                  <option key={c.id} value={c.name}>{c.name}</option>
                ))}
              </select>
              <button className="cr-btn-refresh" onClick={() => fetchComponents(true)} title="Refresh list">
                ↺
              </button>
            </>
          )}
        </div>

        {availableReleases.length > 0 && (
          <div className="cr-filter-group cr-filter-group--releases">
            <label className="cr-filter-label">Release filter</label>
            <div className="cr-release-chips">
              {availableReleases.map(r => (
                <button
                  key={r}
                  className={`cr-release-chip${selectedReleases.has(r) ? ' cr-release-chip--on' : ''}`}
                  onClick={() => toggleRelease(r)}
                  title={r}
                >
                  {r}
                </button>
              ))}
              <button
                className="cr-release-chip cr-release-chip--all"
                onClick={() => setSelectedReleases(new Set(availableReleases))}
              >All</button>
              <button
                className="cr-release-chip cr-release-chip--none"
                onClick={() => setSelectedReleases(new Set())}
              >None</button>
            </div>
          </div>
        )}

        <button
          className="cr-btn-fetch"
          onClick={fetchReportData}
          disabled={!selectedComponent || tabDataLoading}
          title={!selectedComponent ? 'Select a component first' : 'Fetch report data'}
        >
          {tabDataLoading ? '⏳ Fetching…' : '↓ Fetch'}
        </button>
      </div>

      {/* ── Health card ───────────────────────────────────────────────────── */}
      {healthData && (
        <div className="cr-health-card">
          <div className="cr-health-left">
            <HealthDot health={healthData.status} />
            <span className="cr-health-name">{healthData.componentName}</span>
            <span className={`cr-verdict cr-verdict-${healthData.status}`}>{healthData.verdict}</span>
          </div>
          <div className="cr-health-metrics">
            <div className="cr-metric"><span>P0</span><strong>{healthData.p0Count}</strong></div>
            <div className="cr-metric"><span>P1</span><strong>{healthData.p1Count}</strong></div>
            <div className="cr-metric"><span>Outstanding</span><strong>{healthData.outstandingCount}</strong></div>
            <div className="cr-metric"><span>Avg Age</span><strong>{healthData.avgAge}d</strong></div>
          </div>
          {actionItems.length > 0 && (
            <div className="cr-actions">
              {actionItems.slice(0, 3).map((item, idx) => (
                <div key={idx} className={`cr-action-item cr-action-${item.severity}`}>
                  <span className="cr-action-num">{idx + 1}.</span>
                  <JiraLink jiraKey={item.key} />
                  <span className="cr-action-summary">{item.summary}</span>
                  <span className="cr-action-detail">{item.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Error state ───────────────────────────────────────────────────── */}
      {tabDataError && (
        <div className="cr-error-banner">⚠️ {tabDataError}</div>
      )}

      {/* ── No component selected ─────────────────────────────────────────── */}
      {!selectedComponent && !tabDataLoading && (
        <div className="cr-empty-page">Select a component above to load the report.</div>
      )}

      {/* ── Sections ─────────────────────────────────────────────────────── */}
      {selectedComponent && !tabDataLoading && !tabDataError && tabData && (
        <>
          {/* Section A: Selected Releases */}
          <ReportSection
            title={selectedReleases.size > 0
              ? `Selected Releases (${[...selectedReleases].join(', ')})`
              : 'Selected Releases'}
            badge={`${outstanding.filter(i => isInSelected(i.fixVersions, selectedReleases)).length} outstanding`}
            outstanding={outstanding}
            projectBreakdown={projectBreakdown}
            isSelectedSection={true}
            selectedReleases={selectedReleases}
          />

          {/* Section B: All Other Releases (not in selection) */}
          <ReportSection
            title="All Other Projects"
            badge={`${outstanding.filter(i => !isInSelected(i.fixVersions, selectedReleases)).length} outstanding`}
            outstanding={outstanding}
            projectBreakdown={projectBreakdown}
            isSelectedSection={false}
            selectedReleases={selectedReleases}
          />

          {/* Section C: Stale / Cleanup placeholder */}
          <CleanupSection />
        </>
      )}
    </div>
  );
};
