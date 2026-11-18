# 04 — Dead-Code Audit

> **Scope:** Entire repo — `apps/delivery-ops` (client + server), `shared`, `mcp-server`, `agent-pack`, `apps/bin-packing`, `apps/tpm-confluence-tools`
> **Date:** 2026-11-11
> **Method:** 5 parallel static scans + manual verification via `grep`/`wc -l`/direct reads. Dead = exported/defined but never imported/called by any runtime path, excluding tests and `node_modules`.
> **Definitions:**
> - **Confirmed dead** — never imported/called by any runtime file; safe to delete with no behavior change (after tests pass).
> - **Unwired / orphaned** — ported and tested but no feature wires it yet; keep until consumer lands (decide: wire or delete).
> - **Intentional placeholder** — kept by design (stub throwing loud error, SoT copy, compat shim); not dead but flagged for visibility.
> - **Legacy / tech debt** — dead behind early-return or behind comment, should be deleted or re-enabled with a ticket.

---

## Summary Counts

| Category | Count | Risk if deleted today |
|----------|-------|----------------------|
| Confirmed dead — files never imported | **12 files** | None — no caller |
| Confirmed dead — orphans inside live files (unused import / function) | **4 sites** | None |
| Confirmed dead — unreachable code behind early return | **1 site** (26 lines) | None — already unreachable |
| Confirmed dead — npm dependencies never required | **5 deps** | None — remove from `package.json` |
| Commented-out code blocks (disabled features) | **3 blocks** | Decision needed (re-enable behind flag or delete) |
| Unwired — server endpoints never fetched from client | **~33 endpoints** | Low — admin/cron/migrated surfaces; verify before deleting |
| Unwired — shared services ported but 0 server importers | **3 services** | Keep — trunk dependents; wire soon |
| Intentional placeholders / SoT copies | **6 sites** | — do not delete |
| Duplicate `formatDate` implementations | **7+ copies** | Low — consolidate to one |

---

## 1. Confirmed Dead — Files Never Imported (safe to delete)

### 1.1 Server route stubs — 9 files

`apps/delivery-ops/server/routes/jira/` contains 8 one-line re-export aliases + 1 placeholder router with zero endpoints. Verified via `wc -l` and `grep router\.(get|post)` returning 0, and `server/routes/jira/index.js:1-21` not requiring them.

| File | Lines | Content | Verdict |
|------|-------|---------|---------|
| `server/routes/jira/admin.js:1` | 1 | `module.exports = require('./diagnostic')` | Dead alias — `diagnostic.js` is mounted directly |
| `server/routes/jira/component-report.js:1` | 1 | `module.exports = require('./versions')` | Dead alias — `versions.js` mounted directly |
| `server/routes/jira/feature-dashboard.js:1` | 1 | `module.exports = require('./kpi')` | Dead alias — `kpi.js` mounted directly |
| `server/routes/jira/jira-emailer.js:1` | 1 | `module.exports = require('./kpi')` | Dead alias |
| `server/routes/jira/project-status.js:1` | 1 | `module.exports = require('./versions')` | Dead alias |
| `server/routes/jira/release-setup.js:1` | 1 | `module.exports = require('./setup')` | Dead alias — `setup.js` mounted directly |
| `server/routes/jira/retrospective.js:1` | 1 | `module.exports = require('./changelog')` | Dead alias |
| `server/routes/jira/sprint-report.js:1` | 1 | `module.exports = require('./sprints')` | Dead alias — `sprints.js` mounted directly |
| `server/routes/jira/component.js:1-90` | 90 | Imports 20+ modules, defines `express.Router()`, but `grep router\.(get|post|put|delete)` → 0 endpoints, ends `module.exports = router` | Dead placeholder — router with no routes; never mounted in `jira/index.js` nor `server/index.js` |

**Note:** `server/routes/jira/proxy.js:69` looks similar but is **alive** — mounted separately in `server/index.js:132` as `/api/jira/proxy` (outside `jira/index.js`). Do not delete.

**Action:** Delete all 9. They are Phase 2c back-compat aliases left behind after route extraction; nothing requires them (verified `grep -r "require.*jira/component"` → 0 hits outside `index.js` mount table).

### 1.2 Client — 5 files

Verified via `grep -rn "<importName>" client/src --include="*.js"` excluding self/tests → 0 hits.

