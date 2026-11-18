# API Contract — `/api/component/*`

**Route file**: `server/routes/component.js`  
**Auth**: all endpoints require `validateJiraTokenMiddleware`  
**Mounted at**: `/api/component`

---

### GET /api/component/list

**Purpose**: Return the list of JIRA components for a product (used to populate the Component Report selector).

**Auth**: required

**Request**
- Query: `productId` (string, optional — selected team id, e.g. `ncn`). Alias: `team`. Omitted uses `defaultTeamId`.
- Query: `refresh` (boolean, optional — `true` bypasses the session cache for that project)

**Server flow**  
`component.js → getTeamById(productId).projectKey → componentReportService.fetchComponentsFromERA(token, projectKey)`  
JIRA: `GET /rest/api/2/project/{projectKey}/components`

**Response**
```json
{ "components": [{ "id": "10001", "name": "Storage" }], "count": 1, "projectKey": "NCN", "fetchedAt": "2026-09-30T00:00:00.000Z" }
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|----------------|
| 400 | Unknown `productId` / team has no `projectKey` | Show the error; do not fall back to another product |
| 401 | Missing JIRA token | Re-login |
| 500 | JIRA component fetch failed | Show error; retry |

**Caching**: Session, per `projectKey`, 1 hour. `refresh=true` drops that project's entry.

---

### GET /api/component/health

**Purpose**: Return health summary (RAG + bug counts) for all components in a product. Powers the Component Report health dot row.

**Auth**: required

**Request**
- Query: `productId` (string, required), `release` (string, optional — filters to this release only)

**Server flow**  
`component.js → componentReportService.getComponentHealth(productId, release?)`

For each component, runs:
```
project={projectKey} AND component = "{component}" AND issuetype = Bug AND status not in (Done, Closed, Cancelled)
```
— returns counts per priority; derives RAG server-side.

**RAG logic**:
- Red: any P0 open
- Amber: any P1 open (no P0)
- Green: no P0 or P1

**Response**
```json
{
  "success": true,
  "data": [
    { "component": "Storage", "rag": "red", "p0Count": 2, "p1Count": 5, "openCount": 34, "closedPct": 71 }
  ]
}
```

**Caching**: No cache — live JIRA.

---

### GET /api/component/data

**Purpose**: Return full open bug list for a single component. Fetch-once; client applies release filter.

**Auth**: required

**Request**
- Query: `component` (string, required), `productId` (string, required)

**Server flow**  
`component.js → componentReportService.getComponentIssues(component, productId)`

**JQL**:
```
project={projectKey} AND component = "{component}" AND status not in (Done,Closed,Cancelled) AND issuetype = Bug
```

**Fields returned per issue**: `key, summary, status, priority, assignee, fixVersions, created, labels, components`  
**Age field**: server computes `age` in days from `created` to now and appends it.

**Response**
```json
{
  "success": true,
  "data": [
    {
      "key": "ERA-56789",
      "summary": "Storage write path OOM",
      "status": "In Progress",
      "priority": "Blocker - P0",
      "assignee": "john.doe",
      "fixVersions": "NDB-2.11,master",
      "created": "2026-04-10T09:00:00Z",
      "age": 66,
      "labels": ["storage-regression"],
      "components": "Storage"
    }
  ]
}
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 400 | `component` param missing | Show "Component name required" |
| 504 | JIRA timeout | Show per-component error card; other components still load |

**Caching**: No cache — always live.
