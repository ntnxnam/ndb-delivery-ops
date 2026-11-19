import React from 'react';

/**
 * JCH fallback banner shown when fixVersion creation fails.
 * Secondary CTA (outline) to avoid competing with primary green action.
 * Why: orange #ff9800 on white fails contrast; secondary passes 4.5:1.
 */
export function JchFallbackBanner({ projectKey, errorDetail, jchState, onFileJch }) {
  const isCreating = jchState?.state === 'creating';
  const isCreated = jchState?.state === 'created';
  const isError = jchState?.state === 'error';

  return (
    <div
      role="alert"
      aria-live="polite"
      className="jch-fallback-banner"
      style={{ margin: '8px 0', padding: '8px 10px', background: '#fff3cd', borderRadius: 4, fontSize: '0.8rem', border: '1px solid #ffc107', maxWidth: '100%', overflowWrap: 'anywhere' }}
    >
      <div style={{ marginBottom: 6, color: '#856404' }}>
        ⚠ Could not create version in {projectKey}. File a JCH ticket to request it from project admins.
      </div>
      {errorDetail && (
        <details style={{ marginBottom: 8, fontSize: '0.75rem', color: '#6c757d' }}>
          <summary style={{ cursor: 'pointer' }}>Show error detail</summary>
          <div style={{ marginTop: 4, wordBreak: 'break-word' }}>{errorDetail}</div>
        </details>
      )}
      {!isCreated ? (
        <button
          onClick={onFileJch}
          disabled={isCreating}
          aria-busy={isCreating}
          aria-disabled={isCreating}
          style={{ padding: '6px 14px', backgroundColor: '#fff', color: '#8c3b00', border: '1px solid #e65100', borderRadius: 4, cursor: isCreating ? 'not-allowed' : 'pointer', fontSize: '0.78rem', maxWidth: '100%', whiteSpace: 'normal', lineHeight: 1.3 }}
        >
          {isCreating ? 'Filing…' : `↗ File JCH ticket to create version in ${projectKey}`}
        </button>
      ) : (
        <div style={{ color: '#155724', background: '#d4edda', padding: '6px 8px', borderRadius: 4 }}>
          JCH ticket created:{' '}
          {jchState.url ? (
            <a href={jchState.url} target="_blank" rel="noreferrer" style={{ textDecoration: 'underline' }} aria-label={`Open ${jchState.key} in JIRA`}>
              {jchState.key}
            </a>
          ) : (
            jchState.key
          )}
        </div>
      )}
      {isError && <div style={{ color: '#dc3545', marginTop: 6 }}>{jchState.error}</div>}
    </div>
  );
}
