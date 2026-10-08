---
name: release-gates
area: domain
---

# Release gates & phase language

Canonical agent brief. Field IDs live in `productService` / jira field config —
do not hard-code `customfield_*` in new prompts.

## Hierarchy

```
X-FEAT / Capability → Feature / Initiative → Epic → everything else
```

## Gate dates (FEAT-tier)

| Gate | Meaning |
|---|---|
| EC | Early Commitment |
| Code Complete (CC / CCM) | Code-complete milestone |
| Commit Gate (CG) | Commit readiness |
| Promotion Gate (PG) | Promotion readiness |
| GA | General availability |

Maintenance / patch releases: typically **CC + GA only** — interim gates empty.

## Phase labels (exec-summary / briefing)

Inception → Design → Coding → CC Met → CG Met → PG Met → Shipped.

Phase drives which hygiene fields matter (`execSummarySignals` PHASE_FOCUS /
PHASE_IGNORE). Never flag TEAM_NA fields as hygiene gaps.

## Release health RAG floor (release briefing)

First match wins (also in `ai-ticket-key-integrity` / `riskIndicator`):

| Condition | Verdict |
|---|---|
| OPEN_P0_BLOCKERS > 0 | RED |
| OPEN_MUSTFIX > 0 AND DAYS_TO_PG ≤ 14 | RED |
| gate-lagging features > 2 | RED |
| OPEN_MUSTFIX > 0 | YELLOW |
| gate-lagging 1–2 OR dark > 20% OR compliance-at-risk > 0 | YELLOW |
| else clean | GREEN |

`GREEN` is invalid when any open must-fix label count > 0.

## UI rule — Release briefing panel

- Panel border / header: always neutral
- RAG badge appears once inside body at `## Release Health: <VERDICT>`

## Related prompts

- `prompts/production/release-health-briefing.md`
- `prompts/production/feature-exec-summary.md`
- `prompts/production/sos-tier-briefing.md`
