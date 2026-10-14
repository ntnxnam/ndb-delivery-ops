import React from 'react';
import {
  formatCommitVia,
  formatWaitSentence,
  getLinkTypeLabels,
  getWaitContext,
} from './partnershipContext';

function KeyLink({ issueKey, jiraBaseUrl, children }) {
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/+$/, '');
  return (
    <a href={`${base}/browse/${issueKey}`} target="_blank" rel="noopener noreferrer">
      {children || issueKey}
    </a>
  );
}

function SpanBadge({ spanInfo }) {
  if (!spanInfo?.id) return <span className="dv-meta">—</span>;
  return (
    <span
      className={`dv-span-badge dv-span-badge--${spanInfo.id}`}
      title={
        spanInfo.jiraLabel
          ? `${spanInfo.hint || spanInfo.label} · JIRA label: ${spanInfo.jiraLabel}`
          : spanInfo.hint || spanInfo.label
      }
    >
      {spanInfo.short || spanInfo.label}
    </span>
  );
}

function ModeBadge({ operationMode }) {
  if (!operationMode?.id || operationMode.id === 'unknown') {
    return <span className="dv-meta">—</span>;
  }
  return (
    <span
      className={`dv-mode-badge dv-mode-badge--${operationMode.id}`}
      title={operationMode.hint || operationMode.label}
    >
      {operationMode.label}
    </span>
  );
}

const TEAM_INTERNAL_SPAN = {
  id: 'team_internal',
  short: 'Team',
  label: 'Team internal',
  jiraLabel: null,
  hint: 'No global-ew / nutanix-ew / ndb-ew label — treated as team-internal.',
};

function SpanCell({ issue }) {
  const info = issue.spanInfo?.id
    ? issue.spanInfo
    : issue.span
      ? { id: issue.span, short: issue.span, label: issue.span }
      : TEAM_INTERNAL_SPAN;
  return (
    <td className="dv-span-cell dv-col-span">
      <SpanBadge spanInfo={info} />
      {info.jiraLabel ? <div className="dv-meta">label: {info.jiraLabel}</div> : null}
    </td>
  );
}

function WaitContextCell({ issue, direction, jiraBaseUrl }) {
  const theirKey = issue.key;
  const ctx = getWaitContext(issue, direction);
  if (!ctx.length) {
    return (
      <td className="dv-wait-ctx dv-wait-ctx--empty dv-col-wait">
        {direction === 'i_wait_on_them'
          ? `Could not see which of my tickets is waiting on ${theirKey}`
          : `Could not see which of my tickets ${theirKey} is waiting on`}
      </td>
    );
  }
  return (
    <td className="dv-wait-ctx dv-col-wait">
      <ul className="dv-wait-ctx-list">
        {ctx.slice(0, 4).map((c) => (
          <li key={c.key}>
            {direction === 'i_wait_on_them' ? (
              <>
                <span className="dv-wait-ctx-phrase">My</span>{' '}
                <KeyLink issueKey={c.key} jiraBaseUrl={jiraBaseUrl} />
                {c.summary ? <span className="dv-wait-ctx-sum"> — {c.summary}</span> : null}
                <span className="dv-wait-ctx-phrase"> is waiting on </span>
                <KeyLink issueKey={theirKey} jiraBaseUrl={jiraBaseUrl} />
              </>
            ) : (
              <>
                <span className="dv-wait-ctx-phrase">Their </span>
                <KeyLink issueKey={theirKey} jiraBaseUrl={jiraBaseUrl} />
                <span className="dv-wait-ctx-phrase"> is waiting on my </span>
                <KeyLink issueKey={c.key} jiraBaseUrl={jiraBaseUrl} />
                {c.summary ? <span className="dv-wait-ctx-sum"> — {c.summary}</span> : null}
              </>
            )}
            <span className="dv-sr-only">
              {formatWaitSentence(c.key, theirKey, direction, c.summary)}
            </span>
          </li>
        ))}
        {ctx.length > 4 ? (
          <li className="dv-meta">+{ctx.length - 4} more links on the ticket</li>
        ) : null}
      </ul>
    </td>
  );
}

