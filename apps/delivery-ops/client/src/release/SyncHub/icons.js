import React from 'react';

export const RefreshIcon = ({ spinning = false }) => (
  <svg
    width="12" height="12" viewBox="0 0 13 13" fill="none" aria-hidden="true"
    style={spinning ? { animation: 'sh-spin 0.9s linear infinite' } : undefined}
  >
    <path d="M2.5 6.5a4 4 0 0 1 7-2.7M10.5 6.5a4 4 0 0 1-7 2.7"
      stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    <path d="M9.1 2.5l1.2 1.3-1.6.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3.9 10.5l-1.2-1.3 1.6-.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const SyncAllIcon = () => (
  <svg width="13" height="13" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M2 7a5 5 0 0 1 9.2-2.7M12 7a5 5 0 0 1-9.2 2.7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M10 3l1.5 1.3-1.8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M4 11L2.5 9.7l1.8-.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const ErrorIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="7" fill="#e03131" />
    <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);