| File | Lines | Export | Evidence | Action |
|------|-------|--------|----------|--------|
| `client/src/components/GanttStyle2.js:1-14` | 14 | `export { default } from './ReleaseGantt'` | `grep -rn GanttStyle2 client/src` → only self. Comment says "Used by: SosSummaryPage" but `SosSummaryPage.js` never imports it — it would import `ReleaseGantt` directly if needed. | Delete — dead re-export alias. `ReleaseGantt.js` itself is live (`ReleaseConfigPage.js:4` imports it). |
| `client/src/utils/nutanixQuarters.js:1-85` | 85 | `getQuarterRange`, `quarterContaining`, `lastNQuartersWindow` | `grep -rn nutanixQuarters client/src` → only self. Server mirror `server/utils/nutanixQuarters.js` is live (`kpiPulseService.js:11`); client `SprintReportPage.js` re-implements `getNutanixQuarterRange()` locally instead of importing this. | Delete or wire — client duplication; either import this file or delete it. |
| `client/src/hooks/useCrystalBall.js:1-205` | 205 | `useCrystalBall()` | `grep -rn useCrystalBall client/src --include="*.js" | grep -v __test__ | grep import` → 0 importers. Only referenced in `hooks/index.js:27` barrel and `__tests__/hooks/useCrystalBall.test.js`. | Delete — CrystalBall feature mock; no page uses it. Server `landingForecastService` is the real implementation. |
| `client/src/hooks/useSosLeaderCoaching.js:1-101` | 101 | `useSosLeaderCoaching()` | `grep -rn useSosLeaderCoaching client/src --include="*.js" | grep import` → 0 importers outside self+barrel. Hook would call `POST /api/ai/sos-leader-coaching` (`useSosLeaderCoaching.js:41`) but no component ever calls the hook. Replaced by `useSosLeaderAiSummaries.js` (SoS by Leader client-assembled packets). | Delete — superseded. Server endpoint `POST /api/ai/sos-leader-coaching` (`server/routes/ai.js:524`) is then also orphaned (see §3.1). |
| `client/src/hooks/useTeams.js:1-10` | 10 | `useTeams()` | `grep -rn "useTeams" client/src --include="*.js" | grep -v "useTeams.js" | grep import` → 0 importers outside `hooks/index.js:13`. Back-compat wrapper comment: "All consumers should go through TeamContext". All call sites use `contexts/TeamContext.js:useTeam`. | Delete — wrapper never used. |

---

## 2. Confirmed Dead — Orphans Inside Live Files

### 2.1 `server/index.js:17` — unused import

```js
// server/index.js:17
const { formatDateWithHistoryHTML, formatAllCheckpointDatesHTML } = require('./utils/dateFormatter');
```
`grep -n formatDateWithHistoryHTML server/index.js` → only line 17. Both bindings never referenced again in the file (routes were extracted to `server/routes/jira/`; the file is now mount-table + 292 lines). Leftover from Phase 2a extraction.

**Fix:** Delete line 17.

### 2.2 `server/index.js:177-209` — orphaned helper

```js
// server/index.js:177
function formatDate(dateValue) { /* 32 lines dd/MMM/yyyy */ }
```
`grep -n "formatDate" server/index.js` → only the definition line. Never called (file uses `utils/dateFormatter.js` canonical; this is pre-extraction legacy). Comment above: "Endpoint to fetch JIRA ticket data — Fetch and fetch-epics endpoints moved to routes/jira.js" — the helper stayed behind.

**Fix:** Delete lines 177-209.

### 2.3 `server/routes/config.js:24` — unused binding

```js
// server/routes/config.js:24
const releaseVersionsEmailConfig = require('../config/releaseVersionsEmailConfig.json');
```
Only occurrence is line 24; later code re-reads the same JSON via `path.join(__dirname, '../config/releaseVersionsEmailConfig.json')` (line 252) and via `RELEASE_VERSIONS_EMAIL_CONFIG_PATH` (line 23). Binding never used. Companion constant on line 23 *is* used.

**Fix:** Delete line 24 (keep line 23 path constant).

### 2.4 `server/routes/jira/misc.js:101-127` — unreachable code behind early return

