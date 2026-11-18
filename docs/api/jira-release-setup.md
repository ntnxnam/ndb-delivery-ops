### POST /api/jira/check-version-exists
**Purpose**: Validate version existence before create/rename operations.
**Auth**: required (`releaseSetup`)

### POST /api/jira/create-version
**Purpose**: Create a release version in JIRA.
**Auth**: required (`releaseSetup`)

### POST /api/jira/check-filter-exists
**Purpose**: Validate filter existence before creation.
**Auth**: required (`releaseSetup`)

### POST /api/jira/create-filter
**Purpose**: Create saved JIRA filters for release workflows.
**Auth**: required (`releaseSetup`)

### POST /api/jira/rename-release-cascade
**Purpose**: Rename release references across dependent assets.
**Auth**: required (`releaseSetup`)

### POST /api/jira/cleanup-duplicate-prefix-filters
**Purpose**: Remove duplicate filters created during setup iterations.
**Auth**: required (`releaseSetup`)
