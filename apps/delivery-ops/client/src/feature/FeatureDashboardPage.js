import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { PageLoading } from '../shared/components/PageLoading';
import { ProjectPlanView } from '../shared/components/ProjectPlanView';
import { useJiraConfig } from '../utils/jiraConfig';
import { useSelectedRelease } from '../contexts/SelectedReleaseContext';
import { useTeam } from '../contexts/TeamContext';
import { usePermissions } from '../auth/hooks/usePermissions';
import { useExecPageBriefing } from '../hooks/useExecPageBriefing';
import ExecPageBriefing from '../components/ExecPageBriefing';
import { useFeatureDashboard } from './hooks/useFeatureDashboard';
import { jiraSearchUrl } from './services/featureDashboardService';
import FeatureOverviewGantt from './FeatureOverviewGantt';
import { FeatureAnalyticsRow } from './FeatureAnalyticsWidgets';
import FeatureFlowCharts from './FeatureFlowCharts';
import './FeatureDashboardPage.css';

const DONE_STATUSES = new Set(['done', 'resolved', 'closed', 'complete', 'fixed']);

function renderHeaderValue(value) {
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer">
        Link
      </a>
    );
  }
  return value;
}

function FeatureHeaderExtras({ header }) {
  const rows = [
    ['CG checklist', header?.cgChecklistLink],
    ['PG checklist', header?.pgChecklistLink],
    ['Risk assessment', header?.riskAssessment],
    ['Path to green', header?.pathToGreen],
  ].filter(([, value]) => value);
  if (rows.length === 0) return null;
  return (
    <div className="fd-meta">
      {rows.map(([label, value]) => (
        <span key={label}>{label}: {renderHeaderValue(value)}</span>
      ))}
    </div>
  );
}

/** Claim text stays plain; JIRA proof is a trailing ↗ (no full-line underline). */
function ClaimWithJira({ children, href, jql, className = '' }) {
  if (!href) return <span className={className}>{children}</span>;
  return (
    <span className={className}>
      {children}
      {' '}
      <a
        className="fd-jira-proof"
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        title={jql || 'Open in JIRA'}
        aria-label="Open matching JIRA query"
      >
        ↗
      </a>
    </span>
  );
}

/** Planned EC vs real start (first work-item In Progress) + soft fixVersion hygiene. */
function FeatureTimingStrip({ timing, hygiene, jiraBaseUrl }) {
  // Always render once dashboard is loaded — empty state is still a signal.
  if (timing == null && hygiene == null) return null;

  const delta = timing?.deltaDaysVsEc;
  let deltaNote = null;
  let deltaClass = 'fd-timing-neutral';
  if (timing?.realStart && delta != null) {
    if (delta > 0) {
      deltaNote = `${delta}d after EC`;
      deltaClass = 'fd-timing-late';
    } else if (delta < 0) {
      deltaNote = `${Math.abs(delta)}d before EC`;
      deltaClass = 'fd-timing-early';
    } else {
      deltaNote = 'on EC day';
    }
  }

  const seedUrl =
    timing?.realStartKey && jiraBaseUrl
      ? `${jiraBaseUrl.replace(/\/+$/, '')}/browse/${timing.realStartKey}`
      : '';
  const hygieneUrl =
    hygiene?.wrongFixVersionCount > 0 && hygiene?.jql
      ? jiraSearchUrl(jiraBaseUrl, hygiene.jql)
      : '';

  return (
    <div className="fd-timing-strip" data-testid="fd-timing-strip">
      <div className="fd-timing-title">Start dates</div>
      <div className="fd-timing-row">
        <div className="fd-timing-chip">
          <span className="fd-timing-label">Planned (release EC)</span>
          <span className="fd-timing-value">{timing?.plannedStart || '—'}</span>
        </div>
        <div className={`fd-timing-chip ${deltaClass}`}>
          <span className="fd-timing-label">Real start</span>
          {timing?.realStart ? (
            <span className="fd-timing-value">
              {seedUrl ? (
                <a href={seedUrl} target="_blank" rel="noopener noreferrer" title={timing.realStartKey}>
                  {timing.realStart}
                </a>
              ) : (
                timing.realStart
              )}
              {timing.realStartKey ? (
                <span className="fd-timing-seed">
                  {' '}
                  (
                  {seedUrl ? (
                    <a href={seedUrl} target="_blank" rel="noopener noreferrer">
                      {timing.realStartKey}
                    </a>
                  ) : (
                    timing.realStartKey
                  )}
                  )
                </span>
              ) : null}
              {deltaNote ? <span className="fd-timing-delta"> · {deltaNote}</span> : null}
            </span>
          ) : (
            <span className="fd-timing-value fd-timing-muted">Not started</span>
          )}
        </div>
      </div>
      {hygiene?.wrongFixVersionCount > 0 ? (
        <div className="fd-hygiene-caption">
          <ClaimWithJira href={hygieneUrl} jql={hygiene.jql}>
            {hygiene.wrongFixVersionCount} work item{hygiene.wrongFixVersionCount === 1 ? '' : 's'} not on this release fixVersion
          </ClaimWithJira>
          <span className="fd-hygiene-hint"> — hygiene only; still in analytics</span>
        </div>
      ) : null}
    </div>
  );
}