```js
// server/routes/jira/misc.js:91-127
router.get('/team-configurations', requireAuth('releaseVersions'), async (req, res) => {
  // TEMPORARILY DISABLED FOR DEBUGGING
  return res.json({ success: true, data: { availableTeams: [], configurations: {}, ... } });
  try {                                         // ← unreachable
    const voodooService = require('../../services/voodooService');  // dead
    const teamConfigurations = require('../../config/teamConfigurations.json');
    return res.json({ ... teamConfigurations ... });
  } catch (error) { ... }
});
```
Everything after the early `return` (lines 101-127, 26 lines) is unreachable. `voodooService` require and `teamConfigurations.json` read never execute. Handler was disabled for debugging and left in that state.

**Fix:** Either delete lines 101-127 or remove the early return (line 93) to re-enable. Do not ship both branches — the dead branch misleads readers and the `voodooService` import hides a dependency.

---

## 3. Confirmed Dead — Uninstalled npm Dependencies (never required)

Verified via `grep -r "require.*<name>|from.*<name>"` in source (excluding `node_modules`, `package-lock.json`) → 0 hits. These bloat install and audit surface.

| Package | Declared in | Evidence | Action |
|---------|-------------|----------|--------|
| `sqlite3@^6.0.1` | `apps/delivery-ops/server/package.json:1` | `grep -r sqlite3 server --include="*.js" | grep -v node_modules` → only `package-lock.json`. No `require('sqlite3')` anywhere. Persistence uses `tinydb`-like JSON (`server/utils/emailHistoryDB.js:12` comment: "Simple JSON-based (TinyDB-like)") and `data/*.json` files, not SQLite. | `npm uninstall sqlite3` in `server/` |
| `tinydb@^0.1.0` | `apps/delivery-ops/server/package.json:1` | Same — 0 `require('tinydb')`. `emailHistoryDB.js:12` implements its own JSON store and explicitly notes "TinyDB-like functionality" (custom class). | `npm uninstall tinydb` |
| `uuid@^14.0.0` | `apps/delivery-ops/server/package.json:1` | 0 `require('uuid')` / `from 'uuid'`. Code uses `crypto.randomUUID()` (`server/utils/scheduledEmailsDB.js:3`). | `npm uninstall uuid` |
| `https-proxy-agent@^7.0.4` | `apps/delivery-ops/server/package.json:1` (also in `shared` + `mcp-server`) | 0 hits in `server/**/*.js`; correctly used in `shared/src/connectors/jiraConnector.ts:1`, `confluenceConnector.ts`, `githubConnector.ts`. Server dep is redundant — consumed transitively via `@portfolio-delivery-ops/shared`. | Remove from `server/package.json` (keep in `shared`) |
| `jsdom@^29.0.2` | `apps/delivery-ops/package.json:1` | 0 hits in `apps/delivery-ops/**/*.js` outside lock. No test setup uses it (`craco`/`react-scripts` provide own jsdom). | `npm uninstall jsdom` in `apps/delivery-ops/` |
| `officegen@^0.6.5` | `apps/delivery-ops/package.json:1` | 0 hits. Legacy PPTX export from pre-consolidation `ndb-status-sender` (archived). No route generates `.pptx` today (email is HTML via `nodemailer`). | `npm uninstall officegen` |
| `axios@^1.6.2` (in `mcp-server/package.json`) | `mcp-server/package.json:1` | 0 `import axios` / `require('axios')` in `mcp-server/src/**/*.ts`. Pulled transitively via `shared` (`shared/src/connectors/jiraConnector.ts` uses it). | Remove from `mcp-server` (keep in `shared`) |
| `https-proxy-agent` (in `mcp-server/package.json`) | `mcp-server/package.json:1` | Same — 0 hits in `mcp-server/src`. Transitive via `shared`. | Remove from `mcp-server` |

All other deps verified alive (`express`, `cors`, `helmet`, `express-rate-limit`, `express-validator`, `node-cron`, `nodemailer`, `dotenv`, `body-parser` in server; `react`, `react-dom`, `react-router-dom`, `axios`, `recharts`, `lucide-react`, `html2canvas`, `jspdf`, `react-quill` in client; `@modelcontextprotocol/sdk`, `zod` in mcp-server; `axios`, `zod`, `nodemailer`, `https-proxy-agent` in shared).

---

## 4. Commented-Out Code Blocks (disabled features — decide: flag or delete)

