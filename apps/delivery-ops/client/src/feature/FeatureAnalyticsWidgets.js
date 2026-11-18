import React, { useMemo } from 'react';
import { jiraSearchUrl } from './services/featureDashboardService';
import './FeatureAnalyticsWidgets.css';

const DONE_STATUSES = new Set(['done', 'resolved', 'closed', 'complete', 'fixed']);
const PORTFOLIO_TYPES = new Set(['feature', 'initiative', 'epic', 'x-feat', 'capability']);

const PHASE_LABEL_MAP = [
  { key: 'regression', label: 'Regression' },
  { key: 'system-test', label: 'System Test' },
  { key: 'systemtest', label: 'System Test' },
  { key: 'longevity', label: 'Longevity' },
  { key: 'performance', label: 'Performance' },
  { key: 'stress', label: 'Stress' },
  { key: 'unit-test', label: 'Unit Test' },
];

function isDone(issue) {
  return DONE_STATUSES.has((issue.status || '').toLowerCase());
}

/**
 * Feature Dashboard analytics grid — shared with Email Sender.
 * @param {object[]} issues - canonical / related payload issues
 * @param {string} canonicalJql - base JQL for click-through links
 * @param {string} jiraBaseUrl
 */
export function FeatureAnalyticsRow({ issues, canonicalJql, jiraBaseUrl, teamKpiBoxes = [] }) {
  const workItems = useMemo(
    () => (issues || []).filter((i) => !PORTFOLIO_TYPES.has((i.issueType || '').toLowerCase())),
    [issues]
  );
  const workItemsJql = canonicalJql
    ? `(${canonicalJql}) AND issuetype not in (Feature, Initiative, Epic, "X-FEAT", Capability)`
    : '';

  const bugs = useMemo(() => workItems.filter((i) => (i.issueType || '').toLowerCase() === 'bug'), [workItems]);
  const openBugs = useMemo(() => bugs.filter((b) => !isDone(b)), [bugs]);

  return (
    <>
      {teamKpiBoxes.length > 0 && (
        <div className="fd-kpi-boxes">
          <div className="fd-kpi-boxes-title">Team KPIs (open in this feature)</div>
          <div className="fd-kpi-boxes-row">
            {teamKpiBoxes.map((k) => {
              const href = k.jql ? jiraSearchUrl(jiraBaseUrl, k.jql) : '';
              const body = (
                <>
                  <span className="fd-kpi-count">{k.count == null ? '—' : k.count}</span>
                  <span className="fd-kpi-name">{k.name}</span>
                </>
              );
              return href ? (
                <a
                  key={k.id || k.name}
                  href={href}
                  target="_blank"
                  rel="noreferrer"
                  className={`fd-kpi-box ${(k.count || 0) > 0 ? 'fd-kpi-box--hot' : ''}`}
                  title={k.jql}
                >
                  {body}
                </a>
              ) : (
                <div key={k.id || k.name} className="fd-kpi-box">{body}</div>
              );
            })}
          </div>
        </div>
      )}
      <div className="fd-widgets-grid">
        <BugPhaseWidget bugs={openBugs} canonicalJql={workItemsJql} jiraBaseUrl={jiraBaseUrl} />
        <PriorityWidget bugs={openBugs} canonicalJql={workItemsJql} jiraBaseUrl={jiraBaseUrl} />
        <AssigneeWidget issues={workItems} />
        <BurnWidget issues={workItems} />
        <StaleWidget issues={workItems} canonicalJql={workItemsJql} jiraBaseUrl={jiraBaseUrl} />
        <QAQueueWidget bugs={bugs} canonicalJql={workItemsJql} jiraBaseUrl={jiraBaseUrl} />
      </div>
    </>
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
    const buckets = {};
    for (const bug of bugs) {
      let matched = false;
      for (const { key, label } of PHASE_LABEL_MAP) {
        if ((bug.labels || []).some((l) => l.toLowerCase().includes(key))) {
          buckets[label] = (buckets[label] || 0) + 1;
          matched = true;
        }
      }
      if (!matched) {
        buckets.Other = (buckets.Other || 0) + 1;
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
    let thisW = 0;
    let lastW = 0;
    for (const i of issues) {
      if (!i.resolved) continue;
      const t = new Date(`${i.resolved}T00:00:00.000Z`).getTime();
      if (t >= d7) thisW++;
      else if (t >= d14) lastW++;
    }
    return { thisWeek: thisW, lastWeek: lastW };
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
    () => bugs.filter((b) => (b.status || '').toLowerCase() === 'resolved').length,
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

export default FeatureAnalyticsRow;
