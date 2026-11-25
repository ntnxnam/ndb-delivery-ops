# Deferred Insights API

**Purpose:** Per-release deferred bug dashboard — totals, fix rate, where deferred tickets landed, pending tail.

**Auth:** `validateJiraTokenMiddleware` + `apiLimiter` — requires valid JIRA PAT (401 on invalid), no KPI_VIEW gate (accessible to all authenticated users).

## Endpoints

### GET /api/deferred-insights/insights
Query params:
- `teamId` (or `team`) — team id (e.g. `ndb`), defaults to `ndb` via `normalizeTeamId`
- `releases` (or `release`) — CSV `NDB-2.10,NDB-2.11` or repeated array; if omitted, discovered via `getProjectVersions(projectKey)` capped to last 12
- `priority` — allowlisted (`Blocker - P0`, `Critical - P1`, `Major - P2`, `Minor - P3`, `Blocker`, `Critical`, `Major`, `Minor`, `P0`-`P3`) else ignored with warn
- `component` — free-text, quoted via `quote()`
- `refresh` / `bypassCache` — `1` or `true` bypasses `SimpleCache`

Response `200 { success:true, data: {...} }` where `data` is `getDashboard` result (see Data Layer). Errors `500 { success:false, error }`.

### POST /api/deferred-insights/insights/refresh
Body/query same as GET, always `bypassCache:true`. Used by client `Refresh` button.

### Alias
`GET|POST /api/jira/deferred-insights/*` — same router mounted as alias after generic `/api/jira` (fallthrough). Also supports `GET /api/deferred-insights/` (bare) and `GET /api/jira/deferred-insights/` for legacy clients.

## Server flow
`route parseReleases → handleDashboard → svc.getDashboard({token, teamId, releases, priority, component, bypassCache}) → teamConfig + jiraClient searchCount/searchPages → classify isDoneStatus → hero union JQL`

## Caching
`SimpleCache 5m` keyed `deferred:<teamId>:<releases>:<priority>:<component>`; skipped on partial errors.

## Examples
```
GET /api/deferred-insights/insights?teamId=ndb&releases=NDB-2.10,NDB-2.11
GET /api/deferred-insights/insights?teamId=ndb&priority=Blocker%20-%20P0&component=Era
POST /api/deferred-insights/insights/refresh  {teamId:"ndb", releases:"NDB-2.11"}
```
