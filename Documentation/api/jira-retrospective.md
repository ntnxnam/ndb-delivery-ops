### POST /api/jira/checkpoint-history
**Purpose**: Return checkpoint/gate history used by retrospective analyses.
**Auth**: required

### GET /api/jira/test-changelog/:key
**Purpose**: Fetch issue changelog details for retrospective diagnostics.
**Auth**: required

### POST /api/jira/release-items-history
**Purpose**: Return historical release-item snapshots for retrospective deltas.
**Auth**: required (`releaseVersions`)
