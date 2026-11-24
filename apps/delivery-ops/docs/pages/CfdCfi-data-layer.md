# CFD / CFI V2 — Data Layer

**Route**: `/cfdcfi` (V2) · `/cfdcfi-legacy` (tabbed pulse)  
**Component**: `CfdCfiV2Page` · `CfdCfiPage` (legacy)  
**Hooks**: `useCfdcfiV2` · `useCfdcfiSlice` · `useCfdCfi` (legacy)

---

## API endpoints called

| Method | Path | When |
|--------|------|------|
| GET | `/api/jira/cfdcfi?teamId=&timeframe=&v2=1` | Initial load / team or timeframe change (V2) |
| GET | `/api/jira/cfdcfi/v2?teamId=&timeframe=` | Explicit V2 alias (same) |
| POST | `/api/jira/cfdcfi/refresh` | Pull from JIRA (V2 when `timeframe`/`v2` present, else legacy tabbed) |
| POST | `/api/jira/cfdcfi/v2/refresh` | Pull V2 alias |
| POST | `/api/ai/cfdcfi-concern` | Generate fused AI Concern (auto after metrics load + on Regenerate + on pill/hero/chip/view change) |
| POST | `/api/ai/cfdcfi-slice` | Per-view AI 2-liner for drill drawer (on open drill) |
| GET | `/api/jira/cfdcfi?teamId=` | Legacy tabbed initial load (no timeframe) |
| POST | `/api/ai/oncall-concern` | OnCalls legacy (not CFD/CFI) |

---

## Server flow — V2

```
GET /api/jira/cfdcfi?timeframe=&v2=1        → checkKpiViewAuthorization
GET /api/jira/cfdcfi/v2?timeframe=          → cfdcfiDashboardV2.getDashboard({ token, teamId, timeframe })  [6-way parallel]
  1. resolveRuntimeConfig(teamId)            → baseScopeJql (clubbed CFD|CFI kpiConfig.baseQuery + teamBaseFilter), agedOpenDays/needInfoDays/waitingForCustomerDays, optionalHeroes p0/p1/tbv
  2. buildTimeframeHeroQueries(cfg, tf)      → heroes + TIMEFRAMES{7d:7,15d:15,1M:30,1Q:90,2Q:180,1Y:365,18M:540,Overall:null} + timeframeClause('resolved', tf) = resolved >= -Nd or null
  3. runCounts(queries)                      → jira.searchCount per hero (concurrency 6, soft-fail per hero)
  4. fetchOpenStacks(token, cfg)             → searchPages open CFD/CFI + linked fetch + classifyStacksFromIssues → stacks, componentMix, fixVersionMix, linkage, cfdcfiFields
  5. fetchClosedCfdcfiStacks(token,cfg,tf)   → searchPages closed seeds (seed AND statusCategory=Done AND resolved >= -Nd || no clause) cap 200 → closedStacks
  6. linkedOut searchCount linkedIssuesOf(baseScopeJql)
  7. buildPulse({ token, baseJql, window: computePulseWindow(tf) }) — Overall → default 2Q pulse; soft-fail
  8. fetchDeferredBoomerangs(token,cfg)      → labels in (ndb-*-deferred) from releaseVersionsEmailConfig releases → chunked key in (...) AND baseScope membership → boomerangKeys + rate
  9. breakdowns { byComponent, byFixVersion, ageBuckets, testEscape, rootCause, linkage } + boomerang { keys, rate, deferredTotal, byComponent, byFixVersion, cell } + gapMeta { boomerangKeys } + health { mttrMedian, p90, net, throughput, agedShare }
  → { teamId, baseScopeJql, timeframe, hero, health, pulse, breakdowns, boomerang, gapMeta, componentMix, fixVersionMix, openTickets, stacksPreview, closedStacksPreview, errors }

POST /api/jira/cfdcfi/refresh               → same, force: true via authenticatedPost with { teamId, timeframe, v2 }
GET/POST /api/jira/cfdcfi/v2/*             → same V2 orchestrator

POST /api/ai/cfdcfi-concern  Body: { teamId, timeframe, dashboard }
  → cfdcfiDashboardV2.getDashboard if dashboard missing hero
  → naiService.buildCfdcfiConcernPrompt / generateCfdcfiConcern(concernInput { hero, health, breakdowns, boomerang, componentMix, validKeys: gapMeta.boomerangKeys→openTickets, stacksPreview })
  → Loom builds prompt (no NAI), Lighthouse calls NAI (CFDCFI_CONCERN); 400 when NAI_API_KEY missing

POST /api/ai/cfdcfi-slice  Body: { teamId, timeframe, view, keys, meta }
  → naiService.generateCfdcfiSlice({ view, keys, timeframe, meta })  (CFDCFI_SLICE); 400 when NAI_API_KEY missing
```