Real commented-out code (filtered `^\s*//\s*(const|let|import|function|return|if)` against `apps/`; excluded prose comments like `// If no pagination…`).

| File | Lines | Snippet | Why disabled | Decision needed |
|------|-------|---------|--------------|-----------------|
| `client/src/components/ReleaseVersionGantt.js:268-269` | 2 | `// const longTermItemsSorted = sortItems(items.longTermFunded \|\| []);` <br> `// const allItems = [...commitItemsSorted, ...longTermItemsSorted];` + earlier `// Only show committed projects, not long-term funded` | Long-term funded bars intentionally hidden from Gantt (commit vs long-term split). | Either delete or extract behind feature flag `REACT_APP_SHOW_LONG_TERM_GANTT`. Do not leave as comment — the intent is 1 line away from being lost. |
| `client/src/components/ReleaseVersionTab.js:337-343` | 7 | `// TCMS calls disabled - they were causing timeouts and bombing the system`<br>`// const commitKeys = items.commit.map…`<br>`// fetchCommitTcmsData…` | TCMS QI fetch for commit items disabled (timeout/bombing). | Same — feature-flag or delete. If TCMS is retired, delete; if to be re-enabled, gate behind `REACT_APP_ENABLE_TCMS` and add ticket. |
| `client/src/components/ReleaseVersionTab.js:382-388` | 7 | Mirror of above for `longTermKeys` / `fetchLongTermTcmsData` | Same | Same |
| `client/src/components/ReleaseVersionTab.js:688` | 1 | `// formatDateWithHistory moved to utils/dateHistoryUtils.js` | Stale relocation note (file moved). No code. | Delete line — noise. |

**Not counted:** `client/coverage/` HTML mirrors of same comments — build artifact, ignore.

---

## 5. Unwired — Server Endpoints Never Fetched from Client (~33)

Extracted 144 server endpoint suffixes via `grep router\.(get|post|put|delete)` and 117 distinct `/api/*` strings from `client/src` (`grep -RohE "/api/[^'\"]+"` + interpolated `${API()}/suffix` patterns). Cross-checked each suffix against actual client grep hits.

Many hits are **not dead — just admin/cron/migrated surfaces** called via `curl`, scheduler, or legacy email paths outside React. Do not bulk-delete without checking caller.

