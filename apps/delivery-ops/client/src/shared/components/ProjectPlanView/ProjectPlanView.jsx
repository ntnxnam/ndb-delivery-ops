import React, { useMemo, useState, useCallback, useEffect } from 'react';
import { formatDate } from '../../utils/dateFormatter';
import './ProjectPlanView.css';

// Column definitions — single place for header + cell rendering.
// Adding a column = adding an entry here + passing its key in `columns` prop.
const COLUMN_DEFS = {
  key: {
    header: 'Key',
    cell: (row, jiraBaseUrl) => (
      <a href={`${jiraBaseUrl}/browse/${row.key}`} target="_blank" rel="noreferrer">
        {row.key}
      </a>
    ),
  },
  type: { header: 'Type', cell: (row) => row.issueType || '—' },
  summary: { header: 'Summary', cell: (row) => row.summary || '—' },
  status: {
    header: 'Status',
    cell: (row) => (
      <span className="fd-status-chip">
        {row.status || '—'}
      </span>
    ),
  },
  resolution: { header: 'Resolution', cell: (row) => row.resolution || 'N/A' },
  assignee: { header: 'Assignee', cell: (row) => row.assignee || '—' },
  qaContact: { header: 'QA Contact', cell: (row) => row.qaContact || row.customfield_10860?.value || 'Not Set' },
  priority: {
    header: 'Priority',
    cell: (row) => row.priority || '—',
    tdClass: (row) => `fd-pri-${(row.priority || 'none').toLowerCase()}`,
  },
  dueDate: {
    header: 'Due Date',
    cell: (row) => {
      const t = String(row.issueType || '').toLowerCase();
      const isNonEpicPortfolio = ['feature', 'initiative', 'x-feat', 'capability'].includes(t);
      if (isNonEpicPortfolio) {
        return <span title="Portfolio types track gate dates, not Due Date">—</span>;
      }
      const isSprintTracked = ['story', 'task', 'bug', 'sub-task', 'subtask'].includes(t);
      if (isSprintTracked) {
        return <span title="This type tracks sprint, not Due Date">—</span>;
      }
      const v = row.duedate;
      if (!v || v === 'Not Set') return 'Not Set';
      if (/^\d{2}\/[A-Za-z]{3}\/\d{4}$/.test(v)) return v;
      const formatted = formatDate(v);
      return formatted || 'Not Set';
    },
  },
  fixVersions: {
    header: 'Fix Version',
    cell: (row) => {
      const v = row.fixVersions;
      if (Array.isArray(v)) return v.length ? v.join(', ') : 'N/A';
      return v || 'N/A';
    },
  },
};

// Default columns for Feature Dashboard — 7-col including Due Date (Epics show date, portfolio/sprint types show —).
const DEFAULT_COLUMNS = ['key', 'type', 'summary', 'status', 'assignee', 'dueDate', 'priority'];

const DONE_STATUSES = new Set(['done', 'resolved', 'closed', 'complete', 'fixed']);
const EPIC_TYPES = new Set(['epic']);
const PORTFOLIO_TYPES = new Set(['feature', 'initiative', 'epic', 'x-feat', 'capability']);

function isEpic(issue) {
  return EPIC_TYPES.has(String(issue.issueType || '').toLowerCase());
}
function isPortfolio(issue) {
  return PORTFOLIO_TYPES.has(String(issue.issueType || '').toLowerCase());
}
function isDone(issue) {
  return DONE_STATUSES.has(String(issue.status || '').toLowerCase());
}

