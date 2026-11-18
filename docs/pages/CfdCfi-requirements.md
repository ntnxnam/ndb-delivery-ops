# CFD / CFI — Requirements

**Route**: `/cfdcfi`  
**Component**: `CfdCfiPage`  
**Permission**: `kpi_view`  
**Audience**: `tpm`, `team`, `rm`, `team-exec`

---

## Purpose

Ops pulse page for every team KPI whose name matches **CFD** or **CFI** (from `kpiConfig.json` for the sidebar team). One DependencyView-style tab per matched KPI; each tab shows shared KPI Pulse heroes + weekly created/resolved graph, plus an open-ticket drill drawer.

NDB today typically surfaces Top-CFI · Top-CFD · Non-Top-CFI · Non-Top-CFD — names are never hard-coded; the page maps whatever the pattern matches.

---

## Audiences

| Audience | Use |
|----------|-----|
| TPM / Portfolio Manager | Weekly CFD/CFI pulse, open vs resolved, aged open |
| EM / team | Per-KPI chase list (open tickets drawer) |
| Team Executive | Story caption + RAG-friendly heroes (no JQL in narrative) |

---

## User Stories

| ID | Story |
|----|-------|
| CC-01 | As a TPM, I open `/cfdcfi` and see one tab per team KPI matching CFD\|CFI, with open-count chips on tabs. |
| CC-02 | As a TPM, the active tab shows KPI Pulse (last 2 Nutanix Qs): open / created / resolved / net / MTTR / aged open / status dwell + weekly chart. |
| CC-03 | As a TPM, every pulse count opens the exact JQL that produced it. |
| CC-04 | As a TPM, clicking a pulse hero with JQL (Open now / aged / P0 / P1 / TBV / Created / Resolved / MTTR) opens the in-page drill drawer; open-family heroes show ticket rows from the open sample; every drawer keeps “Open matching tickets in JIRA” for the hero’s exact JQL. |
| CC-05 | As a TPM, changing team reloads matched KPIs for that team. |
| CC-06 | As a TPM, a CFD/CFI chip on `/kpis` deep-links to `/cfdcfi`. |
| CC-07 | As a TPM, if no KPIs match, I see a clear empty state (not a hard-coded tile list). |

---

## UI Behaviour

- Header: title, team (TeamContext), Pull from JIRA, as-of
- Tabs: one per matched KPI (DependencyView tab chrome); count = open now
- Active tab: `KpiPulseBand` (shared kit) then page-specific open-ticket drill
- Open-family hero count click (Open now, Aged, P0/P1, Awaiting QA) → in-page drawer; secondary “Open in JIRA ↗” on the tile
- Created / Resolved / MTTR counts → JIRA only (no popup), same as OnCalls Created/Closed 7d
- Chart height ≤ 280px
- No hard-coded KPI names in UI code — render matched names from API

---

## Permissions

- **View / refresh**: `kpi_view`

---

## Edge Cases

- No matching KPIs → empty state naming the pattern
- Pulse count errors → warn; zeros treated with caution
- Open-ticket sample truncated → note in drawer (“Showing N of M”)

---

## Acceptance Criteria

- [ ] Route `/cfdcfi` in sidebar for `kpi_view`
- [ ] KPIs resolved via config name pattern (same idea as OnCalls escalation)
- [ ] Pulse mounted via `buildPulse` + `KpiPulseBand` (no one-off created/resolved chart)
- [ ] Every countable hero has a JIRA link (tile hint and/or drawer proof)
- [ ] Open-family hero counts open in-page `OpenTicketsDrill`; Created/Resolved/MTTR are count → JIRA only
- [ ] Page docs + API docs present
- [ ] `/kpis` CFD/CFI widgets deep-link here
- [ ] Unit tests: `openTicketsFilter`, `PulseHero` onOpen