| Endpoint | Defining file | Why unwired from React | Verdict |
|----------|---------------|------------------------|---------|
| `GET /api/config/allowed-users` | `server/routes/config.js:268` | Admin legacy list; UI uses `GET /api/config/teams` | Keep — admin curl; or delete if `allowedUsers.json` fully migrated to `TAB_PERMISSIONS` |
| `GET/POST /api/config/release-base-filter` | `server/routes/config.js:192/213` | Replaced by `team-base-filter` (D1 product-agnostic) | Deprecate — add `410 Gone` pointing to `team-base-filter`; delete after migration |
| `GET /api/config/jira-fields` | `server/routes/config.js:303` | Dump; UI uses `jiraFieldsConfig.json` directly | Keep if diagnostic page uses it, else delete |
| `POST /api/admin/clear-token-cache` | `server/routes/admin.js:158` | Super-admin only (cache debug) | Keep — admin surface |
| `POST /api/admin/clear-jira-cache` | `server/routes/admin.js:201` | Same | Keep |
| `GET /api/admin/token-cache-stats` | `server/routes/admin.js:139` | Same | Keep |
| `GET /api/admin/jira-cache-stats` | `server/routes/admin.js:176` | Same | Keep |
| `GET /api/jira/jira-diagnostic` | `server/routes/jira/diagnostic.js:91` | Manual curl diagnostic | Keep |
| `POST /api/jira/test-jql` | `server/routes/jira/diagnostic.js:202` | Same | Keep |
| `POST /api/jira/validate-nai-key` | `server/routes/jira/ai-reports.js:12` | Pre-check for NAI (no UI) | Keep or merge into `/api/ai` |
| `POST /api/jira/generate-ai-vp-report` | `server/routes/jira/ai-reports.js:77` | Team-Executive report — gated `validate-nai-key`, not in sidebar; Superseded by `/api/ai/page-briefing` but still callable | Deprecate |
| `POST /api/jira/generate-exec-summary` | `server/routes/jira/exec-summary.js:95` | Superseded by `POST /api/ai/exec-summary` (which adds `deriveSignals` → NAI) | Deprecate — 410 with pointer to `/api/ai/exec-summary` |
| `POST /api/jira/enhanced-exec-summary` | `server/routes/jira/exec-summary.js:141` | Deprecated V2 of same | Deprecate |
| `POST /api/jira/create-universal-agent-input` | `server/routes/jira/exec-summary.js:234` | Agent-input builder; superseded by `generate-exec-summary` | Delete if no external caller |
| `POST /api/jira/discover-versions` | `server/routes/jira/versions.js:111` | Auto-discovery; UI uses `GET /api/jira/release-versions` | Keep if admin wizard uses it (`routes/jira/setup.js` may) |
| `POST /api/jira/risk-indicator-changes` | `server/routes/jira/versions.js:159` | Emailer-only | Keep — `EmailSender` risk change email uses it? Verify |
| `PUT /api/jira/update-executive-summary` | `server/routes/jira/versions.js:148` | Confluence push; now via `/api/ai/exec-summary` (`PUT /exec-summary/:key` → `customfield_38460`) | Deprecate |
| `GET /api/jira/p0-bugs` | `server/routes/jira/misc.js:135` | UI derives from `release-kpi-results` | Keep if external dashboard calls it |
| `GET /api/jira/team-configurations` | `server/routes/jira/misc.js:91` | Disabled (see §2.4) + superseded by `/api/config/teams` | Already dead (early return); remove endpoint or re-enable |
| `GET /api/jira/test-changelog/:key` | `server/routes/jira/changelog.js:289` | Test/debug | Keep behind `NODE_ENV !== production` gate |
| `POST /api/jira/sprint-kpi-breakdown` | `server/routes/jira/sprints.js:135` | Internal; superseded by `sprint-report` | Delete or gate |
| `POST /api/release-dataset/refresh-now` | `server/routes/releaseDataset.js:1967` | Manual refresh; UI uses `POST /api/release-dataset/sync` (SSE) via `releaseSync.js` | Deprecate — point to `/sync` |
| `POST /api/release-dataset/backfill-meta` | `server/routes/releaseDataset.js:2005` | One-time migration helper | Delete after migration confirmed |
| `GET /api/release-dataset/releases` | `server/routes/releaseDataset.js:176` | No React caller; React uses `synopsis`/`per-release` + `ReleaseDataContext` | Keep if scheduler or external tool uses it |
| `POST /api/release-dataset/sync/bucket` | `server/routes/releaseDataset.js:2392` | Background single-bucket sync (job only) | Keep — used by `releaseDatasetSync.ts:syncReleaseBucket` |
| `GET/DELETE /api/release-dataset/cache` | `server/routes/releaseDataset.js:2120` / `releaseSync.js:385` | Debug/cache-bust; `DELETE /api/release-dataset/cache?mode=bundle|full` | Keep behind admin gate |
| `GET /api/release-dataset/sync-status` | `server/routes/releaseSync.js:107` | React `ReleaseDataContext` hits `per-release` not `sync-status` directly | Keep — SyncHub/admin polling uses it |
| `GET /api/auth/voodoo-key/status` | `server/routes/auth.js:312` | Voodoo AI key admin-only | Keep |
| `POST/DELETE /api/auth/voodoo-key` | `server/routes/auth.js:250/344` | Same | Keep |
| `GET /api/date-mover/gate-date-fields` | `server/routes/dateMover.js:38` | Date-mover picker metadata; no React form yet (backend ships, UI pending per ARCHITECTURE.md:F) | Keep — will be used when Date Mover UI lands |
| `POST /api/date-mover/move-gate-date` | `server/routes/dateMover.js:52` | Same — RM-gated D30 | Keep |
| `POST /api/ai/sprint-leadership-asks` | `server/routes/ai.js:489` | AI prompt — hook exists (`useSprintLeadershipAsks` if any); UI currently uses `release-summary`/`weekly-skim` | Keep — called by `sprintPerformanceReportService` |
| `GET /api/status-snapshots/trends` | `server/routes/statusSnapshots.js:45` | React uses `release-dataset/retrospective` not `status-snapshots/trends` | Deprecate — delete if no external consumer |

