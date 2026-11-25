# Deferred Insights — Data Layer

**Hook:** `client/src/hooks/useDeferredInsights.js`
**Service:** `server/services/deferredInsightsService.js`
**Route:** `server/routes/deferredInsights.js`

## API
```
GET /api/deferred-insights/insights?teamId=&releases=&priority=&component=&refresh=
POST /api/deferred-insights/insights/refresh  (body: {teamId, releases, priority, component}, bypassCache=true)
Alias: /api/jira/deferred-insights/insights and /api/jira/deferred-insights/ (same router, alias after generic /api/jira mount — Express fallthrough via next() when no sub-route matches)
```
Releases as CSV or repeated array (`parseReleases`). Priority allowlisted (`Blocker - P0`, `Critical - P1`, `Major - P2`, `Minor - P3` etc via `quote()` escaping), component free-text via `quote()`. Auth: `validateJiraTokenMiddleware` (401 on invalid token, no KPI gate).

## Service flow
1. `getTeamMeta(teamId)` → labelPrefix/releasePrefix/projectKey from `teamBoardConfig` (fallback ndb-/NDB-/ERA) — product-agnostic.
2. `discoverReleases(token, projectKey)` via `getProjectVersions` if no `releases` param; keep dotted versions `/\d+\.\d+/`, sort `compareReleases` numeric, cap last 12.
3. Per release: `labels = "<prefix>-<version>-deferred" AND issuetype = Bug` + extraFilter (priority/component quoted) → `searchCount` + `searchPages` (max 200, pageSize 50, timeout 30s, delay 120ms) via `jiraClient`.
4. Classify `isDoneStatus` (statusCategory Done || status closed/resolved/done) → fixed/pending, byFixVersion/byPriority/byComponent buckets, sample rows (key, summary, status, priority, fixVersions, component, assignee, labels).
5. Hero: sum totals + union JQL (`(jql1) OR (jql2)`) + fixedJql/pendingJql (`AND statusCategory`); cache via `SimpleCache 5m` keyed by `teamId:releases:priority:component`, skip cache on partial errors.

## Response shape
```json
{
  "teamId": "ndb",
  "jiraBaseUrl": "https://jira.nutanix.com",
  "asOf": "ISO8601",
  "releases": [{ "release": "NDB-2.11", "deferredLabel": "ndb-2.11-deferred", "total": 12, "fixed": 8, "pending": 4, "fixRate": 67, "jql": "...", "breakdowns": {...}, "sample": [...], "sampleTruncated": false }],
  "hero": { "totalDeferred": 100, "totalFixed": 70, "totalPending": 30, "fixRate": 70, "releaseCount": 6, "jql": "...", "fixedJql": "...", "pendingJql": "..." },
  "filters": { "priority": null, "component": null }
}
```

## Caching / errors
- `heroCache` 5m per `team:releases:priority:component`; `bypassCache=true` on force refresh or when `hasErrors` (partial fetch) avoids poison.
- Per-release count/fetch errors captured as `entry.error`, not thrown; hero aggregates only successes.

## Client
- `selectedReleases` seeded once from discovered list (no double-fetch); filter is client-side chip row (All + per-release toggles).
- Chart `ComposedChart onClick` → scroll to `di-release-<name>` + expand.
- Heroes: count→drill (`onDrill` opens drawer with hero JQL), Open in JIRA→hero JQL (dual-action).
- ReleaseCard: counts are buttons→drawer (not nested inside expand button), byFixVersion/byPriority/byComponent chips, expandable table with caption/scope cols.

## Mounting
- `server/index.js:178-180` mounts `deferredInsightsRoutes` at `/api/deferred-insights` and alias `/api/jira/deferred-insights` after generic `/api/jira` — alias relies on Express fallthrough (generic router calls next() when no sub-route matches). Preferred order is before generic, but current works; see risk note in requirements P1-3.
