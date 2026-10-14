import React from 'react';
import IssueTable from './IssueTable';

/**
 * Collapsed-by-default ticket list. Summary stays visible; expand only when drilling in.
 */
export default function CollapsibleIssueSection({
  title,
  count,
  jiraUrl,
  jql,
  issues,
  jiraBaseUrl,
  meta,
  variant = 'default',
  defaultOpen = false,
}) {
  const n = count != null ? count : issues?.length || 0;
  return (
    <details className="dv-collapse" {...(defaultOpen ? { open: true } : {})}>
      <summary className="dv-collapse-summary">
        <span className="dv-collapse-title">{title}</span>
        {jiraUrl ? (
          <a
            className="dv-collapse-count"
            href={jiraUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={jql || ''}
            onClick={(e) => e.stopPropagation()}
          >
            ({n})
          </a>
        ) : (
          <span className="dv-collapse-count">({n})</span>
        )}
        {meta ? <span className="dv-meta">{meta}</span> : null}
        <span className="dv-collapse-hint">{n ? 'Expand tickets' : 'Empty'}</span>
      </summary>
      <div className="dv-collapse-body">
        <IssueTable issues={issues} jiraBaseUrl={jiraBaseUrl} variant={variant} />
      </div>
    </details>
  );
}
