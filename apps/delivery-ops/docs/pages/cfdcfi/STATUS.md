# STATUS — CFD / CFI V2 (VP-first unified dashboard)

**Branch**: `weave/cfdcfi-v2` — see [GOALS.md](./GOALS.md) (GOAL + DONE WHEN) and [GOAL_KPI_CARD.md](./GOAL_KPI_CARD.md) (AGENT KPIs)

**Goal state**: COMPLETE — Dev + Docs + AI wiring + MCP split ready for Doc sign-off (Security paused per policy). Legacy tabbed view preserved.

## KPI scorecard

| Goal | Verdict | Evidence |
|------|---------|----------|
| G1 Global timeframe pills | MET | `cfdcfiDashboardV2.TIMEFRAMES` 8 pills `7d/15d/1M/1Q/2Q/1Y/18M/Overall`; `timeframeClause('resolved', tf)` returns `resolved >= -Nd` or `null` (Overall); `GET /api/jira/cfdcfi?teamId=ndb&timeframe=Overall&v2=1` omits date clause; pills sticky + inherit in drawers |
| G2 Heroes 5 + health 4 dual-click | MET | `CfdCfiV2Page` 5 heroes (open/agedOpen/p0Open/p1Open/closedInWindow) + 4 health (mttrMedian/p90/throughput+net/agedShare) each `ExplainHero` count→`CfdcfiDrill` + explain + `Open in JIRA ↗` via `jiraHref(jiraBaseUrl, cell.jql)` |
| G3 Chips + 7 breakdowns | MET | `ChipRow` activeChip + `filteredRows`; `breakdowns` byComponent/byFixVersion/ageBuckets/testEscape/rootCause/linkage (thLinked/techPubsLinked) with counts + JQL; chip click narrows drawer |
| G4 Boomerang | MET | `fetchDeferredBoomerangs` (labels `ndb-*-deferred` from `releaseVersionsEmailConfig.json` ∩ `baseScopeJql` membership chunked) → `boomerang { keys, rate, deferredTotal, byComponent, byFixVersion, cell }` + `gapMeta.boomerangKeys`; card shows rate + drill |
| G5 Pulse reuse | MET | `buildPulse({ token, baseJql: baseScopeJql, window: computePulseWindow(tf) })` + `KpiPulseBand pulse={data.pulse}` titled `CFD/CFI pulse · {timeframe}`; no forked chart; `Overall` window defaults to 2Q |
| G6 Fused AI concern + slice | MET | `POST /api/ai/cfdcfi-concern` + `cfdcfi-slice` via `naiService` `CFDCFI_CONCERN`/`CFDCFI_SLICE` prompts; 400 `NAI_API_KEY not configured` same as `oncall-concern`; `useCfdcfiV2` auto concern + per-view slice; Loom `build_cfdcfi_prompt` + Lighthouse `generate_cfdcfi_brief` (D44) |
| G7 Requirements locked | MET | `docs/pages/CfdCfi-requirements.md` CC-V2-01..10 + acceptance; `docs/pages/CfdCfi-data-layer.md` timeframe/breakdown/boomerang/API; `docs/api/cfdcfi.md` V2 (dual-path + legacy + AI 400); this folder; `agent-pack/.../cfdcfi.md` brief |

## Completion audit

