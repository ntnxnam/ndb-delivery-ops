# Weave: Workable by all teams in Nutanix — Unified Backlog
## NCN + Prism-Infra portability (Lighthouse is a Nutanix app, not an NDB app)

**Worktree:** `claude/awesome-diffie-c662da` @ `7474f98` (8 behind `origin/main` as of 2026-11-19, rebase gated per `merge-rebase-policy.mdc`)
**Date:** 2026-11-19
**Goal:** Zero timeout errors, no other functional breakage, for NCN (NCN, 3 prefixes `NCN-Konvoy-/NCN-NDK-/CSI-`, board 4741, 14d) and Prism-Infra (ENG, `AOS ` prefix, board 3132, 14d) — not just NDB (ERA, `NDB-`, 21d).
**Leads:** 1 Timeout Resilience ✅ · 2 Product-Agnosticism ✅ · 3 Team Registry & Payload ✅ · 4 Frontend Multi-Team ✅ · 5 AI & MCP ✅ (all 5 delivered 2026-11-19)
**Pipeline:** Dev → Impact Scout → Code Review (`/multi-model-review`) → QA → UX → PM → Exec (`/exec-perspective`) → JIRA query check → Fix (max 3) → Security paused → Rebase `origin/main` → Merge → hand back (per `weave.mdc` + `merge-rebase-policy.mdc` on `origin/main`)

> **Weave stitched.** All 5 leads delivered; P-IDs below are stable. Lead 3's 3 new P0s are now first-class P0s.

---

## Reading guide

- **P0** — Blocks NCN and/or Prism-Infra entirely (empty page, 408/timeout, wrong JIRA object, silent misroute to ERA, JQL invalid).
- **P1** — Wrong/confusing labels, JQL, counts, field reads, or degraded UX for non-NDB (functional but incorrect).
- **P2** — Cosmetic/branding: NDB strings in titles, subjects, placeholders, comments, package names (D2 deferred per D45 — not a bug until D2 rename).
- D1-correct fix shape throughout: derive from `productService` / `teamBoardConfig.json` / `jiraFieldsConfig` (server/shared) or `TeamContext` / `useProductConfig` (client) — never a new hardcoded alternate.
- Counts below deduplicate across leads: Lead 2's 16 P0 + Lead 4's 4 P0 + Lead 3's 3 P0 share 6 files (e.g. `jqlTemplates`, TCMS strip, dependency labels, `productService` schism) — unified list has **21 unique P0s**.

---

## 0. Executive summary

**Team-switching core is sound.** `TeamContext → teamEpoch → SelectedReleaseContext/ReleaseDataContext → Layout key` remounts correctly, version fetch is strict `teamId → projectKey` per D11, NCN 3-prefix handling is server-owned, caching is team-keyed, `requestGate` storm/cooldown protects transitions. No P0 infra blocker.

**Product surface has 21 P0 functional blockers** that will break NCN/Prism-Infra on first use, plus ~20 P1 degradations and ~43 P2 branding leaks:

0. **Registry schism (P0-REG-1/2/3) — root cause for "nothing works":** `productService.getReleasePrefix()` ignores `releasePrefixes` plural → fabricates `prism-infra-`/`Nutanix Cloud Native-` → zero active releases for 3/4 teams; `prism-infra` `homeProjects` leaks `ERA`/`FEAT`; Admin `pickManagedFields` drops every field needed for a viable team.
1. **Payload / JQL layer (P0-S2/S7, P0-C3, P0-3):** Silent `|| 'ERA'` fallbacks, hardcoded `RELEASE_PROJECTS = ['ERA','FEAT','SDL',…]`, hardcoded `COMPANION_RELEASE_PROJECTS`, `Era Future`/`master` denylist, unquoted `fixVersion` (breaks `AOS 5.11`), `GetNDB-` filter naming, saved-filter regex `/^NDB-/`.
2. **Release-prefix / TCMS layer (P0-S3/S4/S6, P0-C1/C2/C4, P0-M1-3):** `replace(/^NDB-/i,'')` / `slice(4)` / `split(/[- ]/)` / `NDB-master` / `NDB-2.11` examples — NCN's 3 prefixes and Prism's `AOS ` (space) never stripped; TCMS 404s.
3. **Timeout / reliability layer (P0-1 … P0-8):** 8+ routes missing `jiraTimeout`, raw `req.setTimeout` socket kills, unbounded `searchPages maxTotal=Infinity`, changelog `concurrency:1` serial, `moved_out` 120s bucket > `syncLock 120s`, retry `135s > 90s` wall, `generalTimeout` not mounted globally, client `180–600s` vs server `90s` → 408 misclassified.
4. **Frontend team-scoping layer (P0-1 … P0-4):** `bundleUtils` NDB regex empties release picker, `ComponentReport` unscoped, `DependencyView` home-project hardcode inverts swimlanes, `feature/list` unscoped, `bin-packing` static NDB JSON.
5. **MCP / AI layer (P0-M1-3, P1-M4):** Tool titles `Get NDB Release Status`, direct `customfield_*` + `NDB-2.11` examples, glossary `NDB-Ops` — every non-NDB AI host leaks brand.

**Fix order §8:** Payload JQL → labels/filters → TCMS/GA → prefix denylist → client strips → `customfield_*` codemod (phased) → timeout envelope → MCP/AI → guard hardening → D2 rename deferred.

---

## 1. P0 — Blocks NCN / Prism-Infra entirely (now 21 unique — Lead 3 adds 3)

### 1.0 Registry schism — the root cause for "nothing works" (Lead 3 P0-1/2/3)

