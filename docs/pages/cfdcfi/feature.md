# Feature — CFD / CFI V2 (VP-first, unified) — `/cfdcfi`

## Outcome

VP-first CFD/CFI dashboard where one timeframe pill controls the business story: 5 heroes (Open now, Aged >Nd, P0 open, P1 open, Closed in window) + 4 health tiles (MTTR median, p90, Throughput with net, Aged share) + filter chip row + 6 breakdowns (by-component, by-fixVersion, age buckets, test-escape, root-cause, linkage TH/TechPubs) + boomerang (deferred→scope rate with by-component/by-release detail) + KPI Pulse graph (window-reused, not forked) + fused AI concern and per-view slice. Drill keeps the timeframe. Legacy tabbed pulse view preserved at `/cfdcfi-legacy`.

## Constraints (preserve)

- `kpi-config-driven` — CFD/CFI `baseScopeJql` is the clubbed `kpiConfig` CFD|CFI `baseQuery` values (`kpiNamePattern` `CFD|CFI`, exclude OnCalls) AND `teamBaseFilter`; hero JQL composes `statusCategory`/`resolved >= -Nd`/`priority` onto it, never edits the baseQuery. Never hard-code `filter=142537`.
- `jira-authenticity-links` / `metric-click-dual-action` — count → in-app `CfdcfiDrill` (in-page drawer with tickets + `aiSlice`); Open in JIRA → exact hero/breakdown JQL (`key in (…)` for taxonomy/boomerang). Never both external.
- `kpi-pulse-analytics` — mount shared `KpiPulseBand` with `buildPulse({ window: computePulseWindow(timeframe) })`; no forked `CreatedResolvedChart`. Pulse window follows the pill (`Overall` → default 2Q window).
- `jql-edit-approval` — any JQL shape change needs explicit approval flag (`server/utils/teamScope.js` gate).
- `minimal-architecture` — Components render, hooks fetch, services transform (`apps/delivery-ops/client/src/components/CfdCfiV2/` + `hooks/useCfdcfiV2.js`/`useCfdcfiSlice.js` + `server/services/cfdcfiDashboardV2.js`/`cfdcfiConfigResolve.js`/`cfdcfiStacksService.js`); no stateful logic in routes (`minimal-architecture.mdc`).
- `product-agnostic` D1 — NDB is one tenant; `cfdcfiConfig.json` owns `agedOpenDays`/`needInfoDays`/`waitingForCustomerDays`, project lists (`techHelpProjects`/`techPubsProjects`/`knowledgeProjects`), SLA thresholds, and `customFields` (Test Escape, Root Cause, Corrective Action, RCA Status). Hard-coded project strings are flagged.
- `no-localhost` — no `localhost:8001` in JSX; use relative `/docs/` + `client/src/setupProxy.js`.

## IA (unified V2)

**Header:** title `CFD/CFI V2` + team (TeamContext) + as-of + Pull from JIRA + Regenerate AI Concern

**Global pills (8, sticky):** `7d` · `15d` · `1M` · `1Q` · `2Q` · `1Y` · `18M` · `Overall` — `TIMEFRAMES = {7d:7,15d:15,1M:30,1Q:90,2Q:180,1Y:365,18M:540,Overall:null}`. Active pill drives every hero/health/breakdown/boomerang/pulse/concern. Stored in `useCfdcfiV2` state, sent as `?timeframe=`; drawer inherits (never resets). `timeframeClause('resolved', tf)` returns `resolved >= -Nd` or `null` for `Overall`.

**AI Concern card:** fused quant (open/aged/closed/MTTR/net/agedShare + boomerang rate) + qual (hotspot top-2 components + gap themes from `STACK SAMPLE` + test-escape/TH linkage) → `Quantitative:` 40–45w + `Qualitative:` 45–50w + `Hotspot:` 50–60w + 2-line chase `Ask <owner> to <action> on <keys> by <timeframe>`. Auto after `data.asOf` changes; regenerates on pill/hero/chip/view. States `idle`→`loading`→`done` (linkified `validKeys`) / `error` with Retry. `400 NAI_API_KEY not configured` does not hide quantitative heroes.

**Hero row (5, `ExplainHero`):** Open now · Aged >Nd · P0 open · P1 open · Closed in window — each with count → drill, explain one-liner, `meta` (threshold/window), and `Open in JIRA ↗` (exact JQL). Health row (4, neutral tone): MTTR median · MTTR p90 · Throughput (+net) · Aged share — count → closed-preview drill.

