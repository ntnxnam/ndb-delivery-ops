# KPI Page — Data Layer & Middleware Contract

**Route**: `/kpis`  
**Server routes used**: `server/routes/config.js`, KPI results under `server/routes/jira/`  
**Hooks / context**: `useTeam()` (`TeamContext`) — no separate `useTeams()` fetch  
**Service**: `server/services/kpiService.js` (`buildKpiCombinedJql`)

---

## API Calls (client → server)

### 1. Team list (shared)

```
GET /api/config/teams
```

**Server flow**: `config.js → teamConfig.loadTeamBoardConfig()`  
**Context**: fetched once by `TeamProvider` on app mount. KPI page does not refetch.

---

### 2. KPI definitions

```
GET /api/config/kpi?teamId=ndb
Headers: x-jira-token, x-username
```

**Server flow**: `config.js → loadKpiConfigSync → getKpisForTeam` (normalized team id)  
**Returns**: `{ kpis: [{ id, name, baseQuery, displayType, order }], isAdmin }`

---

### 3. Save team base filter

```
POST /api/config/team-base-filter
Body: { teamId, baseFilter }
Headers: x-username
```

**Server flow**: admin check → `getTeamById` (case-insensitive) → write `team.baseFilter` → `saveTeamBoardConfig` (invalidates mtime cache)  
**Client**: `replaceTeams(response.teams)` so every page sees the new base query without another GET.

---

### 4. Widget results

```
POST /api/jira/kpi-results-batch
Body: { teamId }
Headers: x-jira-token, x-username
```

**Server flow**: `kpiService.getKpiResultBatch` → for each KPI `buildKpiCombinedJql(teamId, kpi.baseQuery)` → `(getTeamBaseFilter(teamId)) AND (resolved kpi JQL)`  
**JIRA**: `GET /rest/api/2/search` with `maxResults: 0` for count widgets

---

## Combined JQL contract

| Piece | Source |
|-------|--------|
| Team base | `teamBoardConfig.teams[].baseFilter` via `getTeamBaseFilter(teamId)` |
| KPI query | `kpiConfig.teams[teamId][].baseQuery` |
| Combined | `(baseFilter) AND (kpiJql)` when baseFilter is set; otherwise kpiJql alone |

Sprint reports use `sprintBaseFilter` (or `baseFilter` if sprint-specific is empty). SoS uses `sosBaseFilter`. Lookups are case-insensitive.

---

## Caching

| Data | Strategy |
|------|----------|
| Teams | `TeamContext` once per session; server mtime cache |
| KPI definitions | No cache; refetch on team change |
| Widget results | In-component state; cleared when `selectedTeamId` changes |

---

## Error Handling

| Scenario | Client behaviour |
|----------|------------------|
| Teams fetch fail | `TeamSelector` Retry; `TeamRequiredGate` if no stored team id |
| Team KPIs not found | Empty table + message |
| Widget JQL error | Per-card error from JIRA `errorMessages[0]` |
