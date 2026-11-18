# CFD / CFI API

## GET /api/jira/cfdcfi

**Purpose**: Live dashboard for team KPIs whose names match CFD/CFI (pulse + open-ticket samples).

**Auth**: required — JIRA token middleware + `kpi_view`

**Request**
- Method + path: `GET /api/jira/cfdcfi`
- Query params:
  - `teamId` (string, optional) — sidebar team; defaults via service if omitted
- Required headers: JIRA auth headers used by `validateJiraTokenMiddleware`

**Server flow**
Route `cfdcfi.js` → `checkKpiViewAuthorization` → `cfdcfiService.getDashboard` → `kpiConfig` / `buildKpiCombinedJql` / `buildPulse` / JIRA search

**Response shape**
```json
{
  "success": true,
  "teamId": "ndb",
  "jiraBaseUrl": "https://jira.nutanix.com",
  "kpiNamePattern": "CFD|CFI",
  "asOf": "2026-10-16T18:00:00.000Z",
  "kpis": [
    {
      "id": "kpi_…",
      "name": "Top-CFD",
      "baseQuery": "filter=142537",
      "combinedJql": "(…team…) AND (…)",
      "pulse": { "heroes": {}, "series": [], "story": "…" },
      "openTickets": {
        "total": 12,
        "truncated": false,
        "jql": "… AND statusCategory != Done",
        "issues": [{ "key": "ERA-1", "summary": "…", "status": "Open", "priority": "…", "assignee": "…", "ageDays": 5 }]
      }
    }
  ]
}
```

**Error responses**

| HTTP code | When | Client should |
|-----------|------|---------------|
| 403 | No `kpi_view` | Show access denied |
| 500 | JIRA / service failure | Show error; offer Pull retry |

**Caching**: No

---

## POST /api/jira/cfdcfi/refresh

**Purpose**: Explicit Pull from JIRA — same payload as GET.

**Auth**: required — JIRA token + `kpi_view`

**Request**
- Body: `{ "teamId": "ndb" }` (optional)

**Server flow**: Same as GET.

**Response shape**: Same as GET.

**Caching**: No
