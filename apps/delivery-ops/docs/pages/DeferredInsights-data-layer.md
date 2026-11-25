# Deferred Insights — Data Layer

**Hook:** `client/src/hooks/useDeferredInsights.js`  
**Service:** `server/services/deferredInsightsService.js`  
**Route:** `server/routes/deferredInsights.js`

## API
```
GET /api/deferred-insights/insights?teamId=&releases=&priority=&component=
POST /api/deferred-insights/insights/refresh  (bypassCache)
Alias: /api/jira/deferred-insights/insights
```
Releases as CSV or repeated array (`parseReleases`). Priority allowlisted, component free-text. Mount order: `/api/jira/deferred-insights` before generic `/api/jira`.

## Service flow
1. `getTeamMeta(teamId)` → labelPrefix/releasePrefix/projectKey from `teamBoardConfig` (fallback ndb-/NDB-/ERA).
2. `discoverReleases(token, projectKey)` via `getProjectVersions` if no `releases` param; keep dotted versions, sort `compareReleases`, cap last 12.
3. Per release: `labels = "<prefix>-<version>-deferred" AND issuetype = Bug` + extraFilter → `searchCount` + `searchPages` (max 200, 30s).
4. Classify `isDoneStatus` (statusCategory Done || status closed/resolved/done) → fixed/pending, byFixVersion/byPriority/byComponent, sample.
5. Hero: sum totals + union JQL (`OR`) + fixedJql/pendingJql (`AND statusCategory`); skip cache on partial errors.

## Client
- `selectedReleases` seeded once from discovered list (no double-fetch); filter is client-side chip row (All + per-release toggles).
- Chart `ComposedChart onClick` → scroll to `di-release-<name>` + expand.
- Heroes: count→drill (`openHeroDrill`), Open in JIRA→hero JQL (dual-action).
- ReleaseCard: counts are buttons→drawer, byFixVersion/byPriority/byComponent chips, expandable table.