function CommitCell({ issue, variant }) {
  const committed = issue.commitState === 'committed';
  const viaLabel = formatCommitVia(issue);
  const linkTypes = getLinkTypeLabels(
    issue,
    variant === 'i_wait_on_them' || variant === 'they_wait_on_me' ? variant : null
  );
  const fvTip =
    Array.isArray(issue.commitFixVersions) && issue.commitFixVersions.length
      ? `fixVersions: ${issue.commitFixVersions.join(', ')}`
      : '';
  const fieldTip = issue.releaseCommit ? `Release Commit field: ${issue.releaseCommit}` : '';
  const tip = [fvTip, fieldTip, linkTypes.length ? `Link type: ${linkTypes.join(', ')}` : '']
    .filter(Boolean)
    .join('\n');

  return (
    <td className="dv-col-commit" title={tip || undefined}>
      <span className={`dv-pill ${committed ? 'committed' : 'ask'}`}>
        {committed ? 'Committed' : 'Ask'}
      </span>
      {viaLabel ? <div className="dv-commit-via">{viaLabel}</div> : null}
      {!committed && !viaLabel ? <div className="dv-commit-via dv-meta">no fixVersion / field</div> : null}
      {linkTypes.slice(0, 2).map((lt) => (
        <div key={lt} className="dv-commit-linktype" title={`JIRA link type: ${lt}`}>
          {lt}
        </div>
      ))}
      {linkTypes.length > 2 ? (
        <div className="dv-meta">+{linkTypes.length - 2} link types</div>
      ) : null}
    </td>
  );
}

/**
 * @param {'default'|'i_wait_on_them'|'they_wait_on_me'} [variant]
 */
export default function IssueTable({ issues, jiraBaseUrl, variant = 'default' }) {
  if (!issues?.length) {
    return <div className="dv-empty">No issues in this section.</div>;
  }
  const partnership = variant === 'i_wait_on_them' || variant === 'they_wait_on_me';
  const whyHeader =
    variant === 'i_wait_on_them'
      ? 'Plain English — my ticket waiting on theirs'
      : variant === 'they_wait_on_me'
        ? 'Plain English — their ticket waiting on mine'
        : null;

  const partnershipModeFallback = {
    id: 'partnership',
    label: 'Partnership',
    hint: 'Linked via JIRA issue link (blocks / is blocked by).',
  };

  return (
    <div className="dv-table-wrap">
      {partnership ? (
        <p className="dv-table-hint">
          Mode = Partnership (JIRA link). Partner type = EW only (
          <code>global-ew</code> / <code>nutanix-ew</code> / <code>ndb-ew</code> / team). Train
          labels on our tickets are a separate Show filter — not Partner type.
        </p>
      ) : null}
      <table className={`dv-table${partnership ? ' dv-table--partnership' : ''}`}>
        <thead>
          <tr>
            <th className="dv-col-key">{partnership ? 'Their ticket' : 'Key'}</th>
            <th className="dv-col-summary">Summary</th>
            <th className="dv-col-mode" title="Partnership = JIRA link; Companionship = under our epic">
              Mode
            </th>
            <th
              className="dv-col-span"
              title="Partner EW type via *-ew labels only — not train-dep / asks / wishlist"
            >
              Partner type
            </th>
            {whyHeader ? <th className="dv-wait-ctx-th dv-col-wait">{whyHeader}</th> : null}
            <th className="dv-col-status">Status</th>
            <th className="dv-col-project">Project</th>
            <th className="dv-col-assignee">Assignee</th>
            <th
              className="dv-col-commit"
              title="Ask vs Committed (fixVersion and/or Release Commit field) · JIRA link type name"
            >
              Commit
            </th>
          </tr>
        </thead>
        <tbody>
          {issues.map((iss) => {
            const mode =
              iss.operationMode?.id && iss.operationMode.id !== 'unknown'
                ? iss.operationMode
                : partnership
                  ? partnershipModeFallback
                  : iss.operationMode;
            return (
              <tr key={iss.key}>
                <td className="dv-col-key">
                  <KeyLink issueKey={iss.key} jiraBaseUrl={jiraBaseUrl} />
                </td>
                <td className="summary dv-col-summary">{iss.summary}</td>
                <td className="dv-col-mode">
                  <ModeBadge operationMode={mode} />
                </td>
                <SpanCell issue={iss} />
                {partnership ? (
                  <WaitContextCell issue={iss} direction={variant} jiraBaseUrl={jiraBaseUrl} />
                ) : null}
                <td className="dv-col-status">{iss.status}</td>
                <td className="dv-col-project">{iss.project}</td>
                <td className="dv-col-assignee">{iss.assignee || '—'}</td>
                <CommitCell issue={iss} variant={variant} />
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
