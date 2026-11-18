### GET /api/jira/sprints
**Purpose**: Sprint route health/list access for sprint report flow.
**Auth**: required

### POST /api/jira/sprints
**Purpose**: Fetch sprint metadata from configured boards.
**Auth**: required (`sprintReport`)

### GET /api/jira/project-components
**Purpose**: Fetch project/component mapping for sprint filtering.
**Auth**: required (`sprintReport`)

### POST /api/jira/sprint-report
**Purpose**: Build sprint report payload for selected sprint.
**Auth**: required (`sprintReport`)

### POST /api/jira/sprint-report-by-range
**Purpose**: Build sprint report payload over custom date range.
**Auth**: required (`sprintReport`)

### POST /api/jira/sprint-kpi-breakdown
**Purpose**: Return KPI breakdown for sprint report visuals.
**Auth**: required (`sprintReport`)

### POST /api/jira/sprint-report-trends
**Purpose**: Return trend series for sprint-level analysis.
**Auth**: required (`sprintReport`)

### GET /api/jira/fields
**Purpose**: Return JIRA field metadata needed for report mapping.
**Auth**: required
