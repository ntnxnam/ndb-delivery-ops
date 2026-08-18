### POST /api/jira/release-versions
**Purpose**: Load release versions for Project Status page selectors.
**Auth**: required (`releaseVersions`)

### POST /api/jira/discover-versions
**Purpose**: Discover candidate versions from JIRA projects.
**Auth**: required (`releaseVersions`)

### POST /api/jira/release-items
**Purpose**: Fetch release payload items for Project Status table.
**Auth**: required (`releaseVersions`)

### POST /api/jira/release-items-tcms
**Purpose**: Fetch release items with TCMS enrichment for quality views.
**Auth**: required (`releaseVersions`)

### POST /api/jira/risk-indicator-changes
**Purpose**: Return risk-indicator change history for release snapshots.
**Auth**: required (`releaseVersions`)

### PUT /api/jira/update-executive-summary
**Purpose**: Persist user-edited executive summary content.
**Auth**: required (`releaseVersions`)

### GET /api/jira/executive-summary-unified
**Purpose**: Return unified summary data for release dashboard render.
**Auth**: required

### GET /api/jira/p0-bugs
**Purpose**: Fetch P0 bugs for release health surfacing.
**Auth**: required