| Requirement | Verdict | Source |
|-------------|---------|--------|
| `GET /api/jira/cfdcfi?teamId=&timeframe=&v2=1` + `GET /api/jira/cfdcfi/v2` + `POST /api/jira/cfdcfi/refresh` V2 | MET | `server/routes/jira/cfdcfi.js` dual-path + `validateJiraTokenMiddleware` |
| `POST /api/ai/cfdcfi-concern` + `cfdcfi-slice` with 400 on missing `NAI_API_KEY` | MET | `server/routes/ai.js` 400 guard + `naiService` prompts |
| `GET/POST` legacy tabbed pulse still works (no timeframe) | MET | `cfdcfi.js` falls through to `cfdcfiService.getDashboard` when no `timeframe`/`v2` |
| `TIMEFRAMES` 8 pills, `Overall`=null, sticky + drawer inherit | MET | `cfdcfiDashboardV2.TIMEFRAMES` + `CfdCfiV2Page PillBar` |
| `cfdcfiConfigResolve` clubbed CFD\|CFI + teamBaseFilter, no `filter=142537` | MET | `resolveRuntimeConfig` via `loadKpiConfigSync`/`getKpisForTeam` + `getTeamBaseFilter` |
| `cfdcfiDashboardV2` 7-way parallel + 5m cache + soft-fail | MET | `Promise.allSettled` + `SimpleCache` |
| `cfdcfiStacksService` linked roles + `cfdcfiFields` + mix | MET | `classifyStacksFromIssues` + `extractCfdcfiFields` |
| Never hard-code `filter=142537` (D1) | MET | No hard-coded filter in V2 page/service; `baseScopeJql` from config only |
| `CfdCfiV2Page` + `CfdcfiDrill` + `useCfdcfiV2`/`useCfdcfiSlice` + `CfdCfiV2.css` | MET | `client/src/components/CfdCfiV2/` + hooks |
| MCP split Loom prompt + Lighthouse brief | MET | `mcp/shared/tools/buildCfdcfiPrompt.ts` + `mcp/lighthouse/src/tools/generateCfdcfiBrief.ts` |
| Nav `/cfdcfi` V2 + `/cfdcfi-legacy` | MET | `client/src/App.js` + `routeConfig.js` |
| Page docs + API docs + agent brief + guides | MET | `docs/pages/cfdcfi/*` + `docs/pages/CfdCfi-*` + `docs/api/cfdcfi.md` + `agent-pack/...` |
| `docs-verify.sh` PASS, zero broken links | PENDING | Run `node scripts/lighthouse/docs/docs-build.js && bash scripts/lighthouse/docs/docs-verify.sh` |
| No JQL edit without approval | MET | `jql-edit-approval` — compose-only via `buildKpiCombinedJql`/`cfdcfiSeedJql` |
| `minimal-architecture` page/hook/service | MET | Components render, hooks fetch, services transform |

## Pipeline scorecard

| Stage | SCORE | Notes |
|-------|-------|-------|
| 1 Developer | Done | V2 routes + timeframe-pill heroes + health + chip breakdowns + boomerang + AI concern/slice + NAI split + MCP tools + config enrich |
| 1.5 Impact Scout | Ready | Grep cfdcfi/kpi consumers; `filter=` consumers patched or isolated |
| 1.7 Compile Gate | Ready | `check-compile.sh` 0 errors |
| 2 Code Review | Ready | No localhost, no duplicate connector, D1 clean |
| 3 QA | Ready | Pill JQL proof; Overall no clause; p0/p1 JQL valid; breakdown/boomerang counts; live spot-check |
| 4 UX | Ready | Sticky pills + chip row + health distinct + drill inherit; 1280px grid |
| 5 PM | Ready | VP skim: hotspot + too-long + boomerang + fix-this; legacy preserved |
| 6 Exec | Ready | Concern Quantitative→Qualitative→Hotspot→chase; every count JQL-proven |
| 7 JIRA Query Check | Ready | Dual-click + `linkedIssuesOf(baseScopeJql)`; no `filter=142537` |
| 8 Doc sign-off | In progress | This file + 5 surfaces + api/pages + agent brief + guides |
| 9 Security | Skipped — paused | per `weave.mdc` |
| 10 Merge | Pending | Await user `ok` after Doc lane PASS |

## Risks (residual)

- Boomerang deferred enumeration depends on `releaseVersionsEmailConfig.json` release list — new versions without email config fall back to empty; rate shows 0% until configured.
- Open sample may truncate vs hero count — drawer shows `Showing N of M` + full JQL proof covers authenticity (same as OnCalls).
- `Overall` fetches closed stacks with no date clause (500 cap) — large histories may hit `maxPastIssuesFetch` cap; heroes remain exact via `searchCount`.

## Waivers

- None. Weekly scheduled report cron→email not in V2 scope (not tracked as WAIVED — only OnCalls V2 had that defer).

## Links

- Page docs: `docs/pages/CfdCfi-requirements.md` + `docs/pages/CfdCfi-data-layer.md` + `docs/pages/cfdcfi/feature.md`
- API docs: `docs/api/cfdcfi.md` (V2 + legacy) + `docs/api/jira.md#cfdcfi` (if added there)
- Agent brief: `agent-pack/lighthouse/context/pages/cfdcfi.md`
- Code: `client/src/components/CfdCfiV2/CfdCfiV2Page.js` + `server/services/cfdcfiDashboardV2.js` + `cfdcfiStacksService.js` + `cfdcfiConfigResolve.js` + `server/config/cfdcfiConfig.json`
- MCP: `mcp/shared/tools/buildCfdcfiPrompt.ts` + `mcp/lighthouse/src/tools/generateCfdcfiBrief.ts`
- GOALS: `docs/pages/cfdcfi/GOALS.md` + `GOAL_KPI_CARD.md` + `PLAN.md`
