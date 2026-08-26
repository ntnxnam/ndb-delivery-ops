# KPI Page — Requirements

**Route**: `/kpis`  
**Component**: `KPIPage`  
**Permission**: `KPI_TAB_VIEW` (legacy `kpiTabAllowedUsers`)  
**Audience**: tpm, rm, team — per-team KPI widgets scoped by the team's base query

---

## Purpose

Configure and view per-team KPI widgets. Each widget's JIRA query is **`(team.baseFilter) AND (kpi.baseQuery)`**. The selected team comes from the shared sidebar `TeamContext` — the same team as Project Status, Sprint Report, and every other page.

---

## Audiences

tpm, rm, team_lead — KPI operators. Admin users for a team may edit the team's base filter and the KPI list.

---

## User Stories

| ID | Story |
|----|-------|
| KPI-01 | As a TPM, I pick a team in the sidebar and click Fetch, then see that team's KPIs without a second team dropdown. |
| KPI-02 | As a team admin, I set a team base filter (JQL) once; every KPI for that team AND's with it. |
| KPI-03 | As a TPM, I add/edit/delete/reorder KPIs (name, base query, count vs list). |
| KPI-04 | As a TPM, I load widget results (count or issue list) for the current team. |

---

## UI Behaviour

1. **Team** — inherited from `TeamContext` (sidebar). Changing the dropdown stages a team; **Fetch** applies it and reloads KPIs (and other team-scoped pages). No local team poll or duplicate fetch.
2. **Team base filter** — shown for the selected team; editable by team KPI admins. Saving updates `TeamContext` immediately so other pages see the new query.
3. **KPI table** — name, base query, widget type; admin reorder / edit / remove.
4. **Widgets** — load on demand via `/api/jira/kpi-results-batch`.

---

## Permissions

- View: `kpiTabAllowedUsers` / `KPI_TAB_VIEW`
- Edit KPIs and team base filter: `checkKpiAdminAuthorization(username, teamId)`

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| No team selected | Shared `TeamRequiredGate` with in-page selector + Retry |
| Team has no KPIs | Empty table; admin can add |
| Team has no base filter | KPI query runs as the KPI base query alone |
| Save base filter | Server cache invalidated; client `replaceTeams` so Sprint Report / Project Status see it |

---

## Acceptance Criteria

- [ ] Changing team in the sidebar reloads this page's KPIs with no 1s localStorage poll
- [ ] Saving a base filter makes `GET /api/config/teams` (and in-memory context) return the new value
- [ ] Widget JQL is `(baseFilter) AND (kpi.baseQuery)` when baseFilter is set
- [ ] Team id match is case-insensitive (`NDB` and `ndb` are the same team)
