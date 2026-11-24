---
page: Oncalls
route: /oncalls
source: apps/delivery-ops/client/src/components/Oncalls
weave: weave-oncalls-v2
date: 2026-11-24
author: Namratha Singh (human) + muse-spark-816b (AI)
models: [muse-spark-816b]
goal: "Rebuild OnCalls dashboard as V2 with global timeframe pills (15d/1M/1Q/2Q/1Y/18M/Overall), fused AI concern with hotspot, workflow buckets, and gap taxonomy"
audience: team-exec
kpiCard: docs/pages/oncalls/GOAL_KPI_CARD.md
---

# 2026-11-24 — OnCalls — oncalls-v2-vp-rebuild

## Prompt (verbatim)
> You are Doc sign-off for OnCalls V2 (weave/oncalls-v2) worktree. Check 5 doc surfaces for OnCalls V2: Known Issues, Release Notes, User Guide, Admin Guide, Tech Guide plus docs/api + docs/pages per page-docs-required/api-docs-required. Also AI Audit trail: for every page touched per aiAudit.config.json (OncallsV2), ensure ai-audit-docs folder exists, scaffold journal via scripts/loom/ai-audit/new-entry.sh, fill Mistakes & Corrections, append to docs/ai-audit/LEARNINGS.md when cross-page, regenerate per-folder INDEX.md + timeline. Run node scripts/lighthouse/docs/docs-build.js and verify bash scripts/lighthouse/docs/docs-verify.sh passes with zero broken links.

## Goal → Done When

**GOAL:** Rebuild OnCalls dashboard as V2 with global timeframe pills (15d/1M/1Q/2Q/1Y/18M/Overall), at-a-glance heroes with one-line explainers, health MTTR throughput heroes, fused quant+qual AI concern with hotspot (Upgrade/MSSQL etc.), workflow buckets Need Info vs Waiting for Customer, gap taxonomy duds/NDB gaps/other-team with NDB sub-drill TH/Bugs/Improvements/Other, Loom JIRA pull + prompt build → Lighthouse AI consume, weekly scheduled report, TPM Pulse + SchedulePage integration.

**DONE WHEN:**
1. `/oncalls` renders wireframe IA: sticky global pills (8) drive all heroes/health/concern/age/graph/taxonomy + drills inherit (no reset), each hero shows count + explain + Open in JIRA proof
2. Server returns timeframe-aware dashboard (counts + pulse window + stacks + gap taxonomy) for any pill including Overall (no date clause) with correct JQL per bucket (Need Info/Waiting status) and thresholds from config
3. AI concern fuses quant (open/MTTR/net) + qual (hotspot component top2 + gap% + view) in ~100w and regenerates on pill/hero/taxonomy/view; drawer 2-liner + full briefing retained; Loom builds prompt, Lighthouse calls NAI

**WAIVED for V2.0 (deferred to V2.1):** weekly scheduled report (cron→email), TPM Pulse card + SchedulePage hook — tracked as follow-up.

## AI Config Snapshot
- `aiConfig.json` @ d9abaf5 — `baseUrl https://tokens.corp.nutanix.com/enterpriseai/gateway/v1`, `defaultModel beam-1-501b`, `maxTokens 8192`, `requestTimeoutMs 120000`
- Models used: `muse-spark-816b` (doc synthesis)
- Connectors touched: `jiraConnector` (searchCount via oncallDashboardV2), `aiConnector` (ONCALL_CONCERN + ONCALL_SLICE via NAI)
- NAI env: `NAI_API_KEY` required for `POST /api/ai/oncall-concern` + `oncall-slice` (doc sign-off did not invoke live NAI; verified route contract + error handling)

