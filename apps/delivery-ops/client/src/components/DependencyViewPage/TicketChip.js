import React from 'react';
import { browseUrl, hasTrainAskLabel } from './hygiene';

const MATRIX_TYPES = new Set(['global_ew', 'nutanix_ew', 'ndb_ew']);

function shortSummary(summary, max = 72) {
  const s = String(summary || '').trim();
  if (!s) return '(no summary)';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function fixVersionLabel(issue) {
  const real = issue.commitFixVersions;
  if (Array.isArray(real) && real.length) return real.join(', ');
  const raw = issue.fixVersions;
  if (Array.isArray(raw) && raw.length) return raw.join(', ');
  return null;
}

function statusTone(status) {
  const s = String(status || '').toLowerCase();
  if (!s) return 'unknown';
  if (s.includes('closed') || s.includes('done') || s.includes('resolved') || s.includes('complete')) {
    return 'done';
  }
  if (s.includes('block') || s.includes('imped')) return 'blocked';
  if (s.includes('progress') || s.includes('review') || s.includes('test') || s.includes('execute')) {
    return 'active';
  }
  if (s.includes('open') || s.includes('to do') || s.includes('backlog') || s.includes('new')) {
    return 'open';
  }
  return 'other';
}

/** Hierarchy target date: Code Complete / Due / Sprint end (inferred). */
export function targetDateMeta(issue) {
  if (!issue) return null;
  const date = issue.targetDate || issue.endDate || null;
  if (!date) return null;
  const source = issue.targetDateSource || (issue.barKind === 'sprint_inferred' ? 'sprint_end' : null);
  const label =
    issue.targetDateLabel ||
    (source === 'code_complete'
      ? 'Code Complete'
      : source === 'sprint_end'
        ? 'Sprint end'
        : source === 'due_date'
          ? 'Due date'
          : 'Target');
  const inferred = source === 'sprint_end';
  const sprintHint = inferred && issue.sprintName ? ` (${issue.sprintName})` : '';
  return {
    date,
    source: source || 'unknown',
    label,
    inferred,
    text: inferred ? `${label}: ${date}${sprintHint}` : `${label}: ${date}`,
  };
}

/**
 * Story-first chip: summary + status + fixVersion + commitment — key is secondary.
 */
export default function TicketChip({
  issue,
  jiraBaseUrl,
  showAskFlags = true,
  emphasize = false,
}) {
  const spanId = issue.spanInfo?.id || issue.span || 'team_internal';
  const fyi = !MATRIX_TYPES.has(String(spanId));
  const nature = issue.commitNature || issue.releaseCommit || null;
  const clean = issue.commitState === 'clean';
  const missingAsk = showAskFlags && !hasTrainAskLabel(issue);
  const hy = issue.commitHygiene;
  const summary = shortSummary(issue.summary);
  const fv = fixVersionLabel(issue);
  const status = String(issue.status || '').trim();
  const issueType = String(issue.issueType || '').trim();
  const dateMeta = targetDateMeta(issue);

  const flagBits = [];
  if (missingAsk) flagBits.push('no ask label');
  if (hy === 'partner_missing_fixversion') flagBits.push('Commit/Stretch without real fixVersion');
  if (hy === 'partner_missing_release_commit') flagBits.push('fixVersion set, Release Commit blank');
  if (fyi) flagBits.push('FYI — not an EW matrix cell');
  const spanSource = issue.spanInfo?.source;
  const inferred =
    spanSource && spanSource !== 'jira_label' && spanSource !== 'no_ew_label'
      ? `Parked via ${String(spanSource).replace(/_/g, ' ')}`
      : null;
  if (inferred) flagBits.push(inferred);
  if (dateMeta?.inferred) {
    flagBits.push(
      `Due inferred from sprint end${issue.sprintName ? ` (${issue.sprintName})` : ''}`
    );
  }

  return (
    <a
      className={`dv-chip${fyi ? ' dv-chip--fyi' : ''}${hy || missingAsk ? ' dv-chip--hygiene' : ''}${
        emphasize ? ' dv-chip--linked' : ''
      }`}
      href={browseUrl(jiraBaseUrl, issue.key)}
      target="_blank"
      rel="noopener noreferrer"
      title={[
        issue.summary || '',
        issue.key,
        status ? `Status: ${status}` : '',
        issueType ? `Type: ${issueType}` : '',
        dateMeta ? dateMeta.text : 'No target date',
        fv ? `fixVersion: ${fv}` : 'No real fixVersion',
        nature ? `Release Commit: ${nature}` : 'Release Commit blank',
        issue.spanInfo?.label || '',
        inferred,
        ...flagBits.filter((b) => b !== inferred),
      ]
        .filter(Boolean)
        .join('\n')}
    >
      <span className="dv-chip-sum">{summary}</span>
      <span className="dv-chip-meta">
        {status ? (
          <span className={`dv-status dv-status--${statusTone(status)}`}>{status}</span>
        ) : (
          <span className="dv-status dv-status--unknown">no status</span>
        )}
        {issueType ? <span className="dv-issuetype">{issueType}</span> : null}
        {dateMeta ? (
          <span
            className={`dv-date dv-date--${dateMeta.source}${dateMeta.inferred ? ' dv-date--inferred' : ''}`}
          >
            {dateMeta.text}
          </span>
        ) : (
          <span className="dv-date dv-date--missing">no target date</span>
        )}
        {fv ? <span className="dv-fv">fixVersion: {fv}</span> : <span className="dv-fv missing">no fixVersion</span>}
        <span className={`dv-nature${clean ? ' ok' : ' ask'}`}>
          {nature ? `Commit: ${nature}` : 'Commit: blank'}
        </span>
        {issue.spanInfo?.short ? (
          <span className={`dv-type dv-type--${spanId}`}>{issue.spanInfo.short}</span>
        ) : null}
        {inferred ? <span className="dv-flag">{inferred}</span> : null}
        {!inferred && flagBits.length ? <span className="dv-flag">{flagBits[0]}</span> : null}
        <span className="dv-chip-key" aria-hidden="true">
          {issue.key}
        </span>
      </span>
    </a>
  );
}
