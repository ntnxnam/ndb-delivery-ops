# Team Overall Report Page — Data Layer

## Backend Endpoint
`GET /api/reports/team-overall`

## Query Parameters
| Param | Type | Default | Description |
|---|---|---|---|
| `teamId` | string | `ndb` | Team identifier from teamBoardConfig.json |
| `periodType` | string | `quarter` | `quarter`, `year`, or `custom` |
| `quarter` | string | — | `YYYY-QN` (e.g., `2025-Q2`) |
| `year` | string | — | Year for `year` period type |
| `startDate` | string | — | ISO date for `custom` period type |
| `endDate` | string | — | ISO date for `custom` period type |
| `inclusionMode` | string | `closed` | `closed`, `touched`, or `worklogged` |
| `groupBy` | string | `issuetype` | `issuetype`, `status`, `priority`, or `assignee` |
| `includeCompanions` | boolean | `true` | Include companion project issues |
| `multiProject` | boolean | `true` | Multi-project scope toggle |
| `summarizeWithNAI` | boolean | `true` | Request NAI summaries |
| `forceRefresh` | boolean | `false` | Bypass cache |
| `username` | string | — | Nutanix username (from auth) |

## Response DTO
```json
{
  "meta": {
    "teamId": "ndb",
    "teamDisplayName": "NDB",
    "baseFilter": "filter=NDB-All-Base-Filter and statusCategory!=Done",
    "jqlExecuted": "...",
    "period": { "type": "quarter", "label": "...", "start": "2025-04-01", "end": "2025-06-30" },
    "inclusionMode": "closed",
    "groupBy": "issuetype",
    "generatedAt": "ISO timestamp",
    "generatedBy": "username",
    "issueCount": 2000,
    "isCached": false,
    "jiraBaseUrl": "https://jira.nutanix.com",
    "companionProjects": ["TECHPUBS", "SDL", "LEG", "SR", "NDBQUAL"],
    "primaryIssueCount": 2000,
    "companionIssueCount": 2000,
    "multiProjectEnabled": true
  },
  "kpis": {
    "totalIssues": 4000,
    "totalStoryPoints": 1234,
    "byStatus": { "Closed": 4000 },
    "avgCycleTimeDays": 15,
    "throughputPerWeek": 42.5
  },
  "aggregation": {
    "groups": [{ "key": "Story", "label": "Story", "count": 2000, "percentage": 50, "storyPoints": 500, "issues": [], "avgCycleTimeDays": 14 }],
    "totalGroups": 5
  },
  "timeline": { "buckets": [] },
  "issuesSample": [{ "key": "ERA-1", "summary": "...", "issuetype": "Story", "status": "Closed", "priority": "Major", "assignee": "Alice", "created": "...", "updated": "...", "resolved": "...", "storyPoints": 5, "fixVersion": ["NDB-2.12"], "integratedVersion": [], "parentKey": null, "url": "https://jira.nutanix.com/browse/ERA-1", "sourceProject": "ERA" }],
  "naiSummaries": []
}
```

## Cache
- TTL: 5 minutes (in-memory Map)
- Key: JSON of all query params
- Bypass: `forceRefresh=true`
- Invalidation: `POST /api/reports/team-overall/invalidate` with optional `cacheKey`

## Multi-Project Scope
- Primary issues from team base filter
- Companion issues from `project in (TECHPUBS, SDL, LEG, SR, NDBQUAL)` with same date window
- Issues tagged with `_sourceProject` for provenance
- Toggle via `includeCompanions`/`multiProject` params