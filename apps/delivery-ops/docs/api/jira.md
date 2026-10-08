# API Contract — `/api/jira/*`

**Route file**: `server/routes/jira/index.js`  
**Auth**: most endpoints require `validateJiraTokenMiddleware`; noted where different  
**Mounted at**: `/api/jira`

This file covers the ~40 endpoints in `jira/index.js`. Grouped by domain.

---

## Diagnostics & Validation

### GET /api/jira/jira-diagnostic

**Purpose**: Test JIRA connectivity and return API version + current user info.

**Auth**: validates token from query/header

**Response**: `{ user, serverInfo, status: "ok" }`

---

### POST /api/jira/test-jql

**Purpose**: Run a test JQL query and return the count + first 10 keys. For dev/debug.

**Auth**: required

**Request** — Body: `{ jql: string }`

**Response**: `{ total, issues: [{ key }] }`

---

### POST /api/jira/validate

**Purpose**: Validate a JIRA token — returns the authenticated user's profile.

**Auth**: token from body

**Request** — Body: `{ token: string, username: string }`

**Response**: `{ valid: true, user: { displayName, email, accountId } }`

---

## Search & Fetch

### POST /api/jira/search-by-jql

**Purpose**: Generic JQL search — returns issues with requested fields.

**Auth**: required

**Request** — Body: `{ jql: string, fields: string[], maxResults?: number, startAt?: number }`

> ⚠️ JQL approval rule applies — any change to JQL passed by callers requires approval.

**Response**: `{ issues: [...], total, startAt, maxResults }`

---

### POST /api/jira/fetch-all-jira-tickets

**Purpose**: Paginated bulk fetch of all tickets matching a JQL, up to a high limit (e.g. 10 000).

**Auth**: required

**Request** — Body: `{ jql: string, fields: string[], batchSize?: number }`

**Response**: `{ issues: [...], total }`

---

### POST /api/jira/fetch-epics

**Purpose**: Fetch all epics for a set of parent keys.

**Auth**: required

**Request** — Body: `{ parentKeys: string[], productId: string }`

**Response**: `{ epics: [...] }`

---

### POST /api/jira/fetch

**Purpose**: Generic JIRA fetch — passes a pre-built request config to the connector. Lower-level than `search-by-jql`.

**Auth**: required

**Request** — Body: `{ endpoint: string, method: string, params?: object, body?: object }`

---

## KPI

### POST /api/jira/kpi-results

**Purpose**: Run a single KPI query for a team and return the result (count + JIRA link).

**Auth**: required

**Request** — Body: `{ teamId, kpiId, release, productId }`

**Response**: `{ kpiId, label, count, jql, jiraUrl }`

---

### POST /api/jira/kpi-results-batch

**Purpose**: Run all KPI queries for a team in parallel and return results array.

**Auth**: required

**Request** — Body: `{ teamId, release, productId, kpiIds?: string[] }`

**Response**: `{ results: [{ kpiId, label, count, jql, jiraUrl }] }`

---

### POST /api/jira/release-kpi-results

**Purpose**: Run a single release-level KPI query (not team-scoped).

**Auth**: required

**Request** — Body: `{ kpiId, release, productId }`

**Response**: `{ kpiId, label, count, jql, jiraUrl }`

---

### POST /api/jira/release-kpi-results-batch

**Purpose**: Batch release-level KPI queries — powers `ReleaseBriefPage` KPI cards.

**Auth**: required

**Request** — Body: `{ release, productId, kpiIds?: string[] }`

**Response**: `{ results: [{ kpiId, label, count, jql, jiraUrl }] }`

---

### POST /api/jira/release-kpi-breakdown-batch

**Purpose**: For each team KPI, return `total` / `done` / `open` counts scoped to
a release version, split by resolution. Powers the Retrospective page's
Cross-Release Comparison "KPI Categories" rows, and leader-scoped KPI chips on
SoS by Leader (via optional `jqlExtra`).

**Auth**: required — KPI view authorization (same gate as `kpi-results-batch`).

**Request**
- Method + path: `POST /api/jira/release-kpi-breakdown-batch`
- Required headers: `x-jira-token` (PAT), `x-username`
- Body params:
  - `releaseVersion` (string, required) — e.g. `NDB-2.11`
  - `teamId` (string, required) — team key whose KPI config is used
  - `jqlExtra` (string, optional) — AND-ed onto every bucket JQL (e.g.
    `"Assignee Manager" in ("Jovan Cukalovic", …)` for leader SoS)

