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
// Grouped by fixVersion. All row types (features, epics, direct tickets) use
// the same unified table. Counts only — "show count, not details".
// Bug cell shows inline assignees (top 3, first name). Each cell shows its own done count.

const W4_COLS = [
  { key: 'Bug',         label: 'Bugs' },
  { key: 'TaskUnit',    label: 'Tasks+UnitTests' },
  { key: 'Improvement', label: 'Improvements' },
  { key: 'Test',        label: 'Tests' },
  { key: 'Other',       label: 'Others' },
];

const W4Cell = ({ colKey, counts, topBugAssignees }) => {
  const c = counts[colKey] || { outstanding: 0, done: 0, p0: 0, p1: 0 };
  if (c.outstanding === 0 && c.done === 0) {
    return <td className="cr-count-cell cr-count-cell--empty"><span className="cr-zero">—</span></td>;
  }
  const tooltip = [
    c.outstanding > 0 ? `${c.outstanding} open` : null,
    c.p0 > 0 ? `${c.p0} P0` : null,
    c.p1 > 0 ? `${c.p1} P1` : null,
    c.done > 0 ? `${c.done} done` : null,
  ].filter(Boolean).join(' · ');
  return (
    <td className="cr-count-cell" title={tooltip}>
      {c.outstanding > 0 && (
        <div className="cr-cell-out">
          <strong>{c.outstanding} open</strong>
          {(c.p0 > 0 || c.p1 > 0) && (
            <span className="cr-prio-sub">
              {c.p0 > 0 && <span className="cr-p0-sub">🔴 {c.p0} P0</span>}
              {c.p1 > 0 && <span className="cr-p1-sub">⚠ {c.p1} P1</span>}
            </span>
          )}
          {colKey === 'Bug' && topBugAssignees && topBugAssignees.length > 0 && (
            <div className="cr-assignees-inline">
              {topBugAssignees.slice(0, 3).map(a => (
                <span key={a.name} className="cr-assignee-chip" title={a.name}>
                  {a.name.split(' ')[0]} ({a.count})
                </span>
              ))}
            </div>
          )}
        </div>
      )}
      {c.done > 0 && <div className="cr-done-sub">✓ {c.done} done</div>}
    </td>
  );
};

const W4Row = ({ row }) => {
  const { counts, topBugAssignees } = row.breakdown || { counts: {}, topBugAssignees: [] };
  const rowTypeLabel = row.rowType === 'feature' ? 'Feature' : row.rowType === 'epic' ? 'Epic' : 'Direct';
  return (
    <tr className={`cr-proj-row cr-row-${row.rowType}${row.mismatch ? ' cr-row-mismatch' : ''}${row.affectedVersionAnomaly ? ' cr-row-av-anomaly' : ''}`}>
      <td>
        <JiraLink jiraKey={row.key} />
        {row.mismatch && (
          <span className="cr-mismatch-flag" title="Child tickets have a different fixVersion">*</span>
        )}
      </td>
      <td className="cr-summary-cell" title={row.summary}>{row.summary}</td>
      <td><span className={`cr-type-badge cr-type-${rowTypeLabel.toLowerCase()}`}>{rowTypeLabel}</span></td>
      <td><span className="cr-status-badge">{row.status}</span></td>
      <td><HealthDot health={row.health} /></td>
      {W4_COLS.map(col => (
        <W4Cell key={col.key} colKey={col.key} counts={counts} topBugAssignees={topBugAssignees} />
      ))}
    </tr>
  );
};

const W4ReleaseTable = ({ rows }) => {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="cr-table-scroll">
      <table className="cr-proj-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Summary</th>
            <th>Type</th>
            <th>Status</th>
            <th>Health</th>
            {W4_COLS.map(c => <th key={c.key}>{c.label} ↑</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map(row => <W4Row key={row.key} row={row} />)}
        </tbody>
      </table>
    </div>
  );
};

// Consolidate direct tickets into a summary row
const DirectTicketsSummaryRow = ({ directTickets }) => {
  if (!directTickets || directTickets.length === 0) return null;

  const totalCounts = { Bug: { outstanding: 0, done: 0, p0: 0, p1: 0 }, 'Tasks+UnitTests': { outstanding: 0, done: 0, p0: 0, p1: 0 }, Improvement: { outstanding: 0, done: 0, p0: 0, p1: 0 }, Test: { outstanding: 0, done: 0, p0: 0, p1: 0 }, Others: { outstanding: 0, done: 0, p0: 0, p1: 0 } };

  directTickets.forEach(ticket => {
    const breakdown = ticket.breakdown?.counts || {};
    Object.entries(breakdown).forEach(([key, val]) => {
      if (totalCounts[key]) {
        totalCounts[key].outstanding += val.outstanding || 0;
        totalCounts[key].done += val.done || 0;
        totalCounts[key].p0 += val.p0 || 0;
        totalCounts[key].p1 += val.p1 || 0;
      }
    });
  });

  const summaryRow = {
    key: `direct-summary-${directTickets.length}`,
    rowType: 'direct-summary',
    summary: `${directTickets.length} Direct Tickets (No Epic)`,
    status: 'Mixed',
    health: 'mixed',
    breakdown: { counts: totalCounts, topBugAssignees: [] }
  };

  return (
    <tr className="cr-proj-row cr-row-direct-summary">
      <td colSpan="5" style={{ fontWeight: 'bold', padding: '8px' }}>{summaryRow.summary}</td>
      {W4_COLS.map(col => (
        <W4Cell key={col.key} colKey={col.key} counts={totalCounts} topBugAssignees={[]} />
      ))}
    </tr>
  );
};

