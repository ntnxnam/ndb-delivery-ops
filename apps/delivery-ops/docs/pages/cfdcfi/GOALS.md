# Goals — CFD / CFI V2 (VP-first unified dashboard)

> Canonical for `weave/cfdcfi-v2`. Mirrors `docs/pages/oncalls/GOALS.md` shape. `GOAL_KPI_CARD.md` in this folder is the stage-scored mirror.

## Primary

| ID | Goal | Done when |
|----|------|-----------|
| G1 | Global timeframe pills | `7d`/`15d`/`1M`/`1Q`/`2Q`/`1Y`/`18M`/`Overall` pills are sticky, drive all heroes/health/concern/breakdowns/boomerang/pulse; `Overall` = no `resolved >= -Nd` clause |
| G2 | Heroes (5) + health (4) with dual-click proof | `Open now` / `Aged >Nd` / `P0 open` / `P1 open` / `Closed in window` + `MTTR median` / `p90` / `Throughput (+net)` / `Aged share` each show count + explain + **Open in JIRA** proof; count → in-app `CfdcfiDrill`, link → exact hero JQL (`metric-click-dual-action`) |
| G3 | Chips filter + 6 breakdowns | Filter chip row (component / release / age-bucket / test-escape / TH linkage) narrows drawer; 6 breakdowns: `byComponent` / `byFixVersion` / `ageBuckets` / `testEscape` / `rootCause` / `linkage (thLinked/techPubsLinked)` each with count + JQL |
| G4 | Boomerang (deferred→scope) | `Boomerang` rate = `CFD/CFI ∩ ndb-*-deferred` / deferred universe `×100` with `byComponent` + `byFixVersion` drill; `gapMeta.boomerangKeys` drives AI concern `validKeys` |
| G5 | Pulse reuse (no fork) | `KpiPulseBand` mounted with `buildPulse({ window: computePulseWindow(tf) })` (`kpi-pulse-analytics`); no forked chart; `Overall` → default 2Q pulse window |
| G6 | Fused AI concern + per-view slice | `POST /api/ai/cfdcfi-concern` merges open/aged/MTTR/net/aged-share + boomerang rate + hotspot top-2 components into ~100w (Quantitative 40–45w + Qualitative 45–50w + Hotspot 50–60w + 2-line chase); `POST /api/ai/cfdcfi-slice` gives drawer 2-liner; both return `400 NAI_API_KEY not configured` like `oncall-concern/slice`; regenerates on pill/hero/chip/view; Loom `build_cfdcfi_prompt` (no NAI) → Lighthouse `generate_cfdcfi_brief` (D44) |
| G7 | Requirements locked | `docs/pages/CfdCfi-requirements.md` CC-V2-01..10 + acceptance; `docs/pages/CfdCfi-data-layer.md` timeframe/breakdown/boomerang/API; `docs/api/cfdcfi.md` V2 section; this folder + wireframe parity |

## Verification artifacts

- Server: `GET /api/jira/cfdcfi?teamId=ndb&timeframe=Overall&v2=1` returns `closedInWindow` with no `resolved >=` clause; `GET ?timeframe=7d&v2=1` has `resolved >= -7d`; live JQL spot-check one pill; `POST /api/jira/cfdcfi/refresh { timeframe:"7d", v2:"1" }` returns same V2 shape; `GET /api/jira/cfdcfi/v2` alias works
- Client: `CfdCfiV2Page` renders sticky pills + 5 heroes + 4 health + chip row + 6 breakdowns + boomerang card + `KpiPulseBand` + AI Concern + `CfdcfiDrill` with `activeChip` filter + `aiSlice`; legacy `CfdCfiPage` preserved at `/cfdcfi-legacy`
- Docs: `docs/pages/cfdcfi/GOAL_KPI_CARD.md` + `GOALS.md`/`feature.md`/`PLAN.md`/`STATUS.md`; `docs/pages/CfdCfi-*`; `docs/api/cfdcfi.md` V2 + legacy; `agent-pack/lighthouse/context/pages/cfdcfi.md` brief
- AI: `POST /api/ai/cfdcfi-concern` and `cfdcfi-slice` return fused concern/slice; 400 when `NAI_API_KEY` missing (same as `oncall-concern`); drawer linkifies `validKeys`; MCP `build_cfdcfi_prompt` + `generate_cfdcfi_brief` registered
