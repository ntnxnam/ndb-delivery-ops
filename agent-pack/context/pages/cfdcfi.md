---
name: cfdcfi
route: /cfdcfi
audience: tpm, team, rm, team-exec
---

# CFD / CFI pulse

**Route**: `/cfdcfi`  
**Audience**: `tpm, team, rm, team-exec`  
**Permission**: `kpi_view`

## Job

For the sidebar team, show one tab per KPI whose name matches CFD|CFI
(`kpiConfig` + `cfdcfiConfig.kpiNamePattern`). Each tab mounts shared
KPI Pulse (last 2 Nutanix Qs) and an open-ticket drill.

## Engineering docs

`apps/delivery-ops/docs/pages/` → CfdCfi-requirements.md, CfdCfi-data-layer.md  
`apps/delivery-ops/docs/api/cfdcfi.md`  
Skill: `kpi-pulse-analytics` · Rule: `kpi-config-driven`

## Agent notes

- Never hard-code Top-CFI / Top-CFD — map matched KPIs from API.
- Compose onto `buildKpiCombinedJql`; no silent JQL edits.
- Dual-click: open-family hero **count → `OpenTicketsDrill`**; **Open in JIRA ↗ → exact JQL** (`onHeroClick` / `PulseHero.onOpen`). Never both external.
- Story caption plain English.
