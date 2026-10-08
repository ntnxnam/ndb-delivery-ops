import React, { useEffect, useMemo, useState } from 'react';
import { useDependencyView } from '../../hooks/useDependencyView';
import { useTeam } from '../../contexts/TeamContext';
import { TeamRequiredGate } from '../../layout/components/TeamRequiredGate';
import './DependencyView.css';

function NumLink({ section, label }) {
  if (!section) return null;
  const count = section.count ?? 0;
  const href = section.jiraUrl;
  if (!href) {
    return (
      <div className="dv-metric">
        <span className="n">{count}</span>
        <span className="l">{label}</span>
      </div>
    );
  }
  return (
    <a
      className="dv-metric"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={section.jql || ''}
      aria-label={`${label}: ${count} — open in JIRA`}
    >
      <span className="n">{count}</span>
      <span className="l">{label}</span>
    </a>
  );
}

function IssueTable({ issues, jiraBaseUrl }) {
  if (!issues?.length) {
    return <div className="dv-empty">No issues in this section.</div>;
  }
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/+$/, '');
  return (
    <div className="dv-table-wrap">
      <table className="dv-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Summary</th>
            <th>Status</th>
            <th>Project</th>
            <th>Assignee</th>
            <th>Span</th>
            <th>Commit</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((iss) => (
            <tr key={iss.key}>
              <td>
                <a href={`${base}/browse/${iss.key}`} target="_blank" rel="noopener noreferrer">
                  {iss.key}
                </a>
              </td>
              <td className="summary">{iss.summary}</td>
              <td>{iss.status}</td>
              <td>{iss.project}</td>
              <td>{iss.assignee || '—'}</td>
              <td>{iss.span != null ? iss.span : '—'}</td>
              <td>
                <span className={`dv-pill ${iss.commitState === 'committed' ? 'committed' : 'ask'}`}>
                  {iss.commitState === 'committed' ? 'Committed' : 'Ask'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function gateLines(ndbGates) {
  if (!ndbGates || typeof ndbGates !== 'object') return [];
  const lines = [];
  if (ndbGates.ecDate) lines.push(`EC: ${ndbGates.ecDate}`);
  ['ccm1Gate', 'ccm2Gate', 'commitGate1', 'commitGate2', 'promotionGate1', 'promotionGate2', 'ga1', 'ga2'].forEach(
    (k) => {
      const g = ndbGates[k];
      if (g && (g.date || g.label)) {
        lines.push(`${g.label || k}: ${g.date || '—'}`);
      }
    }
  );
  if (ndbGates.gaDate) lines.push(`GA: ${ndbGates.gaDate}`);
  return lines;
}

function filterIssues(issues, { mode, direction, span }) {
  return (issues || []).filter((iss) => {
    if (span !== 'all' && iss.span != null && String(iss.span) !== String(span)) return false;
    if (direction === 'i_wait_on_them' && iss.direction && iss.direction !== 'i_wait_on_them') {
      return false;
    }
    if (direction === 'they_wait_on_me' && iss.direction && iss.direction !== 'they_wait_on_me') {
      return false;
    }
    if (mode === 'partnership' && iss.source && !String(iss.source).startsWith('partnership')) {
      return false;
    }
    if (mode === 'companion' && iss.source && !String(iss.source).startsWith('companion')) {
      return false;
    }
    if (mode === 'labels' && iss.source !== 'labels') return false;
    return true;
  });
}

export default function DependencyViewPage() {
  const { selectedTeamId, selectedTeam, hasTeamSelected } = useTeam();
  const [release, setRelease] = useState('');
  const [mode, setMode] = useState('all');
  const [direction, setDirection] = useState('all');
  const [span, setSpan] = useState('all');

  const { data, loading, refreshing, error, refresh } = useDependencyView(
    selectedTeamId,
    release || undefined
  );

  useEffect(() => {
    setRelease('');
  }, [selectedTeamId]);

  useEffect(() => {
    if (!data) return;
    if (!release && data.release) setRelease(data.release);
  }, [data, release]);

  const releases = data?.releases?.length ? data.releases : [];
  const jiraBaseUrl = data?.jiraBaseUrl || 'https://jira.nutanix.com';
  const train = data?.alignedTrain || {};
  const sections = data?.sections || {};

  const filteredPartnershipBlockedBy = useMemo(
    () =>
      filterIssues(sections.partnershipBlockedBy?.issues, { mode, direction, span }),
    [sections.partnershipBlockedBy, mode, direction, span]
  );
  const filteredPartnershipBlocks = useMemo(
    () => filterIssues(sections.partnershipBlocks?.issues, { mode, direction, span }),
    [sections.partnershipBlocks, mode, direction, span]
  );
  const filteredLabels = useMemo(
    () => filterIssues(sections.trainLabels?.issues, { mode, direction, span }),
    [sections.trainLabels, mode, direction, span]
  );

  const showPartnership = mode === 'all' || mode === 'partnership';
  const showCompanion = mode === 'all' || mode === 'companion';
  const showLabels = mode === 'all' || mode === 'labels';
  const showIWait = direction === 'all' || direction === 'i_wait_on_them';
  const showTheyWait = direction === 'all' || direction === 'they_wait_on_me';

  if (!hasTeamSelected) {
    return (
      <TeamRequiredGate
        title="Select a team for Dependency View"
        description="Dependency View is NDB-first; pick a team in the sidebar, then Fetch."
      />
    );
  }

  return (
      <div className="dv-page">
        <div className="dv-header">
          <h2>Dependency View</h2>
          <span className="dv-badge">Read-only</span>
          <span className="dv-meta">
            {selectedTeam?.name || selectedTeamId || '—'}
            {data?.asOf ? ` · as of ${new Date(data.asOf).toLocaleString()}` : ''}
          </span>
          <div className="dv-actions">
            <button type="button" onClick={refresh} disabled={loading || refreshing}>
              {refreshing ? 'Pulling…' : 'Pull from JIRA'}
            </button>
          </div>
        </div>

        <div className="dv-filters">
          <label>
            Release
            <select
              value={release || data?.release || ''}
              onChange={(e) => setRelease(e.target.value)}
              disabled={loading && !data}
            >
              {(releases.length ? releases : [release || data?.release || 'NDB-3.0']).map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="all">All</option>
              <option value="partnership">Partnership</option>
              <option value="companion">Companion</option>
              <option value="labels">Train labels</option>
            </select>
          </label>
          <label>
            Direction
            <select value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="all">All</option>
              <option value="i_wait_on_them">I wait on them</option>
              <option value="they_wait_on_me">They wait on me</option>
            </select>
          </label>
          <label>
            Span
            <select value={span} onChange={(e) => setSpan(e.target.value)}>
              <option value="all">All</option>
              {(data?.spans || []).map((s) => (
                <option key={s.id} value={String(s.id)}>
                  {s.label || `Span ${s.id}`}
                </option>
              ))}
            </select>
          </label>
        </div>

        {error && <div className="dv-error">{error}</div>}
        {loading && !data && <div className="dv-meta">Loading dependency overview…</div>}

        {data && (
          <>
            <div className="dv-train">
              <div>
                <h3>NDB gates — {data.release}</h3>
                <ul>
                  {gateLines(data.ndbGates).length ? (
                    gateLines(data.ndbGates).map((line) => <li key={line}>{line}</li>)
                  ) : (
                    <li>No gate dates in release config</li>
                  )}
                </ul>
              </div>
              <div>
                <h3>
                  Aligned train
                  {train.train ? `: ${train.train}` : ''}
                  {train.status ? (
                    <span className={`dv-train-status ${train.status}`}>{train.status}</span>
                  ) : null}
                </h3>
                <ul>
                  {train.notes ? <li>{train.notes}</li> : null}
                  {train.trainSlug ? <li>Label slug: ndb-{train.trainSlug}-dependency / -asks</li> : null}
                  {(train.partnerVersions || []).length ? (
                    <li>Partner versions: {train.partnerVersions.join(', ')}</li>
                  ) : (
                    <li>Partner versions: (configure in dependencyViewConfig)</li>
                  )}
                  {train.confluenceUrl ? (
                    <li>
                      <a href={train.confluenceUrl} target="_blank" rel="noopener noreferrer">
                        Confluence SoT
                      </a>
                    </li>
                  ) : (
                    <li>Confluence SoT: not set</li>
                  )}
                </ul>
              </div>
            </div>

            <div className="dv-metrics">
              {showPartnership && showIWait && (
                <NumLink section={sections.partnershipBlockedBy} label="I wait on them" />
              )}
              {showPartnership && showTheyWait && (
                <NumLink section={sections.partnershipBlocks} label="They wait on me" />
              )}
              {showLabels && <NumLink section={sections.trainLabels} label="Train labels" />}
              {showCompanion &&
                (sections.companions || []).map((c) => (
                  <NumLink
                    key={`${c.rootKey}-ext`}
                    section={c.external}
                    label={`External · ${c.rootKey}`}
                  />
                ))}
            </div>

            {showPartnership && showIWait && (
              <section className="dv-section">
                <h3>
                  Partnership — I wait on them{' '}
                  <a
                    href={sections.partnershipBlockedBy?.jiraUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={sections.partnershipBlockedBy?.jql}
                  >
                    ({filteredPartnershipBlockedBy.length})
                  </a>
                </h3>
                <IssueTable issues={filteredPartnershipBlockedBy} jiraBaseUrl={jiraBaseUrl} />
              </section>
            )}

            {showPartnership && showTheyWait && (
              <section className="dv-section">
                <h3>
                  Partnership — They wait on me{' '}
                  <a
                    href={sections.partnershipBlocks?.jiraUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={sections.partnershipBlocks?.jql}
                  >
                    ({filteredPartnershipBlocks.length})
                  </a>
                </h3>
                <IssueTable issues={filteredPartnershipBlocks} jiraBaseUrl={jiraBaseUrl} />
              </section>
            )}

            {showLabels && (
              <section className="dv-section">
                <h3>
                  Train labels (dependency = asks){' '}
                  <a
                    href={sections.trainLabels?.jiraUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={sections.trainLabels?.jql}
                  >
                    ({filteredLabels.length})
                  </a>
                </h3>
                <IssueTable issues={filteredLabels} jiraBaseUrl={jiraBaseUrl} />
              </section>
            )}

            {showCompanion &&
              (sections.companions || []).map((c) => (
                <section className="dv-section" key={c.rootKey}>
                  <h3>
                    Companion external — {c.label || c.rootKey}{' '}
                    <a
                      href={c.external?.jiraUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={c.external?.jql}
                    >
                      ({filterIssues(c.external?.issues, { mode, direction, span }).length})
                    </a>
                  </h3>
                  <IssueTable
                    issues={filterIssues(c.external?.issues, { mode, direction, span })}
                    jiraBaseUrl={jiraBaseUrl}
                  />
                </section>
              ))}
          </>
        )}
      </div>
  );
}
