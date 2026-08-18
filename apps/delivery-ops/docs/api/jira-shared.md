### POST /api/jira/validate
**Purpose**: Validate JIRA credentials and session token before page operations.
**Auth**: required

### POST /api/jira/fetch-all-jira-tickets
**Purpose**: Fetch cross-project ticket payload used by multiple pages.
**Auth**: required

### POST /api/jira/fetch-epics
**Purpose**: Fetch epic-level items shared across reporting pages.
**Auth**: required

### POST /api/jira/fetch
**Purpose**: Generic issue fetch endpoint used by multiple UI pages.
**Auth**: required

### POST /api/jira/log-user-action
**Purpose**: Persist user interaction telemetry from UI actions.
**Auth**: required