**Chip row (filter):** Filter chips for component / release (fixVersion) / age bucket / test-escape / TH linkage / boomerang — clicking a chip sets `activeChip` (`kind:value`) and filters `CfdcfiDrill` rows; Clear resets.

**Breakdowns (6 cards):** By Component · By FixVersion · Age Buckets (0-7/8-30/31-90/90+) · Test Escape · Root Cause · Linkage (TH linked / TechPubs linked / total). Each cell shows count + JQL stub; clicking opens `CfdcfiDrill`.

**Boomerang card:** Rate `%` (`CFD/CFI ∩ ndb-*-deferred` over deferred universe) + `deferredTotal` + by-component + by-fixVersion mini-breakdowns; `gapMeta.boomerangKeys` proof via `key in (...)`.

**Pulse graph:** `KpiPulseBand pulse={data.pulse}` titled `CFD/CFI pulse · {timeframe}`; inherits `windowOverride` (`computePulseWindow(timeframe)`); flow vs snapshot toggle.

**Drill drawer (`CfdcfiDrill`):** `mode={open|agedOpen|p0Open|p1Open|closedInWindow|throughput|mttr|component:X|fixVersion:Y|ageBucket:Z|testEscape|boomerang}` with `tickets` (filtered `openTickets` or `closedStacksPreview`), `jql`, `cellCount`, `gapMeta`, `timeframe`, `activeChip`, `aiSlice`/`aiSliceState`/`aiSliceError`. Per-view AI slice auto-generates on open; `400` shows hint.

## Hero → drill (dual-click)

Open-family heroes (`open`/`agedOpen`/`p0Open`/`p1Open`) — count `<button>` → `CfdcfiDrill` with `deriveKeysForView(mode)` capped 12 keys from `openTickets`/`gapMeta.boomerangKeys`/`closedStacksPreview`; secondary `Open in JIRA ↗` → `jiraHref(jiraBaseUrl, cell.jql)`. Created/Resolved/MTTR/throughput heroes are `count → JIRA` only when no filtered universe is meaningful (or closed-preview when `closedInWindow`).

## Chip filtering

Chips derive from `breakdowns` + `boomerang`: `component:<name>` matches `issue.components`, `fixVersion:<ver>` matches `fixVersions`, `ageBucket:<bucket>` matches `ageDays` ranges, `testEscape:<val>` matches `cfdcfiFields.testEscape`, `thLinked` matches `techHelp.length>0`. `ChipRow` shows `label` + `count` badge; `activeChip` toggles; `Clear` resets. `CfdcfiDrill` `filteredRows` further narrows by `activeChip`.

## Boomerang

Deferred labels enumerated from `releaseVersionsEmailConfig.json` (`ndb-*-deferred`), fetched via `searchPages(labels in (...))`, membership-checked chunked `key in (...) AND (baseScopeJql)`, rate = `boomerangKeys.length / deferredKeys.length ×100`. `gapMeta.boomerangKeys` feeds `validKeys` for AI concern.

## Data shapes

- `TIMEFRAMES = {7d:7,15d:15,1M:30,1Q:90,2Q:180,1Y:365,18M:540,Overall:null}` — `timeframeClause` returns `resolved >= -Nd` or `null`
- `hero { open, agedOpen, closedInWindow, p0Open, p1Open, all, tbv }` each `cell(count, jql)` where `count = jira.searchCount(jql)`
- `health { mttrMedian, p90, net, throughput, agedShare, churn }` from `pulse.mttr` + hero counts
- `breakdowns { byComponent, byFixVersion, ageBuckets, testEscape, rootCause, linkage{thLinked,techPubsLinked,totalOpen} }` derived from `cfdcfiStacksService.classifyStacksFromIssues`
- `boomerang { keys, rate, deferredTotal, byComponent, byFixVersion, cell }` + `gapMeta.boomerangKeys`
- `componentMix / fixVersionMix / priorityMix / assigneeMix` — `topN(...,8)` → AI hotspot top-2
- `openTickets` / `stacksPreview` (40) / `closedStacksPreview` (20) — `mapTicketRows` + `cfdcfiFields` (Test Escape, Root Cause, Corrective, RCA Status) from `cfdcfiConfig.customFields`

## Legacy

`apps/delivery-ops/client/src/components/CfdCfiPage.js` + `CfdCfi/OpenTicketsDrill.js` preserved at `/cfdcfi-legacy` (tabbed pulse per KPI); V2 is canonical `/cfdcfi`.
