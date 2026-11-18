import React from 'react';
import { formatHeroValue, jiraIssuesHref } from './pulseLink';

/**
 * Pulse hero tile.
 * - Default: count links to JIRA when cell.jql is set.
 * - With onOpen: count opens in-page panel; “Open in JIRA ↗” keeps authenticity.
 */
export default function PulseHero({
  label,
  cell,
  sub,
  title,
  jiraBaseUrl,
  className,
  onOpen,
}) {
  const href = jiraIssuesHref(jiraBaseUrl, cell?.jql);
  const value = formatHeroValue(cell);
  const cls = ['kpi-pulse-hero', className].filter(Boolean).join(' ');
  const showJiraHint = Boolean(href && onOpen);
  const tip =
    title ||
    (onOpen
      ? `Show ${label} in panel`
      : href
        ? `Open ${label} in JIRA`
        : undefined);

  return (
    <div className={cls} title={tip}>
      <div className="label">{label}</div>
      {onOpen ? (
        <button
          type="button"
          className="value kpi-pulse-hero-open"
          onClick={onOpen}
          aria-label={`Show ${label}: ${value}`}
        >
          {value}
        </button>
      ) : href ? (
        <a className="value" href={href} target="_blank" rel="noopener noreferrer">
          {value}
        </a>
      ) : (
        <span className="value">{value}</span>
      )}
      {sub ? <div className="sub">{sub}</div> : null}
      {showJiraHint ? (
        <a
          className="kpi-pulse-hero-jira-hint"
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open ${label} in JIRA`}
          title={`Open ${label} in JIRA`}
        >
          Open in JIRA ↗
        </a>
      ) : null}
    </div>
  );
}
