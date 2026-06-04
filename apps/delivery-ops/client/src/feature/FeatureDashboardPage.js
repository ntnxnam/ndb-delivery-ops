import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTeam } from '../contexts/TeamContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { listReleaseVersions } from '../release/services/releaseBriefService';
import { useFeatureDashboard } from './hooks/useFeatureDashboard';
import { jiraSearchUrl } from './services/featureDashboardService';
import './FeatureDashboardPage.css';

const DONE_STATUSES = new Set(['done', 'resolved', 'closed', 'complete', 'fixed']);
const EPIC_TYPES = new Set(['epic']);
const PORTFOLIO_TYPES = new Set(['feature', 'initiative', 'x-feat', 'capability']);

// Phase labels to scan on bugs — add more here as needed
const PHASE_LABEL_MAP = [
  { key: 'regression',   label: 'Regression' },
  { key: 'system-test',  label: 'System Test' },
  { key: 'systemtest',   label: 'System Test' },
  { key: 'longevity',    label: 'Longevity' },
  { key: 'performance',  label: 'Performance' },
  { key: 'stress',       label: 'Stress' },
  { key: 'unit-test',    label: 'Unit Test' },
];

function isDone(issue) {
  return DONE_STATUSES.has((issue.status || '').toLowerCase());
}

function isEpic(issue) {
  return EPIC_TYPES.has((issue.issueType || '').toLowerCase());
}

function isPortfolio(issue) {
  return PORTFOLIO_TYPES.has((issue.issueType || '').toLowerCase());
}

const DEFAULT_RELEASE = 'NDB-2.11';

