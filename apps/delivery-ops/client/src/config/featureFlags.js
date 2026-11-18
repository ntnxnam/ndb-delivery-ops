/**
 * Client feature flags — build-time via REACT_APP_* (see ../../../../docs/guides/DEPLOYMENT_FEATURE_FLAGS.md).
 * All digging flags default ON so Slice 1 still testable; set to 'false' to kill-switch.
 */

export const ENABLE_JQL_AUTOCOMPLETE =
  (process.env.REACT_APP_ENABLE_JQL_AUTOCOMPLETE || 'true').toLowerCase() !== 'false';

export const ENABLE_JQL_VALUE_SUGGEST =
  (process.env.REACT_APP_ENABLE_JQL_VALUE_SUGGEST || 'false').toLowerCase() === 'true';

export const ENABLE_JIRA_DIGGING =
  (process.env.REACT_APP_ENABLE_JIRA_DIGGING || 'true').toLowerCase() !== 'false';