function isDone(issue) {
  return DONE_STATUSES.has((issue.status || '').toLowerCase());
}

function InferencePanel({ inference, jiraBaseUrl }) {
  if (!inference) return null;
  const ragClass =
    inference.rag === 'Red' ? 'fd-rag-red' : inference.rag === 'Yellow' ? 'fd-rag-yellow' : 'fd-rag-green';
  const codingHref =
    inference.codingByPg?.jql ? jiraSearchUrl(jiraBaseUrl, inference.codingByPg.jql) : '';
  const companionHref =
    inference.companionByGa?.jql ? jiraSearchUrl(jiraBaseUrl, inference.companionByGa.jql) : '';
  const codingLabel = `Coding → PG: ${inference.codingByPg?.open ?? '—'}/${inference.codingByPg?.total ?? '—'} open${inference.codingByPg?.onTrack ? ' · on track' : ' · at risk'}`;
  const companionLabel = `Companion → GA: ${inference.companionByGa?.open ?? '—'}/${inference.companionByGa?.total ?? '—'} open${inference.companionByGa?.onTrack ? ' · on track' : ' · at risk'}`;
  return (
    <div className={`fd-inference ${ragClass}`} data-testid="fd-inference">
      <div className="fd-inference-head">
        <span className="fd-inference-rag">{inference.rag}</span>
        <span className="fd-inference-summary">{inference.summary}</span>
      </div>
      <div className="fd-inference-lanes">
        <ClaimWithJira href={codingHref} jql={inference.codingByPg?.jql}>
          {codingLabel}
        </ClaimWithJira>
        <ClaimWithJira href={companionHref} jql={inference.companionByGa?.jql}>
          {companionLabel}
        </ClaimWithJira>
      </div>
      {(inference.drivers || []).length > 0 && (
        <ul className="fd-inference-drivers">
          {inference.drivers.slice(0, 8).map((d) => {
            const href = d.jql ? jiraSearchUrl(jiraBaseUrl, d.jql) : '';
            return (
              <li key={d.id} className={`fd-driver-${d.severity}`}>
                <ClaimWithJira href={href} jql={d.jql}>
                  {d.text}
                </ClaimWithJira>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function KickoffWidget({ kickoff, jiraBaseUrl }) {
  if (!kickoff) return null;
  const tone =
    kickoff.status === 'done_on_time'
      ? 'ok'
      : kickoff.status === 'missing' || kickoff.status === 'hygiene'
        ? 'warn'
        : kickoff.status === 'done_late' || (kickoff.status === 'incomplete' && kickoff.pastEc)
          ? 'bad'
          : 'warn';
  const url = kickoff.jql ? jiraSearchUrl(jiraBaseUrl, kickoff.jql) : '';
  const epicBrowse =
    kickoff.epicKey && jiraBaseUrl
      ? `${jiraBaseUrl.replace(/\/+$/, '')}/browse/${kickoff.epicKey}`
      : '';
  return (
    <div className={`fd-kickoff fd-kickoff--${tone}`} data-testid="fd-kickoff">
      <div className="fd-kickoff-title">Kick-off epic</div>
      <div className="fd-kickoff-msg">
        <ClaimWithJira href={url} jql={kickoff.jql}>
          {kickoff.message}
        </ClaimWithJira>
      </div>
      {kickoff.epicKey && (
        <div className="fd-kickoff-meta">
          {epicBrowse ? (
            <a href={epicBrowse} target="_blank" rel="noopener noreferrer">
              {kickoff.epicKey}
            </a>
          ) : (
            kickoff.epicKey
          )}
          {kickoff.doneDate ? ` · done ${kickoff.doneDate}` : ''}
          {kickoff.ecDate ? ` · EC ${kickoff.ecDate}` : ''}
          {kickoff.childrenTotal
            ? ` · ${kickoff.childrenClosed}/${kickoff.childrenTotal} children closed`
            : ''}
        </div>
      )}
    </div>
  );
}

export default function FeatureDashboardPage() {
  const { jiraBaseUrl } = useJiraConfig();
  const { selectedTeamId } = useTeam();
  const { isExecAudience } = usePermissions();
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
  } = useFeatureDashboard({
    release,
    featureKey: committedFeatureKey,
    teamId: selectedTeamId || 'ndb',
    jiraToken,
    username,
  });

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

  const featureSnapshot = useMemo(() => {
    if (!dashboard?.header) return null;
    const h = dashboard.header;
    const outstanding = [
      ...(dashboard.payload?.epicChildren || []),
      ...(dashboard.payload?.directTickets || []),
    ]
      .filter((i) => i && !isDone(i))
      .slice(0, 20)
      .map((i) => ({ key: i.key, summary: i.summary, status: i.status, issueType: i.issueType }));
    return {
      key: h.key,
      summary: h.summary,
      status: h.status,
      riskIndicator: h.riskIndicator,
      riskAssessment: h.riskAssessment,
      pathToGreen: h.pathToGreen,
      cgChecklistLink: h.cgChecklistLink,
      pgChecklistLink: h.pgChecklistLink,
      timing: dashboard.timing,
      hygiene: dashboard.hygiene,
      burn: dashboard.burn,
      teamKpiBoxes: dashboard.teamKpiBoxes || dashboard.kpiBoxes || [],
      outstanding,
      gates: gates || null,
      header: h,
    };
  }, [dashboard, gates]);

  const featureSnapshotKey = useMemo(() => {
    if (!featureSnapshot) return '';
    return `${featureSnapshot.key}|${(featureSnapshot.outstanding || []).length}|${featureSnapshot.status || ''}`;
  }, [featureSnapshot]);

  const {
    state: execBriefState,
    summary: execBriefSummary,
    meta: execBriefMeta,
    error: execBriefError,
    refresh: refreshExecBrief,
  } = useExecPageBriefing({
    enabled: isExecAudience,
    surface: 'feature',
    featureKey: committedFeatureKey,
    snapshot: featureSnapshot,
    snapshotKey: featureSnapshotKey,
    ready: Boolean(featureSnapshot),
  });

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

      {error && <div className="fd-error">{error}</div>}
      {loadingDashboard && <PageLoading message="Loading feature dashboard…" />}

      <ExecPageBriefing
        state={execBriefState}
        summary={execBriefSummary}
        meta={execBriefMeta}
        error={execBriefError}
        onRetry={refreshExecBrief}
        jiraBase={jiraBaseUrl || 'https://jira.nutanix.com'}
      />

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
            <FeatureHeaderExtras header={dashboard.header} />
            <FeatureTimingStrip
              timing={dashboard.timing}
              hygiene={dashboard.hygiene}
              jiraBaseUrl={jiraBaseUrl}
            />
            {dashboard.inference && (
              <InferencePanel inference={dashboard.inference} jiraBaseUrl={jiraBaseUrl} />
            )}
            {dashboard.kickoff && (
              <KickoffWidget kickoff={dashboard.kickoff} jiraBaseUrl={jiraBaseUrl} />
            )}
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

          <FeatureFlowCharts flow={dashboard.flow} />

          <section className="fd-section">
            <FeatureAnalyticsRow
              issues={payload.canonical || []}
              canonicalJql={dashboard.jql.canonical}
              jiraBaseUrl={jiraBaseUrl}
              teamKpiBoxes={dashboard.teamKpiBoxes || []}
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
                  <a href={`${jiraBaseUrl}/browse/${row.key}`} target="_blank" rel="noreferrer">
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
