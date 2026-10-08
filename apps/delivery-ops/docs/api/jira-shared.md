### POST /api/jira/validate
**Purpose**: Validate a Feature / Initiative / X-FEAT / Capability key before the Email Sender fetch.
**Auth**: required

**Response**: `{ valid, issueType, summary, status, key, fixVersions }` — `fixVersions` is a comma-separated name list, or `N/A`.

### POST /api/jira/fetch-all-jira-tickets
**Purpose**: Fetch cross-project ticket payload used by multiple pages.
**Auth**: required

### POST /api/jira/fetch-epics
**Purpose**: Fetch epic-level items shared across reporting pages.
**Auth**: required

### POST /api/jira/fetch
**Purpose**: Fetch one Feature / Initiative / X-FEAT / Capability for the Email Sender, including gate dates, document links, risk, and checklist fields.
**Auth**: required

**Request** — Body: `{ jiraKey: string }`

**Response** includes `customfield_55662` (Link to CG checklist), `customfield_55663` (Link to PG checklist), `customfield_47780` (Risk Assessment), and `customfield_55664` (Path to Green), each as `{ name, value }`. Link values use `{ type, display, url }`.

> ⚠️ Breaking change in 2026-10-07: response gained those four fields.

### POST /api/jira/log-user-action
**Purpose**: Persist user interaction telemetry from UI actions.
**Auth**: required