**Action:** Do not delete this tier blindly. Most are admin/cron diagnostics. Tag each with `410 Gone` + replacement pointer before removal, and check for external callers (scripts, cron, SoS email HTML builder) via `grep -r "<endpoint>"` repo-wide excluding `node_modules` before deleting.

**Also:** `server/routes/releaseDataset.js` and `server/routes/releaseSync.js` both mount at `/api/release-dataset` (`server/index.js:138-139`) with overlapping paths (`/sync-status`, `/sync`, `/bundle`, `/cache`) — first match wins; second router's overlapping paths are shadowed. Not dead code but duplicate mount — deduplicate in `server/index.js` (keep one router for those paths).

---

## 6. Unwired — Shared Services Ported but 0 Server Importers

These are **ported, tested, and re-exported from `@portfolio-delivery-ops/shared`** but no `server/routes/` or `mcp-server/` file imports them yet. They are the trunk dependents of `CONSOLIDATION.md` #1b.

| File | Lines | Exported | Test status | Why unwired | Action |
|------|-------|----------|-------------|-------------|--------|
| `shared/src/services/releaseInsightsService.ts:1-448` | 448 | `computePayloadMetrics`, `computeLabelAnchoredMetrics`, `computeReleaseInsights`, `filterVisiblePayload`, `filterFullRelease` | 41/41 tests pass | First slice of #3 Insights engine; future dashboard consumers pending (ARCHITECTURE.md:139) | **Keep** — wire as next dashboard slice or delete if superseded by `releaseDatasetService` derives |
| `shared/src/services/statusService.ts:1-310` | 310 | `StatusService` (`getActiveReleases`, `releaseRag`, `topBlockers` only — partial, ARCHITECTURE.md:144 ○) | Partial | Intended backing for `get_release_status` MCP + Team Executive protocol; real consumers (`releaseAiSummaryService.js`, `releaseAnalysisService.js`) do same work via other services. `grep -r statusService server --include="*.js"` → 0 importers | **Keep or delete** — if `releaseInsightsService` + `riskIndicator` supersede it, delete; otherwise wire MCP `getReleaseStatus` to it |
| `shared/src/services/dependencyService.ts:1-203` | 203 | `DependencyService` (`upstreamOf`/`downstreamOf` live; `teamGraph()` stub returning `nodes:[]`) | Partial | Future `/dependency-view` write path + `dependency-tracker-specialist` (D18); reads `Blocks`/`is blocked by` issuelinks | **Keep** — wire when cross-team dep map mutates land; stub `teamGraph()` to be implemented |
| `shared/src/services/featureDashboardService.ts:1-467` | 467 | `buildFeatureListJql`, `buildCanonicalPayloadJql`, `toFeatureListItem`, `diffByKey`, `buildFlowSeries`, … | Tested via `__tests__/featureInferenceJql.test.js:21` importing `shared/dist/services/featureDashboardService.js` | `server/routes/feature.js:35-553` **re-implements** all 5 helpers locally instead of importing shared. Shared exports are redundant duplicates of live server logic. | **Deduplicate** — make `feature.js` import from `@portfolio-delivery-ops/shared` and delete local copies, or delete shared file if server is canonical. Do not keep two. |
| `shared/src/services/sprintMetrics.ts:1-55` | 55 | `getSprintMetrics()` | Wrapper | Server `services/sprintService.js:10` imports `shared/src/domain/sprintMetrics.cjs` (CJS SoT), not this TS twin. Twin is never imported. | **Delete TS twin** — keep `domain/sprintMetrics.cjs` as SoT (its header says "Matches services/sprintMetrics.ts"); or re-export CJS from TS and delete one. |
| `shared/src/connectors/githubConnector.ts:1-76` | 76 | `GithubConnector.listCommits` | Live in mcp-server (`mcp-server/src/tools/leadershipCommitReport.ts:19`) | 0 `server/**/*.js` importers — by design deferred (ARCHITECTURE.md:97) but not dead | **Keep** |

Also `shared/src/types/*` (7 files) are **type-only dead outside `shared`** — `grep import.*from.*@portfolio-delivery-ops/shared` in `server/`/`mcp-server/`/`client/` → 0 typed imports (both surfaces are JS/CJS). Inside `shared` they are used (`product.ts` imports `AudienceId`, `statusService.ts` imports `Release`/`Risk`, `releaseDatasetService.ts` imports `IssueTypeFamily` helpers via transitives). `Sprint/TeamWeeklyDelta/FeatCallout/Team/GateProgression` in `types/sprint.ts`:`27`/`types/team.ts` have no internal consumers either — spec-only for future `statusService.teamWeeklyDelta`/`featCallouts` (D17). Keep as TS spec but not dead; wire when server is typed.

