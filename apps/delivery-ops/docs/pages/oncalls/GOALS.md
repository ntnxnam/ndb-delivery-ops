# Goals — OnCalls pulse kit + authenticity

## Primary

| ID | Goal | Done when |
|----|------|-----------|
| G1 | Shared KPI Pulse on `/oncalls` | `buildPulse` + `KpiPulseBand` with weekly chart (last 2 Nutanix Qs) |
| G2 | Dual-click open-family | Open/Aged/P0/P1 count → PathDrill; Open in JIRA → exact pulse JQL |
| G3 | Status authenticity | Escalation field tickets show real JIRA status (Closed ≠ fake Resolved) |
| G4 | About chrome | ≤1 About-unavailable banner per drawer; no per-row NAI-limited badge |
| G5 | Requirements locked | Oncalls-requirements AC match kit + authenticity; STATUS evidence |

## Verification artifacts

- Client tests: AboutLine / EscalationDrill status / pulse wiring
- Manual: Closed CFD ticket shows Closed once; About miss → one banner
- Docs: requirements, data-layer, API, this STATUS