| ID | File(s) | Hardcode | Breakage | Fix | Lead |
|---|---|---|---|---|---|
| **P0-REG-1** | `shared/src/types/product.ts:92-108` `shared/src/services/productService.ts:247-250` vs `shared/src/types/teamConfig.ts:49-50` `apps/delivery-ops/server/config/teamBoardConfig.json:178,240,297` + downstream `shared/src/services/statusService.ts:90-98` `shared/src/services/retroService.ts:52-59` `shared/src/services/releaseClassificationService.ts:63-98` `shared/src/utils/versionPattern.ts:7-17` `apps/delivery-ops/server/routes/releaseDataset.js:1641-1644,1727-1728,1809-1810` | `ProductConfig` declares only `releasePrefix?: string` (singular); `getReleasePrefix()` reads only `p.releasePrefix` → fabricates `prism-infra-` / `Nutanix Cloud Native-` / `Cerebro / DR-` for 3/4 teams. `releasePrefixes` plural + `releaseRegexes` never exposed; `statusService.getActiveReleases()` `versionBelongsToProduct(v, {productPrefix: fabricated})` → zero active releases | Every downstream derivation (velocity, forecast, burndown, catch-all vs standard JQL) empty for NCN/Prism/Cerebro | Extend `ProductConfig` with `releasePrefixes?: string[]` + `releaseRegexes?: string[]`; add `getReleasePrefixes(productId): string[]` (plural canonical, singular fallback, then `${name}-` legacy) and `getReleaseRegexes` with `try{new RegExp(r)}` validation; migrate consumers (`statusService`, `releaseClassificationService`, `versionPattern`, `releaseDataset.js` catch-all) to `prefixes.some(pfx=>version.startsWith(pfx))` / strip longest match; keep `getReleasePrefix()` as `getReleasePrefixes()[0]` for NDB compat | 3 P0-1 |
| **P0-REG-2** | `apps/delivery-ops/server/config/teamBoardConfig.json:173-177` vs `apps/delivery-ops/server/config/teamBoardConfig.json:86-90` | `prism-infra` `homeProjects: ["ENG","ERA","FEAT"]` copy-pastes `ERA`/`FEAT` from `ndb` | Cross-project JQL via `teamProjectUtils.getHomeProjects()` pulls NDB tickets into Prism reports; swimlanes inverted | `homeProjects: ["ENG"]` (like `ncn` correctly `["NCN"]` and `cerebro-dr` `["ENG"]`); add validator for `homeProjects` not containing foreign team's projects | 3 P0-2 |
| **P0-REG-3** | `apps/delivery-ops/server/services/teamAdminService.js:55-68` `apps/delivery-ops/server/routes/admin.js:92-122` | `pickManagedFields` only handles `name,baseFilter,projectKey,boardId,sprintCalendar,featureComponents` — silently drops `labelPrefix`, `releasePrefixes`, `releaseRegexes`, `homeProjects`, `featureProjectKey`, `branding`, `displayName`, `defaultRelease`, `tcms`, `qaEnv`, `labels`, `notificationEmails`, `companionDisciplines`, `activeVersionNames`, `sosBaseFilter`; `boardId` typo → `null` → `stripLegacy` deletes silently | Any team onboarded via Admin UI is born broken (falls into P0-REG-1 fabricated prefix); no feedback | Widen `MANAGED_FIELDS` to full set; normalize `releasePrefix` singular→plural; default `labelPrefix` from `slugify(name)+'-'`; validate `labelPrefix` + `releasePrefixes` required; add `boardId` 400 on invalid; document that `releasePrefixes` must be set via admin now | 3 P0-3 |

### 1.1 Payload & JQL (highest blast radius)

| ID | File(s) | Hardcode | Breakage | Fix | Leads |
|---|---|---|---|---|---|
| **P0-JQL-1** | `apps/delivery-ops/server/services/outstandingWorkbenchService.js:128` `componentReportService.js:16` `releaseOutstandingDeferralService.js:961` | `projectKey: team?.projectKey \|\| 'ERA'` | NCN/ENG silently query ERA → zero/wrong issues | `productService.getProduct(productId).projectKey` + throw on unknown `productId` | 2 (P0-S2) |
| **P0-JQL-2** | `apps/delivery-ops/client/src/utils/jqlTemplates.js:24-26,74` `apps/delivery-ops/server/utils/jqlTemplates.js:63` | `fixVersion not in ("Era Future",…)` + `COMPANION_RELEASE_PROJECTS=['FEAT','SDL','LEG','TECHPUBS']` + `RELEASE_PROJECTS=releaseProjectsForTeam('ERA')` | NCN companions are CSI/NKP/NDK, Prism none; future train leaks; root filter hits zero | `getActiveVersionNames(productId)` for exclusion; `getFeatureProjectKey` + `getCompanionDisciplines` for companions; remove hardcoded constants; `jqlTemplates` takes `productId` not `projectKey` | 2 (P0-C3) + 4 (P1-7) |
| **P0-JQL-3** | `apps/delivery-ops/client/src/utils/jqlTemplates.js:32,61` `apps/delivery-ops/server/utils/jqlTemplates.js` | `fixVersion in (${v})` / `fixVersion = ${v}` unquoted | `fixVersion in (AOS 5.11)` invalid JQL — **Prism completely broken**; NDB works by accident | Quote: `fixVersion in ("${v.replace(/"/g,'\\"')}")` / `fixVersion = "${v}"` + unit test with `AOS 5.11`, `NCN-Konvoy-2.1` | 4 (P0-2) |
| **P0-JQL-4** | `apps/delivery-ops/client/src/utils/jqlTemplates.js:18` `apps/delivery-ops/server/services/releaseSetupService.js:169` | `Get${v}Features` raw version in filter name + `/^(NDB-[\d.]+)-All$/i` | `GetAOS 5.11Features` invalid JIRA name → save fails; non-NDB filters never registered | Slugify `v.replace(/[^A-Za-z0-9]+/g,'_')` for name; build regex from `getReleasePrefixes(productId)` / `releaseRegexes` | 4 (P0-2) + 2 (P0-S7) |
| **P0-JQL-5** | `apps/delivery-ops/server/services/outstandingWorkbenchService.js:227-229` | `filter=ndb-product-regressions` / `ndb-test-regressions` / `NDB-System-Test` | Filters don't exist for NCN/ENG | `teamBoardConfig.filters.{systemTest,regression*}` or `labelPrefix` + `kpiConfig` team query | 2 (P0-S1) |
| **P0-JQL-6** | `apps/delivery-ops/server/routes/config.js:647` | `const projects=['FEAT','ERA']` GA side-effect | Updates wrong JIRA versions for NCN/Prism | Derive from `getJiraProjects(productId)` + `getFeatureProjectKey` | 2 (P0-S6) |
| **P0-JQL-7** | `apps/delivery-ops/client/src/components/feature/hooks/useFeatureDashboard.js:32` `apps/delivery-ops/client/src/components/feature/services/featureDashboardService.js:8` `apps/delivery-ops/server/routes/feature.js:470` (server) | `listReleaseFeatures GET /api/feature/list?release=` no `teamId` + server `getProduct('ndb')` hardcode | NCN sees NDB feature list | `GET /api/feature/list?teamId=&release=` + `resolveRequestedTeam` | 4 (P1-6) |