---

## 7. Intentional Placeholders — Not Dead (do not delete)

| File | Why kept | Action |
|------|----------|--------|
| `shared/src/services/predictabilityService.ts:1-46` | **Retired stub that throws** — `predictLanding()`/`sayVsDo()` `throw RETIRED_MESSAGE` pointing to `landingForecastService (#4)`, `predictiveAnalyticsService (#8)`, `sayVsDoService (#15)` (CONSOLIDATION.md). Kept so old type references resolve loudly. | Keep until CONSUMER.md #5 closes; then delete + re-export removal |
| `shared/src/services/chartService.ts:1-30` | Same — `render()` throws, points to `chartCatalogService (#5)` | Same |
| `shared/src/domain/bundleDerive.js:1-1244` | SoT for 10 browser-safe derives (`deriveRetro*`, `deriveSynopsis*`, `deriveVelocity*`, `deriveBurndown*`, `deriveComponent*`, …). Client **copies** it to `client/src/release/utils/bundleUtils.js:2` because CRA cannot import from `shared` without pulling Node connectors (ARCHITECTURE.md:D41). `shared/package.json:19` exposes `"./bundleDerive"` but server has 0 direct imports — all client traffic goes via copy. | Keep — drift risk; `shared/scripts/smoke-wave3.mjs:99` asserts copy stays in sync. Do not delete either copy. |
| `shared/src/domain/execSummarySignals.cjs` + shim `server/utils/execSummarySignals.js:2-4` | CJS SoT + intentional D41 shim (`module.exports = require('../../../../shared/src/domain/execSummarySignals.cjs')`) | Keep |
| `shared/src/domain/sprintMetrics.cjs` + twin `shared/src/services/sprintMetrics.ts` | CJS SoT (see §6); shim pattern same as above | Keep CJS, delete TS twin |
| `server/utils/teamScope.js` (CJS adapter for `shared/src/utils/teamScope.ts:1-197`) | Same pattern — TS SoT + CJS shim | Keep; note drift risk |
| `shared/src/agentPack/*` helpers `resolveAgentPackRoot`, `listSkillsByType`, `listSkillsByToolClass`, `extractSystemPromptBody` | Never imported by `server`/`mcp-server` yet; used internally by `loadAgentPack.ts:63` or intended for skill UIs / `createPackTools` | Keep — small intentional helpers |
| `agent-pack/skills/era-csv-jira-import/` + `ndb-delivery-ops-deploy/` | On disk but not in `agent-pack/manifest.json` (21 entries). Both have valid `SKILL.md` and are intentionally unregistered? `era-csv-jira-import` is AuthZ bulk import (used ad-hoc, not via agent runtime); `ndb-delivery-ops-deploy` is deploy runbook | Keep — register in manifest if agent should surface them, else keep as runbook/skills outside agent pack |
| `apps/bin-packing/` | Static-mounted D37 (`/bin-packing/*`, opens new tab) | Keep — canonical surface until algorithm extracted to `shared/services/binPackingService.ts` |

---

## 8. Duplicates — Consolidate to One

