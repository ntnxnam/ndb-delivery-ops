---
page: DeferredInsights
route: /deferred-insights
source: apps/delivery-ops/client/src/components/DeferredInsights
weave: weave-deferred-insights
date: 2026-11-24
author: namratha.singh (human) + muse-spark-816b (AI)
models: [muse-spark-816b]
goal: "Create deferred insights dashboard — per release, how many bugs got deferred, which release they finally got fixed in, what is still pending. Line graph oldest→newest, hero numbers, drill-down by release."
audience: portfolio_mgr, rm, director
---

# 2026-11-24 — Deferred Insights — deferred-insights-dashboard

## Prompt (verbatim)
> goal is to create a new deferred insights dashboard. Per release, how many bugs got deferred, which release they finally got fixed in and what is still pending. It needs to look great. Open with a graph. line graph. Oldest to newest. then hero numbers. Drill down by release with details. What else can you think of? shift+tab agents. Lets discuss. You will provide ample filtering and drilling right? Reuse same behaviour as in other teams? this needs to come into KPI section.

## Goal → Done When
- Line graph oldest→newest per-release deferred volume with fixed/pending stacked, clickable to drill-down.
- Hero numbers: total deferred, fixed elsewhere, still pending, fix rate, release count — each with JIRA JQL proof.
- Drill-down by release: deferred count, where fixed (by fixVersion), what's pending, priority/component breakdown, expandable ticket table with JIRA links.
- Filters reuse existing team behaviour: release multi-select, priority, component — narrow graph+heroes+cards. Page in KPI section (Quality/KPIs), gated kpi_view, product-agnostic.

## AI Config Snapshot
- `aiAudit.config.json` @ 2026-11-24 +1 page (DeferredInsights)
- Models used: muse-spark-816b
- Connectors touched: jiraConnector (JiraConnector.searchCount/searchPages/getProjectVersions)

## Changes
| File | Change |
|------|--------|
| `apps/delivery-ops/server/services/deferredInsightsService.js` | New service: label-taxonomy deferred JQL, discoverReleases, fixed/pending classification, hero union JQL |
| `apps/delivery-ops/server/routes/deferredInsights.js` | New thin route /insights + /insights/refresh, kpi_view guard |
| `apps/delivery-ops/server/index.js` | Mount /api/deferred-insights + specific /api/jira/deferred-insights before generic /api/jira |
| `apps/delivery-ops/server/config/aiAudit.config.json` | Register DeferredInsights page |
| `apps/delivery-ops/client/src/hooks/useDeferredInsights.js` | New hook with AbortController |
| `apps/delivery-ops/client/src/components/DeferredInsights/DeferredInsightsPage.js` | Page: graph→heroes→by-release with multi-select filter, dual-action heroes/counts, drawer |
| `apps/delivery-ops/client/src/components/DeferredInsights/DeferredInsights.css` | Sticky filter, token colors, responsive, drawer |
| `apps/delivery-ops/client/src/App.js` | Route /deferred-insights (kpi_view, wide) |
| `apps/delivery-ops/client/src/layout/utils/sidebarNavConfig.js` | KPI group entry |
| `apps/delivery-ops/client/src/layout/utils/routeConfig.js` | Route config |
| `apps/delivery-ops/client/src/auth/constants/permissions.js` | TAB_PERMISSIONS |
| `agent-pack/loom/rules/weave.mdc` | Stage 10 now requires rebase + conflict-free merge |
| `apps/delivery-ops/docs/pages/DeferredInsights-*.md` | Requirements + data layer |
| `apps/delivery-ops/client/src/components/DeferredInsights/ai-audit-docs/` | Journal + INDEX |

## Decisions & Alternatives Considered
- Deferred = labels = "{prefix}-{version}-deferred" (lifecycle.deferred taxonomy) + issuetype Bug, not changelog fixVersion was — simpler, audited by QA DRI; changelog enrichment deferred to v2.
- Filtering server-side via priority/component extraFilter + client-side release subset (chip row) to avoid double fetch; priority allowlisted against known values to prevent JQL injection.
- Recharts ComposedChart (Area stacked fixed/pending + Line total) with onClick on chart, not activeDot prop.

## Mistakes & Corrections
- Initial release filter was single-select `<select>` — violated multi-select spec. Fixed to chip row with per-release toggle (All + each release).
- Heroes initially passed jql=null (no JIRA proof) — fixed to union OR JQL + fixed/pending variants from service; counts now open drill, JIRA hint shows exact JQL.
- Release card missed byComponent — server computed it but never rendered; added third chip row.
- Hardcoded hex colors violated tokens — replaced with var(--*-soft/border/text) + var(--overlay-bg-soft/--z-drawer/--shadow-lg); filter made sticky.
- Chart click used unsupported activeDot.onClick — replaced with ComposedChart onClick.

## Verification
- Review: Code Review 7/7 MET (*1 caveat), QA 11/12, UX 3/9 → Fix pass addressed Blocking/High
- QA edge: TeamRequiredGate, emptyReason, abort, disabled states verified
- docs-verify: PASS (new page docs + audit entry)
- check-compile: shared ✓, server canary ✓, client build ✓ (mcp/* pre-existing tsc failures unchanged)
- check-product-agnostic: OK, check-no-localhost: OK

## Links
- Plan: `~/.opencode/plan/weave-deferred-insights.md`
- PR: TBD
- Docs: `apps/delivery-ops/docs/pages/DeferredInsights-requirements.md`, `DeferredInsights-data-layer.md`

## Config Delta
```json
{"DeferredInsights": {"route": "/deferred-insights", "title": "Deferred Insights"}}
```

## Follow-ups / Waivers
- None. mcp/* tsc failures are pre-existing grandfathered (shared/config/env.ts missing @portfolio-delivery-ops/shared) — not from this weave (verified stashed).