### 1.2 Release-prefix / version identity

| ID | File(s) | Hardcode | Breakage | Fix |
|---|---|---|---|---|
| **P0-PFX-1** | `apps/delivery-ops/client/src/components/ComponentReport.js:25-30` | `return /^NDB-\d+\.\d+/.test(trimmed) \|\| trimmed.toLowerCase()==='master'` | All non-NDB (`NCN-Konvoy-2.11`, `AOS 6.2`, `Era Future` vs `master`) misclassified as not-current → counts zero | `new RegExp('^'+escapeRe(getReleasePrefix(productId)))` + `getActiveVersionNames(productId)`; thread `productId` from `useTeam()` |
| **P0-PFX-2** | `apps/delivery-ops/client/src/release/utils/releaseTypeUtils.js:20` | `prefix='NDB-'` default param | Dot-count classification wrong for NCN/Prism | Require `productId`, default via `getReleasePrefix(productId)`; `WeeklySkimPage` passes `selectedTeam.releasePrefix` |
| **P0-PFX-3** | `apps/delivery-ops/client/src/release/utils/bundleUtils.js:1032,1147` `apps/delivery-ops/client/src/components/ComponentReport.js:29` + `shared/src/domain/bundleDerive.js` | `if(/^NDB-\d/.test(rel)\|\|master) releaseSet.add(rel)` + `isRelevantFV=/^NDB-\d/` | Prism `AOS 5.11` + NCN `NCN-Konvoy-2.1`/`CSI-1.4` → `availableReleases` empty → picker empty; direct tickets discarded | Thread `team` into `deriveComponentDataFromBundle(bundle,componentName,team)`; predicate `team.releaseRegexes.some(re=>new RegExp(re).test(rel))`; sync `shared/src/domain/bundleDerive.ts` per D41 |
| **P0-PFX-4** | `apps/delivery-ops/server/services/tcmsService.js:71` `apps/delivery-ops/server/services/dependencyViewService.js:601,1575` `shared/src/domain/bundleDerive.js` `apps/delivery-ops/client/src/components/ReleaseVersionTableCell.js:913` `ReleaseVersionGantt.js:562` `sprintPerformanceClient.js:485` | `fixVersion.replace(/^NDB-/i,'')` / `slice(4)` / `s.startsWith('NDB-')` / `split(/[- ]/)` | NCN `NCN-NDK-1.2` → `NDK-1.2` wrong, Prism `AOS 6.2` never stripped, labelPrefix `prisminfra-` vs `AOS ` distinct | `getReleasePrefixes(productId)` (plural, NCN has 3) loop: `for(p of prefixes) if(v.startsWith(p)) return v.slice(p.length)` + generic fallback `v.replace(/^[A-Za-z][A-Za-z0-9]*[- ]/,'')`; never split on `-` |

### 1.3 TCMS / companion linkage

| ID | File(s) | Hardcode | Breakage | Fix |
|---|---|---|---|---|
| **P0-TCMS-1** | `apps/delivery-ops/server/services/tcmsService.js:75,215-216` `apps/delivery-ops/server/config/tcmsConfig.json:48,63` `apps/delivery-ops/client/src/components/ReleaseVersionTableCell.js:918` `ReleaseVersionGantt.js:567` | `/#/testcases/NDB/${versionNum}/` + `fetchMergedMetrics(item.key,'NDB-master',…)` + `masterForNDB: NDB-master` | NCN/AOS segment `NCN`/`AOS` → 404; master milestone differs | `team.tcms.projectSegment` + configurable `masterMilestone` per team (`getActiveVersionNames` where needed); `uiLink` template param |
| **P0-TCMS-2** | `apps/delivery-ops/server/services/dependencyViewService.js:595,750-764,1536-1537` | `labels in ("ndb-${trainSlug}-dependency",…)` + `EW_LABEL_PRIORITY=['global-ew','nutanix-ew','ndb-ew']` | NCN/Prism labels `ncn-*`/`prisminfra-*` missed → deps missed, EW wrong | `getLabelPrefix(productId)` + `jiraFieldsConfig.labels.dependency/ew`; add `teamBoardConfig.labels.{ew,train,dependency}` for all teams |
| **P0-TCMS-3** | `apps/delivery-ops/server/config/dependencyViewConfig.json:5,12,22-25` `apps/delivery-ops/server/config/tcmsConfig.json:2,48,63,67` `apps/delivery-ops/server/config/releaseVersionsCCConfig.json` `systemTestScaleConfig.json` `teamConfigurations.json` | Top-level keys `NDB-3.0`/`NDB-2.11`/`NDB-2.12` etc. | NDB-only files; NCN/Prism have no entries | Scope to product or generic `releaseVersion`-keyed; delete legacy `teamConfigurations.json` (superseded by `teamBoardConfig.json`) |

### 1.4 Frontend team-scoping (no `useTeam` / no `teamId` param)

