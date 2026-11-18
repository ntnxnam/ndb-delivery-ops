# Feature — CFD / CFI pulse (`/cfdcfi`)

## Outcome

Team KPIs matching CFD|CFI get a tabbed pulse page: heroes, weekly graph (line/grouped bars + cumulative/point-in-time), and an in-page open-tickets drill.

## Constraints (preserve)

- `kpi-config-driven` — no hard-coded Top-CFI / Top-CFD names
- `jira-authenticity-links` — every count has exact JQL; drawer keeps “Open in JIRA”
- `kpi-pulse-analytics` — mount shared `KpiPulseBand` / `buildPulse`; chart toggles live in `CreatedResolvedChart`
- `jql-edit-approval` — compose onto KPI `baseQuery` only
- `minimal-architecture` — page / hook / service layers
- Outcome-first — chaseable heroes first; no raw universe dump as the lead tile

## Hero → popup (done)

Open-family hero click opens in-page `OpenTicketsDrill` via `PulseHero.onOpen` / `KpiPulseBand.onHeroClick`; JIRA remains secondary proof. Created / Resolved / MTTR stay count → JIRA (no popup), matching OnCalls Created/Closed 7d.

## Chart (done in shared kit)

`CreatedResolvedChart` toggles: **Line | Bars** (side-by-side Created / →Resolved / →Closed) and **Point-in-time | Cumulative**. Cumulative click uses `createdCumulative` / `resolvedCumulative` JQL (window start → week end).
