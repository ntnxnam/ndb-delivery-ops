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
      → buildQueries() — KPI filter + release All filters + cf[13260] slices + components + carry + ST pulse (label-based)
      → jira.searchCount(jql) × N (parallel workers)
      → assemble byRelease, trends, components, rag, stPulse
  → JSON response (counts + jql per cell)
```

---

## Data shapes

### Metric cell

```json
{ "count": 19, "jql": "filter=NDB-System-Test AND filter=NDB-2.11-All AND issuetype = Bug AND status not in (Resolved, Closed)" }
```

### ST pulse (label-based — filters 188191–188195)

```json
{
  "stPulse": {
    "global": {
      "all": { "count": 120, "jql": "project = ERA AND labels in (…) AND issuetype in (Bug, Improvement)" },
      "open": { "count": 40, "jql": "… AND statusCategory != Done" },
      "resolvedNotClosed": { "count": 8, "jql": "… AND status = Resolved AND resolution not in (Duplicate, \"Not a bug\", \"Config issue\")" }
    },
    "byRelease": {
      "NDB-2.12": {
        "affectedOpen": { "count": 5, "jql": "… AND affectedVersion in (ndb-2.12)" },
        "fixVersionOpen": { "count": 3, "jql": "… AND fixVersion in (ndb-2.12)" }
      }
    },
    "sourceFilters": { "all": 188191, "open": 188192, "resolvedNotClosed": 188193, "affectedOpen": 188194, "fixVersionOpen": 188195 },
    "byLabel": {
      "longevity": {
        "key": "longevity",
        "title": "Longevity",
        "label": "longevity",
        "all": { "count": 12, "jql": "project = ERA AND labels = longevity AND issuetype in (Bug, Improvement)" },
        "open": { "count": 4, "jql": "… AND statusCategory != Done" }
      },
      "smoke": { "key": "smoke", "title": "System Smoke", "label": "ndb-system-smoke-test", "all": {}, "open": {} },
      "functional": { "key": "functional", "title": "Functional (ST-found)", "label": "ndb-systest-found-functional-bug", "all": {}, "open": {} },
      "scale": { "key": "scale", "title": "Scale", "label": "ndb-scale", "all": {}, "open": {} }
    }
  }
}
```

Client `selectReleaseView` merges `global` + `byRelease[current]` so Current/Compare switches instantly, and flattens `byLabel` for the label widgets.

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
- `stPulse`: project, labels, issueTypes, resolvedNotClosedResolutionExclude, sourceFilters (188191–188195), labelWidgets (longevity / smoke / functional / scale)
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
