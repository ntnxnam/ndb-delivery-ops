---
name: cfdcfi
route: /cfdcfi
audience: tpm, team, rm, team-exec
---

# CFD / CFI V2 — VP-first unified dashboard

**Route**: `/cfdcfi` (V2 canonical — `CfdCfiV2Page`; legacy tabbed `CfdCfiPage` at `/cfdcfi-legacy`)  
**Audience**: `tpm, team, rm, team-exec`  
**Permission**: `kpi_view`

## Job

For the sidebar team, show a **unified VP-first dashboard** where one global **timeframe pill** (`7d`/`15d`/`1M`/`1Q`/`2Q`/`1Y`/`18M`/`Overall`, `Overall` = no `resolved >= -Nd` clause) drives **all heroes + health + chip-filtered breakdowns + boomerang + pulse + AI concern**. Never hard-code `filter=142537` or Top-CFI/CFD — `kpiNamePattern` `CFD|CFI` via `cfdcfiConfig.json` clubs `kpiConfig` `baseQuery` values + `teamBaseFilter` → `baseScopeJql`.

## IA (V2 — unified)

One pill controls the business story: **sticky pills (8)** → **AI Concern** (~100w fused quant + hotspot + boomerang rate; auto after load, regenerates on pill/hero/chip/view) → **5 heroes** (Open now / Aged >14d / P0 open / P1 open / Closed in window) + **4 health** (MTTR median / p90 / Throughput+net / Aged share) — each `ExplainHero` with **dual-click**: count → `CfdcfiDrill`, `Open in JIRA ↗` → exact hero JQL → **chip filter row** (component / fixVersion / age-bucket / test-escape / TH linkage / boomerang; single-active, narrows drawer) → **7 breakdowns** (Customer found categories, by-component, by-fixVersion, age buckets 0-7/8-30/31-90/90+, test-escape, root-cause, linkage TH/TechPubs with counts + JQL) → **boomerang** card (rate `CFD/CFI ∩ ndb-*-deferred` + deferredTotal + by-component/by-release) → **KPI Pulse** (`KpiPulseBand` with `window: computePulseWindow(tf)`, reuse not fork) → **CfdcfiDrill** drawer with per-view AI slice (2-liner + chase). Legacy `/cfdcfi-legacy` keeps tabbed pulse.

## Heroes — dual-click

Every hero count that has a JQL proof uses `metric-click-dual-action`: **count `<button>` → in-app `CfdcfiDrill`** (rows from `openTickets`/`closedStacksPreview`/`gapMeta.boomerangKeys` via `deriveKeysForView(view)` capped 12, further filtered by `activeChip`), **Open in JIRA ↗ → exact `cell.jql`** (`jiraHref`). Never both external. Created/Resolved/MTTR/throughput may show `count → JIRA` only when no filtered universe applies (closed-preview for `closedInWindow`).

## Chips — filtering

`ChipRow` renders `Filter:` + chips `{label, count, kind:value}` from `breakdowns` + `boomerang`; `activeChip` is `kind:value` or null; clicking a chip sets it (toggle), `Clear` resets. `CfdcfiDrill` `filteredRows` double-filters by `mode` + `activeChip` (component name match, fixVersion match, age range, testEscape value, `techHelp.length>0`).

## Timeframes

`TIMEFRAMES = {7d:7,15d:15,1M:30,1Q:90,2Q:180,1Y:365,18M:540,Overall:null}` in `cfdcfiDashboardV2.js` + `useCfdcfiV2.js`. `timeframeClause('resolved', tf)` returns `resolved >= -Nd` or `null` for `Overall`. Pill selection drives `GET /api/jira/cfdcfi?teamId=&timeframe=&v2=1` (or `/v2` alias) and `POST /api/ai/cfdcfi-concern|slice`; drawer inherits pill, never resets. `computePulseWindow(tf)` gives `KpiPulseBand` window; `Overall` defaults to 2Q window.

## AI — concern + slice