**Server flow**
Route (`routes/jira/kpi.js`) → `kpiService.getReleaseKpiResolutionBreakdown`
→ per KPI builds `buildReleaseKpiResolutionJql(total|done|open)` (release base
filter + KPI filter + optional `jqlExtra` + resolution/status clause) →
`jira.searchCount` (count-only, maxResults=0) for each bucket.

**Response shape**
```json
{
  "success": true,
  "results": {
    "product-blockers": {
      "name": "Product Blockers",
      "total": 12,
      "done": 9,
      "open": 3,
      "links": {
        "total": "fixVersion = \"NDB-2.11\" and (...) ",
        "done": "... and resolution in (Fixed, Done, Resolved, Complete)",
        "open": "... and status not in (Done, Closed)"
      }
    },
    "system-test": { "error": "..." }
  }
}
```
Per-KPI `error` strings are returned inline; a failing KPI does not fail the batch.

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | `releaseVersion` or `teamId` missing | fix request |
| 403 | not KPI-view authorized | hide the comparison KPI rows |
| 5xx | JIRA/query failure | show error, allow retry |

**Caching**: No server cache. Client caches per (teamId, releaseSet) via the
`useRetroComparison` hook key; no auto-refetch on empty results.

> JQL buckets approved via the richer-retrospective plan (2026-09-21):
> `total = <releaseBaseFilter> AND (<kpiPart>)`;
> `done = total AND resolution in (Fixed, Done, Resolved, Complete)`;
> `open = total AND status not in (Done, Closed)`. `excludeDeferred` KPIs also
> append the deferred-label exclusion.

---

## Issue Breakdown & History

### POST /api/jira/issue-breakdown

**Purpose**: Break down a set of issue keys by issue type group (Project Hierarchy / Bug / Dev Code / Test / etc.).

**Auth**: required

**Request** — Body: `{ keys: string[], productId: string }`

**Response**: `{ breakdown: { "Bug": 34, "Dev Code": 120, ... } }`

---

### POST /api/jira/checkpoint-history

**Purpose**: Fetch the date-history of a custom field (e.g. gate date changes over time) for a set of tickets.

**Auth**: required

**Request** — Body: `{ keys: string[], fieldId: string, productId: string }`

**Response**: `{ history: [{ key, changes: [{ date, from, to }] }] }`

---

## Release Versions

### POST /api/jira/release-versions

**Purpose**: List unreleased versions in the selected team's JIRA project (`GET /project/{projectKey}/versions`).

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ teamId: string }` (required). No fallback to another team when missing or unknown.

**Server flow**
`jira/versions.js` → `releaseDataService.listOpenReleaseVersions` → `listFixVersionsForTeam` → `GET /rest/api/2/project/{team.projectKey}/versions` → keep `released !== true && archived !== true` → pick next upcoming `releaseDate` as `defaultVersion`

**Response shape**
```json
{
  "success": true,
  "versions": [{ "name": "MSP-2.1", "released": false, "releaseDate": "2026-10-01" }],
  "projectKey": "ENG",
  "defaultVersion": "MSP-2.1",
  "teamId": "prism-infra"
}
```

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | teamId missing, unknown, or team has no `projectKey` | Show Fetch / Admin error |
| 429 | JIRA rate limit | Retry later |

**Caching**: ~10 min per team on the server.

> ⚠️ Breaking change in 2026-08-26: versions are unreleased names from `GET /project/{team.projectKey}/versions` (one call). No ticket search.

---

### POST /api/jira/discover-versions

**Purpose**: Auto-discover release versions from JIRA that match the product naming pattern.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ productId: string, pattern?: string }`

**Response**: `{ versions: [...] }`

---

### POST /api/jira/check-version-exists

**Purpose**: Check if a version name already exists before creating.

**Auth**: required + `releaseSetup` permission

**Request** — Body: `{ versionName: string, projectKey: string }`

**Response**: `{ exists: boolean, version?: { id, name } }`

---

### POST /api/jira/create-version

**Purpose**: Create a new JIRA release version.

**Auth**: required + `releaseSetup` permission

**Request** — Body: `{ name: string, description?: string, releaseDate?: string, projectKey: string }`

**Response**: `{ success: true, version: { id, name, self } }`

---

### POST /api/jira/rename-release-cascade

**Purpose**: Cascade-rename a release and all companion versions (NDB-2.11 → NDB-2.12, plus .1, .1.1, etc.).

**Auth**: required + `releaseSetup` permission

**Request** — Body: `{ oldName: string, newName: string, projectKey: string, dryRun?: boolean }`

