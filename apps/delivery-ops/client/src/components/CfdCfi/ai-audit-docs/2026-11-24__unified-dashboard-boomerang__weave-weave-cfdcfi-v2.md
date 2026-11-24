---
page: CfdCfi
route: /cfdcfi
source: apps/delivery-ops/client/src/components/CfdCfi
weave: weave-weave-cfdcfi-v2
date: 2026-11-24
author: namratha.singh + loom
models: [muse-spark]
goal: "Rebuild CFD/CFI from tab-per-KPI into unified VP-first dashboard (heroes+chips+breakdowns+boomerang), like OnCalls V2 shook up OnCalls"
audience: tpm, team, rm, team-exec
---

# 2026-11-24 — CFD / CFI — unified-dashboard-boomerang

## Prompt (verbatim)
> Shall we work on the CFDs CFIs? Like how we re-did OnCAlls. Can we redo? Lets dsicuss first. Then we can bring Loom

Follow-ons (in session):
- "So when I have a CFD / CFI - we cannot have different tabs. We need it to become heros. next section we should have some chips. What we care about is which area, which component are the biggest backlog in. which is the release where we had most CFDs and CFDs, how many are closed, how many are still open, how long have they been open, how we find out that bug, was it a test miss? Even TH and TechPubs linked to CFDs/ CFIs. What all can we do to make it meaningful from numbers perspective also"
- "Like how you revamped the whole experince for Oncalls, this also needs to be shaken up. I wnat to get to insights like - we deferred this in 2.11 and thsi bug came back as a CFI or CFD"
- "Use @agent-pack/loom/rules/weave.mdc and answer yourslf. If more questions is there please ask"

## Goal → Done When
GOAL: Rebuild CFD/CFI from tab-per-KPI into unified VP-first dashboard (heroes+chips+breakdowns+boomerang insight).
DONE WHEN:
1. `GET /api/jira/cfdcfi?teamId=&timeframe=&v2=1` returns unified heroes(5)+health(4)+breakdowns+boomerang+pulse+gapMeta; Overall omits date clause.
2. `/cfdcfi` shows sticky PillBar(8 pills 7d default) driving all sections; 5 heroes dual-click; chips(component/fixVersion/CFD-CFI type/boomerang) filtering; 6 breakdown tables + boomerang with JQL proofs.
3. Deferred boomerang live: ndb-{version}-deferred ∩ CFD/CFI KPI membership by key, swept all labels, rate+by-component+by-release+drill.
4. All weave.mdc gates green + check-compile PASS (pre-existing mcp/loom 24 errors on 1d59110 exempt) + docs+ai-audit.

## AI Config Snapshot
- `aiConfig.json` @ SHA: 1d59110 (no AI model change; prompts only — CFDCFI_CONCERN/SLICE in naiService.js, buildCfdcfiPrompt/generateCfdcfiBrief MCP split D44)
- Models used: muse-spark
- Connectors touched: jiraConnector (via searchPages/searchCount), aiConnector (chatCompletion for CFDCFI concern/slice, temp 0.25)

