# CFD / CFI — Data Layer

**Route**: `/cfdcfi`  
**Component**: `CfdCfiPage`  
**Hook**: `useCfdCfi`

---

## API endpoints called

| Method | Path | When |
|--------|------|------|
| GET | `/api/jira/cfdcfi?teamId=` | Initial load / team change |
| POST | `/api/jira/cfdcfi/refresh` | Pull from JIRA |

---

## Server flow

```
GET/POST /api/jira/cfdcfi
  → checkKpiViewAuthorization
  → cfdcfiService.getDashboard({ token, teamId })
       → load cfdcfiConfig.kpiNamePattern (default CFD|CFI)
       → getKpisForTeam(kpiConfig) → filter name by pattern (exclude OnCalls)
       → for each matched KPI (parallel):
            buildKpiCombinedJql(teamId, baseQuery)
            buildPulse({ token, baseJql: resolveKpiJql(kpi) /* not open-scoped combinedJql */, optionalHeroes: p0/p1/tbv })
            open list still uses combinedJql (team base may include statusCategory!=Done)
            searchPages open issues (statusCategory != Done) for drill sample
       → return { teamId, jiraBaseUrl, kpiNamePattern, kpis: [...], asOf }
```

---

## Domain rules

| Item | Rule |
|------|------|
| KPI selection | `kpiConfig` names matching `cfdcfiConfig.kpiNamePattern`; never hard-code Top-CFI / Top-CFD |
| Pulse window | Last **2** Nutanix fiscal quarters (`kpiPulseService`) |
| Combined JQL | `(teamBaseFilter) AND (resolved KPI baseQuery)` via `buildKpiCombinedJql` |
| Open drill | Sample of open issues under that KPI’s combined JQL; counts still use pulse hero JQL |

---

## Caching

- Live on load / Pull — no durable dashboard cache

---

## Error handling

| Case | Client |
|------|--------|
| 403 | Access denied |
| No matched KPIs | Empty state |
| Pulse / search failure | Error banner; other KPIs may still render |