`POST /api/ai/cfdcfi-concern` (body `teamId`/`timeframe`/`dashboard`) → optionally `cfdcfiDashboardV2.getDashboard` → `generateCfdcfiConcern({ hero, health, breakdowns, boomerang, componentMix, validKeys: gapMeta.boomerangKeys→openTickets, stacksPreview })` with `CFDCFI_CONCERN` prompt (Quantitative 40–45w + Qualitative 45–50w + Hotspot 50–60w + 2-line chase). `POST /api/ai/cfdcfi-slice` (body `view`/`keys`/`timeframe`/`meta`) → `generateCfdcfiSlice`. Both return **400 `NAI_API_KEY not configured`** when key missing (same as `oncall-concern`/`oncall-slice`), never 200 fallback that hides the bug. Per-view slice regenerates on drill open. Loom `mcp/shared/tools/buildCfdcfiPrompt.ts` `build_cfdcfi_prompt` (JIRA pull + prompt, no NAI) → Lighthouse `mcp/lighthouse/src/tools/generateCfdcfiBrief.ts` `generate_cfdcfi_brief` (calls `aiConnector`).

## Never hard-code `filter=142537`

`filter=142537` (and siblings 142539/142541/142543) are NDB-specific saved filters — violate D1 `product-agnostic`. V2 `baseScopeJql` is derived only from `kpiConfig` CFD|CFI `baseQuery` OR-club + `teamBaseFilter` (`cfdcfiConfigResolve.resolveRuntimeConfig`). Grep must not find `142537` in V2 page/service/config.

## Engineering docs

`apps/delivery-ops/docs/pages/cfdcfi/{GOALS,feature,PLAN,STATUS}` + `docs/pages/cfdcfi/{GOALS,feature,PLAN,STATUS,GOAL_KPI_CARD}` + `CfdCfi-requirements.md` + `CfdCfi-data-layer.md`  
`docs/api/cfdcfi.md` → V2 `GET ?timeframe=&v2=1` + `/v2` + `POST /refresh` V2 + `POST /api/ai/cfdcfi-concern|slice` (400)  
`server/config/cfdcfiConfig.json` (`kpiNamePattern`, `agedOpenDays` 14, `needInfoDays`/`waitingForCustomerDays`, `rag.boomerangRate`, `customFields` Test Escape 12672 / Root Cause 12670 / Corrective 12674 / RCA 40067)  
Services: `cfdcfiConfigResolve` → `cfdcfiStacksService` → `cfdcfiDashboardV2` (`TIMEFRAMES`, `timeframeClause`, `fetchDeferredBoomerangs`)  
Hooks: `useCfdcfiV2` (`TIMEFRAMES`, auto concern via `POST /api/ai/cfdcfi-concern`) + `useCfdcfiSlice`  
MCP: `mcp/shared/tools/buildCfdcfiPrompt.ts` + `mcp/lighthouse/src/tools/generateCfdcfiBrief.ts`

Skill: `kpi-pulse-analytics` · Rules: `kpi-config-driven` · `metric-click-dual-action` · `jira-authenticity-links` · `jql-edit-approval` · `minimal-architecture` · `product-agnostic` D1

## Agent notes

- Never hard-code `filter=142537` / `filter=NDB-*` / Top-CFI/CFD — map clubbed `baseScopeJql` from API; V2 clubs CFD|CFI into one scope.
- Compose onto `cfdcfiSeedJql` / `buildKpiCombinedJql` + `teamBaseFilter`; no silent JQL edits (`jql-edit-approval`).
- Dual-click: count → `CfdcfiDrill` via `deriveKeysForView(view)` + `activeChip`; `Open in JIRA ↗` → exact `cell.jql` / `keysInJql`. Never both external.
- Chips single-active + Clear; reset on timeframe change; drawer double-filtered by `mode` + `activeChip`.
- Boomerang = `labels in (ndb-*-deferred)` sweep ∩ `baseScopeJql` membership via chunked `key in (…)`; `gapMeta.boomerangKeys` → `validKeys` for concern.
- AI concern ~100w + per-view 2-liner via `POST /api/ai/cfdcfi-concern|slice`; 400 when `NAI_API_KEY` missing — page keeps heroes/pulse/breakdowns.
- Pulse reuses `KpiPulseBand` (`kpi-pulse-analytics`) with `window: computePulseWindow(tf)`; `Overall` → default 2Q.