| ID | File(s) | Hardcode | Breakage | Fix |
|---|---|---|---|---|
| **P0-FE-1** | `apps/delivery-ops/client/src/components/DependencyViewPage/index.js:23,33,69-91,158,161` `DependencyViewPage/DependencySwimlanes.js:13,27` | `isNdbHome(pk=>'ERA'\|\|'FEAT'\|\|pk.startsWith('NDB'))` + `HOME_PROJECTS=new Set(['ERA','FEAT'])` | NCN `NCN` dep miscategorized as partner → graph inverted; labels `Peer NDB` | `isHomeProject(pk,team)=>team.homeProjects.includes(pk)` (+ regex fallback); labels `Peer ${team.branding.shortName}` |
| **P0-FE-2** | `apps/delivery-ops/client/src/components/ComponentReport.js:12,28,44,67,377,422` | No `useTeam` import; `GET /api/component/list` no `teamId` + `isCurrent` ERA text | NCN never current, components for NDB only | Add `useTeam()`, pass `teamId` to `GET /api/component/list?teamId=` + `health?component=&teamId=` + `data?component=&teamId=`; server filter by `teamId`; `JIRA_BASE` from config |
| **P0-FE-3** | `apps/delivery-ops/client/src/utils/jqlAutocompleteLogic.js:69` `apps/delivery-ops/client/src/jira/utils/jqlAutocompleteLogic.js:69` | `'Sprint (NDB 10360)'` + static `JQL_FIELDS` with 40+ `customfield_*` | Sprint field is per-team `boardId`/`sprintFieldId` | Derive label from `getCustomFields(productId).sprintFieldId` + `jiraFieldsConfig`; generate `JQL_FIELDS` at runtime per `productId` |
| **P0-FE-4** | `apps/delivery-ops/client/public/bin-packing/` `apps/delivery-ops/server/index.js` static | `GET /bin-packing/*` no `teamId`, NDB capacity JSON hardcoded | NCN/Prism see NDB data | Generate per-team JSON `GET /bin-packing/${teamId}/data.json` or dynamic `GET /api/bin-packing?teamId=` |

### 1.5 MCP / AI (P0-equivalent: tool contracts leak NDB)

| ID | File(s) | Hardcode | Breakage | Fix |
|---|---|---|---|---|
| **P0-MCP-1** | `mcp/shared/tools/getReleaseStatus.ts:33-36,43,60,62` | Direct `customfield_23560/11067/35863/35864` + `version: "NDB-2.11"` example + title `Get NDB Release Status` | Field IDs must be team-scoped; title leaks brand to every AI host | Resolve via `getCustomFields(productId)` at runtime; param `productId` + `releaseVersion` + generic title `Get Release Status` |
| **P0-MCP-2** | `mcp/shared/tools/ganttReleaseTimeline.ts:34-37,41,47,120` | Same `customfield_*` + `NDB-Ops` in description | Same | Same |
| **P0-MCP-3** | `mcp/shared/tools/binPackProjects.ts:4,55-56` `mcp/shared/tools/planCapacity.ts:4,29-35,42` | `Bin-pack NDB Projects` / `Plan NDB Team Capacity` + "NDB uses 3-week sprints" doc | Tool names leak product; sprint cadence not per-team | Generic titles + `productId` param + per-team `sprintCalendar` |

### 1.6 Timeout & Reliability (Lead 1 — blocks large NCN/Prism releases)

| ID | Area | File(s) | Symptom for NCN/Prism | Fix |
|---|---|---|---|---|
| **P0-TO-1** | Missing envelope | `apps/delivery-ops/server/routes/releaseDataset.js` (synopsis/velocity/forecast/component-counts/burndown/retrospective), `routes/feature.js`, `routes/component.js`, `routes/releaseOutstandingWork.js`, `routes/jira/sprints.js` | No `jiraTimeout(90s)` → hangs to Node idle close; sprints uses raw `req/res.setTimeout 120-300s` (socket kill) | Wrap every live-JIRA handler with `jiraTimeout`; remove raw `setTimeout` |
| **P0-TO-2** | Unbounded pagination | `apps/delivery-ops/server/utils/jiraClient.js` `makeJiraSearchFetcher`/`searchPages` + `shared/src/connectors/jiraConnector.ts` `searchAll` | `maxTotal=Infinity`, `maxTimeMs=undefined`, `pageSize 1000` → NCN 6-10 fixVersions ×8 releases = 70-110 searches (60-120s) + Prism 40-70 futureReleases → 30-50min sync, always exceeds 90s middleware/nginx | Cap `maxTotal` (e.g. 10000) + `maxTimeMs = jiraTimeoutMs - 5s` + `perPageTimeout 30s` + wall guard; surface `truncated:true` |
| **P0-TO-3** | Retry > wall | `shared/src/connectors/jiraConnector.ts:retry 5× 5/10/20/40/60s (~135s)` vs `middleware timeout 90s` | 429 storm sleeps 135s behind 90s 408 → client sees generic 408, retry progress lost | Clamp retry budget to `jiraTimeoutMs - elapsed` or reduce to 3 retries (5/10/20s) + `Retry-After` header |
| **P0-TO-4** | Changelog serial | `shared/src/services/releaseDatasetService.ts` `DEFAULT_PAGE_SIZE 500 MAX_ISSUES 20000 concurrency 1 BETWEEN_SEARCH 250` + `releaseDatasetSync.ts` changelog `concurrency 1` + `Sync lock stale 120s` | NCN changelog 8-40min, Prism 30-50min, slowest bucket `moved_out 120s` == lock stale → guaranteed lock expiry + 90s middleware kill | Raise concurrency to 3-5 for search + 5-10 for changelog (with JIRA 429 backoff), raise `aiTimeout 300s` for weekly-skim, `sprintTimeout 150s`; `syncLock` 300s; budget/circuit-breaker for changelog |
| **P0-TO-5** | Client vs server misalign | `apps/delivery-ops/client/src/shared/services/apiService.js:50-86` `authenticatedPost 60→600s` vs server `90s` | Client 180-600s always loses to 90s 408; AI 600s weekly-skim always 408; `isJiraUnreachable` only checks 503 | Map `408/503/504` + `timeout` to VPN banner; align `client = server + 5s` or raise server for heavy paths (`/api/ai/*` 300s) |
| **P0-TO-6** | No global mount | `apps/delivery-ops/server/index.js` never `app.use(generalTimeout)` + `middleware/timeout.js` doesn't destroy upstream axios | New route without timeout hangs; JIRA continues after 408 | Mount `generalTimeout 30s` globally, override per-router with `jiraTimeout 90s`/`aiTimeout 300s`; `req.on('close', ()=> axiosCtrl.abort())` |

