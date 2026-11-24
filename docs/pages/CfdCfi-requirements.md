# CFD / CFI V2 — Requirements

**Route**: `/cfdcfi` (canonical — mounts `CfdCfiV2Page`; `/cfdcfi-legacy` retains tabbed pulse view)  
**Component**: `CfdCfiV2Page` (`apps/delivery-ops/client/src/components/CfdCfiV2/CfdCfiV2Page.js`)  
**Permission**: `kpi_view`  
**Audience**: `team-exec`, `tpm`, `director`, `team`, `rm`

---

## Purpose

VP-first CFD/CFI dashboard — one global timeframe pill drives every hero, health tile, AI concern, breakdown, boomerang signal, and pulse graph so a VP can answer *what's hot, what's stalling, boomerang risk, and what to fix* in one skim. Product-agnostic (D1); NDB is one tenant — tenant strings live in `cfdcfiConfig.json` + `kpiConfig`.

Unified lens (single dashboard, not per-KPI tabs):

- **Heroes + health:** open / aged / P0 / P1 / closed-in-window + MTTR median/p90/throughput/aged-share.
- **Breakdowns + boomerang:** by-component / by-fixVersion / age buckets / test-escape / root-cause / linkage (TH/TechPubs) + deferred→scope boomerang rate.
- **Graph + AI:** KPI Pulse window override + fused quant+qual concern and per-view slice.

Global pills: `7d` · `15d` · `1M` · `1Q` · `2Q` · `1Y` · `18M` · `Overall` — sticky, inherited in drawers (no reset). `Overall` = no date clause (all closed history). Legacy tabbed pulse preserved at `/cfdcfi-legacy`.

Loom JIRA pull + prompt build → Lighthouse AI consume (dual MCP: `loom-mcp buildCfdcfiPrompt` + `lighthouse-mcp generateCfdcfiBrief`).

---

## Audiences

| Audience | Use |
|----------|-----|
| Team Executive / VP | One-paragraph AI Concern + hotspot top-2 components + boomerang rate + fix-this; drill only when needed |
| TPM / Portfolio Manager | Timeframe skim, chase P0/P1 + aged + boomerang, own component/release hotspots |
| Director / EM | MTTR trend, aging buckets, component/release distribution, throughput |
| IC / RM | Interrupt load vs release work; per-hero JQL proof; test-escape/root-cause drill |

---

## User Stories

| ID | Story |
|----|-------|
| CC-V2-01 | As a VP, I open `/cfdcfi` and see AI Concern (~100w: Quantitative 40–45w + Qualitative 45–50w + Hotspot 50–60w + 2-line chase) that fuses quant (open/aged/MTTR/net/agedShare + boomerang rate) + qual (hotspot top-2 components + TH/test-escape themes) for the selected pill, and it regenerates when I change pill/hero/chip/view. |
| CC-V2-02 | As a TPM, I pick a timeframe pill (7d→Overall) and every hero/health/breakdown/boomerang/pulse/concern recomputes for that window; Overall shows all closed with no date clause. |
| CC-V2-03 | As a TPM, each hero shows count + one-line explainer + Open in JIRA proof (exact JQL) — count click drills in-app, Open in JIRA opens search. |
| CC-V2-04 | As a TPM, I see filter chips for component / fixVersion (release) / age bucket / test-escape / TH linkage / boomerang — clicking a chip filters the drawer to that slice; Clear resets. |
| CC-V2-05 | As a TPM, I see 6 breakdowns: By Component, By FixVersion, Age Buckets (0-7/8-30/31-90/90+), Test Escape, Root Cause, Linkage (TH linked / TechPubs) — each with count + JQL proof and in-app drill. |
| CC-V2-06 | As a TPM, I see Boomerang rate (deferred→scope: `CFD/CFI ∩ ndb-*-deferred` / deferred total) + by-component + by-fixVersion with JQL proof; clicking drills to deferred keys. |
| CC-V2-07 | As a TPM, health strip shows MTTR median/p90/throughput/aged-share; clicking MTTR/throughput opens closed-preview drill and regenerates AI slice. |
| CC-V2-08 | As a TPM, opening any hero/breakdown/boomerang shows `CfdcfiDrill` drawer with per-view AI slice (2-liner + fix suggestion) plus ticket rows filtered by `activeChip`; drawer inherits pill. |
| CC-V2-09 | As a TPM, the Created→Resolved graph (`KpiPulseBand`) uses the timeframe window override (`Overall` → default 2Q pulse) and shows flow for the pill window. |
| CC-V2-10 | As a TPM, changing team reloads the V2 dashboard for that team's `baseScopeJql` (clubbed CFD\|CFI + team base filter). |
| CC-01 | (Legacy) As a TPM, I open `/cfdcfi-legacy` and see one tab per team KPI matching CFD\|CFI, with open-count chips on tabs. |
| CC-11 | As a TPM, when NAI is unavailable the quantitative page still loads; AI panel shows `NAI_API_KEY not configured` (400) with retry and validKeys hint. |

