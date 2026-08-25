# Project Status — Data Layer & Middleware Contract

**Route**: `/project-status`  
**Server routes used**: `server/routes/jira/index.js`, `server/routes/releaseDataset.js`  
**Hooks**: `useReleaseItems`, `useReleaseVersions`, `useGateTimeline`  
**Contexts consumed**: `SelectedReleaseContext`, `ReleaseDataContext`, `TeamDatasetContext`, `TeamContext`

---

## API Calls (client → server)

### 0. Fetch teams (populates team picker)

```
GET /api/config/teams
Headers: Authorization, X-Username (optional; endpoint is unauthenticated)
```

**Server flow**: `config.js → loadTeamBoardConfig()` reads `server/config/teamBoardConfig.json`  
**Returns**: `{ teams: [{ id, name, boardId, ... }], defaultTeamId }`  
**Context**: `TeamContext` fetches once on app mount; auto-selects stored or default team  
**Fallback**: if the request fails, the Team dropdown stays visible with a Retry button; a stored `releaseVersionSelectedTeamId` is still treated as selected so the page is not a dead-end

---

### 1. Fetch release versions (populates picker)

```
GET /api/jira/releases?productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `jira/index.js → jiraConnector.getVersions(projectKey)`  
**JIRA endpoint**: `GET /rest/api/2/project/{projectKey}/versions`  
**Returns**: `[{ id, name, released, releaseDate, description }]`  
**Hook**: `useReleaseVersions`

---

### 2. Fetch release payload (the table data)

```
GET /api/jira/release-items?release=NDB-2.11&productId=ndb&teamId=<id>
Headers: x-jira-token, x-username
```

**Server flow**: `jira/index.js → releaseItemsDataService.getReleaseItems(release, productId, teamId)`  
**Service**: `server/services/releaseItemsDataService.js`  
**JIRA queries** (5-bucket structure, run in parallel):

| Bucket | JQL pattern |
|--------|------------|
| Top-level projects | `fixVersion={release} AND status not in (Cancelled,Backlog) AND issueType in (Feature,Initiative,Epic,X-FEAT,Capability)` |
| Portfolio children | `issuefunction in portfolioChildrenOf("fixVersion={release} AND ...")` |
| Epic children | `issueFunction in issuesInEpics("issuefunction in portfolioChildrenOf(...) AND type=Epic")` |
| Standalone epics | `type=Epic AND fixVersion={release} AND "Parent Link" is EMPTY` |
| Direct tickets | `issuetype not in (Feature,...) AND (fixVersion was {release} OR fixVersion={release} OR affectedVersion={release}) AND "Epic link" is EMPTY` |

**Fields fetched per issue**: `summary, status, priority, assignee, issuetype, fixVersions, duedate, customfield_11067 (ccDate), customfield_35863 (cgDate), customfield_35864 (pgDate), customfield_10360 (sprint), labels, components, parent`  
**Deduplication**: union of all 5 buckets deduplicated by issue key server-side  
**Hook**: `useReleaseItems`

---

### 3. Fetch gate timeline (Gantt rulers)

```
GET /api/release-dataset/gate-timeline?release=NDB-2.11&productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → loadReleaseGateConfig() → reads releaseVersionsEmailConfig.json`  
**Returns**: `{ ccm, cg, pg, ga, ec }` as ISO date strings for the selected release  
**Hook**: `useGateTimeline`  
**Fallback**: returns empty object `{}` when release not in config (no 404)

---

### 4. Bundle read (team dataset — used for pre-computed metrics)

```
GET /api/release-dataset/sync-status?productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: reads `shared/.cache/release-dataset/ndb/bundle.json` from disk  
**Used for**: pre-computed payload counts, component lists, health signals  
**Context**: `TeamDatasetContext` shares bundle across all pages; loaded once at app mount  
**Fallback**: falls back to live JIRA calls if bundle missing or stale (>24 h)

---

## Data Shapes

### Release item (single issue)
```json
{
  "key": "ERA-12345",
  "summary": "Fix storage write regression",
  "status": "In Progress",
  "priority": "Critical - P1",
  "assignee": "john.doe",
  "issueType": "Bug",
  "fixVersions": ["NDB-2.11"],
  "ccDate": "2026-05-15",
  "cgDate": "2026-06-01",
  "pgDate": "2026-07-01",
  "sprint": { "id": 4201, "name": "S22", "endDate": "2026-06-04" },
  "components": ["Storage"],
  "labels": ["ndb-2.11-deferred"],
  "bucket": "epic_children"
}
```

### Gate timeline
```json
{
  "ec":  "2026-02-01",
  "ccm": "2026-04-15",
  "cg":  "2026-06-01",
  "pg":  "2026-07-15",
  "ga":  "2026-08-20"
}
```

---

## Caching

| Data | Cache strategy | TTL |
|------|---------------|-----|
| Release versions | In-memory | 5 min |
| Release items (5 buckets) | `ReleaseDataContext` in-memory per release | Session (cleared on release change) |
| Gate timeline | Read from config file on each request | No cache (file read is cheap) |
| Bundle (team dataset) | Disk (`shared/.cache/`) + `TeamDatasetContext` | 24 h; manual refresh via Sync Hub |

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Teams config fetch failed | 5xx / network | Team dropdown stays visible with Retry; stored team id still counts as selected |
| JIRA token invalid | 401 | Redirect to login |
| Release not found in JIRA | 404 | Show "Release not found" empty state |
| JIRA search timeout (>30 s) | 504 | Show error + "Retry" button |
| Bundle missing from disk | 200 (fallback) | Falls back to live JIRA calls, shows "Live data" badge |
| portfolioChildrenOf JQL unsupported | 400 | Falls back to fixVersion direct query |