## Changes
| File | Change |
|------|--------|
| `docs/api/jira.md` | Added OnCalls V2 section: timeframe pills (8), Overall no-clause, workflow JQL, gap taxonomy duds/NDB/other + NDB sub, health MTTR, pulse window override, `POST /api/ai/oncall-concern` + `oncall-slice` (Loom→Lighthouse) |
| `docs/pages/Oncalls-requirements.md` | Rewrote for V2: OC-V2-01..12, sticky pill behavior, dual-click, Need Info/Waiting buckets, gap taxonomy double-click, health strip, AI concern + slice, edge cases (Overall, notConfigured, NAI unavailable) |
| `docs/pages/Oncalls-data-layer.md` | Rewrote for V2: timeframe-aware endpoints, oncallDashboardV2 5-way parallel flow, gap taxonomy classification table, timeframe pills→JQL table, client useOncallsV2 flow, oncallConfig fields |
| `docs/pages/oncalls/GOAL_KPI_CARD.md` | Updated SCOPE + DONE WHEN: `/oncalls` canonical (not /oncalls-next), 8 pills, added useOncallSlice + /v2 aliases |
| `docs/pages/oncalls/GOALS.md` | New V2 goals G1..G6 (pills, heroes, workflow, taxonomy, AI concern, requirements locked) |
| `docs/pages/oncalls/Feature.md` | New V2 two-lens feature doc with constraints + data shapes |
| `docs/pages/oncalls/PLAN.md` | New V2 9-step plan (wireframe → server → routes → client → hooks → docs → guides → audit → deferred) |
| `docs/pages/oncalls/STATUS.md` | New V2 COMPLETE scorecard with pipeline + waivers |
| `docs/pages/oncalls/wireframe.html` | Copied from `apps/delivery-ops/docs/pages/oncalls/wireframe.html` to canonical `docs/pages/oncalls/` |
| `apps/delivery-ops/docs/pages/oncalls/*` | Synced GOAL_KPI_CARD, GOALS, Feature, PLAN, STATUS to match canonical |
| `docs/guides/USER_GUIDE.md` | Added OnCalls V2 VP-first section: pills, AI Concern, hero/health rows, age table, taxonomy double-click, drawer, dual-click rule; bumped to 3.1 @ 2026-11-24 |
| `docs/guides/ADMIN_GUIDE.md` | Added OnCalls V2 config table (oncallConfig.json) + extra config section (routes/MCP/tenant override/Overall); added oncall-concern troubleshooting |
| `docs/known-issues/KNOWN_ISSUES.md` | Added OnCalls V2 NDB fallback + weekly report deferred; bumped to 2026-11-24 |
| `docs/release-notes/RELEASE_NOTES.md` | Added Unreleased — weave/oncalls-v2 entry (pills, health, gap taxonomy, AI concern, legacy preserved, deferred, known issues) |
| `docs/technical/TECH_DESIGN.md` | Added §14 OnCalls V2 Architecture (route/component, server orchestrator, JQL flow); renumbered deployment/future |
| `docs/technical/LLD-ai-layer.md` | Added §8 OnCalls V2 AI (Concern + Slice prompts, endpoints, ticket key integrity) |
| `apps/delivery-ops/client/src/components/Oncalls/ai-audit-docs/2026-11-24__oncalls-v2-vp-rebuild__weave-oncalls-v2.md` | This journal (scaffolded via new-entry.sh) |
| `docs/ai-audit/LEARNINGS.md` | Appended cross-page learning: timeframe-pill docs drift (see Mistakes) |
| `docs/guides/*.html` | Regenerated via `node scripts/lighthouse/docs/docs-build.js` (includes ai-audit indexes/timeline) |

## Decisions & Alternatives Considered
- **V2 canonical at `/oncalls`, legacy at `/oncalls-legacy`:** chosen so V2 is discoverable without breaking bookmarks; alternative was `/oncalls-next` (rejected — wireframe already canonicalized to `/oncalls` in routeConfig.js)
- **8 pills include 7d legacy:** keeps backward compat for embedded old links; 15d is the true new minimum for VP skim
- **Overall = no date clause:** avoids arbitrary max window; server `timeframeClause` returns null so JQL is `seed AND statusCategory=Done` only
- **NDB gap fallback to `gapProjectPrefixes`:** makes tenant override product-agnostic (D1); hardcoding NDB would break DataLens tenant
- **Need Info / Waiting as status-only JQL (not dwell):** changelog dwell filter is planned but not in V2; thresholds are UI meta for now
- **Docs location:** canonical `docs/pages/oncalls/*` (root) + synced `apps/delivery-ops/docs/pages/oncalls/*` stub (legacy path still served); docs-verify checks root

## Mistakes & Corrections
- **Mistake 1 — stale `GOALS.md`/`Feature.md`/`PLAN.md`/`STATUS.md` still described pulse-era (G1=buildPulse, G2=dual-click open-family):** Doc sign-off gap meant V2 code shipped without updating the feature folder. Fixed by overwriting all four files with V2 content (pills, gap taxonomy, AI concern, NDB sub-drill) and syncing both `docs/pages/oncalls/` and `apps/delivery-ops/docs/pages/oncalls/`.
  - **Correction:** Created V2 GOALS (G1..G6), Feature (two lenses), PLAN (9-step), STATUS (COMPLETE) from wireframe + GOAL_KPI_CARD + live code.
  - **Prevention:** Add Doc KPI: `GOALS.md` must mention `timeframe` when `TIMEFRAMES` exists in code; add CI doc-verify check that `docs/pages/oncalls/GOALS.md` contains `Overall` when `oncallDashboardV2.js` does.
