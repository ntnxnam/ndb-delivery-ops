# Goals — OnCalls V2 (VP-first 2-lens rebuild)

## Primary

| ID | Goal | Done when |
|----|------|-----------|
| G1 | Global timeframe pills | `7d`/`15d`/`1M`/`1Q`/`2Q`/`1Y`/`18M`/`Overall` pills are sticky, drive all heroes/health/concern/age/graph/taxonomy; `Overall` = no date clause |
| G2 | At-a-glance + health heroes | Open now / Aged >Nd / Need Info / Waiting for Customer / Closed in window + MTTR median/p90/throughput/aged-share each show count + explain + Open in JIRA proof |
| G3 | Workflow buckets | Need Info (`status="Need Info"`) vs Waiting for Customer (`status="Waiting for Customer"`) as first-class buckets with config thresholds |
| G4 | Gap taxonomy + NDB sub-drill | Duds / NDB gaps / Other-team gaps with past drills; NDB double-click expands TH linked / Bugs / Improvements / Other |
| G5 | Fused AI concern | ~100w concern merges open/MTTR/net + hotspot top-2 components + gap%; regenerates on pill/hero/taxonomy/view; per-view 2-liner in drawer |
| G6 | Requirements locked | `docs/pages/Oncalls-requirements.md` OC-V2-01..12 + acceptance; `docs/pages/Oncalls-data-layer.md` timeframe/gap/API; `docs/api/jira.md` V2 section; this folder |

## Verification artifacts

- Server: `GET /api/jira/oncalls?timeframe=Overall` returns closed count with no `resolved >=` clause; `GET ?timeframe=15d` has correct clause; live JQL spot-check one pill
- Client: `OncallsV2Page` renders sticky pills + 5 heroes + 4 health + AI Concern + age table + KpiPulseBand + 3 taxonomy + NDB sub-drill
- Docs: `docs/pages/oncalls/GOAL_KPI_CARD.md` + `GOALS.md`/`Feature.md`/`PLAN.md`/`STATUS.md` + wireframe.html; `docs/pages/Oncalls-*`; `docs/api/jira.md`
- AI: `POST /api/ai/oncall-concern` and `oncall-slice` return fused summaries; drawer linkifies keys
