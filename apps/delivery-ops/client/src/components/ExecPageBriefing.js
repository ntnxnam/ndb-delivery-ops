/**
 * ExecPageBriefing — top-of-page "What ails the team" band for exec audience.
 * Neutral chrome (no triple RAG colouring). Story-first.
 */
import React from 'react';
import { SummaryBody } from './Oncalls/OncallsParts';

const JIRA_BASE = 'https://jira.nutanix.com';

const bandStyle = {
  marginBottom: '0.75rem',
  border: '1px solid #dee2e6',
  borderRadius: 8,
  background: '#f8f9fa',
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.5rem',
  padding: '0.4rem 0.75rem',
  borderBottom: '1px solid #dee2e6',
  background: '#f8f9fa',
  fontSize: '0.8125rem',
  fontWeight: 600,
  color: '#212529',
};

const bodyStyle = {
  padding: '0.65rem 0.75rem',
  fontSize: '0.875rem',
  lineHeight: 1.45,
  color: '#212529',
};

/**
 * @param {object} props
 * @param {'idle'|'loading'|'done'|'error'} props.state
 * @param {string|null} props.summary
 * @param {object|null} [props.meta]
 * @param {string|null} [props.error]
 * @param {() => void} [props.onRetry]
 * @param {string} [props.title]
 * @param {string} [props.jiraBase]
 */
export default function ExecPageBriefing({
  state,
  summary,
  meta,
  error,
  onRetry,
  title = 'What ails the team',
  jiraBase = JIRA_BASE,
}) {
  if (state === 'idle') return null;

  return (
    <section style={bandStyle} aria-label={title} data-testid="exec-page-briefing">
      <div style={headerStyle}>
        <span>{title}</span>
        <span style={{ fontWeight: 500, color: '#6c757d', fontSize: '0.75rem' }}>
          {state === 'loading' && 'Generating…'}
          {state === 'error' && 'Unavailable'}
        </span>
      </div>
      <div style={bodyStyle}>
        {state === 'loading' && (
          <div style={{ color: '#6c757d' }}>
            Building an executive skim from multiple signals…
          </div>
        )}
        {state === 'error' && (
          <div>
            <div style={{ color: '#c92a2a', marginBottom: 6 }}>{error || 'Briefing failed'}</div>
            {onRetry ? (
              <button
                type="button"
                onClick={onRetry}
                style={{
                  minHeight: '2rem',
                  padding: '0.375rem 0.875rem',
                  fontSize: '0.8125rem',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            ) : null}
          </div>
        )}
        {state === 'done' && summary ? (
          <SummaryBody summary={summary} jiraBase={jiraBase} />
        ) : null}
        {state === 'done' && !summary ? (
          <div style={{ color: '#6c757d' }}>Nothing to escalate for this view.</div>
        ) : null}
      </div>
    </section>
  );
}