Legacy flow (no timeframe): `GET/POST /api/jira/cfdcfi` → `checkKpiViewAuthorization` → `cfdcfiService.getDashboard({ token, teamId })` → clubbed kpiConfig CFD|CFI + `buildPulse` per KPI tab → `{ kpis: [{ pulse, openTickets }] }`. See pre-V2 docs.

Modules (V2): `cfdcfiDashboardV2.js` (orchestrator) · `cfdcfiStacksService.js` (classify) · `cfdcfiConfigResolve.js` (clubbing + TIMEFRAMES) · `kpiPulseService.js` · `cfdcfiService.js` (legacy) · `naiService.js` (CFDCFI_CONCERN + CFDCFI_SLICE) · `routes/jira/cfdcfi.js` · `routes/ai.js` · `mcp/shared/tools/buildCfdcfiPrompt.ts` + `mcp/lighthouse/src/tools/generateCfdcfiBrief.ts`

---

## Domain classification — V2 breakdowns + boomerang

| Breakdown | Rule |
|-----------|------|
| `byComponent` | `topN(componentMix,8)` from open stacks `components` |
| `byFixVersion` | `topN(fixVersionMix,8)` from `fixVersions` |
| `ageBuckets` | `0-7` / `8-30` / `31-90` / `90+` by `ageDays` |
| `testEscape` | `cfdcfiFields.testEscape` value (customfield_12672) — `topN(...,8)` |
| `rootCause` | `cfdcfiFields.rootCause` (customfield_12670) — `topN(...,8)` |
| `linkage` | `thLinked` = `techHelp.length>0`, `techPubsLinked` = `techPubs.length>0`, `totalOpen` = open stacks length |
| `boomerang` | Deferred labels `ndb-*-deferred` from `releaseVersionsEmailConfig.json` → `labels in (...)` → deferredKeys (cap 200) → chunked `key in (chunk) AND (baseScopeJql)` membership → `boomerangKeys` + `rate = boomerangKeys.length / deferredTotal ×100`; `boomerangCells.total = keysInJql(boomerangKeys)` |

All cells are `cell(count, jql)` where `jql = key in (…)` or null; all hero JQL composes `baseScopeJql` + `statusCategory`/`resolved >= -Nd`/`priority` only — never edits `kpiConfig` baseQuery.

### Timeframe pills → JQL

| Pill | `timeframeClause('resolved', pill)` | Notes |
|------|-------------------------------------|-------|
| `7d` · `15d` · `1M` · `1Q` · `2Q` · `1Y` · `18M` | `resolved >= -Nd` (N = 7/15/30/90/180/365/540) | Windowed closed count |
| `Overall` | `null` (no clause) | All closed history — server omits date filter; `computePulseWindow` returns default 2Q window |

### Boomerang detail

- Labels enumerated from `releaseVersionsEmailConfig.json` `releaseGateDates` keys → `${version.toLowerCase()}-deferred`; fallback empty when no releases.
- Deferred search: `searchPages(token, labels in ("ndb-2.11-deferred", …), maxTotal 200)` → `deferredKeys`.
- Membership: for each chunk of 80: `key in (chunk) AND (baseScopeJql)` via `jira.get('/rest/api/2/search')` → `boomerangKeys`.
- By-component / by-fixVersion boomerang breakdowns derived from `openStacks` intersecting `boomerangKeys` set.

---

## Client flow — V2