function jiraSearchUrl(jiraBaseUrl, jql) {
  if (!jiraBaseUrl || !jql) return '';
  return `${String(jiraBaseUrl).replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}

/**
 * Shared Project Plan View — used by Feature Dashboard and Email Sender.
 *
 * Two modes:
 * 1. issues mode (Feature Dashboard): flat canonical list, grouped by `groupBy` field (default epicLink).
 * 2. groups mode (Email Sender): pre-grouped `[{ key, summary, status, issueType, duedate, fixVersions, assignee, qaContact, childItems: [] }]`
 *    where childItems are Epics under each Feature.
 *
 * Props:
 *  - issues?: FeatureDashboardIssue[]  — flat list (FeatureDashboard)
 *  - groups?: { key, summary, status, issueType?, duedate?, fixVersions?, assignee?, qaContact?, childItems: Issue[] }[]  — pre-grouped (EmailSender)
 *  - canonicalJql?: string — for "Open in JIRA" header link
 *  - jiraBaseUrl: string
 *  - columns?: string[] — column keys from COLUMN_DEFS
 *  - title?: string — header title (default "Open Work")
 *  - groupBy?: string — field to group flat issues by (default "epicLink")
 */
export function ProjectPlanView({
  issues,
  groups,
  canonicalJql,
  jiraBaseUrl,
  columns = DEFAULT_COLUMNS,
  title = 'Open Work',
  groupBy = 'epicLink',
}) {
  // Groups mode: render directly from pre-grouped data (Email Sender path)
  // `groups` being defined (even as empty array) signals caller intent for groups mode.
  if (groups !== undefined) {
    return (
      <GroupsPlanView
        groups={groups}
        canonicalJql={canonicalJql}
        jiraBaseUrl={jiraBaseUrl}
        columns={columns}
        title={title}
      />
    );
  }

  // Issues mode: derive groups from flat list (Feature Dashboard path)
  return (
    <IssuesPlanView
      issues={issues || []}
      canonicalJql={canonicalJql}
      jiraBaseUrl={jiraBaseUrl}
      columns={columns}
      title={title}
      groupBy={groupBy}
    />
  );
}

/** Flat-issues mode — Feature Dashboard: Epic → Tasks grouping */
function IssuesPlanView({ issues, canonicalJql, jiraBaseUrl, columns, title, groupBy }) {
  const epics = useMemo(() => issues.filter(isEpic), [issues]);
  const children = useMemo(() => issues.filter((i) => !isEpic(i) && !isPortfolio(i)), [issues]);

  const childrenByEpic = useMemo(() => {
    const map = {};
    for (const c of children) {
      const key = c[groupBy] || '__isolated__';
      if (!map[key]) map[key] = [];
      map[key].push(c);
    }
    return map;
  }, [children, groupBy]);

  const openJql = canonicalJql ? `(${canonicalJql}) AND statusCategory != Done` : null;
  const totalOpen = useMemo(() => issues.filter((i) => !isDone(i)).length, [issues]);

  return (
    <div>
      <div className="fd-plan-header">
        <span className="fd-plan-title">{title}</span>
        <span className="fd-plan-counts">{totalOpen} open · {issues.length} total</span>
        {openJql && jiraBaseUrl && (
          <a href={jiraSearchUrl(jiraBaseUrl, openJql)} target="_blank" rel="noreferrer" className="fd-plan-jira-link">
            Open in JIRA
          </a>
        )}
      </div>

      {epics
        .filter((epic) => (childrenByEpic[epic.key] || []).length > 0)
        .map((epic) => (
          <EpicSection
            key={epic.key}
            epic={epic}
            children={childrenByEpic[epic.key]}
            jiraBaseUrl={jiraBaseUrl}
            columns={columns}
          />
        ))}

      {(childrenByEpic['__isolated__'] || []).length > 0 && (
        <EpicSection
          epic={{ key: '__isolated__', summary: 'Isolated (no epic link)', issueType: '', status: '' }}
          children={childrenByEpic['__isolated__']}
          jiraBaseUrl={jiraBaseUrl}
          columns={columns}
          isolated
        />
      )}
    </div>
  );
}

/** Pre-grouped mode — Email Sender: Feature → Epics grouping */
function GroupsPlanView({ groups, canonicalJql, jiraBaseUrl, columns, title }) {
  const safeGroups = useMemo(() => (Array.isArray(groups) ? groups : []), [groups]);
  const totalCount = useMemo(
    () => safeGroups.reduce((sum, g) => sum + (g.childItems?.length || g.childEpics?.length || 0), 0),
    [safeGroups]
  );
  // Build exact-set JQL for clickthrough authenticity
  const totalJql = useMemo(() => {
    const keys = [];
    for (const g of safeGroups) {
      const items = g.childItems || g.childEpics || [];
      for (const e of items) {
        const k = String(e?.key || '').trim();
        if (/^[A-Z][A-Z0-9]+-\d+$/i.test(k)) keys.push(k);
      }
    }
    return keys.length ? `key in (${keys.join(', ')})` : null;
  }, [safeGroups]);
  const totalUrl = totalJql ? jiraSearchUrl(jiraBaseUrl, totalJql) : '';

  return (
    <div>
      <div className="fd-plan-header">
        <span className="fd-plan-title">{title}</span>
        <span className="fd-plan-counts">
          Total Epics:{' '}
          {totalUrl ? (
            <a href={totalUrl} target="_blank" rel="noopener noreferrer" title={totalJql} className="fd-plan-count-link">
              {totalCount}
            </a>
          ) : (
            <span className="fd-plan-count-value">{totalCount}</span>
          )}
        </span>
        {canonicalJql && jiraBaseUrl && (
          <a href={jiraSearchUrl(jiraBaseUrl, canonicalJql)} target="_blank" rel="noreferrer" className="fd-plan-jira-link">
            Open in JIRA
          </a>
        )}
      </div>

      {safeGroups.length === 0 ? (
        <div className="fd-empty">No epics in this payload.</div>
      ) : (
        safeGroups.map((group) => {
          const childItems = group.childItems || group.childEpics || [];
          return (
            <EpicSection
              key={group.key}
              epic={group}
              children={childItems}
              jiraBaseUrl={jiraBaseUrl}
              columns={columns}
            />
          );
        })
      )}
    </div>
  );
}

function EpicSection({ epic, children, jiraBaseUrl, columns = DEFAULT_COLUMNS, isolated = false }) {
  const openChildren = useMemo(() => children.filter((c) => !isDone(c)), [children]);
  const allDone = openChildren.length === 0 && children.length > 0;
  const pct = children.length > 0 ? Math.round(((children.length - openChildren.length) / children.length) * 100) : 0;
  const [expanded, setExpanded] = useState(!allDone);
  const toggle = useCallback(() => setExpanded((v) => !v), []);
  // Sync expanded when allDone flips after data refresh (e.g. task marked Done)
  useEffect(() => {
    if (allDone) setExpanded(false);
  }, [allDone]);

  const activeDefs = columns.map((k) => COLUMN_DEFS[k]).filter(Boolean);

  return (
    <div className="fd-epic-section">
      <button
        type="button"
        className="fd-epic-row"
        onClick={toggle}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} ${epic.key !== '__isolated__' ? epic.key : 'isolated'}`}
      >
        <span className="fd-epic-toggle" aria-hidden="true">{expanded ? '▼' : '▶'}</span>
        {!isolated && <span className="fd-epic-key">{epic.key}</span>}
        <span className="fd-epic-summary">{epic.summary}</span>
        {!isolated && epic.status ? <span className="fd-epic-status fd-status-chip">{epic.status}</span> : null}
        <span className="fd-epic-counts">
          {allDone ? (
            <span className="fd-all-done">✓ all done</span>
          ) : (
            <>
              {openChildren.length} open / {children.length} total
            </>
          )}
        </span>
        {children.length > 0 && (
          <span className="fd-progress-bar">
            <span className="fd-progress-fill" style={{ width: `${pct}%` }} />
          </span>
        )}
        <span className="fd-progress-pct">{pct}%</span>
      </button>

      {expanded && openChildren.length > 0 && (
        <div className="fd-plan-table-wrap">
          <table className="fd-plan-table">
            <thead>
              <tr>
                {activeDefs.map((def) => (
                  <th key={def.header}>{def.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {openChildren.map((row) => (
                <tr key={row.key}>
                  {columns.map((colKey) => {
                    const def = COLUMN_DEFS[colKey];
                    if (!def) return null;
                    const tdClass = typeof def.tdClass === 'function' ? def.tdClass(row) : undefined;
                    return (
                      <td key={colKey} className={tdClass}>
                        {def.cell(row, jiraBaseUrl)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ProjectPlanView;
