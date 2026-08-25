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
import { useJiraConfig } from '../utils/jiraConfig';
import { useSelectedRelease } from '../contexts/SelectedReleaseContext';
import { useFeatureDashboard } from './hooks/useFeatureDashboard';
import { jiraSearchUrl } from './services/featureDashboardService';
import FeatureOverviewGantt from './FeatureOverviewGantt';
import './FeatureDashboardPage.css';

const DONE_STATUSES = new Set(['done', 'resolved', 'closed', 'complete', 'fixed']);
const EPIC_TYPES = new Set(['epic']);
const PORTFOLIO_TYPES = new Set(['feature', 'initiative', 'epic', 'x-feat', 'capability']);

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

export default function FeatureDashboardPage() {
  const { jiraBaseUrl } = useJiraConfig();
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || '';

  // Versions come from the central context — no local fetch needed.
  const {
    activeVersions,
    inactiveVersions,
    loadingVersions,
    selectedRelease: contextRelease,
  } = useSelectedRelease();

  // Merge active + inactive for the full picker list (active first).
  const versions = useMemo(
    () => [...activeVersions, ...inactiveVersions],
    [activeVersions, inactiveVersions]
  );

  // Local release/feature selection — initialise from context's current selection.
  const [release, setRelease] = useState(contextRelease || '');
  // pendingFeatureKey: what's visible in the dropdown
  // committedFeatureKey: what actually drives the dashboard load (set on "Choose")
  const [pendingFeatureKey, setPendingFeatureKey] = useState('');
  const [committedFeatureKey, setCommittedFeatureKey] = useState('');
  const [reasonByKey, setReasonByKey] = useState({});

  const {
    features,
    gates,
    dashboard,
    loadingFeatures,
    loadingDashboard,
    savingReparent,
    error,
    reparentTicket,
  } = useFeatureDashboard({ release, featureKey: committedFeatureKey, jiraToken, username });

  // Keep local release in sync when context selection changes (e.g. team switch).
  useEffect(() => {
    if (contextRelease) setRelease((prev) => prev || contextRelease);
  }, [contextRelease]);

  // Auto-select the first active version if nothing is chosen yet.
  useEffect(() => {
    if (!release && activeVersions.length > 0) {
      setRelease(activeVersions[0].name);
    }
  }, [release, activeVersions]);

  // When a new release is picked, reset feature selection.
  const handleReleaseChange = useCallback((name) => {
    setRelease(name);
    setPendingFeatureKey('');
    setCommittedFeatureKey('');
  }, []);

  // When features load, pre-select the first one in the dropdown (but don't load dashboard yet).
  useEffect(() => {
    if (features.length > 0) {
      setPendingFeatureKey((prev) => prev || features[0].key);
    }
  }, [features]);

  const featureOptions = useMemo(
    () => features.map((f) => ({ ...f, label: `${f.key} - ${f.summary}` })),
    [features]
  );

  const flowPoints = dashboard?.flow?.points || [];
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
  // Deduplicate marker dates (ccm and ccmException may differ).
  const markerDays = [...new Set(Object.values(markers).filter(Boolean))];

  const handleChooseFeature = useCallback(() => {
    if (pendingFeatureKey) setCommittedFeatureKey(pendingFeatureKey);
  }, [pendingFeatureKey]);

  const handleSelectFromGantt = useCallback((key) => {
    if (!key) return;
    setPendingFeatureKey(key);
    setCommittedFeatureKey(key);
  }, []);

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
              onChange={(e) => handleReleaseChange(e.target.value)}
              disabled={loadingVersions}
            >
              <option value="">— select release —</option>
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
          </label>
          <label>
            Feature
            <div className="fd-picker-row">
              <select
                value={pendingFeatureKey}
                onChange={(e) => setPendingFeatureKey(e.target.value)}
                disabled={loadingFeatures || featureOptions.length === 0}
              >
                <option value="">— select feature —</option>
                {featureOptions.map((f) => (
                  <option key={f.key} value={f.key}>{f.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="fd-choose-btn"
                disabled={!pendingFeatureKey || loadingFeatures}
                onClick={handleChooseFeature}
              >
                Choose
              </button>
            </div>
          </label>
        </div>
      </header>

      {release && (
        <FeatureOverviewGantt
          release={release}
          features={features}
          gates={gates}
          selectedKey={committedFeatureKey || pendingFeatureKey}
          onSelectFeature={handleSelectFromGantt}
          loading={loadingFeatures}
        />
      )}

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
              <GateChip label="EC" planned={dashboard.gates.ec} />
              <GateChip
                label="CCM"
                planned={dashboard.gates.ccmException || dashboard.gates.ccm}
                originalPlanned={dashboard.gates.ccmException ? dashboard.gates.ccm : null}
                exceptionLabel={dashboard.gates.ccmExceptionLabel}
                jira={dashboard.gates.jiraCcm}
                actual={dashboard.gates.actualCcm}
              />
              <GateChip label="CG"  planned={dashboard.gates.cg}  jira={dashboard.gates.jiraCg}  actual={dashboard.gates.actualCg} />
              <GateChip label="PG"  planned={dashboard.gates.pg}  jira={dashboard.gates.jiraPg}  actual={dashboard.gates.actualPg} />
              <GateChip label="GA" planned={dashboard.gates.ga} />
            </div>
          </section>

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
  const workItems = useMemo(
    () => issues.filter((i) => !PORTFOLIO_TYPES.has(i.issueType.toLowerCase())),
    [issues]
  );
  const workItemsJql = `(${canonicalJql}) AND issuetype not in (Feature, Initiative, Epic, "X-FEAT", Capability)`;

  const bugs = useMemo(() => workItems.filter((i) => i.issueType.toLowerCase() === 'bug'), [workItems]);
  const openBugs = useMemo(() => bugs.filter((b) => !isDone(b)), [bugs]);

  return (
    <div className="fd-widgets-grid">
      <BugPhaseWidget bugs={openBugs} canonicalJql={workItemsJql} jiraBaseUrl={jiraBaseUrl} />
      <PriorityWidget bugs={openBugs} canonicalJql={workItemsJql} jiraBaseUrl={jiraBaseUrl} />
      <AssigneeWidget issues={workItems} />
      <BurnWidget issues={workItems} />
      <StaleWidget issues={workItems} canonicalJql={workItemsJql} jiraBaseUrl={jiraBaseUrl} />
      <QAQueueWidget bugs={bugs} canonicalJql={workItemsJql} jiraBaseUrl={jiraBaseUrl} />
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

function fmtShort(iso) {
  if (!iso) return '—';
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function calcDelta(planned, date) {
  if (!planned || !date) return null;
  const diff = Math.round(
    (new Date(`${date}T00:00:00Z`) - new Date(`${planned}T00:00:00Z`)) / 86400000
  );
  return {
    label: diff > 0 ? `+${diff}D` : diff < 0 ? `${diff}D` : '±0D',
    color: diff > 0 ? '#C0392B' : '#27AE60',
  };
}

function GateChip({ label, planned, originalPlanned, exceptionLabel, jira, actual }) {
  const isNotProvided = actual === 'not-provided';
  const hasRealActual = actual && !isNotProvided;

  const jiraDelta   = jira ? calcDelta(planned, jira) : null;
  const actualDelta = hasRealActual ? calcDelta(planned, actual) : null;

  return (
    <div className="fd-gate">
      <span className="fd-gate-label">{label}</span>
      {originalPlanned && (
        <div className="fd-gate-exception-badge" title={exceptionLabel || 'Management-approved exception'}>
          <span className="fd-gate-exception-icon">⚡</span>
          <span>Exception</span>
        </div>
      )}
      <div className="fd-gate-row">
        <span className="fd-gate-row-key">Gate</span>
        <strong className="fd-gate-planned">{fmtShort(planned) || '—'}</strong>
      </div>
      {originalPlanned && (
        <div className="fd-gate-row">
          <span className="fd-gate-row-key">Original</span>
          <span className="fd-gate-actual fd-gate-actual--original">{fmtShort(originalPlanned)}</span>
        </div>
      )}
      {jira !== undefined && (
        <div className="fd-gate-row">
          <span className="fd-gate-row-key">Set Date</span>
          <span className="fd-gate-actual">{jira ? fmtShort(jira) : '—'}</span>
          {jiraDelta && (
            <span className="fd-gate-delta" style={{ color: jiraDelta.color }}>{jiraDelta.label}</span>
          )}
        </div>
      )}
      {actual && (
        <div className="fd-gate-row">
          <span className="fd-gate-row-key">Actual</span>
          <span className={`fd-gate-actual${isNotProvided ? ' fd-gate-actual--none' : ''}`}>
            {isNotProvided ? 'not provided' : fmtShort(actual)}
          </span>
          {actualDelta && (
            <span className="fd-gate-delta" style={{ color: actualDelta.color }}>{actualDelta.label}</span>
          )}
        </div>
      )}
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
                <td>
                  <a href={`https://jira.nutanix.com/browse/${row.key}`} target="_blank" rel="noreferrer">
                    {row.key}
                  </a>
                </td>
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
