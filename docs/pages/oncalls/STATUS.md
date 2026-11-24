# STATUS — OnCalls V2 (VP-first 2-lens rebuild)

**Goal state**: COMPLETE — Dev + Docs + AI audit ready for Doc sign-off (Security paused per policy)

| Goal | Verdict | Evidence |
|------|---------|----------|
| G1 Global timeframe pills | MET | `oncallDashboardV2.TIMEFRAMES` 8 pills; `timeframeClause` returns null for Overall; `GET ?timeframe=Overall` omits date; sticky pills inherit in drawers |
| G2 At-a-glance + health heroes | MET | `OncallsV2Page` 5 heroes + 4 health `ExplainHero` with explain one-liner + `jiraHref` proof; dual-click wired |
| G3 Workflow buckets | MET | `buildTimeframeHeroQueries` needInfo/waiting JQL `status="Need Info"/"Waiting for Customer"`; thresholds from `oncallConfig.json` in meta |
| G4 Gap taxonomy + NDB sub-drill | MET | `oncallGapService.classifyGapBuckets/buildGapCells` + `classifyNdbSubGaps`; `gapTaxonomy`/`gapMeta` in payload; double-click NDB → 4 sub-cards |
| G5 Fused AI concern | MET | `naiService generateOncallConcern(generateOncallSlice)`; `useOncallsV2` auto + slice on drill; Loom prompt + Lighthouse consume |
| G6 Requirements locked | MET | `docs/pages/Oncalls-requirements.md` OC-V2 + `Oncalls-data-layer.md` + `docs/api/jira.md` V2 + this folder + wireframe |

## Pipeline scorecard

| Stage | SCORE | Notes |
|-------|-------|-------|
| 1 Developer | Done | V2 route + sticky pills + hero explain + health MTTR + concern + age table + graph + taxonomy + NDB drill + drawer with AI slice + server timeframe-aware + config thresholds + 7d default + parallel fetch |
| 2 Code Review | Ready | No localhost, minimal-arch, no duplicate connector, JQL edits flagged via `jql-edit-approval` |
| 3 QA | Ready | Pill JQL matches hero proof; Overall = no date clause; Need Info/Waiting JQL valid; gap taxonomy checks |
| 4 UX | Ready | Sticky pills on scroll + in drawers; explain visible without hover; MTTR distinct; graph toggle; taxonomy double-click flow |
| 5 PM | Ready | VP can answer hotspot + too-long owner + fix-this in one skim; persona team-exec/tpm covered |
| 6 Exec | Ready | High-level concern first (100w + hotspot + gap%) then drill-down; every hero count has JQL proof |
| 7 JIRA Query Check | Ready | Every hero uses `baseScopeJql` + status/resolution clause; dual-click + `linkedIssuesOf` exact baseQuery |
| 8 Doc sign-off | In progress | This file + 5 surfaces + api/pages per `page-docs-required`/`api-docs-required` + AI audit |
| 9 Security | Skipped — paused | per weave.mdc |

## Waivers

- Weekly scheduled report (cron→email) + TPM Pulse card + SchedulePage hook — deferred to V2.1, tracked in `GOAL_KPI_CARD.md` WAIVED line

## Links

- Wireframe: `docs/pages/oncalls/wireframe.html` (and `apps/delivery-ops/docs/pages/oncalls/wireframe.html` stub)
- Page docs: `docs/pages/Oncalls-requirements.md` + `docs/pages/Oncalls-data-layer.md`
- API docs: `docs/api/jira.md#oncalls` (V2)
- Code: `apps/delivery-ops/client/src/components/OncallsV2/OncallsV2Page.js` + `server/services/oncallDashboardV2.js` + `oncallGapService.js`
