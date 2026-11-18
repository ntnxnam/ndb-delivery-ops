# Project Status — Data Layer & Middleware Contract

**Route**: `/project-status`  
**Server routes used**: `server/routes/jira/versions.js`, `server/routes/releaseDataset.js`  
**Hooks**: `useReleaseItems`, `useReleaseVersions`, `useGateTimeline`  
**Contexts consumed**: `SelectedReleaseContext`, `ReleaseDataContext`, `TeamContext`

---

## API Calls (client → server)

### 0. Fetch teams (populates team picker)

```
GET /api/config/teams
Headers: Authorization, X-Username (optional; endpoint is unauthenticated)
```

**Server flow**: `config.js → loadTeamBoardConfig()` reads `server/config/teamBoardConfig.json`  
**Returns**: `{ teams: [{ id, name, boardId, baseFilter, ... }], defaultTeamId }`  
**Context**: `TeamContext` fetches once on app mount. **Choose** applies the staged team, clears `selectedRelease`, and bumps `teamEpoch` so the version list reloads.

---

### 1. Fetch release versions (populates picker)

```
POST /api/jira/release-versions
Body: { teamId }
Headers: x-jira-token, x-username
```

**Server flow**: `jira/versions.js → releaseDataService.listOpenReleaseVersions(teamId)` → `listFixVersionsForTeam`  
**JIRA call**: `GET /rest/api/2/project/{team.projectKey}/versions`, keep unreleased/unarchived. Cached ~10 min per team. No ticket search.  
**Returns**: `{ versions: [{ name, released, releaseDate }], projectKey, defaultVersion }`  
**Default**: unreleased version whose JIRA `releaseDate` (GA) is next upcoming.  
**400**: team not selected, or team has no `projectKey` — never falls back to another team.

---

### 2. Fetch release payload (the table data)

```
POST /api/jira/release-items
Body: { fixVersions: [version], teamId }
Headers: x-jira-token, x-username
```

**Server flow**: `jira/versions.js → releaseItemsDataService.fetchAllItemsAcrossVersions` — **always live JIRA**, no disk cache.  
**JQL**:
```
(${team.baseFilter}) AND ((fixVersion = "<version>" OR labels = "<labelPrefix>-<suffix>-long-term-funded") AND issuetype IN (Feature, Initiative) AND status != Cancelled) ORDER BY key ASC
```
**Hook**: `useReleaseItems` (5-minute in-memory TTL). Choosing a version in the dropdown, or **Load** / **Refresh**, hits this endpoint. **Refresh** busts TTL. Does not call `/refresh-now`.

**Item fields**: mapped in `releaseItemsDataService.processReleaseItems` from `RELEASE_ITEMS_CONFIG.FIELDS_LIST`. Includes `assigneeManager` (display name) and `assigneeManagerEmail`, both derived from `customfield_19262`.

### Quality column (TCMS) data shape

When TCMS enrichment runs (`/api/jira/release-items-tcms`), each item carries
`tcmsQuality` (4 tables: Release/Master × Overall/Last 4 weeks) and legacy
`tcmsQI`. Each table is `{ functional: {manual,automation}, system:
{manual,automation} }`; each cell `{ qi, run, passed, failed, rate }`.
Window keys: `releaseLast4Weeks`/`masterLast4Weeks` (primary) with
deprecated alias `releaseLast3Weeks`/`masterLast3Weeks`. No `overall` key is
emitted; legacy `overall` data falls back to the `system` row in renderers.
Functional/System rows currently share source metrics (clone) until TCMS
exposes a `test_category` filter — see `../tcms-rows-followup.md`.
Time-filtered (Last 4 weeks) windows use `/api/v1/all_test_cases/aggregate/metrics`
(`time_filter=four_weeks`, `target={milestone}-qcow2`) and do not fall back to
Overall.

**Client-side filtering**: `ReleaseVersionFilterBar` + `applyFilters` narrow the loaded items in memory (no re-fetch). Filters: Risk, Status, Assignee, **Assignee Mgr**, Status-update staleness, plus a commit/long-term-funded Section toggle. `assigneeManager` also drives the manager CC on the release-versions email (`sendReleaseVersions.js`).

---

### 3. Checkpoint date history (struck-through old dates)

```
POST /api/jira/release-items-history
Body: { fixVersion, teamId }
Headers: x-jira-token, x-username
```

Walks JIRA changelog per ticket for `customfield_11067` (CC), `customfield_35863` (CG), `customfield_35864` (PG) + FS/DS, Test Plan etc. Client shows current date bold on top, old dates struck through below, with `moved N times by X weeks` where `X = |current - first ever set|` (a revert to original = 0). Shared helper `client/src/utils/dateHistoryDisplay.js` powers `/project-status`, `/sos-summary`, and `/sos-leader-summary`.

---

### 3b. Fetch gate timeline (Gantt rulers)

```
GET /api/release-dataset/gate-timeline?release=NDB-2.11&productId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → loadReleaseGateConfig()`  
**Hook**: `useGateTimeline`

---

### 4. Release Brief tickets (same page chrome)

```
GET /api/release-dataset/per-release/:release?productId=<teamId>
```

Live `fetchReleaseData` wrapped with `baseFilter`. `ReleaseDataContext` keeps a 5-minute in-memory TTL only.

---

## Caching

| Data | Cache strategy | TTL |
|------|---------------|-----|
| Release versions | In-memory per team (`listFixVersionsForTeam`) | 10 min server / 10 min client |
| Release items | `useReleaseItems` in-memory | 5 min; Refresh busts |
| Per-release tickets | `ReleaseDataContext` in-memory | 5 min; Refresh busts |
| Gate timeline | Config file | No cache |

---

## Error Handling

| Scenario | HTTP code | Client behaviour |
|----------|-----------|-----------------|
| Team has no `baseFilter` | 400 | Show Admin message; do not load NDB versions |
| JIRA token invalid | 401 | Redirect to login |
| JIRA search timeout | 504 | Show error + Retry |
| JIRA 429 | 429 | Wait and retry |