---

## 2. P1 — Wrong / confusing for non-NDB

### 2.1 Client P1

| ID | File(s) | Symptom | Fix |
|---|---|---|---|
| P1-C1 | `WeeklySkimPage.js:76` + `weeklySkimService.js:65` `replace(/^NDB-/,'')` | `NCN-Konvoy-2.11` unshortened in skim | Generic strip via `getReleasePrefixes(productId)` |
| P1-C2 | `ReleaseVersionTableCell.js:913` TCMS deep-link | Same strip bug | Same |
| P1-C3 | `ReleaseSetup/CleanupFilters.js:69,83` `GetNDB<…>` naming | NDB filter convention leak | Generic `Get${releasePrefixEx}` |
| P1-C4 | `jqlAutocompleteLogic.js:117-122` `ERA-123`, board `2888`, `NDB S 45` | NCN board 4741 / `NCN 45`, Prism 3132 wrong | `getBoardId(productId)` + `${displayName} S ${n}` |
| P1-C5 | `ChatbotPage.js:234,253` `project = ERA AND fixVersion = "NDB-2.11"` + button `NDB open` | Copy-pasted presets return zero | `project = ${projectKey} AND fixVersion = "${releases[0]??releasePrefix+'2.11'}"` + `${displayName} open` |
| P1-C6 | `utils/jiraFields.js:68` `getLabelJql() default ndb` | NCN `ncn-` / Prism `prisminfra-` missed | Require `productId`, default `getLabelPrefix(productId)` |
| P1-C7 | `utils/releaseVersionUtils.js:464-466` + `jqlAutocompleteLogic.js:86` `code-complete-extension-recieved` | Extension detection misses non-NDB labels | Derive via `getLabelPrefix` + `labels.codeCompleteExtensionSuffix` config |
| P1-C8 | `utils/sosLeaderGrouping.js` via `GET /api/config/ndb-leader-org` | Endpoint name NDB-legacy | Alias `GET /api/config/leader-org` (keep compat) |
| P1-C9 | **219 `customfield_NNNNN` sites** across 28 files (see Lead 2 §3.1) | Functional today (global defaults match) but next product that overrides field IDs breaks | Codemod to `getFieldValue(item,'codeCompleteDate')` / `getCustomFields(productId).commitGateDateFieldId`; gate dates first (20 sites), then risk/story-points |
| P1-C10 | `layout/utils/sidebarNavConfig.js:17` `http://shuryakumar-ns.r8.ubvm.nutanix.com:8080/` | Individual dev host | Remove literal; `REACT_APP_PROJECT_PLAN_CREATOR_URL` already supported |
| P1-TEAM-1 | `TeamContext.js:46,57-75,106-112` `hooks/useReleaseItems.js:89` | `activeRequestsRef` dead code — zero call sites register; in-flight survives team switch, can stain next-team state | Wire `registerApiRequest(ctrl)` or remove dead Set + codify `cancelled+cache-key` + E2E switching-while-loading |
| P1-TEAM-2 | `TeamContext.js:7,145` `TEAMS_FETCH_TIMEOUT_MS=8000` | Tight on VPN cold start; no auto-retry → blank gate | Raise 15-20s + idempotent auto-retry on `AbortError` |
| P1-TEAM-3 | `SelectedReleaseContext.js:14-19` `isJiraUnreachable` only `503` | `408` from `jiraTimeout` misclassified as generic error not VPN banner | Map `408/503/504` + `timeout` to banner |
| P1-TEAM-4 | `hooks` no unmount cleanup + `ApiService.cancelAllRequests` dead | Leak + wasted JIRA work | `useEffect` cleanup + `AbortSignal.timeout` in fetch path |

### 2.2 Server P1

| ID | File(s) | Symptom | Fix |
|---|---|---|---|
| P1-S1 | `execSummaryService.js:168` `releaseAiSummaryService.js:83` `dependencyViewService.js:606-615` fallback `'ndb'` | `String(version).split(/[- ]/)[0].toLowerCase()` brittle for `AOS 6.2` / `NCN-NDK-1.2` | Thread `productId`, use `getLabelPrefix(productId)` |
| P1-S2 | **113 server + 78 shared direct `customfield_*` reads** (WARN_ONLY) | Same as P1-C9 | Phased migration to `getCustomFields(productId)` per `minimal-architecture.mdc` |
| P1-S3 | `jiraFieldsConfig.json` `dependencyViewConfig.json:34,44,54,116,142,145` `previouslyLinkedDeps.js:197` `pk.startsWith('NDB')` `jqlTemplates.js:63` `RELEASE_PROJECTS` | Server companion/home-project lists still NDB-wired | Derive from `getJiraProjects` / `companionDisciplines` / `homeProjects` |
| P1-SPRINT | `bundleUtils.js:1196-1197` `SPRINT_S1_START_MS='2024-10-09' 21d` | Sprint calendar NDB-only | Thread `team.sprintCalendar:{s1StartIso,sprintDays}` |
| P1-SORT | `bundleUtils.js:1035-1036` `ndbA=/^NDB-(\d+)\.(\d+)/.exec(a)` sort | Loses NCN/Prism numerics | Generic `s.match(/\d+/g).map(Number)` |

### 2.3 MCP P1

| ID | File(s) | Symptom | Fix |
|---|---|---|---|
| P1-MCP-1 | `mcp/shared/tools/sayVsDo.ts:30,38,50` `calculateStoryPoints.ts:13,23` `customfield_10002` in desc + `NDB-2.11` | Description leak | Generic description; story-points field `customfield_10002` is global so not blocking |

---

## 3. P2 — Cosmetic / branding

Defer D2 rename per D45 (wait for `portfolio-delivery-ops` filesystem/GH rename) — no bulk `package.json` rename before then.

