import React, { useMemo } from 'react';
import { formatWaitChipLabel, formatWaitContextLine } from './partnershipContext';

const CHIP_CAP = 10;

function browseUrl(jiraBaseUrl, key) {
  const base = String(jiraBaseUrl || 'https://jira.nutanix.com').replace(/\/+$/, '');
  return `${base}/browse/${key}`;
}

function Chip({ issue, jiraBaseUrl, waitDirection }) {
  const ask = issue.commitState !== 'committed';
  const waitLabel = waitDirection ? formatWaitChipLabel(issue, waitDirection) : '';
  const spanInfo = issue.spanInfo;
  const tip = [
    `${issue.key}: ${issue.summary || ''}`,
    issue.operationMode ? `Mode: ${issue.operationMode.label}` : '',
    spanInfo
      ? `Partner type: ${spanInfo.label}${spanInfo.jiraLabel ? ` (${spanInfo.jiraLabel})` : ' (team internal)'}`
      : '',
    ask ? 'Ask (not committed)' : 'Committed',
    waitDirection ? formatWaitContextLine(issue, waitDirection) : '',
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <a
      className={`dv-swim-chip ${ask ? 'ask' : 'committed'}`}
      href={browseUrl(jiraBaseUrl, issue.key)}
      target="_blank"
      rel="noopener noreferrer"
      title={tip}
    >
      <span className="dv-swim-chip-key">{issue.key}</span>
      {spanInfo?.short ? (
        <span
          className={`dv-span-badge dv-span-badge--${spanInfo.id}`}
          title={spanInfo.hint || spanInfo.label}
        >
          {spanInfo.short}
        </span>
      ) : null}
      {waitLabel ? <span className="dv-swim-chip-wait">{waitLabel}</span> : null}
      <span className={`dv-pill ${ask ? 'ask' : 'committed'}`}>{ask ? 'Ask' : 'Ok'}</span>
    </a>
  );
}

function Lane({
  id,
  title,
  subtitle,
  issues,
  jiraBaseUrl,
  jiraUrl,
  jql,
  tone,
  emptyHint,
  waitDirection,
}) {
  const list = issues || [];
  const shown = list.slice(0, CHIP_CAP);
  const extra = list.length - shown.length;

  return (
    <div className={`dv-swim-lane dv-swim-lane--${tone || 'neutral'}`} data-lane={id}>
      <div className="dv-swim-lane-label">
        <div className="dv-swim-lane-title">{title}</div>
        {subtitle ? <div className="dv-swim-lane-sub">{subtitle}</div> : null}
        <div className="dv-swim-lane-count">
          {jiraUrl ? (
            <a href={jiraUrl} target="_blank" rel="noopener noreferrer" title={jql || ''}>
              {list.length}
            </a>
          ) : (
            list.length
          )}
        </div>
      </div>
      <div className="dv-swim-lane-body">
        {!list.length ? (
          <span className="dv-empty">{emptyHint || 'None for current filters.'}</span>
        ) : (
          <>
            {shown.map((iss) => (
              <Chip
                key={iss.key}
                issue={iss}
                jiraBaseUrl={jiraBaseUrl}
                waitDirection={waitDirection}
              />
            ))}
            {extra > 0 ? (
              <span className="dv-swim-more" title="Expand ticket tables below for the full list">
                +{extra} more
              </span>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Swimlane flowchart — primary mental model for Dependency View.
 * Lanes = who waits on whom + hygiene (orphans / label-only).
 */
export default function DependencySwimlanes({
  jiraBaseUrl,
  sections,
  showWishlist,
  showPartnership,
  showIWait,
  showTheyWait,
  filtered,
}) {
  const lanes = useMemo(() => {
    const out = [];
    if (showPartnership && showIWait) {
      out.push({
        id: 'i-wait',
        title: 'I wait on them',
        subtitle: 'Partnership · “my X is waiting on this”',
        tone: 'upstream',
        waitDirection: 'i_wait_on_them',
        issues: filtered?.partnershipBlockedBy || [],
        jiraUrl: sections?.partnershipBlockedBy?.jiraUrl,
        jql: sections?.partnershipBlockedBy?.jql,
        emptyHint: 'No upstream partnership blockers.',
      });
    }
    if (showWishlist) {
      out.push({
        id: 'wishlist',
        title: 'NDB wishlist asks',
        subtitle: 'Pre-commit · linked parents',
        tone: 'wishlist',
        issues: filtered?.wishlist || [],
        jiraUrl: sections?.wishlist?.jiraUrl,
        jql: sections?.wishlist?.jql,
        emptyHint: 'No linked wishlist items.',
      });
      out.push({
        id: 'partners',
        title: 'Partner responses',
        subtitle: 'Linked from wishlist',
        tone: 'partner',
        issues: filtered?.wishlistLinked || [],
        jiraUrl: sections?.wishlistLinked?.jiraUrl,
        jql: sections?.wishlistLinked?.jql,
        emptyHint: 'No linked partners yet.',
      });
    }
    if (showPartnership && showTheyWait) {
      out.push({
        id: 'they-wait',
        title: 'They wait on me',
        subtitle: 'Partnership · “waiting on my X”',
        tone: 'downstream',
        waitDirection: 'they_wait_on_me',
        issues: filtered?.partnershipBlocks || [],
        jiraUrl: sections?.partnershipBlocks?.jiraUrl,
        jql: sections?.partnershipBlocks?.jql,
        emptyHint: 'Nothing partners are waiting on from us.',
      });
    }
    if (showWishlist) {
      out.push({
        id: 'hygiene',
        title: 'Needs a link',
        subtitle: 'Label-only · orphans',
        tone: 'warn',
        issues: [
          ...(filtered?.wishlistUnlinked || []),
          ...(filtered?.partnerOrphans || []),
        ],
        jiraUrl: sections?.partnerOrphans?.jiraUrl || sections?.wishlistUnlinked?.jiraUrl,
        jql: sections?.partnerOrphans?.jql,
        emptyHint: 'No orphans or label-only rows.',
      });
    }
    return out;
  }, [
    showWishlist,
    showPartnership,
    showIWait,
    showTheyWait,
    filtered,
    sections,
  ]);

  if (!lanes.length) {
    return (
      <div className="dv-empty">No swimlanes for the current Mode / Direction filters.</div>
    );
  }

  return (
    <div className="dv-swimlanes" aria-label="Dependency swimlanes">
      <div className="dv-swim-flow-hint" aria-hidden="true">
        <span>Upstream</span>
        <span className="dv-swim-flow-arrow">→</span>
        <span>NDB asks</span>
        <span className="dv-swim-flow-arrow">→</span>
        <span>Partners</span>
        <span className="dv-swim-flow-arrow">→</span>
        <span>We owe</span>
        <span className="dv-swim-flow-arrow">→</span>
        <span>Hygiene</span>
      </div>
      {lanes.map((lane) => (
        <Lane key={lane.id} {...lane} jiraBaseUrl={jiraBaseUrl} />
      ))}
    </div>
  );
}
