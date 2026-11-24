# Goal KPI Card — OnCalls V2 (VP-first 2-lens rebuild)

GOAL: Rebuild OnCalls dashboard as V2 with global timeframe pills (15d/1M/1Q/2Q/1Y/18M/Overall), at-a-glance heroes with one-line explainers, health MTTR throughput heroes, fused quant+qual AI concern with hotspot (Upgrade/MSSQL etc.), workflow buckets Need Info vs Waiting for Customer, gap taxonomy duds/NDB gaps/other-team with NDB sub-drill TH/Bugs/Improvements/Other, Loom JIRA pull + prompt build → Lighthouse AI consume, weekly scheduled report, TPM Pulse + SchedulePage integration.

SCOPE: apps/delivery-ops/client/src/components/OncallsV2/*, hooks/useOncallsV2.js, App.js route /oncalls-next, server/services/oncallDashboardV2.js, oncallBacklogAdvisor.js, oncallGapService.js, config/oncallConfig.json (needInfoDays/waitingDays), routes/jira/oncalls.js (timeframe param), routes/ai.js (oncall-concern + oncall-slice), services/naiService.js (ONCALL_CONCERN + ONCALL_SLICE prompts), mcp/shared/tools/buildOncallPrompt.ts, mcp/lighthouse product tool, docs/pages/oncalls/*, wireframe.html

DONE WHEN:
1. /oncalls-next renders wireframe IA: sticky global pills (7) drive all heroes/health/concern/age/graph/taxonomy + drills inherit (no reset), each hero shows count + explain + Open in JIRA proof
2. Server returns timeframe-aware dashboard (counts + pulse window + stacks + gap taxonomy) for any pill including Overall (no date clause) with correct JQL per bucket (Need Info/Waiting status) and thresholds from config
3. AI concern fuses quant (open/MTTR/net) + qual (hotspot component top2 + gap% + view) in ~100w and regenerates on pill/hero/taxonomy/view; drawer 2-liner + full briefing retained; Loom builds prompt, Lighthouse calls NAI
WAIVED for V2.0 (deferred to V2.1): weekly scheduled report (cron→email), TPM Pulse card + SchedulePage hook — tracked as follow-up; no blocking for V2.0 merge

AGENT KPIs:
  Developer: [V2 route + sticky pills + hero explain rows + health MTTR strip + concern + age table + graph toggle + taxonomy + NDB drill + drawer with fix suggestion all render; server timeframe-aware with Overall; config thresholds wired; no hardcoded product strings]
  Impact Scout: [All oncall consumers grep'd: oncallService, oncallStacksService, oncallEscalationService, kpiPulseService, ticketNarrativeService, OncallsPage, KpiPulseBand, TpmPulsePage, SchedulePage, emailScheduler — patched or N/A]
  Code Review: [No localhost, no duplicate connectors, minimal-architecture respected, no silent JQL edit without approval flag]
  QA: [Counts verified: timeframe pill JQL matches hero count proof; Overall = no date clause; Need Info/Waiting JQL valid; gap taxonomy counts sum to closed; live JQL spot-check for one pill]
  UX: [Sticky pills stay on scroll + in drawers; hero explain visible without hover; MTTR heroes distinct from at-a-glance; graph toggle flow/snapshot works; taxonomy double-click opens NDB sub-cards; no crushed flex on 1280px]
  PM: [VP can answer hotpots + too-long owner + fix-this in 10s; persona team-exec/tpm covered; scope matches wireframe; no missing must-have (Overall, MTTR, pills global)]
  Exec: [High-level story first (concern 100w + hotspot) then drill-down; every hero count has JQL proof; no data dump]
  JIRA Query Check: [Every hero count JQL uses baseScopeJql + correct status/resolution clause; dual-click count→panel, Open in JIRA→JQL; linkedOut uses linkedIssuesOf exact baseQuery]
  Compile Gate: [0 errors]
  Merge: [Branch weave/oncalls-v2 pushed, PR-ready]
