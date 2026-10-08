# System-Test Scale — Data Layer

**Route**: `/system-test-scale`  
**Component**: `SystemTestScalePage`  
**Hook**: `useSystemTestScale`

---

## API endpoints called

| Method | Path | When |
|--------|------|------|
| GET | `/api/jira/system-test-scale?teamId=&currentRelease=&compareRelease=` | Initial load / team or release change |
| POST | `/api/jira/system-test-scale/refresh` | User clicks Pull from JIRA |

---

## Server flow

```
Route (system-test-scale.js)
  → checkKpiViewAuthorization
  → systemTestScaleService.getDashboard({ token, teamId, currentRelease, compareRelease })
      → resolveRuntimeConfig(teamId)
           teamBoardConfig + systemTestScaleConfig.teams[teamId]
           → teamCode → kpiFilter = filter={teamCode}-System-Test
           → releases / components from per-team config (+ featureComponents fallback)
      → buildQueries() — KPI filter + release All filters + cf[13260] slices + components + carry
      → jira.searchCount(jql) × N (parallel workers)
      → assemble byRelease, trends, components, rag
  → JSON response (counts + jql per cell)
```

---

## Data shapes

### Metric cell

```json
{ "count": 19, "jql": "filter=NDB-System-Test AND filter=NDB-2.11-All AND issuetype = Bug AND status not in (Resolved, Closed)" }
```

### Trends

```json
{
  "releaseOrder": ["NDB-2.10", "NDB-2.10.1", "NDB-2.11", "NDB-2.12"],
  "series": [
    {
      "key": "open",
      "label": "Open bugs",
      "points": [{ "release": "NDB-2.11", "short": "2.11", "value": 19, "jql": "..." }]
    }
  ],
  "rateSeries": [
    { "key": "regressionRate", "label": "Regression rate %", "points": [...] }
  ]
}
```

---

## Config

`server/config/systemTestScaleConfig.json`

- `kpiFilterTemplate` (`filter={teamCode}-System-Test`)
- `regressionTypes`, `defaultTeamId`
- `teams.<teamId>`: `teamCode`, `releases`, `carryPairs`, `componentReleases`, optional `components`
- Components default to flattened `teamBoardConfig.teams[].featureComponents` when not overridden

---

## Caching

None. Page load (GET) and Pull (POST `/refresh`) both hit JIRA live.

---

## Error handling

| Case | Client |
|------|--------|
| 403 | Show KPI access denied |
| 5xx / timeout | Show error + retry via Pull from JIRA |
| Partial JIRA failures | `errors` map on payload; counts default to 0 for failed keys |
