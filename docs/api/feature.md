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
- Query:
  - `featureKey` (string, required) — FEAT / Initiative key
  - `release` (string, required) — fixVersion name
  - `teamId` (string, optional) — team whose KPIs to scope into `teamKpiBoxes` (default `ndb`)

**Server flow**  
`feature.js` → JiraConnector + `kpiConfig.json` via `getKpisForTeam`

Three JIRA queries run in parallel:
1. `key = {featKey}` — fetch the FEAT ticket + its gate date customfields
2. `issueFunction in portfolioChildrenOf("key = {featKey}")` — all direct children
3. `issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf('key = {featKey}') AND type=Epic")` — grandchildren under epics

**Fields per issue**: `key, summary, status, priority, issuetype, fixVersions, assignee, labels, duedate, customfield_11067, customfield_35863, customfield_35864, customfield_10360, components, resolutiondate`

> ⚠️ Breaking change in 2026-10-07: `data.header` also includes `riskAssessment`, `pathToGreen`, `cgChecklistLink`, and `pgChecklistLink`.
>
> Additive 2026-10-16: `data.timing`, `data.hygiene`, `data.flow.daily` (enriched series), `data.kickoff`, `data.inference` (RAG + drivers), `data.teamKpiBoxes` (open counts scoped to feature).
>
> **teamKpiBoxes**: every KPI from `kpiConfig.json` for `teamId` (ordered by `order`). No hard cap — new KPIs added on the KPIs page appear here without a code change.
>
> **QA verification line** (`flow.daily[].verified`): Bug/Improvement count whose changelog last transitioned **status → Closed** that day (`extractClosedDate`). This is QA sign-off — same signal as sprint Dev vs QA velocity. It is **not** `resolutiondate` (dev resolve / TBV). Resolved series still uses `resolutiondate`.
>
> **Click-through authenticity**: every inference driver / coding·companion lane / hygiene count / kick-off message carries a `jql` field. Counts that list tickets use `key in (...)` (or `key = X`) so the JIRA result set size matches the claim. Real-start links to `key = {realStartKey}` (changelog first In Progress is not expressible in JQL).

**Response** (current `/dashboard` shape — see route handler for full payload)
```json
{
  "success": true,
  "data": {
    "release": "NDB-2.12",
    "featureKey": "FEAT-19398",
    "timing": {
      "plannedStart": "2026-01-15",
      "realStart": "2026-02-03",
      "realStartKey": "ERA-62216",
      "deltaDaysVsEc": 19
    },
    "hygiene": {
      "wrongFixVersionCount": 3,
      "jql": "key in (ERA-1,ERA-2,ERA-3)"
    },
    "header": { },
    "gates": { },
    "payload": { "canonical": [], "featIdOnly": [], "featNumberOnly": [] },
    "flow": { },
    "kpis": []
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
