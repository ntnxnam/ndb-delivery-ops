# Deferred Insights — Requirements

**Route:** `/deferred-insights`  
**Nav:** Quality / KPIs → Deferred Insights  
**Permission:** `kpi_view`  
**Team-aware:** yes — labelPrefix/releasePrefix/projectKey from `teamBoardConfig`

## What it does
Per-release view of bugs that got deferred: how many, where they landed (which fixVersion), what is still pending. Opens with line graph oldest→newest, then hero numbers, then drill-down by release with ticket tables. Ample filtering and drilling reusing same behaviour as other KPI pages.

## Stories
- As RM, I can see per-release deferred counts over time (line graph oldest→newest with fixed vs pending stacked) and click through to a release.
- As RM/PM, I see hero numbers: total deferred, fixed elsewhere, still pending, fix rate, release count — each with JIRA JQL proof.
- As IC/QA, I can drill into any release: where deferred bugs landed (by fixVersion chips), by priority/component breakdown, expandable ticket table + drawer with JQL link.
- As any KPI consumer, I can filter by release (multi-select chips), priority (allowlisted), component (free-text) and see all sections narrow consistently.

## Out of scope (v1)
- Changelog enrichment (who moved, when — pending latency/median-lag).
- Repeat-offender (3+ deferrals) table.
- Export CSV.