| File:Line | Snippet | Fix |
|---|---|---|
| `auth/constants/permissions.js:1` | `for the NDB Status Sender application` | `for the Delivery Ops application` |
| `layout/utils/routeConfig.js:247` | `return route?.title \|\| 'NDB Status Sender'` | `getDisplayName(productId) + ' Delivery Ops'` or generic `'Delivery Ops'` |
| `layout/utils/routeConfig.js:111` | `(NDB-first)` | Remove qualifier |
| `release/WeeklySkimPage.js:220` | `<h2>NDB Weekly Skim</h2>` | `{displayName} Weekly Skim` |
| `release/services/weeklySkimService.js:140-146,188` | `NDB Weekly Skim` title/download | Interpolate `displayName` / `${productId}` |
| `components/GenericEmailer.js:112` | `NDB Reminder –` | `${displayName} Reminder –` |
| `components/ReleaseSetup/*.js:183,193,91,101,69,83` | `placeholder="NDB-2.12"` etc. | `${releasePrefix}2.12` |
| `components/ReleaseConfigPage.js:381` | `placeholder="e.g. NDB-2.13"` | Same |
| `utils/scheduledEmailsDB.js:78` `routes/email/*.js` `services/emailService.js:81` `config/emailConfig.json` | `NDB Reminder` / `smtp.ndb.team@nutanix.com` / NDB `defaultCC`/`defaultTo` | Per-team `notificationEmails` via `productService.getNotificationEmails(productId)`; `SMTP_FROM` env-only |
| `server/config/kpiConfig.json` `releaseVersionsCCConfig.json` `systemTestScaleConfig.json` `dependencyViewConfig.json` | Keys `NDB-2.11/2.12` etc. | Team-scoped or generic `releaseVersion`-keyed |
| `mcp/shared/resources/ndbGlossary.ts:4,24,26` | `NDB-Ops glossary` | `Delivery Ops Glossary` or `getGlossary(productId)` |
| `agent-pack/lighthouse/skills/*` `identity/ops-assistant.md:72-73` `prompts/production/*` | `NDB-2.11` / `ERA-66381` / `FEAT-1001` examples | Parameterise: `${releaseVersion}`, `${projectKey}-0001`; note "replace with active product's release" |

See Lead 2 §4 for full P2 table (43 items) and Lead 4 §3 medium/low — this is the consolidated view.

---

## 4. Team registry integrity (NCN / Prism-Infra)

**Source:** `apps/delivery-ops/server/config/teamBoardConfig.json` (_schema 2.0-team-agnostic, D43).

| Team | id | projectKey | boardId | baseFilter | releasePrefixes | sprintCalendar | homeProjects | labelPrefix | Observations |
|---|---|---|---|---|---|---|---|---|---|
| NDB | `ndb` | `ERA` | 2888 | `filter=NDB-All-Base-Filter …` | `["NDB-"]` | 2024-10-23 21d | `["NDB","ERA","FEAT"]` | `ndb-` | Reference — well-formed; 5 companionDisciplines |
| Prism-Infra | `prism-infra` | `ENG` | 3132 | `prisminfra-all-base-filter` | `["AOS "]` | 2023-09-05 14d | `["ENG","ERA","FEAT"]` **⚠ copy-paste** | `prisminfra-` | `homeProjects` still has `ERA/FEAT` → P0-JQL-1 will query ERA; `featureProjectKey` missing; `activeVersionNames` missing; `sosBaseFilter` missing; `releaseRegex "AOS \\d+\\.\\d+"` ok but space prefix distinct from labelPrefix |
| NCN | `ncn` | `NCN` | 4741 | `NCN-All-Base-Filter …` | `["NCN-Konvoy-","NCN-NDK-","CSI-"]` | 2020-02-20 14d | `["NCN"]` | `ncn-` | 3 prefixes correct but `featureProjectKey` / `activeVersionNames` / `sosBaseFilter` missing; `releaseRegexes` 3 patterns ok; `homeProjects` minimal (ok) |
| Cerebro-DR | `cerebro-dr` | `ENG` | 2477 | `filter=DR-All` | `["AOS "]` | 2021-11-04 14d | `["ENG"]` | `cerebro-` | Shares `ENG` with Prism-Infra — payload must distinguish by `boardId`/`labelPrefix`, not `projectKey` alone |

**Registry gaps (from Lead 3 scope, to be detailed in annex):**

- Prism-Infra `homeProjects` copy-paste bug (`ERA`/`FEAT` leak) — P0 for cross-team dep graph.
- Missing `featureProjectKey` for NCN/Prism/Cerebro — `productService.getFeatureProjectKey` must return null-safe, not fall back to `FEAT`.
- Missing `activeVersionNames` for non-NDB — `Era Future`/`master` denylist must be per-team; NCN/Prism likely need own (e.g. `["NCN-Future"]` or empty).
- Missing `sosBaseFilter` for NCN — SoS history will have no scope.
- `prism-infra` `name: "prism-infra"` vs `displayName: "Prism Infra"` inconsistent (cosmetic).
- No validator enforces unique `id` (case-insensitive), non-empty `projectKey`/`boardId`, `defaultTeamId ∈ teams` — Admin can create shadow `Eng`/`eng`.

---

## 5. Guard: `scripts/lighthouse/checks/check-product-agnostic.js`

**Catches ~15% of above (3 narrow FORBIDDEN patterns; `customfield_*` WARN_ONLY; `ChatbotPage` blanket-allowlisted).**

Must be expanded to 5 new FORBIDDEN rules + narrowed allowlist: `NDB-` prefix family (`replace(/^NDB-/`, `slice(4)` after `startsWith('NDB-')`, `new RegExp('^NDB-')`, `NDB-master`), `filter=NDB-*` literals, `Era Future`/`master` denylist, `COMPANION_RELEASE_PROJECTS`/`RELEASE_PROJECTS` derivation, `NDB Reminder`/`NDB Status Sender` branding, `NDB S \d+` sprint naming, `boardId 2888` assumption. Promote `customfield_*` to FORBIDDEN outside `jiraFieldsConfig`/`productService`; narrow `ChatbotPage` allowlist to example-only lines.