**Response**: `{ success: true, renamed: [{ id, oldName, newName }], errors: [] }`

---

## Filters

### POST /api/jira/check-filter-exists

**Auth**: required + `releaseSetup` permission  
**Request** — Body: `{ filterName: string }`  
**Response**: `{ exists: boolean, filter?: { id, name } }`

---

### POST /api/jira/create-filter

**Auth**: required + `releaseSetup` permission  
**Request** — Body: `{ name: string, jql: string, description?: string }`  
**Response**: `{ success: true, filter: { id, name, self } }`

---

### POST /api/jira/cleanup-duplicate-prefix-filters

**Purpose**: Remove duplicate JIRA filters that have a redundant prefix from a rename operation.

**Auth**: required + `releaseSetup` permission

**Request** — Body: `{ prefix: string, dryRun?: boolean }`

**Response**: `{ deleted: [{ id, name }], errors: [] }`

---

## Sprints

### GET /api/jira/sprints

**Purpose**: List sprints for a board.

**Auth**: required + `sprintReport` permission

**Request** — Query: `boardId` (number, required)

**Response**: `{ sprints: [{ id, name, state, startDate, endDate }] }`

---

### POST /api/jira/sprints

**Purpose**: (Alternate) List sprints — accepts boardId in body for clients that can't use query params.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ boardId: number }`

**Response**: same as GET

---

### GET /api/jira/project-components

**Purpose**: List components for a JIRA project.

**Auth**: required + `sprintReport` permission

**Request** — Query: `projectKey` (string, required)

**Response**: `{ components: [{ id, name }] }`

---

### POST /api/jira/sprint-report

**Purpose**: Full sprint report for a team/sprint — velocity, resolution breakdown, issue type breakdown.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ teamId, sprintId, boardId, startDate, endDate, productId }`

**Response**:
```json
{
  "dev": { "count": 47, "storyPoints": 89, "jql": "..." },
  "qaVerification": { "count": 18, "adjustedCount": 5.94, "jql": "..." },
  "qaTestTasks": { "count": 12, "storyPoints": 24, "jql": "..." },
  "resolutionBreakdown": { "Done": 47, "Unresolved": 5, "Duplicate or Not Reproducible": 3, "Others": 2 }
}
```

---

### POST /api/jira/sprint-report-by-range

**Purpose**: Sprint report across a date range (e.g., a fiscal quarter) — returns per-sprint data.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ teamId, boardId, startDate, endDate, productId }`

**Response**: `{ sprints: [ /* per-sprint report objects */ ] }`

---

### POST /api/jira/sprint-kpi-breakdown

**Purpose**: KPI breakdown per sprint — used for multi-sprint trend charts.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ teamId, boardId, sprintIds: number[], productId }`

---

### POST /api/jira/sprint-report-trends

**Purpose**: Multi-sprint trend data — velocity over time, issue type trends.

**Auth**: required + `sprintReport` permission

**Request** — Body: `{ teamId, boardId, startDate, endDate, productId }`

---

### POST /api/jira/sprint-gantt-data

**Purpose**: Gantt chart data for sprint-based tickets — resolves sprint end dates for timeline bars.

**Auth**: required

**Request** — Body: `{ keys: string[], productId: string }`

**Response**: `{ items: [{ key, summary, startDate, endDate, issueType }] }`

---

## Release Items

### POST /api/jira/release-items

**Purpose**: Live Feature/Initiative items for Project Status. Always JIRA; disk cache is ignored.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ fixVersions: string[], teamId: string }` (both required)

**Server flow**  
`jira/versions.js` → `releaseItemsDataService.fetchAllItemsAcrossVersions` → wrap `(${team.baseFilter}) AND ((fixVersion = "…" OR labels = "<labelPrefix>-<suffix>-long-term-funded") AND issuetype IN (Feature, Initiative) AND status != Cancelled) ORDER BY key ASC`

**Response**: `{ success: true, data: { allItems: [...] } }`

**Error responses**
| HTTP code | When | Client should |
|-----|---|---|
| 400 | no team, no `baseFilter`, empty `fixVersions`, or JIRA rejected the JQL | Show the server `error` string (JIRA message when present) |

---

### POST /api/jira/release-items-history

**Purpose**: Fetch the history of which items were added/removed from a release payload over time.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ release: string, productId: string }`

---

### POST /api/jira/release-items-tcms

**Purpose**: Enrich release items with TCMS (test management) data.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ release: string, productId: string }`

---

## Executive Summary

### PUT /api/jira/update-executive-summary

