export const STATUS = {
  PENDING: 'pending',
  CHECKING: 'checking',
  EXISTS: 'exists',
  MISSING: 'missing',
  CREATING: 'creating',
  CREATED: 'created',
  SKIPPED: 'skipped',
  ERROR: 'error',
  WILL_RENAME: 'will-rename',
  RENAMED: 'renamed',
  WILL_UPDATE_JQL: 'will-update-jql',
  UPDATED: 'updated',
  CONFLICT: 'skipped-conflict',
  OK: 'ok-no-change',
};

export const statusLabel = (s) => {
  switch (s) {
    case STATUS.PENDING: return '\u2014';
    case STATUS.CHECKING: return 'Checking\u2026';
    case STATUS.EXISTS: return 'Already exists';
    case STATUS.MISSING: return 'Missing';
    case STATUS.CREATING: return 'Creating\u2026';
    case STATUS.CREATED: return 'Created';
    case STATUS.SKIPPED: return 'Skipped';
    case STATUS.ERROR: return 'Error';
    case STATUS.WILL_RENAME: return 'Will rename';
    case STATUS.RENAMED: return 'Renamed';
    case STATUS.WILL_UPDATE_JQL: return 'Will update JQL';
    case STATUS.UPDATED: return 'Updated';
    case STATUS.CONFLICT: return 'Conflict (skipped)';
    case STATUS.OK: return 'No change needed';
    default: return s || '';
  }
};

export const statusColor = (s) => {
  switch (s) {
    case STATUS.EXISTS:
    case STATUS.CREATED:
    case STATUS.RENAMED:
    case STATUS.UPDATED:
    case STATUS.OK:
      return '#28a745';
    case STATUS.MISSING:
    case STATUS.WILL_RENAME:
    case STATUS.WILL_UPDATE_JQL:
      return '#ffc107';
    case STATUS.ERROR:
    case STATUS.CONFLICT:
      return '#dc3545';
    case STATUS.SKIPPED: return '#6c757d';
    case STATUS.CHECKING:
    case STATUS.CREATING:
      return '#007bff';
    default: return '#aaa';
  }
};

export const statusIcon = (s) => {
  switch (s) {
    case STATUS.EXISTS:
    case STATUS.CREATED:
    case STATUS.RENAMED:
    case STATUS.UPDATED:
    case STATUS.OK:
      return '\u2713';
    case STATUS.MISSING:
    case STATUS.WILL_RENAME:
    case STATUS.WILL_UPDATE_JQL:
      return '\u25CB';
    case STATUS.ERROR:
    case STATUS.CONFLICT:
      return '\u2717';
    case STATUS.SKIPPED: return '\u2014';
    case STATUS.CHECKING:
    case STATUS.CREATING:
      return '\u21BB';
    default: return '';
  }
};

export const cardStyle = {
  border: '1px solid #ddd',
  borderRadius: '6px',
  padding: '16px',
  marginBottom: '12px',
  background: '#fff',
};

export const sectionHeading = {
  fontSize: '1rem',
  fontWeight: 600,
  margin: '20px 0 10px 0',
  borderBottom: '1px solid #e0e0e0',
  paddingBottom: '6px',
};