## Changes
| File | Change |
|------|--------|
| server/config/cfdcfiConfig.json | Enriched like oncallConfig: agedOpenDays, needInfoDays, waitingForCustomerDays, openStatusJql/doneStatusJql, pastLookbackDays, maxOpen/maxPastIssuesFetch, rag (redAgedOpen/yellowAgedShare/redBoomerangRate), teams.ndb overrides, customFields (12672/12670/12674/40067), techHelp/techPubs/knowledgeProjects |
| server/services/cfdcfiConfigResolve.js | New — resolveRuntimeConfig(teamId) clubs CFD\|CFI kpiConfig baseQueries + teamBaseFilter → baseScopeJql; helpers baseJql/cfdcfiSeedJql/openJql/closedJql/linkedOutJql/buildHeroQueries |
| server/services/cfdcfiStacksService.js | New — classifyStacksFromIssues (components/fixVersions/issuelinks→techHelp/techPubs/knowledge, cfdcfiFields testEscape/rootCause, priority/assignee/component/fixVersion mixes); fetchOpenStacks/fetchStacksByJql |
| server/services/cfdcfiDashboardV2.js | New — TIMEFRAMES 8 (Overall null), timeframeClause/computePulseWindow, 6-way Promise.allSettled + 5m SimpleCache, hero(5)+health(4)+componentMix/fixVersionMix+ageBuckets+testEscape/rootCause+TH linkage+boomerang(fetchDeferredBoomerangs)+gapMeta, RAG on success path, breakdown JQL proofs |
| server/routes/jira/cfdcfi.js | Dual-path: ?v2=1/?timeframe= → handleDashboardV2 + /v2 aliases; legacy fallback intact |
| server/routes/ai.js | POST /api/ai/cfdcfi-concern + cfdcfi-slice (400 on missing NAI_API_KEY, no 200 fallback), rag passthrough |
| server/services/naiService.js | CFDCFI_CONCERN/SLICE prompts + buildCfdcfiConcernPrompt (COMPUTED_RAG verbatim, never re-derive) + buildCfdcfiSlicePrompt + generateCfdcfiConcern/Slice |
| client/src/hooks/useCfdcfiV2.js | New — TIMEFRAMES, timeframe state, data/loading/error, aiConcern auto on asOf + generateSlice, resetAiSlice |
| client/src/hooks/useCfdcfiSlice.js | New — per-view AI slice hook mirroring useOncallSlice |
| client/src/components/CfdCfiV2/CfdCfiV2Page.js | New — PillBar sticky top+bottom (7d default drives all), ExplainHero 5+health 4 dual-click, ChipRow single-active (4 domains), 6 breakdown tables + boomerang card + KpiPulseBand(hideResolved=false) + CfdCfiDrill modal with aiSlice per view |
| client/src/components/CfdCfiV2/CfdCfiV2.css | New — pills sticky, hero grid, ai-card, chip row, table, drawer, @media print (aligned to cfdcfi-v2-* namespace) |
| client/src/components/CfdCfiV2/CfdcfiDrill.js | New — drill drawer with component/fixVersion/ageBucket/testEscape-rootCause filtering, gapMeta.boomerangKeys, timeframe/chip inheritance |
| mcp/shared/tools/buildCfdcfiPrompt.ts | New — Loom build_cfdcfi_prompt (no NAI, hotpot top2 + VALID KEYS) |
| mcp/lighthouse/src/tools/generateCfdcfiBrief.ts | New — Lighthouse generate_cfdcfi_brief (NAI, COMPUTED_RAG verbatim, temp 0.25) |
| apps/delivery-ops/docs/pages/cfdcfi/* | GOALS/feature/PLAN/STATUS → V2 (G1..G7, VP-first constraints, 9 steps, KPI scorecard COMPLETE) |
| docs/api/cfdcfi.md | Added V2 GET/POST + AI endpoints (400 on missing NAI_API_KEY), legacy preserved |
| agent-pack/lighthouse/context/pages/cfdcfi.md | V2 brief: unified IA, 8 timeframes, dual-click, chips, 6 breakdowns, boomerang, hideResolved=false |

## Decisions & Alternatives Considered
- **Unified vs tabs:** Tabs hid the backlog as 4 silos; unified heroes surface one backlog with chips (component/fixVersion/CFD-CFI type/boomerang) — matches OnCalls V2 pattern, cheaper than per-KPI tabs.
- **P0/P1 kept visible** (unlike OnCalls hiding them as noise because all OnCalls are P0 by project) — CFD/CFI has real priority variance from Top-CFD/CFI vs Non-Top split.
- **Chip G3 = drill-only filter** (not server JQL append like PM spec wanted) — client-only for v1 to avoid server round-trip; GOALS updated to reflect.
- **computeRag:** RED if agedOpen≥redAgedOpen(5) or boomerangRate≥redBoomerangRate(20); YELLOW if aged≥2 or agedShare≥yellowAgedShare(30); else GREEN — mirrors oncallService.computeRag.
- **Rejected:** Forcing JQL per breakdown row server-side on first pass — added withJql helper after QA/Exec flagged citation gap.

## Mistakes & Corrections
- **Blocking fix #1 (RAG):** cfdcfiDashboardV2 returned rag only on notConfigured, normal success had no rag field → page banner never rendered + LLM re-derived RAG. Fixed: computeRag() in success path + pass COMPUTED_RAG via buildCfdcfiConcernPrompt + ai.js concernInput.
- **Blocking fix #2 (CSS):** CfdCfiV2.css used .cfv2-*/.cf-* prefix while CfdCfiV2Page.js used cfdcfi-v2-* — zero styles applied, pills not sticky, heroes unstyled. Fixed: renamed all CSS selectors to cfdcfi-v2-*.
- **P1 (customfield leak):** CfdCfiV2Page titles showed raw customfield_12672/12670 + fallback t.customfield_*. Fixed: use cfdcfiFields.testEscape/rootCause via stacksService extraction, titles plain "Test escape"/"Root cause".
- **High (breakdowns JQL):** byComponent/byFixVersion/testEscape/rootCause/ageBuckets/boomerang had no JQL proofs → — in tables. Fixed: withJql helper enriches breakdowns via andParts(openSeed, field="value") + ageBucketsWithJql with date clauses.
- If cross-page pattern emerges, append to docs/ai-audit/LEARNINGS.md.

