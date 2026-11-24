# AI Audit — Learnings (Anti-Repeat Log)

> Cross-page mistakes that must not be repeated. Loom's builder reads this file before every weave.
> When a new cross-page mistake is found, append an entry here **and** keep the full context in that page's own `ai-audit-docs/` journal.

## How to add an entry

```markdown
## YYYY-MM-DD — <category> — <short title>
- **Page:** <PageName> (`<route>`)
- **Mistake:** what went wrong
- **Correction:** how it was fixed
- **Prevention:** rule or check to avoid repeating it
- **Source:** `<page-audit-path>/YYYY-MM-DD__...md`
```

Categories: `jql` | `layout` | `config` | `naming` | `process` | `data` | `auth` | `other`

---

<!-- No learnings yet — this file was created with the initial audit trail seed on 2026-11-20. -->
<!-- Append entries below as mistakes are discovered in future weaves. -->

_Seeded on 2026-11-20 with the initial audit trail. No cross-page mistakes have been logged yet._

## 2026-11-20 — naming — stale ReleaseVersionTab name
- **Page:** ProjectStatus (`/project-status`)
- **Mistake:** Component/route still called `ReleaseVersionTab` (legacy tab name) after route became `/project-status`; new devs grepped wrong name, docs drifted.
- **Correction:** Canonical `ProjectStatusPage.js` + `ProjectStatusPage.css`; `ReleaseVersionTab.js` kept as re-export shim; `routeConfig` + `App.js` + `aiAudit.config` updated.
- **Prevention:** `ARCHITECTURE_TARGET.md` rename tracker; grep `ReleaseVersionTab` in CI warn; prefer route-name = file-name.
- **Source:** `apps/delivery-ops/client/src/components/ai-audit-docs/ProjectStatus/2026-11-20__initial__weave-backfill.md`

## 2026-11-20 — data — recurring item.getFieldValue crash
- **Page:** ProjectStatus (`/project-status`)
- **Mistake:** `generateExecutiveSummary`/`generateReleaseHighlights`/`downloadUtils` called `item.getFieldValue(item, key)` (instance method) but items are plain JSON from `releaseItemsDataService`; every row threw `TypeError`, table blank.
- **Correction:** Bulk fix `item.getFieldValue(item,` → `getFieldValue(item,`; hardened `getFieldValue` in both `client/src/utils/jiraFields.js` and `server/utils/jiraFieldsConfig.js` to unwrap `.fields`, delegate to legacy `.getFieldValue` if present, and fallback to `fieldKey` lookup; added `check-no-stale-getfieldvalue.sh` CI guard.
- **Prevention:** Defensive `getFieldValue` handles both shapes; CI guard fails on `item.getFieldValue`; add unit test for `generateExecutiveSummary` with plain item.
- **Source:** `apps/delivery-ops/client/src/components/ai-audit-docs/ProjectStatus/2026-11-20__initial__weave-backfill.md`

## 2026-11-19 — data — duplicate RAG palette + unescaped risk history HTML
- **Page:** ProjectStatus (`/project-status`), SosSummary (`/sos-summary`), EmailSender (`/`)
- **Mistake:** `RAG_COLORS` duplicated across `ReleaseVersionTableCell`, `emailTableGenerator`, `sosEmailHtml` violating D41 SoT; `formatRiskWithHistoryHTML` interpolated raw risk words without escaping (XSS).
- **Correction:** Consolidated to `client/src/utils/riskHistoryDisplay.js` SoT (`RAG_COLORS`, `riskWord`, `getRagColor`, `formatRiskWithHistoryHTML` with `escapeHtml`); server `releaseHistoryService` now passes `includeRiskIndicator:true`.
- **Prevention:** Grep `RAG_COLORS` — must have single definition in `riskHistoryDisplay.js`; docs-verify SoT check; always escape HTML-bound derived words.
- **Source:** `apps/delivery-ops/client/src/components/ai-audit-docs/ProjectStatus/2026-11-19__risk-indicator-trail__weave-risk-indicator-trail.md`

## 2026-11-24 — docs — timeframe-pill doc drift (stale feature folder + API lag)
- **Page:** Oncalls (`/oncalls`)
- **Mistake:** `docs/pages/oncalls/GOALS.md`/`Feature.md`/`PLAN.md`/`STATUS.md` still described pulse-era (G1=buildPulse, G2=dual-click open-family) and `docs/api/jira.md` OnCalls section was pulse-only (no timeframe pills, no gap taxonomy, no `POST /api/ai/oncall-concern`/`oncall-slice`); `docs/pages/oncalls/GOAL_KPI_CARD.md` still said `/oncalls-next` after route became `/oncalls` canonical.
- **Correction:** Overwrote all four feature-folder docs with V2 (8 pills, Overall no-clause, health MTTR, gap taxonomy + NDB sub-drill, fused AI concern, WAIVED V2.1); rewrote `docs/api/jira.md` OnCalls to V2 with timeframe pills, gap taxonomy, Overall, and AI routes; fixed KPI card SCOPE to `/oncalls` canonical.
- **Prevention:** When `TIMEFRAMES`/`timeframeClause` exists in code, Doc gate must verify `docs/pages/oncalls/GOALS.md` mentions `timeframe`+`Overall` and `docs/api/jira.md` documents `?timeframe=`; lint `GOAL_KPI_CARD.md` SCOPE route against `routeConfig.js`; enforce `api-docs-required` retrofit for any `req.query.*` read.
- **Source:** `apps/delivery-ops/client/src/components/Oncalls/ai-audit-docs/2026-11-24__oncalls-v2-vp-rebuild__weave-oncalls-v2.md`
