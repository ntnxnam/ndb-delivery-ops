import React from 'react';
import './PageLoading.css';

/**
 * First-paint loading state: rolling spinner + short message.
 * Render only while a page has no primary data yet (`loading && !data`).
 */
export const PageLoading = ({ message = 'Loading…', inline = false, className = '' }) => (
  <div
    className={`page-loading${inline ? ' page-loading--inline' : ''} ${className}`.trim()}
    role="status"
    aria-live="polite"
  >
    <span className="page-loading__ring" aria-hidden="true" />
    <span className="page-loading__text">{message}</span>
  </div>
);

export default PageLoading;