```
useCfdcfiV2(teamId, initial='7d')
  load({ force=false }) → authenticatedGet('/api/jira/cfdcfi', { teamId, timeframe, v2:'1' })
  load({ force=true })  → authenticatedPost('/api/jira/cfdcfi/refresh', { teamId, timeframe, v2:'1' })
  set timeframe → effect resets aiConcern + reloads; activeChip reset

  auto: after data.asOf changes → POST /api/ai/cfdcfi-concern { teamId, timeframe, dashboard }
  on drill open(view, keys, meta) → POST /api/ai/cfdcfi-slice { view, keys, timeframe, meta }

CfdCfiV2Page
  PillBar(8) sticky top → deriveKeysForView(mode) caps 12 keys from openTickets / gapMeta.boomerangKeys / closedStacksPreview
  health + breakdown + boomerang cards: count→openDrill, jql→Open in JIRA ↗
  ChipRow(single-active) → activeChip narrows CfdcfiDrill filteredRows
  CfdcfiDrill({ mode, tickets, jql, cellCount, scope, gapMeta, agedDays, teamId, timeframe, aiSlice, activeChip })
```

Legacy: `useCfdCfi` → `GET /api/jira/cfdcfi?teamId=` (no timeframe) → `CfdCfiPage` tabbed `KpiPulseBand` per KPI.

---

## Config

`server/config/cfdcfiConfig.json` (per D1 — no hardcoded product strings):

| Field | Purpose |
|-------|---------|
| `kpiNamePattern` (`CFD\|CFI`) | Regex to select `kpiConfig` KPIs to club |
| `defaultTeamId` (`ndb`) | Fallback team |
| `agedOpenDays` (14) | Aged threshold for hero + health agedShare |
| `needInfoDays` (10), `waitingForCustomerDays` (21) | Legacy threshold meta (not V2 hero JQL) |
| `pastLookbackDays` (30) | Not used in V2 `Overall`; kept for legacy `maxPastIssuesFetch` |
| `openStatusJql` / `doneStatusJql` | `statusCategory != Done` / `= Done` |
| `maxOpenIssuesFetch` / `maxPastIssuesFetch` (200) | Fetch caps for open/closed stacks |
| `maxOpenTickets` (80) | Drawer cap |
| `optionalHeroes` {p0,p1,tbv} | Priority slices enabled |
| `slaThresholds` + `rag.redBoomerangRate` (20) | RAG boomerang red threshold |
| `techHelpProjects` / `techPubsProjects` / `knowledgeProjects` | Linked-role project scoping |
| `customFields` (testEscape 12672, rootCause 12670, corrective 12674, rcaStatus 40067) | CFD/CFI screen field IDs for `extractCfdcfiFields` → `stacksPreview.cfdcfiFields` → AI Stack Sample |

MCP: `mcp/shared/tools/buildCfdcfiPrompt.ts` (Loom, read-only prompt build) + `mcp/lighthouse/src/tools/generateCfdcfiBrief.ts` (Lighthouse, NAI call).

---

## Caching

- Dashboard counts + pulse + stacks + boomerang: `SimpleCache(5m)` per `teamId:timeframe` in `cfdcfiDashboardV2`
- No durable dashboard cache; Pull bypasses only when `force:true` but still benefits from `heroCache` on GET
- `oncallDashboardV2` parallelizes with `allSettled`; partial errors surface in `errors` map

---

## Error handling

| Case | Client |
|------|--------|
| 403 | Show access denied |
| `errors.counts` / `errors.openStacks` / `errors.closedStacks` / `errors.boomerang` | Hero shows 0 with jql null; rest of page loads |
| `errors.pulse` | KpiPulseBand error banner; heroes/breakdowns/boomerang still load |
| `notConfigured` (no baseScopeJql) | Show config hint ("Add CFD/CFI KPI in Admin → KPIs") |
| `NAI_API_KEY not set` on AI call | 400 `NAI_API_KEY not configured on the server` + setup hint; quantitative page works (same as OnCalls) |
| NAI timeout / 502 | AI panel shows error with retry; "Regenerate" reuses snapshot |