---

## 6. Legitimate occurrences (D33 / D1 rules)

Not bugs — stay out of bulk rewrite: `reports/` HTML outputs (D33), `__tests__/` fixtures (`ERA-60000`, `NDB-2.11`), `AGENTS.md`/`ARCHITECTURE.md`/`DECISIONS.md` history (D2-deferred), `teamBoardConfig.json` `ndb` entry itself (source of truth), `jiraFieldsConfig.json` field map, `agent-pack/lighthouse/context/` NDB case-study briefs (acceptable when labelled "NDB is one tenant — other tenants use their own `releasePrefix`/`projectKey` per `teamBoardConfig`" — disclaimer currently missing in `component-report.md`, `dependency-view.md`, `jira-workflows-and-resolutions.md`), one-shot NDB scripts in `scripts/lighthouse/jira/`.

---

## 7. D1-correct fix shapes (cross-cutting)

```js
// Release-prefix strip (multi-prefix aware for NCN)
function stripReleasePrefix(fixVersion, productId) {
  const prefixes = getReleasePrefixes(productId); // ["NCN-Konvoy-","NCN-NDK-","CSI-"] for NCN
  for (const p of prefixes) if (fixVersion.startsWith(p)) return fixVersion.slice(p.length);
  return fixVersion.replace(/^[A-Za-z][A-Za-z0-9]*[- ]/, '');
}
// Active version denylist
const excluded = getActiveVersionNames(productId).map(v => `"${v}"`).join(', ');
const jql = `fixVersion not in (${excluded})`;
// Companion / home projects
const homeProjects = getJiraProjects(productId); // ["NCN"] for NCN, ["ENG"] for Prism-Infra (after fix)
const featureProjectKey = getFeatureProjectKey(productId); // null for NCN/Prism
const companions = getCompanionDisciplines(productId).map(c => c.projectKey);
const releaseProjects = [homeProjects[0], featureProjectKey, ...companions].filter(Boolean);
// Email branding
const displayName = getDisplayName(productId);
const subject = `${displayName} Consolidated Status Summary (Weekly) - ${dateStr}`;
// Gate dates / custom fields
import { getFieldValue } from '../utils/jiraFields';
getFieldValue(item, 'codeCompleteDate');
// TCMS
const segment = getProductById(productId).tcms.projectSegment; // "NDB"|"AOS"|"NCN"
const masterMilestone = getActiveVersionNames(productId).find(v => /master/i.test(v)) || 'master';
// Dependency / EW labels
const ewLabel = getLabel(productId, 'ew'); // "ncn-ew" / "prisminfra-ew"
```

---

## 8. Fix order (pipeline sequence)

1. **P0-REG-1/2/3 — registry schism + admin viability** — extend `ProductConfig` with `releasePrefixes`/`releaseRegexes`, add `getReleasePrefixes()`/`getReleaseRegexes()`, migrate `statusService`/`releaseClassificationService`/`versionPattern`/`releaseDataset.js` catch-all to plural; fix `prism-infra` `homeProjects` to `["ENG"]`; widen `teamAdminService.pickManagedFields` to full set + `labelPrefix`/`releasePrefixes` validation. Unblocks every non-NDB team.
2. **P0-JQL-1/2/3/4 + P0-JQL-5/6** — remove `|| 'ERA'` fallbacks, hardcoded `RELEASE_PROJECTS`/`COMPANION_*`, unquoted JQL, `Era Future` denylist. Plumb `productId` through `jqlTemplates` / `componentReportService`.
3. **P0-PFX-4 + P0-TCMS-2 + P1-S1** — EW/train labels + saved-filter names into `teamBoardConfig.labels.*`/`filters.*` via productService.
4. **P0-TCMS-1 + P0-TCMS-3 + missing registry fields** — TCMS segment + master milestone + `teamBoardConfig` validator (`validateTeamBoardConfig` on save: unique lowercase ids, non-empty `projectKey`/`boardId`, `defaultTeamId ∈ teams`).
5. **P0-PFX-1/2/3 + P1-TEAM-1/2/3/4** — generic `stripReleasePrefix` (multi-prefix) + `getActiveVersionNames` denylist; TeamContext abort wiring, 8s→15s, 408→ banner.
6. **P0-FE-1/2/3/4 + P0-TO-1/2/6** — DependencyView swimlanes, ComponentReport scoping, bundleUtils picker, bin-packing per-team, mount `generalTimeout` globally + `jiraTimeout` on every JIRA route.
7. **P0-TO-3/4/5** — clamp retry budget, raise concurrency (search 3-5, changelog 5-10), `aiTimeout 300s` / `sprintTimeout 150s`, `syncLock 300s`, `maxTotal`/`maxTimeMs` caps with `truncated:true`.
8. **P1-C9/S2 mass `customfield_*` migration** — codemod to `getFieldValue` / `getCustomFields(productId)` (one PR, phased: gate dates 20 sites first, then risk/story-points; `rg 'customfield_' --glob '!*productService*'`).
9. **P2 branding + KPI + MCP + agent-pack** — email subjects/from, KPI `baseQuery` per-team, tool titles/descriptions, skill templates.
10. **Guard hardening** — 5 new FORBIDDEN rules; narrow `ChatbotPage` allowlist; promote `customfield_*`.
11. **D2 naming debt** — defer per D45; no bulk rename before filesystem rename.

---

## 9. Files requiring edits (absolute paths, deduplicated)

**P0 Server:** `apps/delivery-ops/server/services/outstandingWorkbenchService.js`, `componentReportService.js`, `releaseOutstandingDeferralService.js`, `tcmsService.js`, `dependencyViewService.js`, `releaseSetupService.js`, `routes/config.js`, `routes/feature.js`; **Config:** `server/config/tcmsConfig.json`, `dependencyViewConfig.json`, `kpiConfig.json`, `emailConfig.json`, `teamBoardConfig.json` (+ validator in `server/utils/teamConfig.js`, `server/services/teamAdminService.js`).