- **Mistake 2 — `GOAL_KPI_CARD.md` still said `App.js route /oncalls-next`:** route had moved to `/oncalls` (canonical) + `/oncalls-legacy` in `App.js:201-216` but KPI card not updated.
  - **Correction:** Updated SCOPE to `App.js route /oncalls (canonical V2) + /oncalls-legacy` and DONE WHEN to `/oncalls` + 8 pills.
  - **Prevention:** KPI card SCOPE should be linted against `routeConfig.js` routes; Doc stage must grep route strings.
- **Mistake 3 — `docs/api/jira.md` OnCalls section was pulse-only (no timeframe, no gap taxonomy, no AI routes):** API docs lagged behind route changes (`?timeframe=`, `/v2`, `oncall-concern/slice`).
  - **Correction:** Rewrote OnCalls section with V2 timeframe-aware endpoints, gap taxonomy table, health, pulse window override, AI concern/slice contracts.
  - **Prevention:** `api-docs-required.mdc` retrofit obligation — any `req.query.timeframe` read must have a doc param entry; docs-verify should warn on undocumented query params.
- **Cross-page pattern:** Timeframe-pill doc drift (any global pill feature risks `GOALS.md`/`docs/api` lagging) — appended to `docs/ai-audit/LEARNINGS.md`.

## Verification
- Review: Doc Specialist — all 5 surfaces + api/pages per `page-docs-required`/`api-docs-required`; no hardcoded product strings verified via oncallConfig tenant path
- QA: Pill JQL contract verified (Overall omits clause, 15d→1Y have correct `-Nd`); Need Info/Waiting exact status strings; gap taxonomy `DUD_RESOLUTIONS` set; legacy path preserved
- docs-verify: `bash scripts/lighthouse/docs/docs-verify.sh` — PASS (stale writers PASS, ai-audit naming PASS, broken links WARN only for pre-existing cross-pack refs)
- docs-build: `node scripts/lighthouse/docs/docs-build.js` — regenerated `docs/guides/*.html` + ai-audit INDEX/timeline
- AI Audit: journal scaffolded via `new-entry.sh --page Oncalls --slug oncalls-v2-vp-rebuild --weave oncalls-v2`; INDEX.md + timeline.md regenerated

## Links
- Plan: `~/.opencode/plan/weave-oncalls-v2.md` (weave plan)
- Wireframe: `docs/pages/oncalls/wireframe.html`
- Page specs: `docs/pages/Oncalls-requirements.md` + `docs/pages/Oncalls-data-layer.md`
- API docs: `docs/api/jira.md#oncalls` (V2)
- Feature folder: `docs/pages/oncalls/{GOAL_KPI_CARD,GOALS,Feature,PLAN,STATUS}.md`
- Code: `apps/delivery-ops/client/src/components/OncallsV2/OncallsV2Page.js`, `hooks/useOncallsV2.js`, `server/services/oncallDashboardV2.js`, `oncallGapService.js`, `routes/jira/oncalls.js`, `routes/ai.js`, `services/naiService.js`
- MCP: `mcp/shared/tools/buildOncallPrompt.ts` + `mcp/lighthouse/src/tools/generateOncallBrief.ts`
- Branch: `weave/oncalls-v2` @ `d9abaf5`
- Registry: `apps/delivery-ops/server/config/aiAudit.config.json#pages.Oncalls`

## Config Delta
```json
{
  "aiAudit.config.json": "no change — Oncalls page already in registry (folder-page)",
  "oncallConfig.json": "needInfoDays:10, waitingForCustomerDays:21, agedOpenDays:14, gapProjectPrefixes tenant override",
  "routeConfig.js": "/oncalls → OncallsV2Page (V2 canonical), /oncalls-legacy → OncallsPage (legacy)",
  "docs/pages/oncalls": "GOALS.md, Feature.md, PLAN.md, STATUS.md, wireframe.html, GOAL_KPI_CARD.md updated to V2",
  "docs/api/jira.md": "OnCalls section expanded to V2 (timeframe pills, gap taxonomy, AI concern/slice)"
}
```

## Follow-ups / Waivers
- **WAIVED for V2.0 (V2.1):** weekly scheduled report (cron→email), TPM Pulse card + SchedulePage hook — tracked in `GOAL_KPI_CARD.md` WAIVED line and `KNOWN_ISSUES.md`
- **Follow-up:** add CI lint for `GOAL_KPI_CARD.md` route vs `routeConfig.js`, and `docs/pages/oncalls/GOALS.md` must contain `Overall` when `TIMEFRAMES` includes it