---

## UI Behaviour

- **Header:** title `CFD/CFI V2` + team (TeamContext) + as-of + Pull from JIRA + Regenerate AI Concern
- **Global pills:** sticky `cfdcfi-v2-pills` (`7d`/`15d`/`1M`/`1Q`/`2Q`/`1Y`/`18M`/`Overall`); active pill has `active` class; stored in `useCfdcfiV2` state and sent as `?timeframe=` on every fetch
- **AI Concern card:** fused quant+hotspot+boomerang; states `idle` → `loading` → `done` (linkified JQL via `validKeys`) / `error` with 400 hint; Regenerate reuses dashboard snapshot; includes `gapMeta.boomerangKeys` as `validKeys`
- **Hero row (5):** Open now · Aged >Nd · P0 open · P1 open · Closed in window — each `ExplainHero` with count → drill, explain one-liner, `meta` (threshold/window), and `Open in JIRA ↗` (exact JQL)
- **Health row (4):** MTTR median · MTTR p90 · Throughput (with net) · Aged share — neutral tone; count → closed-preview drill; JQL from `pulse.mttr.jql` or `hero.closedInWindow.jql`
- **Chip row:** `Filter:` + single-active chips (component/fixVersion/ageBucket/testEscape/thLinked/boomerang) + Clear button; `activeChip` filters `CfdcfiDrill` rows
- **Breakdowns (6 cards):** By Component · By FixVersion · Age Buckets · Test Escape · Root Cause · Linkage (TH/TechPubs/total) — count + JQL; click → `CfdcfiDrill`
- **Boomerang card:** Rate % + `deferredTotal` + byComponent/byFixVersion mini-lists; `gapMeta.boomerangKeys` proof `key in (...)`
- **Graph:** `KpiPulseBand pulse={data.pulse}` titled `CFD/CFI pulse · {timeframe}`; inherits `windowOverride`; flow view
- **Drill drawer:** `CfdcfiDrill mode={open|agedOpen|p0Open|p1Open|closedInWindow|component:X|fixVersion:Y|ageBucket:Z|boomerang} tickets={filtered} jql gapMeta timeframe activeChip aiSlice aiSliceState` — per-view AI slice auto-generates on open; `activeChip` further filters rows
- **Legacy:** `CfdCfiPage` preserved at `/cfdcfi-legacy` with tabbed pulse per KPI; no removal in this weave

Metric-click dual-action (all pages): count → in-app drill; Open in JIRA → exact JQL.

---

## Permissions

- **View / refresh / AI**: `kpi_view` (`checkKpiViewAuthorization` + `validateJiraTokenMiddleware`)

---

## Edge Cases

- No team selected → `TeamRequiredGate` ("Select a team for CFD/CFI V2")
- `!baseScopeJql` (no CFD|CFI KPI for team) → `notConfigured` payload with message; page shows config hint
- No open CFD/CFI → heroes show 0; Pulse may be empty; AI concern still attempts with zero counts
- `Overall` → no date clause; closed window uses `seed AND statusCategory=Done` only (capped 200)
- `buildPulse` failure → `errors.pulse` set; page renders pulse error but heroes/breakdowns/boomerang still load
- NAI unavailable / timeout → `aiConcernError` / `aiSliceError` banner with 400 hint; quantitative page unaffected
- Empty breakdown/boomerang → cell shows 0 with no JQL; drill shows fallback closed preview
- Boomerang deferred enumeration empty (no `releaseVersionsEmailConfig.json` releases) → rate 0%, `deferredTotal` 0

---

## Acceptance Criteria

- [x] Route `/cfdcfi` mounts `CfdCfiV2Page` for `kpi_view`; legacy at `/cfdcfi-legacy`
- [x] Sticky global pills (8) drive all heroes/health/concern/breakdowns/boomerang/pulse; `Overall` = no date clause; pills inherited in drawers
- [x] Each hero shows count + explain + Open in JIRA (exact JQL); count → in-app drill (dual-action)
- [x] Chip row filters drawer (activeChip + Clear); 6 breakdowns with correct JQL proofs
- [x] Boomerang rate + byComponent/byFixVersion with `key in (...)` proof; `gapMeta.boomerangKeys` correct
- [x] Health MTTR strip distinct from heroes; throughput net shown; pulse window override per timeframe
- [x] AI Concern fuses quant+boomerang+hotspot in ~100w and regenerates on pill/hero/chip/view; per-view AI slice regenerates on drill
- [x] `KpiPulseBand` mounted with timeframe window; not forked (`kpi-pulse-analytics`)
- [x] Config thresholds wired from `cfdcfiConfig.json` (`agedOpenDays`/`needInfoDays`/`waitingForCustomerDays`/customFields)
- [x] No hardcoded `filter=142537` or Top-CFI/CFD (D1); clubbed `baseScopeJql` only
- [x] Page docs + API docs present; `docs-verify` PASS
- [x] Never JQL without approval (`jql-edit-approval`); `minimal-architecture` page/hook/service