**P0 Client:** `apps/delivery-ops/client/src/components/ComponentReport.js`, `release/utils/bundleUtils.js`, `release/utils/releaseTypeUtils.js`, `utils/jqlTemplates.js`, `components/SystemTestScalePage.js`, `utils/jqlAutocompleteLogic.js`, `components/ReleaseVersionTableCell.js`, `components/ReleaseVersionGantt.js`, `components/DependencyViewPage/index.js`, `components/DependencyViewPage/DependencySwimlanes.js`, `components/feature/hooks/useFeatureDashboard.js`, `components/feature/services/featureDashboardService.js`, `utils/jqlAutocompleteLogic.js`.

**P0 Shared:** `shared/src/domain/bundleDerive.js` (→ `shared/src/domain/bundleDerive.ts`), `shared/src/connectors/jiraConnector.ts`, `shared/src/services/productService.ts`, `shared/src/services/payloadJqlService.ts`, `shared/src/services/releaseDatasetService.ts`, `shared/src/services/releaseDatasetSync.ts`, `shared/src/types/product.ts`.

**P0 MCP:** `mcp/shared/tools/getReleaseStatus.ts`, `ganttReleaseTimeline.ts`, `binPackProjects.ts`, `planCapacity.ts`, `sayVsDo.ts`, `calculateStoryPoints.ts`; `mcp/shared/resources/ndbGlossary.ts`, `mcp/lighthouse/src/tools/teamOverallReport.ts`, `buildJql.ts`.

**P1 Client/Server:** `release/WeeklySkimPage.js`, `release/services/weeklySkimService.js`, `components/ReleaseVersionTableCell.js` (+ sister renderers), `utils/emailTableGenerator.js`, `downloadUtils.js`, `sosEmailHtml.js`, `generateReleaseHighlights.js`, `utils/jiraFields.js`, `release/ChatbotPage.js`, `utils/releaseVersionUtils.js`, `layout/utils/sidebarNavConfig.js`, `contexts/TeamContext.js`, `contexts/SelectedReleaseContext.js`, `shared/services/apiService.js`, `utils/requestGate.js`, `hooks/useReleaseItems.js`, `services/execSummaryService.js`, `services/releaseAiSummaryService.js`, `utils/previouslyLinkedDeps.js`, `utils/jqlTemplates.js`, `utils/sosHistoryFilter.js`, `middleware/timeout.js`, `middleware/security.js`, `server/index.js`.

**Guard:** `scripts/lighthouse/checks/check-product-agnostic.js`.

---

## 10. Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| NCN 3 prefixes breaks naive single-`releasePrefix` strip | P0 regressions | Use `releasePrefixes` array + `releaseRegexes`; `stripReleasePrefix` tries all |
| `AOS 5.11` prefix `AOS ` (space) not `AOS-` | P0 `split(/[- ]/)` hack wrong | Derive `labelPrefix`/`releasePrefix` from productService; never split on `-` |
| `customfield_*` migration 410 sites | Scope blow-up | Phase: gate dates first (20 sites), then risk/story-points; codemod |
| Guard green masks debt | False confidence | Land 5 new FORBIDDEN rules in same PR as first P0 fix |
| D2 rename deferred — `ndb-*` package names remain | Cosmetic | Leave per D45 |
| Prism-Infra `homeProjects` copy-paste (`ERA`/`FEAT`) | P0 swimlanes + cross-team deps | Fix registry + validator before dep walk |
| Changelog `concurrency 1` → 30-50min Prism sync | Guaranteed 90s kill | Raise to 5-10 with 429 backoff + `syncLock 300s` |
| `ENG` shared by Prism-Infra + Cerebro-DR | Payload must not conflate | Scope by `boardId`/`labelPrefix`, not `projectKey` alone (Lead 3 annex) |
| `bundleUtils` used in tests — test fixtures use `NDB-` strings | Test breakage on generic fix | Gate fix: `if (!team) return legacy NDB path`; update fixtures to param |

---

## Annex: Lead reports

- Lead 1 (Timeout Resilience): `/Users/namratha.singh/.claude/projects/.../tool-results/bhkyb3ebc.txt` + `bh…txt` (a637dc9b919e675da) — 30 fixes across A-F layers, coverage matrix, P0-P2 grading.
- Lead 2 (Product-Agnosticism): handback `a80b38603b47552fd` (1084551B, 79 findings, 16 P0/20 P1/43 P2) — full §2-10 above is its synthesis.
- Lead 4 (Frontend Multi-Team): handback `a305fbb6c3099aebe` (88062 tokens, 4 P0/7 P1 matrix, per-page scoping table, timeout matrix, performance audit).
- Lead 5 (AI & MCP): handback `a76c35dc75c36fd82` (55.5KB, 6 sections — identity/specialists/skills/prompts/rules/workflows/MCP).
- Lead 3 (Team Registry & Payload): ✅ done 2026-11-19 09:15 IST — 126k tokens, 3 subagents, field-by-field config audit (4 teams table), `productService` coverage audit (mtime reload + missing-field defaults + **P0 schema schism** `releasePrefix` vs `releasePrefixes`), payload JQL correctness (6-bucket + Group2 moved_out + Group3 futureReleases), cache/sync scoping (per-team dir + `syncLocking` vs legacy global `_syncState`), sprint/velocity/forecast per-team wiring (hardcoded `*3` weeks + `ndb-` label in forecast).

---

## Next: Implementation — ready to dev

All 5 leads stitched. Fix per **§8 sequence** (one feature, one place, 5-layered). Each step: `npm run check` + `docs-verify` + `docs-build`, `gh pr create` via `open-pr.sh`, pipeline gates (Impact Scout → Code Review `/multi-model-review` → QA → UX → PM → Exec `/exec-perspective` → JIRA query check → Fix max 3), then **rebase `origin/main`** (`fetch` → `rebase` → plain-language conflict ask → `push --force-with-lease` → `merge --no-ff` → `push main` → delete branch per `merge-rebase-policy.mdc` on `origin/main`, 8 behind at `7474f98`).
