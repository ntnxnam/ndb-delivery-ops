---
product: NDB Delivery Ops
lastUpdated: 2026-11-24
source: doc-release-notes @ 2026-11-24
---

# Release Notes

> Rolling notes. Per-release files live under `docs/release-notes/<version>.md`. Maintained by `doc-specialist` via `doc-release-notes`.

## NDB 2.11 — _TBD_

See [NDB-2.11.md](./NDB-2.11.md) when cut.

### Fix: Risk Details on Project Status (47780 / 55664)

- Risk Assessment (`customfield_47780`) and Path to Green (`customfield_55664`) now render as plain text on `/project-status` → Risk Details (ADF doc → plain text; `customfield_38460` email HTML unchanged). Stale cached HTML payloads strip to text on next fetch; URLs still render as Link, empty as Not Set. See [USER_GUIDE — Risk Details](../guides/USER_GUIDE.md#risk-details-project-status).

### Recent changes (TCMS Quality table)

- TCMS Quality table now renders **Functional** and **System** rows (2×2:
  Functional/System × Manual/Automation) instead of the legacy
  Overall/Functional/Automation layout. `Overall` is no longer a row/title.
- Window label aligned to data source: **Last 4 weeks** (key
  `releaseLast4Weeks`/`masterLast4Weeks`), with deprecated alias
  `releaseLast3Weeks`/`masterLast3Weeks` retained for back-compat.
- Legacy `overall` data falls back to the **System** row for back-compat.
- Caveat: Functional and System rows currently share the same source metrics
  (clone) until TCMS exposes a `test_category` filter — see
  `KNOWN_ISSUES.md` and `docs/tcms-rows-followup.md`.
- TCMS time-filtered metrics corrected: "Last 4 weeks" now queries
  `/api/v1/all_test_cases/aggregate/metrics` with `time_filter=four_weeks`
  and `target={milestone}-qcow2`, returning genuinely filtered data instead
  of erroring or echoing Overall. See `docs/tcms-rows-followup.md` (Endpoint
  migration).

## Unreleased — risk-indicator-trail (checkpointHistory.riskIndicator SoT)

- **Risk movement trail:** Project Status Risk Details + SoS Summary + release/SOS emails now show Risk Indicator change history (`Red ← Yellow ← Green`, prior values struck-through) from `POST /api/jira/release-items-history` `checkpointHistory[key].riskIndicator`. SoT is `client/src/utils/riskHistoryDisplay.js` (`RAG_COLORS`, `riskWord`, `formatRiskWithHistory`/`formatRiskWithHistoryHTML`); duplicate `RAG_COLORS` maps removed and HTML words escaped. Server `releaseHistoryService` passes `includeRiskIndicator:true` to `fetchFieldHistoryForMultiple`. Feature Dashboard / Email Sender intentionally out of scope — see `docs/pages/FeatureDashboard-data-layer.md#risk-trail-disposition` and `docs/pages/EmailSender-data-layer.md`.
- **Docs:** `docs/pages/ProjectStatus-data-layer.md` documents `checkpointHistory.riskIndicator` contract and SoT; dispositions added to FeatureDashboard/EmailSender data-layer docs.

## Unreleased — weave-client-fields-labels (jiraFieldsConfig v1.1.0 client consolidation)

- **Client SoT mirror:** `client/src/config/jiraFieldsConfig.json` mirrors server SoT (8 field cats + labels taxonomy: porExclude, lifecycle{deferred,mustfix,wishlist,longTermFunded,extension}, dependency.trainAsk, testType.systemTest).
- **fieldConfig fetch-cache:** `client/src/utils/fieldConfig.js` ensureLoaded() via `GET /api/config/jira-fields` (fetch-once, cached) delegates to `client/src/utils/jiraFields` (getFieldId/getLabelJql); consumers must await ensureLoaded() before use.
- **385→0 (resilience):** Hardcoded field IDs/labels removed from client services — all resolved via SoT; badge contrast fix on status pills.
- **P2 cache labels:** trainAsk/longTerm cache keys use taxonomy patterns (no inline strings).
- **Live proof 3× HTTP200:** `/api/config/jira-fields`, project-status, and dependency-view all 200 on QA run.

## Unreleased — `weave/oncalls-v2` (OnCalls V2: VP-first timeframe pills + gap taxonomy + fused AI concern)

> Merge target: `main`. Source: `apps/delivery-ops/client/src/components/OncallsV2/*`, `hooks/useOncallsV2.js`, `server/services/oncallDashboardV2.js`, `oncallGapService.js`, `server/config/oncallConfig.json`, `server/routes/jira/oncalls.js` (timeframe), `server/routes/ai.js` (oncall-concern + oncall-slice), `services/naiService.js` (ONCALL_CONCERN + ONCALL_SLICE), `mcp/shared/tools/buildOncallPrompt.ts`, `docs/pages/oncalls/*`.

- **OnCalls V2 — global timeframe pills:** sticky `7d`/`15d`/`1M`/`1Q`/`2Q`/`1Y`/`18M`/`Overall` drives all heroes/health/concern/age/graph/taxonomy; `Overall` = no `resolved >= -Nd` clause (all history). Every hero shows count + one-line explainer + **Open in JIRA** proof (dual-click: count → in-app drill, link → exact JQL). See [USER_GUIDE — OnCalls V2](../guides/USER_GUIDE.md#oncalls-v2) and [Oncalls requirements](../pages/Oncalls-requirements.md).
- **Health + workflow buckets:** MTTR median/p90, throughput + net, aged share; How-long-open table (Open now / Need Info / Waiting for Customer); pulse graph with timeframe window override (`window: computePulseWindow(tf)`). Need Info = `status="Need Info"`, Waiting = `status="Waiting for Customer"`; thresholds from `oncallConfig.json` (`needInfoDays`/`waitingForCustomerDays`/`agedOpenDays`).
- **Gap taxonomy:** `duds` (duplicate/Won't Do/Cannot Reproduce/no linked fix) · `ndbGaps` (linked fix in NDB family via `gapProjectPrefixes`) · `other-team gaps`; NDB double-click expands TH linked / Bugs / Improvements / Other. Cells are `key in (…)` JQL proofs; [Oncalls data-layer](../pages/Oncalls-data-layer.md#domain-classification--v2-gap-taxonomy) documents rules.
- **Fused AI concern + per-view slice:** `POST /api/ai/oncall-concern` merges open/MTTR/net + hotspot top-2 components + gap% into ~100w (regenerates on pill/hero/taxonomy/view); `POST /api/ai/oncall-slice` gives drawer 2-liner + fix suggestion. Loom builds prompt (`buildOncallPrompt.ts`), Lighthouse calls NAI. See [API — OnCalls V2](../api/jira.md#oncalls).
- **Legacy removed 2026-11-24:** V1 pulse page deleted; `/oncalls-legacy` redirects to `/oncalls` (V2). Added `POST /api/jira/oncalls/report` Download + Email HTML (reuses Outstanding pattern).
- **Deferred to V2.1 (WAIVED):** weekly scheduled report cron→email + TPM Pulse card + SchedulePage hook — tracked in [GOALS.md](../pages/oncalls/GOALS.md).
- **Known limitations added:** [KNOWN_ISSUES.md](../known-issues/KNOWN_ISSUES.md) — NDB fallback tenant override + weekly report deferred.

## Unreleased — `weave/feature-dashboard-shared-views` (bin-packing converter + `NAI_*` canonical)

> Merge target: `main` @ `eb71a25`. Source: `apps/bin-packing`, `shared/src/connectors/aiConnector.ts`, `shared/src/services/csvConverterService.ts`, `mcp/shared/tools/convertToBinPackingCsv.ts`, `agent-pack/lighthouse/skills/csv-to-binpacking/`, `apps/delivery-ops/server/routes/binPackingConvert.js`.

- **Bin-Packing — universal file → canonical CSV converter (new):** any `.csv`, `.tsv`, `.xlsx`, `.xls`, `.pdf`, `.docx`, `.html`/`.htm` or pasted TSV/CSV (≤ 10 MB) can be converted to the canonical 26-column Sheet1 CSV via **Convert any file (AI)** above the existing upload card in `apps/bin-packing/upload.html`. Preview maps headers via the product-aware alias table (`shared/src/services/productColumnAliases.ts`), surfaces warnings/missing-mandatory, validates through `shared/src/services/csvConverterService.ts`, and offers **Download CSV** or **Replace & Repack** (direct chart render). Server path `POST /api/bin-packing/convert` accepts `multipart/form-data` (primary) and `JSON { filename, contentBase64, mimeType }` (fallback), is auth-guarded (`apiLimiter` + `validateJiraTokenMiddleware`, same as `POST /api/ai/*`), and runs per-request `mkdtemp` isolation. See [USER_GUIDE — Bin-Packing CSV Converter](../guides/USER_GUIDE.md#bin-packing-csv-converter) and [CSV Converter Guide](../product/CSV_CONVERTER_GUIDE.md). No change to the existing CSV/XLSX upload or the deterministic bin-packing scheduler.
- **MCP — `convertToBinPackingCsv` tool:** new read-only tool in `mcp/shared` (exposed via `mcp/lighthouse` as `lighthouse-mcp`). Input `filePath` is validated (10 MB ceiling, traversal + MIME guard) and returns `{ csvText, warnings, stats, validation }`.
- **Skill — `agent-pack/lighthouse/skills/csv-to-binpacking/`:** `SKILL.md` (frontmatter: `name: csv-to-binpacking`, `audience: portfolio_mgr`, triggers), `prompt.md` (placeholders `{productId}`, `{filePath}`), `examples.md` (4 worked flows + anti-patterns). Orchestrator-only — deterministic logic stays in `shared`. No forked copy under `.claude/skills` / `.cursor/skills` (harness symlinks only).
- **AI config — `NAI_*` canonical (5 vars):** `NAI_API_KEY`, `NAI_API_BASE_URL`, `NAI_DEFAULT_MODEL`, `NAI_MAX_TOKENS`, `NAI_REQUEST_TIMEOUT` are canonical; `AI_*` kept as fallback. Non-secret defaults live in `server/config/aiConfig.json` (`baseUrl`, `defaultModel`, `maxTokens`, `requestTimeoutMs`); secrets in `server/.env` only. Resolution: `per-call override → NAI_* env (→ AI_* fallback) → aiConfig.json → throw actionable NAI_* error`. Documented in [ADMIN_GUIDE — AI / NAI Configuration](../guides/ADMIN_GUIDE.md#ai--nai-configuration) and [LLD — NAI Configuration §7](../technical/LLD-ai-layer.md#7-nai-configuration--canonical-nai-precedence). `apps/delivery-ops/server/.env.example` updated. Server now throws `NAI_API_KEY is not set…` / `NAI_API_BASE_URL is not set…` etc. — error tables in `docs/api/ai.md` and `apps/delivery-ops/docs/api/ai.md` reflect the canonical names.
- **Server — body parser limit:** `bodyParser.json({ limit: '15mb' })` (was `1mb`) in `server/index.js` to allow 10 MB binary via the JSON base64 path (≈13.3 MB b64). Documented in [ADMIN_GUIDE](../guides/ADMIN_GUIDE.md#bin-packing-converter--server--auth--limits).
- **Known limitation added:** [KNOWN_ISSUES.md#bin-packing-converter](../known-issues/KNOWN_ISSUES.md) — 10 MB cap, restricted extension allowlist.

## Unreleased — `weave/teams-config` (Teams Config filter/sprint/people JQL — PM/Dev/QA 3 DLs, shared 10, sprint 21d)

> Merge target: `main`. Source: `apps/delivery-ops/client/src/components/AdminPanel/TeamForm.js` (`buildPreview`/`formatJql`/`ChipInput` blur-add), `server/services/teamAdminService.js` (`buildBaseJqlFromTeam`, `leader_outlook_dls` → assignee inner OR), `shared/src/services/teamBaseJqlService.ts` (`SHARED_PROJECTS_ALL`=10, `leaderOutlookDLs` param, `buildInnerOr`), `server/utils/sprintCalendar.js` (`inferSprintCalendarFromSprints` recent-10 median → `snapSprintDays` 7/14/21 default 21d), `server/config/teamBoardConfig.json` (NDB `ERA,NDBECO` private), `agent-pack/lighthouse/context/pages/admin.md`.

- **Filter (shared 10 + private):** JQL now generated deterministically via `teamBaseJqlService` — `is_shared_project=true` → `project in (ENG, FEAT, ONCALL, TH, SDL, TECHPUBS, SR, LEG, ACP, LBDR)` (10) `AND (component in (…) OR "primary component" in (…) OR assignee in (…) OR issuetype in ("Era Oncall","ERA Oncall"))`; `is_shared_project=false` → `(project in (ERA,NDBECO) OR (project in (shared 10) AND (inner OR)))` — NDB example `ERA,NDBECO` private per 2026-11-24 correction, legacy empty list cleared. Components validated across ENG + 10 horizontals via `GET /rest/api/2/project/{key}/components`. See [Admin data-layer](../pages/Admin-data-layer.md#team-form--save-team) and [API — Admin](../api/admin.md#post-apiteams).
- **People (8 rows + 3 Leadership DLs → assignee inner OR):** 8 contact rows (`team`/`serv_team`/`doc_team`/`security_team`/`legal`/`documentation`/`trade_compliance`/`others`) each `{entries[], isDL}` plus 3 dedicated Leadership DL inputs PM/Dev/QA (`leader_outlook_dls[3]`) all auto-map to `assignee in (membersOf("PM") OR membersOf("Dev") OR membersOf("QA") OR membersOf(DL) OR handle)` inner OR — no re-typing in Contacts. `ChipInput` now commits on `Enter` / `,` / `paste` / `blur` with 24px `×` target and `DL → membersOf` vs `→ handle` toggle label per row; indented `formatJql` preview (`2sp` per `(`/`OR`/`AND`) in `<pre>` with Copy/Reset. Client `buildPreview` and server `buildBaseJqlFromTeam` parity via `buildInnerOr` (`assigneeDLs` + `leaderOutlookDLs`).
- **Sprint (board + 21d + S1 base date, recent-10):** Full-team sprint config is now `boardId` (board number from Jira Agility URL) + `sprintDays` (number 1–90, default 21) + `s1StartIso` (date `YYYY-MM-DD`). Auto-detect via `POST /api/admin/project-scope` + `POST /api/admin/board-calendar` → `collectSprintCalendarFromBoard` paginates `GET /rest/agile/1.0/board/{id}/sprint` (max 4 pages) → `inferSprintCalendarFromSprints` uses **recent 10** sprints median snapped to 7/14/21 (was full-history 14d bias) — 15×14d + 8×21d → 21d correctly; fallback 21d when no durations; `named S1` else earliest dated sprint. Manual override via date/duration inputs + `Load Calendar` / `Auto-detect from project`. Stored as `sprintCalendar: {s1StartIso, sprintDays}` in `teamBoardConfig.json`.
- **Docs:** `docs/pages/Admin-requirements.md` + `Admin-data-layer.md` rewritten to component/people/sprint JQL-generation flow (no manual `filter=` paste); `docs/api/admin.md` documents `is_shared_project`/`custom_project_key`/`components`/`leader_outlook_dls`/`contacts`/`base_jql` + 21d calendar; `ADMIN_GUIDE.md` adds Teams Config section with JQL shape + sprint inference; `TECH_DESIGN.md` §2 notes `teamBaseJqlService`/`sprintCalendar` SoT.
- **Verification:** `sprintCalendar.test.js` adds `recent 10 sprints for 21d cadence` case; `teamBoardConfig.json` NDB JQL matches agreed sample `(project in (ERA,NDBECO) OR (project in (ENG,FEAT,ONCALL,TH,SDL,TECHPUBS,SR,LEG,ACP,LBDR) AND (... assignee in (membersOf(3 DLs) ... ) ...)))`; `baseFilterTouched` guard preserves edits.

## Template for next release

Copy into `release-notes/<version>.md`:

- Highlights (3-5 exec-readable bullets)
- What's New / Enhancements / Bug Fixes
- Breaking Changes (⚠️ + migration step)
- Upgrade Notes
- Known Issues → [KNOWN_ISSUES.md](../known-issues/KNOWN_ISSUES.md)
