# Feature — OnCalls pulse (`/oncalls`)

## Outcome

OnCalls KPI page: shared KPI Pulse (heroes + weekly graph) above chase/path/escalation bands. Status and About chrome stay truthful for TPM skim.

## Constraints (preserve)

- `kpi-config-driven` — OnCalls `baseQuery` from kpiConfig only
- `kpi-pulse-analytics` — mount `KpiPulseBand` / `buildPulse`; no forked chart
- `jira-authenticity-links` / `metric-click-dual-action` — count → panel; Open in JIRA → JQL
- `jql-edit-approval` — compose onto baseQuery only
- `no-defensive-statements` — no per-row “NAI limited” apology chrome
- `visual-storyteller-ui` — story / chase first; footprint proof-only

## Status authenticity

Field ticket chip = JIRA `status` name. Done bucket hero = **KPI cleared**. Never invent “Resolved” for Closed tickets (Nutanix: Resolved = TBV).

## About

Inferred About when NAI returns; else structured pathHint. Drawer-level banner when About missing for the set.