export default function FeatureDashboardPage() {
  const { selectedTeamId } = useTeam();
  const { jiraBaseUrl } = useJiraConfig();
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || '';
  const [versions, setVersions] = useState([]);
  const [release, setRelease] = useState(DEFAULT_RELEASE);
  const [featureKey, setFeatureKey] = useState('');
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [reasonByKey, setReasonByKey] = useState({});

  const {
    features,
    dashboard,
    loadingFeatures,
    loadingDashboard,
    savingReparent,
    error,
    reparentTicket,
  } = useFeatureDashboard({ release, featureKey, jiraToken, username });

  useEffect(() => {
    let cancelled = false;
    async function loadVersions() {
      if (!selectedTeamId || !jiraToken) return;
      setLoadingVersions(true);
      try {
        const data = await listReleaseVersions({ teamId: selectedTeamId, jiraToken, username });
        if (cancelled) return;
        const next = data.versions || [];
        setVersions(next);
        if (next.length > 0) {
          setRelease((prev) => prev || next[0].name);
        }
      } catch (_e) {
        if (!cancelled) setVersions([]);
      } finally {
        if (!cancelled) setLoadingVersions(false);
      }
    }
    loadVersions();
    return () => {
      cancelled = true;
    };
  }, [selectedTeamId, jiraToken, username]);

  useEffect(() => {
    if (!featureKey && features.length > 0) {
      setFeatureKey(features[0].key);
    }
  }, [featureKey, features]);

  const featureOptions = useMemo(
    () => features.map((f) => ({ ...f, label: `${f.key} - ${f.summary}` })),
    [features]
  );

  const flowPoints = dashboard?.flow?.points || [];
  const kpis = dashboard?.kpis || [];
  const statusUpdate20 = dashboard?.statusUpdate20 || [];
  const payload = dashboard?.payload || {};
  const openFeatIdOnly = useMemo(
    () => (payload.featIdOnly || []).filter((i) => !isDone(i)),
    [payload.featIdOnly]
  );
  const openFeatNumberOnly = useMemo(
    () => (payload.featNumberOnly || []).filter((i) => !isDone(i)),
    [payload.featNumberOnly]
  );
  const markers = dashboard?.flow?.markers || {};
  const markerDays = Object.values(markers).filter(Boolean);

  const handleReparent = async (ticketKey) => {
    const reason = String(reasonByKey[ticketKey] || '').trim();
    if (!reason) return;
    await reparentTicket({ ticketKey, newParent: dashboard.header.key, reason });
    setReasonByKey((prev) => ({ ...prev, [ticketKey]: '' }));
  };

  return (
    <div className="fd-page">
      <header className="fd-header">
        <div>
          <h1>Feature Dashboard</h1>
          <p>Gate-aware payload, burn, reconciliation, and action queue.</p>
        </div>
        <div className="fd-pickers">
          <label>
            Release
            <select
              value={release}
              onChange={(e) => {
                setRelease(e.target.value);
                setFeatureKey('');
              }}
              disabled={loadingVersions}
            >
              {versions.map((v) => (
                <option key={v.name} value={v.name}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Feature
            <select
              value={featureKey}
              onChange={(e) => setFeatureKey(e.target.value)}
              disabled={loadingFeatures || featureOptions.length === 0}
            >
              {featureOptions.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      {error && <div className="fd-error">{error}</div>}
      {loadingDashboard && <div className="fd-loading">Loading feature dashboard...</div>}

      {dashboard && (
        <>
          <section className="fd-section">
            <h2>{dashboard.header.key} - {dashboard.header.summary}</h2>
            <div className="fd-meta">
              <span>{dashboard.header.issueType}</span>
              <span>{dashboard.header.status}</span>
              <span>{dashboard.header.assignee || 'Unassigned'}</span>
              <span>Risk: {dashboard.header.riskIndicator?.value || 'N/A'}</span>
            </div>
            <div className="fd-gates">
              <GateChip label="EC" value={dashboard.gates.ec} />
              <GateChip label="CC" value={dashboard.gates.cc} />
              <GateChip label="CG" value={dashboard.gates.cg} />
              <GateChip label="PG" value={dashboard.gates.pg} />
              <GateChip label="GA" value={dashboard.gates.ga} />
            </div>
          </section>

          {kpis.length > 0 && (
            <section className="fd-section">
              <h3>KPIs (non-zero)</h3>
              <div className="fd-kpis">
                {kpis.map((kpi) => (
                  <a
                    key={kpi.key}
                    href={jiraSearchUrl(jiraBaseUrl, kpi.jql)}
                    target="_blank"
                    rel="noreferrer"
                    className={`fd-kpi fd-${kpi.severity}`}
                  >
                    <div className="fd-kpi-label">{kpi.label}</div>
                    <div className="fd-kpi-count">{kpi.count}</div>
                  </a>
                ))}
              </div>
            </section>
          )}

          {flowPoints.length > 0 && (
            <section className="fd-section">
              <h3>Created vs Resolved ({dashboard.flow.startIso} to {dashboard.flow.endIso})</h3>
              <div className="fd-chart-wrap">
                <ResponsiveContainer width="100%" height={280}>
                  <LineChart data={flowPoints}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="day" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {markerDays.map((m) => (
                      <ReferenceLine key={m} x={m} stroke="#999" strokeDasharray="4 4" />
                    ))}
                    <Line type="monotone" dataKey="created" stroke="#2563EB" dot={false} />
                    <Line type="monotone" dataKey="resolved" stroke="#16A34A" dot={false} />
                    <Line type="monotone" dataKey="open" stroke="#D97706" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </section>
          )}

          <section className="fd-section">
            <AnalyticsRow
              issues={payload.canonical || []}
              canonicalJql={dashboard.jql.canonical}
              jiraBaseUrl={jiraBaseUrl}
            />
          </section>

          <section className="fd-section">
            <ProjectPlanView
              issues={payload.canonical || []}
              canonicalJql={dashboard.jql.canonical}
              jiraBaseUrl={jiraBaseUrl}
            />
          </section>

          {openFeatIdOnly.length > 0 && (
            <section className="fd-section fd-grid-two">
              <PayloadTable
                title={`Potential Payload — open only (cf[40468])`}
                rows={openFeatIdOnly}
                jql={dashboard.jql.featId}
                jiraBaseUrl={jiraBaseUrl}
                action={(row) => (
                  <ReparentAction
                    row={row}
                    reason={reasonByKey[row.key] || ''}
                    onReasonChange={(next) =>
                      setReasonByKey((prev) => ({ ...prev, [row.key]: next }))
                    }
                    onSubmit={() => handleReparent(row.key)}
                    disabled={savingReparent}
                  />
                )}
              />
            </section>
          )}

          {openFeatNumberOnly.length > 0 && (
            <section className="fd-section">
              <PayloadTable
                title={`Potential Payload — open only (cf[14262])`}
                rows={openFeatNumberOnly}
                jql={dashboard.jql.featNumber}
                jiraBaseUrl={jiraBaseUrl}
                action={(row) => (
                  <ReparentAction
                    row={row}
                    reason={reasonByKey[row.key] || ''}
                    onReasonChange={(next) =>
                      setReasonByKey((prev) => ({ ...prev, [row.key]: next }))
                    }
                    onSubmit={() => handleReparent(row.key)}
                    disabled={savingReparent}
                  />
                )}
              />
            </section>
          )}

          {statusUpdate20.length > 0 && (
            <section className="fd-section">
              <h3>Status Update (20-point format)</h3>
              <div className="fd-status-list">
                {statusUpdate20.map((item) => (
                  <div key={item.id} className="fd-status-row">
                    <strong>{item.title}</strong>
                    <span>{item.value}</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

// ─── Project Plan View ───────────────────────────────────────────────────────

function ProjectPlanView({ issues, canonicalJql, jiraBaseUrl }) {
  const epics = useMemo(() => issues.filter(isEpic), [issues]);
  const children = useMemo(() => issues.filter((i) => !isEpic(i) && !isPortfolio(i)), [issues]);

  const childrenByEpic = useMemo(() => {
    const map = {};
    for (const c of children) {
      const key = c.epicLink || '__isolated__';
      if (!map[key]) map[key] = [];
      map[key].push(c);
    }
    return map;
  }, [children]);

  const openJql = `(${canonicalJql}) AND statusCategory != Done`;
  const totalOpen = useMemo(() => issues.filter((i) => !isDone(i)).length, [issues]);

  return (
    <div>
      <div className="fd-plan-header">
        <span className="fd-plan-title">Open Work</span>
        <span className="fd-plan-counts">{totalOpen} open · {issues.length} total</span>
        <a href={jiraSearchUrl(jiraBaseUrl, openJql)} target="_blank" rel="noreferrer" className="fd-plan-jira-link">
          Open in JIRA
        </a>
      </div>

      {epics
        .filter((epic) => (childrenByEpic[epic.key] || []).length > 0)
        .map((epic) => (
          <EpicSection
            key={epic.key}
            epic={epic}
            children={childrenByEpic[epic.key]}
            jiraBaseUrl={jiraBaseUrl}
          />
        ))}

      {(childrenByEpic['__isolated__'] || []).length > 0 && (
        <EpicSection
          epic={{ key: '__isolated__', summary: 'Isolated (no epic link)', issueType: '', status: '' }}
          children={childrenByEpic['__isolated__']}
          jiraBaseUrl={jiraBaseUrl}
          isolated
        />
      )}
    </div>
  );
}

function EpicSection({ epic, children, jiraBaseUrl, isolated = false }) {
  const openChildren = useMemo(() => children.filter((c) => !isDone(c)), [children]);
  const allDone = openChildren.length === 0 && children.length > 0;
  const pct = children.length > 0 ? Math.round(((children.length - openChildren.length) / children.length) * 100) : 0;
  const [expanded, setExpanded] = useState(!allDone);

  const toggle = useCallback(() => setExpanded((v) => !v), []);

  return (
    <div className="fd-epic-section">
      <button type="button" className="fd-epic-row" onClick={toggle}>
        <span className="fd-epic-toggle">{expanded ? '▼' : '▶'}</span>
        {!isolated && <span className="fd-epic-key">{epic.key}</span>}
        <span className="fd-epic-summary">{epic.summary}</span>
        {!isolated && <span className={`fd-epic-status fd-status-chip`}>{epic.status}</span>}
        <span className="fd-epic-counts">
          {allDone
            ? <span className="fd-all-done">✓ all done</span>
            : <>{openChildren.length} open / {children.length} total</>}
        </span>
        {children.length > 0 && (
          <span className="fd-progress-bar">
            <span className="fd-progress-fill" style={{ width: `${pct}%` }} />
          </span>
        )}
        <span className="fd-progress-pct">{pct}%</span>
      </button>

      {expanded && openChildren.length > 0 && (
        <table className="fd-plan-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Type</th>
              <th>Summary</th>
              <th>Status</th>
              <th>Assignee</th>
              <th>Priority</th>
            </tr>
          </thead>
          <tbody>
            {openChildren.map((row) => (
              <tr key={row.key}>
                <td>
                  <a href={`https://jira.nutanix.com/browse/${row.key}`} target="_blank" rel="noreferrer">
                    {row.key}
                  </a>
                </td>
                <td>{row.issueType}</td>
                <td>{row.summary}</td>
                <td><span className={`fd-status-chip fd-priority-${(row.status || '').toLowerCase().replace(/\s+/g, '-')}`}>{row.status}</span></td>
                <td>{row.assignee || '—'}</td>
                <td className={`fd-pri-${(row.priority || 'none').toLowerCase()}`}>{row.priority || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ─── Analytics Widgets ────────────────────────────────────────────────────────

function AnalyticsRow({ issues, canonicalJql, jiraBaseUrl }) {
  const bugs = useMemo(() => issues.filter((i) => i.issueType.toLowerCase() === 'bug'), [issues]);
  const openBugs = useMemo(() => bugs.filter((b) => !isDone(b)), [bugs]);

  return (
    <div className="fd-widgets-grid">
      <BugPhaseWidget bugs={openBugs} canonicalJql={canonicalJql} jiraBaseUrl={jiraBaseUrl} />
      <PriorityWidget bugs={openBugs} canonicalJql={canonicalJql} jiraBaseUrl={jiraBaseUrl} />
      <AssigneeWidget issues={issues} />
      <BurnWidget issues={issues} />
      <StaleWidget issues={issues} canonicalJql={canonicalJql} jiraBaseUrl={jiraBaseUrl} />
      <QAQueueWidget bugs={bugs} canonicalJql={canonicalJql} jiraBaseUrl={jiraBaseUrl} />
    </div>
  );
}

function WidgetCard({ title, children }) {
  return (
    <div className="fd-widget">
      <div className="fd-widget-title">{title}</div>
      {children}
    </div>
  );
}

function BugPhaseWidget({ bugs, canonicalJql, jiraBaseUrl }) {
  const phases = useMemo(() => {
    const seen = new Set();
    const buckets = {};
    for (const bug of bugs) {
      let matched = false;
      for (const { key, label } of PHASE_LABEL_MAP) {
        if (bug.labels.some((l) => l.toLowerCase().includes(key))) {
          if (!buckets[label]) buckets[label] = 0;
          buckets[label]++;
          matched = true;
        }
      }
      if (!matched) {
        buckets['Other'] = (buckets['Other'] || 0) + 1;
      }
    }
    return Object.entries(buckets).sort((a, b) => b[1] - a[1]);
  }, [bugs]);

  return (
    <WidgetCard title="Bugs by Test Phase">
      {phases.length === 0 ? (
        <span className="fd-widget-empty">No open bugs</span>
      ) : (
        <div className="fd-phase-list">
          {phases.map(([label, count]) => {
            const labelKey = PHASE_LABEL_MAP.find((p) => p.label === label)?.key || label.toLowerCase();
            const jql = `(${canonicalJql}) AND issuetype = Bug AND labels = "${labelKey}" AND statusCategory != Done`;
            return (
              <a key={label} href={jiraSearchUrl(jiraBaseUrl, jql)} target="_blank" rel="noreferrer" className="fd-phase-pill">
                <span className="fd-phase-name">{label}</span>
                <span className="fd-phase-count">{count}</span>
              </a>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

function PriorityWidget({ bugs, canonicalJql, jiraBaseUrl }) {
  const buckets = useMemo(() => {
    const map = { P0: 0, P1: 0, P2: 0, P3: 0, Other: 0 };
    for (const b of bugs) {
      const p = (b.priority || '').toUpperCase();
      if (p in map) map[p]++;
      else map.Other++;
    }
    return Object.entries(map).filter(([, v]) => v > 0);
  }, [bugs]);

  const priorityClass = { P0: 'fd-pri-p0', P1: 'fd-pri-p1', P2: 'fd-pri-p2', P3: 'fd-pri-p3', Other: 'fd-pri-none' };

  return (
    <WidgetCard title="Open Bugs by Priority">
      {buckets.length === 0 ? (
        <span className="fd-widget-empty">No open bugs</span>
      ) : (
        <div className="fd-phase-list">
          {buckets.map(([p, count]) => {
            const jql = `(${canonicalJql}) AND issuetype = Bug AND priority = "${p}" AND statusCategory != Done`;
            return (
              <a key={p} href={jiraSearchUrl(jiraBaseUrl, jql)} target="_blank" rel="noreferrer" className={`fd-phase-pill ${priorityClass[p] || ''}`}>
                <span className="fd-phase-name">{p}</span>
                <span className="fd-phase-count">{count}</span>
              </a>
            );
          })}
        </div>
      )}
    </WidgetCard>
  );
}

function AssigneeWidget({ issues }) {
  const rows = useMemo(() => {
    const open = issues.filter((i) => !isDone(i));
    const map = {};
    for (const i of open) {
      const name = i.assignee || '(Unassigned)';
      map[name] = (map[name] || 0) + 1;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [issues]);

  const max = rows[0]?.[1] || 1;

  return (
    <WidgetCard title="Open by Assignee">
      {rows.length === 0 ? (
        <span className="fd-widget-empty">No open tickets</span>
      ) : (
        <div className="fd-assignee-list">
          {rows.map(([name, count]) => (
            <div key={name} className="fd-assignee-row">
              <span className="fd-assignee-name" title={name}>{name}</span>
              <span className="fd-assignee-bar-wrap">
                <span className="fd-assignee-bar" style={{ width: `${Math.round((count / max) * 100)}%` }} />
              </span>
              <span className="fd-assignee-count">{count}</span>
            </div>
          ))}
        </div>
      )}
    </WidgetCard>
  );
}

function BurnWidget({ issues }) {
  const { thisWeek, lastWeek } = useMemo(() => {
    const now = Date.now();
    const d7 = now - 7 * 86400000;
    const d14 = now - 14 * 86400000;
    let thisWeek = 0;
    let lastWeek = 0;
    for (const i of issues) {
      if (!i.resolved) continue;
      const t = new Date(`${i.resolved}T00:00:00.000Z`).getTime();
      if (t >= d7) thisWeek++;
      else if (t >= d14) lastWeek++;
    }
    return { thisWeek, lastWeek };
  }, [issues]);

  const delta = lastWeek > 0 ? Math.round(((thisWeek - lastWeek) / lastWeek) * 100) : null;

  return (
    <WidgetCard title="Weekly Burn Rate">
      <div className="fd-burn-main">{thisWeek} <span className="fd-burn-label">closed this week</span></div>
      {delta !== null && (
        <div className={`fd-burn-delta ${delta >= 0 ? 'fd-burn-up' : 'fd-burn-down'}`}>
          {delta >= 0 ? '↑' : '↓'} {Math.abs(delta)}% vs last week ({lastWeek})
        </div>
      )}
      {delta === null && <div className="fd-widget-empty">{lastWeek} closed last week</div>}
    </WidgetCard>
  );
}

function StaleWidget({ issues, canonicalJql, jiraBaseUrl }) {
  const staleCount = useMemo(() => {
    const cutoff = Date.now() - 14 * 86400000;
    return issues.filter((i) => {
      if (isDone(i) || !i.updated) return false;
      return new Date(`${i.updated}T00:00:00.000Z`).getTime() < cutoff;
    }).length;
  }, [issues]);

  const jql = `(${canonicalJql}) AND statusCategory != Done AND updated <= -14d`;

  return (
    <WidgetCard title="Stale > 14 Days">
      <div className={`fd-burn-main ${staleCount > 0 ? 'fd-stale-warn' : ''}`}>
        {staleCount}
        <span className="fd-burn-label"> open, no update</span>
      </div>
      {staleCount > 0 && (
        <a href={jiraSearchUrl(jiraBaseUrl, jql)} target="_blank" rel="noreferrer" className="fd-widget-link">
          View in JIRA →
        </a>
      )}
    </WidgetCard>
  );
}

function QAQueueWidget({ bugs, canonicalJql, jiraBaseUrl }) {
  const count = useMemo(
    () => bugs.filter((b) => b.status.toLowerCase() === 'resolved').length,
    [bugs]
  );

  const jql = `(${canonicalJql}) AND issuetype = Bug AND status = Resolved`;

  return (
    <WidgetCard title="QA Verification Queue">
      <div className={`fd-burn-main ${count > 0 ? 'fd-amber-text' : ''}`}>
        {count}
        <span className="fd-burn-label"> bugs awaiting close</span>
      </div>
      {count > 0 && (
        <a href={jiraSearchUrl(jiraBaseUrl, jql)} target="_blank" rel="noreferrer" className="fd-widget-link">
          View in JIRA →
        </a>
      )}
    </WidgetCard>
  );
}

// ─── Existing helpers ─────────────────────────────────────────────────────────

function GateChip({ label, value }) {
  return (
    <div className="fd-gate">
      <span>{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  );
}

function PayloadTable({ title, rows = [], jql, jiraBaseUrl, action }) {
  return (
    <div className="fd-table-card">
      <div className="fd-table-head">
        <h4>{title}</h4>
        <a href={jiraSearchUrl(jiraBaseUrl, jql)} target="_blank" rel="noreferrer">
          Open in JIRA
        </a>
      </div>
      {rows.length === 0 ? (
        <div className="fd-empty">No tickets</div>
      ) : (
        <table className="fd-table">
          <thead>
            <tr>
              <th>Key</th>
              <th>Summary</th>
              <th>Type</th>
              <th>Status</th>
              <th>Assignee</th>
              {action && <th>Action</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.key}</td>
                <td>{row.summary}</td>
                <td>{row.issueType}</td>
                <td>{row.status}</td>
                <td>{row.assignee || '—'}</td>
                {action && <td>{action(row)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function ReparentAction({ reason, onReasonChange, onSubmit, disabled }) {
  return (
    <div className="fd-action">
      <input
        value={reason}
        placeholder="Reason (required)"
        onChange={(e) => onReasonChange(e.target.value)}
      />
      <button type="button" onClick={onSubmit} disabled={disabled || !reason.trim()}>
        Set Parent Link
      </button>
    </div>
  );
}