| Symbol | Copies | Canonical | Deletable duplicates |
|--------|--------|-----------|----------------------|
| `formatDate` → `dd/MMM/yyyy` | 7+ (see §2 + static scan): `server/index.js:177`, `server/utils/dateFormatter.js:48`, `server/utils/milestoneProcessor.js:13` (wrapper), `server/utils/fieldHistoryUtils.js:164`, `client/src/utils/releaseVersionUtils.js:519`, `client/src/components/SosSummaryPage.js:468` (local inline), `shared/src/services/landingForecastAssemble.ts:186` (private `YYYY-MM-DD→human`), `apps/bin-packing/js/utils.js:27` | `server/utils/dateFormatter.js:48` (server) + `client/src/utils/releaseVersionUtils.js:519` (client) + `shared/src/domain/sprintMetrics.cjs` calendar twin | `server/index.js:177` (§2.2) + `SosSummaryPage.js:468` inline |
| `normalizeDateStr` | `server/utils/dateFormatter.js:11` + `client/src/utils/dateNormalization.js:13` | Promote to `shared/src/utils/dateHelpers.ts` | Both shims → import from shared |
| `getExtensionColor` / `getExtensionLabelInfo` | `server/utils/dateFormatter.js:216/193` + `client/src/utils/releaseVersionUtils.js:498/483` | Same | Same |
| `formatDateWithHistory` | `server/utils/dateFormatter.js:76` (HTML) vs `client/src/utils/dateHistoryDisplay.js:58/115` (JSX) | Intentional dual (HTML vs React JSX) but share core sort | Extract shared sort to `shared/` |
| `execSummarySignals` shim | SoT `shared/src/domain/execSummarySignals.cjs` + shim `server/utils/execSummarySignals.js` | SoT | Shim is intentional — keep per D41 |
| `featureDashboardService` helpers | Shared `shared/src/services/featureDashboardService.ts` vs `server/routes/feature.js:35-553` local copies | One canonical (shared) | §6 dedicated row |

---

## 9. Recommended Delete Order (low-risk first)

**Batch 1 — zero-risk (no behavior change, no tests break beyond import path):**
1. `server/routes/jira/{admin,component-report,feature-dashboard,jira-emailer,project-status,release-setup,retrospective,sprint-report}.js` (8 files) + `server/routes/jira/component.js` (1 file) — 9 files total.
2. `server/index.js:17` unused import + `server/index.js:177-209` `formatDate` orphan.
3. `server/routes/config.js:24` unused `releaseVersionsEmailConfig` binding.
4. `server/routes/jira/misc.js:101-127` unreachable body behind early return.
5. `client/src/components/GanttStyle2.js` (14 lines) + `client/src/utils/nutanixQuarters.js` (85) + `client/src/hooks/{useCrystalBall,useSosLeaderCoaching,useTeams}.js` (10+101+205) — 5 files.
6. `client/src/components/ReleaseVersionTab.js:688` stale comment + decide on `ReleaseVersionGantt.js:268-269` / `ReleaseVersionTab.js:337-343/382-388` commented blocks (delete or flag).
7. `shared/src/services/sprintMetrics.ts` TS twin (keep `domain/sprintMetrics.cjs`).
8. `apps/delivery-ops/server: sqlite3, tinydb, uuid, https-proxy-agent` (server) + `apps/delivery-ops: jsdom, officegen` + `mcp-server: axios, https-proxy-agent` — 8 deps total (remove from direct deps; transitive via `shared` still available).

**Batch 2 — deprecate with 410 + pointer before deleting (check external callers first via repo-wide grep):**
9. `server/routes/jira/exec-summary.js` legacy endpoints (`generate-exec-summary` → `/api/ai/exec-summary`, `enhanced-exec-summary`, `create-universal-agent-input`), `server/routes/jira/versions.js` `update-executive-summary` → `/api/ai/exec-summary/:key`, `server/routes/config.js` `release-base-filter` → `team-base-filter`, `server/routes/releaseDataset.js` `refresh-now` → `sync`, `backfill-meta` (one-time).

**Batch 3 — deduplicate (requires small code move):**
10. `featureDashboardService` — make `server/routes/feature.js` import from `@portfolio-delivery-ops/shared` and delete local helpers.
11. Date helpers — promote `normalizeDateStr` + `getExtensionColor/LabelInfo` to `shared/src/utils/dateHelpers.ts`; have server+client import from there; delete `SosSummaryPage.js:468` inline `formatDate`.
12. `server/index.js` duplicate mount — deduplicate `/api/release-dataset` overlapping paths between `releaseDataset.js` and `releaseSync.js` (keep one router per path).

---

*Evidence: `wc -l` on route stubs, `grep router\.(get|post)` for 0-endpoint `component.js`, `grep -rn importName` for 0-importer client hooks/utils, `grep require('sqlite3'|tinydb|uuid)` 0 hits, direct reads of `server/index.js:17,177`, `server/routes/config.js:24`, `server/routes/jira/misc.js:91-127`, `client/src/components/GanttStyle2.js:1-14`, `shared/src/services/predictabilityService.ts:1-46`/`chartService.ts:1-30`. All paths relative to `ndb-delivery-ops/` unless absolute.*
