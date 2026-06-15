# API Contract — `/api/feature/*`

**Route file**: `server/routes/feature.js`  
**Auth**: all endpoints require `validateJiraTokenMiddleware`  
**Mounted at**: `/api/feature`

---

### GET /api/feature/list

**Purpose**: Return a list of FEAT-tier tickets (Features, X-FEATs) for a release — used to populate the Feature Dashboard picker.

**Auth**: required

**Request**
- Query: `release` (string, required), `productId` (string, required)

**Server flow**  
`feature.js → jiraConnector.search`

**JQL**:
```
fixVersion={release} AND issueType in (Feature, X-FEAT, Initiative, Capability) AND status not in (Cancelled, Backlog)
```

**Response**
```json
{ "success": true, "data": [{ "key": "ERA-100", "summary": "Storage Write Throughput", "status": "In Progress" }] }
```

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
