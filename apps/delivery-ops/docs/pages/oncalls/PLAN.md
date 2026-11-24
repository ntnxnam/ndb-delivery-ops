# Plan — OnCalls V2 (VP-first rebuild)

1. **Wireframe + GOAL_KPI_CARD** — pills (8), hero explain rows, health MTTR strip, concern card, age table, graph toggle, taxonomy + NDB drill, drawer with AI slice; `docs/pages/oncalls/wireframe.html`
2. **Server V2** — `oncallDashboardV2.js` (timeframe pills + Overall no-clause + parallel fetch + pulse window override + gap taxonomy) + `oncallGapService.js` (duds/NDB/other + NDB sub) + `oncallConfig.json` thresholds
3. **Routes** — `GET /api/jira/oncalls?timeframe=&v2=` (dual-path), `GET /api/jira/oncalls/v2`, `POST /api/jira/oncalls/refresh` timeframe-aware, `POST /api/ai/oncall-concern` + `oncall-slice` with `ONCALL_CONCERN`/`ONCALL_SLICE` prompts; `mcp/shared/tools/buildOncallPrompt.ts` (Loom) + `mcp/lighthouse product tool`
4. **Client V2** — `OncallsV2Page.js` (sticky pills, ExplainHero + dual-click, health row, taxonomy double-click, PathDrill with `gapMeta` + `aiSlice`)
5. **Hooks** — `useOncallsV2.js` (timeframe state, parallel fetch, auto concern, per-view slice) + `useOncallSlice.js`
6. **Docs** — `docs/pages/Oncalls-requirements.md` (OC-V2-01..12), `docs/pages/Oncalls-data-layer.md` (timeframe/gap/API), `docs/api/jira.md` V2 (pills + taxonomy + `Overall`), `docs/pages/oncalls/{GOALS,Feature,PLAN,STATUS}` + wireframe.html
7. **Guides + release** — USER_GUIDE (pill + taxonomy How-To), ADMIN_GUIDE (oncallConfig), TECH_DESIGN/LLD-ai-layer (V2 architecture), KNOWN_ISSUES + RELEASE_NOTES
8. **AI audit** — `ai-audit-docs/Oncalls` journal via `new-entry.sh`, LEARNINGS.md when cross-page, rebuild INDEX/timeline, docs-verify PASS
9. **Deferred (V2.1)** — weekly scheduled report cron→email, TPM Pulse card + SchedulePage hook (WAIVED per KPI card)

Out of scope: kpiConfig JQL edits; NDB tenant strings in code (use config); new JQL without approval.