**Purpose**: Write an updated executive summary string to a JIRA field.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ issueKey: string, summary: string }`

---

### POST /api/jira/generate-exec-summary

**Purpose**: AI-generate an executive summary for a release payload. Returns generated text.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ release: string, productId: string, teamId?: string }`

**Response**: `{ summary: string, generatedAt: string }`

---

### POST /api/jira/enhanced-exec-summary

**Purpose**: Enhanced (richer) AI executive summary with predictive analytics section.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ release: string, productId: string, teamId?: string }`

---

## Risk & Misc

### POST /api/jira/risk-indicator-changes

**Purpose**: Fetch the history of risk indicator changes for items in a release.

**Auth**: required + `releaseVersions` permission

**Request** — Body: `{ release: string, productId: string }`

---

### GET /api/jira/fields

**Purpose**: Return JIRA field metadata — field IDs and display names. Used by column configurator in JIRA Emailer.

**Auth**: required

**Response**: `{ fields: [{ id, name, type }] }`

---

### GET /api/jira/team-configurations

**Purpose**: Return team configurations visible to the current user.

**Auth**: `releaseVersions` permission

**Response**: `{ teams: [{ id, name, boardId, kpiConfig }] }`

---

### POST /api/jira/log-user-action

**Purpose**: Server-side audit log for significant user actions (e.g., email sent, release renamed).

**Auth**: none (fire-and-forget from client; no sensitive data logged)

**Request** — Body: `{ action: string, meta?: object }`

**Response**: `{ logged: true }`

---

### GET /api/jira/test-changelog/:key

**Purpose**: Dev/debug endpoint — return the full changelog for a JIRA ticket key.

**Auth**: required

**Request** — Path: `key` (JIRA issue key)

**Response**: `{ changelog: [...] }`

---

## System-Test Scale

### GET /api/jira/system-test-scale

**Purpose**: Return live System-Test scale dashboard counts, per-metric JQL, RAG, components, and release-over-release trends scoped by team KPI `filter={teamCode}-System-Test` with `cf[13260]` regression typing.

**Auth**: required · KPI view authorization (`kpi_view`)

**Request**
- Method + path: `GET /api/jira/system-test-scale`
- Query params:
  - `teamId` (string, optional) — team board id (e.g. `ndb`); resolves `teamCode` → `filter={teamCode}-System-Test`
  - `currentRelease` (string, optional) — e.g. `NDB-2.11`
  - `compareRelease` (string, optional) — e.g. `NDB-2.10`
- Required headers: JIRA token (middleware)

**Server flow**
Route handler → `checkKpiViewAuthorization` → `systemTestScaleService.getDashboard({ teamId, … })` → resolve teamCode / kpiFilter → parallel `jira.searchCount` → assemble payload

**Response shape**
```json
{
  "success": true,
  "generatedAt": "2026-10-08T06:00:00.000Z",
  "fetchSeconds": 52.3,
  "teamId": "ndb",
  "teamCode": "NDB",
  "kpiFilter": "filter=NDB-System-Test",
  "regressionField": "cf[13260]",
  "currentRelease": "NDB-2.11",
  "compareRelease": "NDB-2.10",
  "rag": { "level": "yellow", "why": "..." },
  "current": { "open": { "count": 19, "jql": "..." }, "rates": { "regressionRate": 8.1 } },
  "compare": { },
  "byRelease": { },
  "trends": { "series": [], "rateSeries": [] },
  "components": { },
  "carry": { }
}
```

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | Team has no releases in `systemTestScaleConfig.teams` | Show configure message |
| 403 | User lacks KPI view | Show access denied |
| 500 | JIRA / internal failure | Show error + retry |

**Caching**
No — always live JIRA `searchCount`.

---

### POST /api/jira/system-test-scale/refresh

**Purpose**: Explicit pull — same live re-count as GET (user-triggered Refresh).

**Auth**: required · KPI view authorization

**Request**
- Method + path: `POST /api/jira/system-test-scale/refresh`
- Body params:
  - `teamId` (string, optional)
  - `currentRelease` (string, optional)
  - `compareRelease` (string, optional)
- Required headers: JIRA token

**Server flow**
Route handler → `getDashboard` → respond

**Response shape**
Same as GET `/api/jira/system-test-scale`.

**Error responses**
| HTTP code | When | Client should |
|-----------|------|---------------|
| 400 | Team not configured for System-Test | Show configure message |
| 403 | No KPI view | Show access denied |
| 500 | Refresh failed | Show error + retry |

**Caching**
No.
