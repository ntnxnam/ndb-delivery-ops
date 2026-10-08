# API Contract — `/api/feature/*`

**Route file**: `server/routes/feature.js`  
**Auth**: all endpoints require `validateJiraTokenMiddleware`  
**Mounted at**: `/api/feature`

---

### GET /api/feature/list

**Purpose**: Return FEAT-tier tickets (Feature, Initiative) for a release, plus that release's gate dates — used to populate the Feature Dashboard picker and the overall completion Gantt.

**Auth**: required

**Request**
- Method + path: `GET /api/feature/list`
- Query params:
  - `release` (string, required) — fixVersion name, e.g. `NDB-2.11`
- Required headers: `x-jira-token`, `x-username`

**Server flow**
`feature.js` → `JiraConnector.searchAll` (list tickets) + `parseReleaseGateTimeline` (gate rulers from `releaseVersionsEmailConfig.json`)

**JQL** (unchanged):
```
fixVersion = "{release}" AND issuetype in (Feature, Initiative) AND status not in (Cancelled, Backlog) ORDER BY summary ASC
```

**Fields fetched**: `summary, issuetype, status, assignee`, plus Code Complete / Commit Gate / Promotion Gate / Risk Indicator via `getFieldId`.

**Response shape**
```json
{
  "success": true,
  "data": {
    "release": "NDB-2.11",
    "jql": "fixVersion = \"NDB-2.11\" AND issuetype in (Feature, Initiative) AND status not in (Cancelled, Backlog) ORDER BY summary ASC",
    "features": [
      {
        "key": "ERA-100",
        "summary": "Storage Write Throughput",
        "issueType": "Feature",
        "status": "In Progress",
        "assignee": "Jane Doe",
        "ccDate": "2026-05-15",
        "cgDate": "2026-06-01",
        "pgDate": "2026-07-01",
        "risk": "Green"
      }
    ],
    "gates": {
      "ec": "2025-12-09",
      "cc": "2026-03-04",
      "cg": "2026-04-15",
      "pg": "2026-06-10",
      "ga": "2026-08-12"
    }
  }
}
```

> Additive in Aug 2026: each feature now includes `ccDate` / `cgDate` / `pgDate` / `risk`, and the payload includes `gates` for the overall Gantt. Existing picker fields are unchanged.

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | `release` missing | Show inline error |
| 401 | JIRA token missing/expired | Prompt re-auth |
| 5xx | JIRA search failed | Show error + keep previous list if any |

**Caching**: No cache.

---

### GET /api/feature/dashboard

**Purpose**: Return the full payload for a single feature — the feature ticket itself + all children — for the Feature Dashboard page.

**Auth**: required

**Request**
- Query: `featKey` (string, required), `release` (string, required), `productId` (string, required)

**Server flow**  
`feature.js → featurePayloadService`

Three JIRA queries run in parallel:
1. `key = {featKey}` — fetch the FEAT ticket + its gate date customfields
2. `issueFunction in portfolioChildrenOf("key = {featKey}")` — all direct children
3. `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key = {featKey}') AND type=Epic")` — grandchildren under epics

**Fields per issue**: `key, summary, status, priority, issuetype, fixVersions, assignee, labels, duedate, customfield_11067, customfield_35863, customfield_35864, customfield_10360, components, resolutiondate`

> ⚠️ Breaking change in 2026-10-07: `data.header` also includes `riskAssessment`, `pathToGreen`, `cgChecklistLink`, and `pgChecklistLink`.

**Response**
```json
{
  "success": true,
  "data": {
    "feature": {
      "key": "ERA-100",
      "summary": "Storage Write Throughput",
      "ccDate": "2026-05-15",
      "cgDate": "2026-06-01",
      "pgDate": "2026-07-01"
    },
    "children": [ /* issue array */ ]
  }
}
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 404 | featKey not found | Show "Feature not found" inline error |
| 400 | portfolioChildrenOf unsupported | Show "JIRA plugin unavailable" |

**Caching**: No cache — always live.

---

### POST /api/feature/reparent

**Purpose**: Reparent an issue to a different FEAT ticket — used in reconciliation workflow.

**Auth**: required

**Request**
- Body: `{ issueKey: string, newParentKey: string, jiraToken: string, username: string }`

**Server flow**  
`feature.js → jiraConnector.updateIssue(issueKey, { parent: { key: newParentKey } })`  
Uses `PUT /rest/api/2/issue/{key}` with the `parent` field.

**Response**
```json
{ "success": true, "issueKey": "ERA-12400", "newParent": "ERA-200" }
```

**Error responses**
| Code | When | Client should |
|------|------|---------------|
| 400 | newParentKey is same type (can't parent Feature under Feature) | Show JIRA error message |
| 403 | Token lacks edit permission | Show "Insufficient JIRA permissions" |

> ⚠️ **JQL approval rule does not apply** to reparent — it's a write, not a query. But the JIRA field `parent` must not be changed to a different field name without explicit approval.