const W4ReleaseGroup = ({ fixVersion, group, defaultOpen }) => {
  const [open, setOpen] = useState(defaultOpen);
  const features = group.features || [];
  const epics = group.epics || [];
  const directTickets = group.directTickets || [];
  
  
  const allForCount = [...features, ...epics, ...directTickets];
  const totalOut = allForCount.reduce((s, r) =>
    s + Object.values(r.breakdown?.counts || {}).reduce((ss, c) => ss + (c.outstanding || 0), 0), 0);
  const hasMismatch = allForCount.some(r => r.mismatch);
  const hasAnomaly = allForCount.some(r => r.affectedVersionAnomaly);

  return (
    <div className={`cr-w4-group cr-accordion${open ? ' cr-accordion--open' : ''}`}>
      <button className="cr-accordion-header cr-w4-group-header" onClick={() => setOpen(o => !o)}>
        <span className="cr-w4-fv-label">{fixVersion}</span>
        <span className="cr-widget-count">
          {features.length} proj · {epics.length} epic · {directTickets.length} direct · {totalOut} outstanding
          {hasMismatch && <span className="cr-mismatch-flag" title="Some items have fixVersion mismatches"> *</span>}
          {hasAnomaly && <span className="cr-anomaly-flag" title="affectedVersion anomaly detected"> ⚠</span>}
        </span>
        <span className="cr-accordion-chevron">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="cr-accordion-body">
          {features.length > 0 && (
            <>
              <h4 className="cr-w4-subtype-heading">Projects — Features / Initiatives ({features.length})</h4>
              <W4ReleaseTable rows={features} />
            </>
          )}
          {epics.length > 0 && (
            <>
              <h4 className="cr-w4-subtype-heading">Standalone Epics ({epics.length})</h4>
              <W4ReleaseTable rows={epics} />
            </>
          )}
          {directTickets.length > 0 && (
            <>
              <h4 className="cr-w4-subtype-heading">Direct Tickets — No Epic</h4>
              <div className="cr-table-scroll">
                <table className="cr-proj-table">
                  <thead>
                    <tr>
                      <th colSpan="5">Summary</th>
                      {W4_COLS.map(c => <th key={c.key}>{c.label} ↑</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    <DirectTicketsSummaryRow directTickets={directTickets} />
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

const ProjectsWidget = ({ projectBreakdown }) => {
  const { byRelease, releaseOrder } = projectBreakdown || { byRelease: {}, releaseOrder: [] };
  if (!releaseOrder || releaseOrder.length === 0) {
    return <p className="cr-empty-inline">No project data available.</p>;
  }

  // Open the first release that has outstanding work; fall back to the first release
  const firstWithWork = releaseOrder.find(fv => {
    const g = byRelease[fv] || {};
    const all = [...(g.features || []), ...(g.epics || []), ...(g.directTickets || [])];
    return all.some(r => Object.values(r.breakdown?.counts || {}).some(c => (c.outstanding || 0) > 0));
  });
  const defaultOpenRelease = firstWithWork || releaseOrder[0];

  return (
    <div className="cr-widget-inner cr-widget-projects">
      {releaseOrder.map((fv) => (
        <W4ReleaseGroup
          key={fv}
          fixVersion={fv}
          group={byRelease[fv]}
          defaultOpen={fv === defaultOpenRelease}
        />
      ))}
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

// ── Cleanup section — stale projects with orphaned open children ─────────────
// A "stale" row = Feature/Initiative/Epic in Done status but has ≥1 outstanding descendant.
// Director lens: this is garbage that teams haven't cleaned up — it inflates counts and
// hides real work. Show it so someone can act.
const CleanupSection = ({ staleProjects }) => {
  const [open, setOpen] = useState(false);
  const count = staleProjects.length;

  return (
    <section className={`cr-section cr-section-accordion${open ? ' cr-section-accordion--open' : ''}`}>
      <button className="cr-section-header cr-section-toggle" onClick={() => setOpen(o => !o)}>
        <h2 className="cr-section-title">Stale Projects — Cleanup Needed</h2>
        <span className={`cr-section-badge${count > 0 ? ' cr-badge-warn' : ''}`}>
          {count > 0 ? `${count} closed with open children` : 'None — clean ✓'}
        </span>
        <span className="cr-section-chevron">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="cr-section-body">
          {count === 0 ? (
            <p className="cr-placeholder-text">
              No closed/cancelled projects with open work found — data hygiene looks good.
            </p>
          ) : (
            <>
              <p className="cr-cleanup-intro">
                The following <strong>{count}</strong> project(s)/epic(s) are <strong>closed or cancelled</strong> in JIRA
                but still have <strong>outstanding open work items</strong> underneath them.
                These inflate component metrics and hide real risk. Each item needs an owner decision:
                reopen the project, close/defer the children, or move children to an active project.
              </p>
              <div className="cr-table-scroll">
                <table className="cr-proj-table cr-cleanup-table">
                  <thead>
                    <tr>
                      <th>Key</th>
                      <th>Summary</th>
                      <th>Type</th>
                      <th>Status</th>
                      <th>Fix Version</th>
                      <th>Open Children ↑</th>
                      <th>Health</th>
                    </tr>
                  </thead>
                  <tbody>
                    {staleProjects
                      .sort((a, b) => b.openChildCount - a.openChildCount)
                      .map(row => (
                        <tr key={row.key} className="cr-cleanup-row">
                          <td><JiraLink jiraKey={row.key} /></td>
                          <td className="cr-summary-cell" title={row.summary}>{row.summary}</td>
                          <td>
                            <span className={`cr-type-badge cr-type-${row.rowType}`}>
                              {row.rowType === 'feature' ? 'Feature' : 'Epic'}
                            </span>
                          </td>
                          <td><span className="cr-status-badge cr-status-stale">{row.status}</span></td>
                          <td className="cr-fixver-cell">{row.fixVersions || '—'}</td>
                          <td className="cr-count-cell">
                            <strong className="cr-cleanup-open-count">{row.openChildCount}</strong>
                          </td>
                          <td><HealthDot health={row.health} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
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

  // Filter the projectBreakdown byRelease groups to only those matching the section filter
  const { byRelease = {}, releaseOrder = [] } = projectBreakdown || {};
  const filteredReleaseOrder = releaseOrder.filter(fv =>
    isSelectedSection ? selectedReleases.has(fv) : !selectedReleases.has(fv)
  );
  const filteredByRelease = {};
  filteredReleaseOrder.forEach(fv => { filteredByRelease[fv] = byRelease[fv]; });
  const filteredProjectBreakdown = { byRelease: filteredByRelease, releaseOrder: filteredReleaseOrder };

  const totalProjectRows = filteredReleaseOrder.reduce((s, fv) => {
    const g = byRelease[fv] || {};
    return s + (g.features?.length || 0) + (g.epics?.length || 0) + (g.directTickets?.length || 0);
  }, 0);

  const isEmpty = filtered.length === 0 && totalProjectRows === 0;

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
              badge={`${totalProjectRows} items across ${filteredReleaseOrder.length} releases`}
              defaultOpen={true}
            >
              <ProjectsWidget projectBreakdown={filteredProjectBreakdown} />
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
  const [fetchedAt, setFetchedAt] = useState(null);

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
    setFetchedAt(null);

    Promise.all([
      authenticatedGet(`${API_BASE}/api/component/health?component=${encodeURIComponent(selectedComponent)}`),
      authenticatedGet(`${API_BASE}/api/component/data?component=${encodeURIComponent(selectedComponent)}`),
    ])
      .then(([healthRes, dataRes]) => {
        setHealthData(healthRes.data?.health || null);
        setActionItems(healthRes.data?.actions || []);
        setTabData(dataRes.data || null);
        setFetchedAt(new Date());

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
  const projectBreakdown = tabData?.projectBreakdown || { byRelease: {}, releaseOrder: [] };
  const staleProjects = tabData?.staleProjects || [];

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

        <div className="cr-fetch-group">
          <button
            className={tabData ? 'cr-btn-refetch' : 'cr-btn-fetch'}
            onClick={fetchReportData}
            disabled={!selectedComponent || tabDataLoading}
            title={!selectedComponent ? 'Select a component first' : tabData ? 'Re-fetch data for this component' : 'Fetch report data'}
          >
            {tabDataLoading ? '⏳ Fetching…' : tabData ? '↺ Refresh' : '↓ Fetch'}
          </button>
          {fetchedAt && !tabDataLoading && (
            <span className="cr-fetched-at">
              data as of {fetchedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
        </div>
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

          {/* Section C: Stale projects with open children */}
          <CleanupSection staleProjects={staleProjects} />
        </>
      )}
    </div>
  );
};
