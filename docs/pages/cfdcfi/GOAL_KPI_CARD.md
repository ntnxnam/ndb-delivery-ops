# Goal KPI Card — CFD / CFI V2 (VP-first unified dashboard)

> Mirror of `docs/pages/cfdcfi/GOALS.md` — scorer's compact view. See `GOALS.md` for verification artifacts.

GOAL: Rebuild CFD/CFI dashboard as V2 with global timeframe pills (7d/15d/1M/1Q/2Q/1Y/18M/Overall), 5 heroes + 4 health with dual-click proof, chip-filtered 7 breakdowns, boomerang deferred→scope rate, KPI Pulse window reuse, and fused AI concern + per-view slice (Loom prompt → Lighthouse NAI), preserving legacy tabbed view.

SCOPE: `apps/delivery-ops/client/src/components/CfdCfiV2/*` (`CfdCfiV2Page.js`, `CfdcfiDrill.js`, `CfdCfiV2.css`), `hooks/useCfdcfiV2.js` + `useCfdcfiSlice.js`, `App.js` route `/cfdcfi` (canonical V2) + `/cfdcfi-legacy` (tabbed fallback), `server/services/cfdcfiDashboardV2.js` + `cfdcfiConfigResolve.js` + `cfdcfiStacksService.js`, `config/cfdcfiConfig.json` (agedOpenDays/needInfoDays/waitingForCustomerDays + thresholds + customFields), `routes/jira/cfdcfi.js` (dual-path `?timeframe=&v2=` + `/v2` aliases), `routes/ai.js` (`cfdcfi-concern` + `cfdcfi-slice` with 400 NAI guard), `services/naiService.js` (`CFDCFI_CONCERN` + `CFDCFI_SLICE` prompts), `mcp/shared/tools/buildCfdcfiPrompt.ts` (Loom) + `mcp/lighthouse/src/tools/generateCfdcfiBrief.ts` (Lighthouse), `docs/pages/cfdcfi/*` + `docs/pages/CfdCfi-*` + `docs/api/cfdcfi.md`

DONE WHEN:
1. `/cfdcfi` renders unified V2 IA: sticky global pills (8) drive all heroes/health/concern/breakdowns/boomerang/pulse + drawers inherit (no reset); each hero shows count + explain + **Open in JIRA** proof; `Overall` = no date clause
2. Server returns timeframe-aware dashboard (`hero` 5 + `health` 4 + `breakdowns` 6 + `boomerang` rate/byComponent/byFixVersion + `pulse` window override + `stacksPreview`/`openTickets`) for any pill including `Overall` with correct JQL per bucket and config thresholds from `cfdcfiConfig.json`
3. AI concern fuses quant (open/aged/MTTR/net/agedShare + boomerang rate) + qual (hotspot component top2 + linkage/test-escape themes) in ~100w and regenerates on pill/hero/chip/view; drawer 2-liner + full concern retained; Loom builds prompt (no NAI), Lighthouse calls NAI; both AI routes return `400 NAI_API_KEY not configured` when key missing (never 200 fallback that hid bug)

AGENT KPIs:
  Developer: [V2 route + sticky pills + 5 heroes + 4 health + chip filter + 7 breakdowns + boomerang rate/byComponent/byFixVersion + concern + pulse via `computePulseWindow` + `KpiPulseBand` all render; server timeframe-aware with `Overall`; config thresholds + boomerang deferred-label membership wired; no `filter=142537` hard-code (D1)]
  Impact Scout: [All cfdcfi consumers grep'd: cfdcfiService, cfdcfiStacksService, cfdcfiConfigResolve, kpiPulseService, CfdCfiPage, KpiPulseBand, TpmPulsePage — patched or N/A; no stale `filter=` consumer missed]
  Code Review: [No localhost, no duplicate connector, `minimal-architecture` (page/hook/service) respected, no silent JQL edit without `jql-edit-approval` flag; `cfdcfiConfig.json` owns thresholds, not code]
  QA: [Counts verified: timeframe pill JQL matches hero count proof; `Overall` = no `resolved >=` clause; `p0Open`/`p1Open` JQL valid; breakdown counts + boomerang `keys.length` match drawer; live JQL spot-check for one pill]
  UX: [Sticky pills stay on scroll + in drawers; hero explain visible without hover; health strip distinct from heroes; chip active state + Clear; breakdown cards + boomerang card not crushed on 1280px; `metric-click-dual-action` count→drill, Open in JIRA→JQL]
  PM: [VP can answer *what's hot, too-long, boomerang risk, fix-this* in 10s; persona `team-exec/tpm` covered; scope matches GOALS G1..G7; no missing must-have (`Overall`, MTTR, pills global, boomerang); legacy `/cfdcfi-legacy` preserved]
  Exec: [High-level concern first (Quantitative→Qualitative→Hotspot→chase) then drill-down; every hero count has JQL proof; no data dump; boomerang rate in narrative]
  JIRA Query Check: [Every hero uses `baseScopeJql` (clubbed CFD|CFI + `teamBaseFilter`) + correct `statusCategory`/`resolved >= -Nd`/`priority` clause; dual-click `count→panel`, `Open in JIRA→JQL` via `keysInJql`/`jiraHref`; `linkedOut` is `linkedIssuesOf(baseScopeJql)`]
  Doc: [5 surfaces + `docs/api/cfdcfi.md` V2+legacy + `docs/pages/cfdcfi/{GOALS,GOAL_KPI_CARD,feature,PLAN,STATUS}` + `agent-pack/.../cfdcfi.md` brief; `docs-verify` PASS, zero broken links; AI audit folder exists]
  Compile Gate: [0 errors — `bash scripts/loom/checks/check-compile.sh` PASS]
  Merge: [Branch `weave/cfdcfi-v2` pushed, PR-ready; legacy `/cfdcfi-legacy` retained]