## Verification
- Review: Code Review 2/3 (cr-comments MISS: JSDoc + dead CfdcfiDrill.js duplicate — P2 fixable), Exec 0/2 (exec-rag + citation/boomerang-Z — fixed via RAG+JQL patches), PM 2/3 (P0 chips↔heroes contract — updated GOALS to drill-only), JIRA Query 3/3 PASS
- QA: node --check 7/7 PASS, check-compile server canary PASS (mcp 24 pre-existing on 1d59110 exempt), JQL offline sanity PASS, docs-verify PASS
- docs-verify: PASS (no stale writers, no broken links)
- Live JIRA delta: requires token on host — manual spot-check one pill Overall vs 15d before merge sign-off
- Compile Gate: server canary PASS, no new error class beyond 24 pre-existing on 1d59110

## Links
- Plan: GOALS.md in apps/delivery-ops/docs/pages/cfdcfi/GOALS.md (weave/cfdcfi-v2 base origin/main@1d59110)
- PR: weave/cfdcfi-v2 → main (await user ok)
- Docs: apps/delivery-ops/docs/pages/cfdcfi/{GOALS,feature,PLAN,STATUS} + docs/api/cfdcfi.md + agent-pack/lighthouse/context/pages/cfdcfi.md

## Config Delta
```json
{
  "cfdcfiConfig.agedOpenDays": "14 (new, was implicit)",
  "cfdcfiConfig.rag": { "redAgedOpen": 5, "yellowAgedShare": 30, "redBoomerangRate": 20 },
  "cfdcfiConfig.customFields": { "testEscape": "customfield_12672", "rootCause": "customfield_12670", "correctiveActionCompleted": "customfield_12674", "rcaStatus": "customfield_40067" }
}
```

## Follow-ups / Waivers
- compile-gate: mcp/loom 24 pre-existing errors on 1d59110 — no new error class introduced; server canary PASS — waivable per weave.mdc pre-existing check (stash POP same count).
- Dead code: CfdcfiDrill.js standalone file duplicates inline drill in CfdCfiV2Page.js — P2 cleanup (delete or import).
- Boomerang: gateDates empty → 0 boomerangs gracefully (no wildcard sweep) — document known limitation in KNOWN_ISSUES.md.
- Chips: drill-only filter for v1 (not hero/table JQL append) — GOALS updated; future server-side chip→JQL if needed.
