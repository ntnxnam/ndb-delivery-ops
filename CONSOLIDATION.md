# Consolidation Port Tracker

Single source of truth for what's being merged from 17 archived apps + 5 skills into the `ndb-delivery-ops` monorepo. Every row is a capability, not an app.

**Runtime decision:** single Node + TypeScript runtime. Python sources from archives are ported, not run alongside.

## Status legend

- `pending` — source identified, not yet ported
- `porting` — actively being ported in current branch
- `ported` — TS implementation exists in `shared/services/` or `apps/delivery-ops/server/services/`, callable
- `wired` — exposed through an API route AND consumed by at least one UI page
- `skip` — archive contained no usable code

## Trunk (everything depends on this)

| # | Capability | Source | Target TS module | Status |
|---|---|---|---|---|
| 1a | **6-bucket** release payload JQL builders + Group 2 (moved-out) + Group 3 (long-term funded) + sidecars | `release-sprint-analysis-with-chatbot/payload_jql.py` | `shared/services/payloadJqlService.ts` | **ported + extended** (9/9 original parity tests pass). *2026-06-13:* Bucket 1B `epics_of_projects` added (`portfolioChildrenOf(1A) AND issuetype=Epic`). Group 2: `getMovedOutQuery` (single broad `fixVersion was X AND not in X` query; in-memory bucket classification post-fetch). Group 3: `getLongTermProjectsQuery`, `getLongTermEpicsQuery`, `getLongTermWorkQuery` (take `{ futureReleases[] }`). New tags: `MOVED_OUT_COMPONENT`, `LONG_TERM_PROJECTS_COMPONENT`, `LONG_TERM_EPICS_COMPONENT`, `LONG_TERM_WORK_COMPONENT`. |
| 1b | Canonical `releaseDataset` (`processed_df` equivalent + cache + sync) | `release-sprint-analysis-with-chatbot/data_layer.py` (1,508 LOC) + 4 helper modules (300 LOC) | `shared/services/releaseDatasetService.ts` + `releaseDatasetCache.ts` + `releaseDatasetSync.ts` + 4 sibling services | **Phase 1 + Phase 2 + Phase 3 ported + extended** (134 unit tests from Phases 1-2 + 57 end-to-end assertions from Phase 3 smoke). Phase 1 — `ProcessedTicket` row shape + `fetchBucket` + parallel `fetchReleaseData` with within-release dedup. Phase 2 — `processMaster()` cross-release assembly with derived columns + label helpers + 4 sibling services. Phase 3 — `ReleaseDatasetCache` (per-product JSON cache, atomic writes, jqlHash invalidation, sync-lock), `syncReleaseDataset` (full-sync vs scoped-refetch + changelog enrichment for `Closed Date` / `Last Resolved Date` / `Reopen Count`). *2026-06-13 extensions:* (a) `RELEASE_DATASET_FIELDS` expanded to 56 columns — added date, people, content/indicators, document-links, sprint fields. (b) `fetchBucket.projectKey` optional — omit = Release Payload (no project scope, D36 default); set = Engineering Payload. (c) `fetchReleaseData` fetch plan covers all 3 groups: 6 Group-1 buckets + `moved_out` (Group 2) + 3 long-term-funded buckets (Group 3, conditional on `futureReleases` param) + 4 sidecars. (d) `syncReleaseDataset` calls `jira.getProjectVersions` at sync start to determine `futureReleases`; Group 3 failure is non-fatal. `SyncOptions` adds `includeLongTermFunded` flag. Smoke: `shared/scripts/smoke-release-dataset-phase3.mjs`. **Not yet wired** to a route. |

## Capabilities that read from the trunk

| # | Capability | Source | Target | Status |
|---|---|---|---|---|
| 2 | 3-stream sprint velocity (Dev / QA-Verif 1:3 / QA-Test) | `team_velocity_profile.py` | `shared/services/velocityService.ts` | pending |
| 3 | Insights engine (z-score, severity, phase, WoW diff) | `insights*.py` (4,256 LOC across 5 files) | `shared/services/releaseInsightsService.ts` (+ more, pending) | **payload + label-anchored slice ported** (41/41 tests): `VISIBLE_COMPONENTS`, `filterVisiblePayload`, `filterFullRelease`, `computePayloadMetrics` (planned_total, completed_by_ga, deferred, open, unresolved, completion_pct, 5 issue-group shares, 3 KPI arm shares, pre_bc / test_pre_bc left-shift signals, tail_share_at_ga), `computeLabelAnchoredMetrics` (deferred count + carry-over from earlier releases via `compareSortKeys`), `computeReleaseInsights` one-shot. D1 product-agnostic via `labelPrefix` + `productPrefix`. First real consumer of the #1b trunk — validates the dataset shape works. **Pending slices**: flow / triage debt / cohort / cycle-time / interval / velocity / pace metrics + `computeReleaseMatrix` (multi-release comparison) + `computeTeamMatrix` (per-team rollup) + phase-normalised timing + recommendations (`insights_actions.py`) + history (`insights_history.py`). |
| 4 | Landing forecast (release date prediction) | `landing_forecast.py` | `shared/services/landingForecastService.ts` (replaces stub) | pending |
| 5 | Chart catalog + `[chart:<id>]` tokens | `chart_catalog.py` | `shared/services/chartCatalogService.ts` (replaces stub) | pending |
| 6 | NAI chatbot (one-tool function-calling) | `chatbot_tools.py + chatbot_router.py + chatbot_context.py + nai_client.py` | `shared/services/chatbot/{tools,router,context,naiClient}.ts` | pending |
| 7 | Team Executive release report generator | `~/.cursor/skills/team-exec-release-report/` | `shared/services/vpReportService.ts` + retain skill | pending |
| 8 | Predictive Team Executive analytics (Monte Carlo, completion prob, QI forecast) | `~/.cursor/skills/predictive-team-exec-analytics/` | `shared/services/predictiveAnalyticsService.ts` | pending |
| 10 | Date mover — gate-date move with **mandatory reason + Confluence audit** (D30) | `ndb-date-mover/` + new Confluence audit writer | `shared/services/dateMoverService.ts` + `shared/connectors/confluenceConnector.ts` | **ported (route-wired)**: `dateMoverService` requires reason, updates JIRA via `jiraConnector`, audits to Confluence via `confluenceConnector.appendStructuredRow`. JIRA rollback on Confluence audit failure (best-effort transactional). Express route at `/api/date-mover/{gate-date-fields,move-gate-date}`, RM+TPM authorized via `authService.dateMover` feature gate. Skill `move-gate-date` dispatches from `rm-specialist`. **Not yet UI-wired** — no React form; client_form_optional deferred. |
| 11 | Outstanding-work pulse (realistic timeline) | `NDB-Outstanding-Work-Realistic-Timelines/shipwatch + jira-fetcher` | `shared/services/outstandingWorkService.ts` | pending |
| 13 | Release timeline visualizer (date overrides, holiday cal) | `Release-Timelines-Visualizer/` | `apps/delivery-ops/client/src/components/ReleaseTimelineVisualizer/` | pending |
| 14 | Bin packing / resource Gantt | `ndb-projects-bin-packing/` | `apps/bin-packing/` (static mount) + future `shared/services/binPackingService.ts` | **wired (static, D37)**: 7,000-LOC vanilla-JS app copied as-is to `apps/bin-packing/`; served by delivery-ops Express at `/bin-packing/*` (same-origin, single runtime, no auth — matches legacy). Sidebar entry **opens in a new tab** because the bin-packing UI has its own chrome/nav and embedding it inside delivery-ops created port-asymmetry pain in dev (React `:8888` vs Express `:6001`). URL helper in `Sidebar.js` reads `window.location` to pick the right backend port (`REACT_APP_BACKEND_PORT || 6001`) in dev and a relative `/bin-packing/` in prod — no hardcoded localhost. **Algorithm extraction deferred**: current MCP tool `bin_pack_projects` is a simplified FFD that doesn't yet match the real 800-LOC algorithm (resource pools, dev-blocker deps, gap-fill, 3-tier display). Future: port algorithm core to `shared/services/binPackingService.ts`, keep CSV parser flow. |
| 15 | Say-vs-do tracking | `ndb-say-vs-do/` | `shared/services/sayVsDoService.ts` | pending |
| 16 | Story point calculator (JIRA + Confluence) | `ndb-story-point-calculator/` | `shared/services/storyPointService.ts` | pending |

## Independent / already in monorepo

| # | Capability | Source | Target | Status |
|---|---|---|---|---|
| 9 | Capacity planner (t-shirt, bandwidth, rollup) | `ndb-capacity-planner/` (103 Py files) | `shared/services/capacityService.ts` | pending |
| 12 | Confluence template engine + page mgmt | `Confluence-Page-Creator/` | `apps/tpm-confluence-tools/` | already in repo (Python) — needs port |
| 17 | Fetch project tickets (8-clause JQL primitive) | `~/.cursor/skills/fetch-project-tickets/` | `shared/services/ticketFetchService.ts` | **ported + wired**: 28/28 base + 11/11 D1-optional/linkedIssues parity tests; comprehensive + work-items views; URL builders; `includeLinkedIssues` opt-in for legacy 9-clause behaviour; `projectKey` now optional (production callers don't scope). Live in `apps/delivery-ops/server/routes/jira/index.js#/issue-breakdown` — replaces inline `buildOptimizedProjectTicketsJQL` + `buildTaskBreakdownJQL` calls and removes the hardcoded `jira.nutanix.com` host (no-localhost.mdc / D1). |
| 18 | Sprint Gantt chart (date-hierarchy-aware) | `~/.cursor/skills/sprint-gantt-chart/` | `apps/delivery-ops/client/src/components/SprintGantt/` | pending |
| 19 | Confluence width cleanup | `~/.cursor/skills/confluence-width-cleanup/` | retain as skill (no code port) | retained as skill |
| 20 | Status sender (current app) | `apps/delivery-ops/` | — | already in repo |

## New cross-cutting need surfaced during inventory

| Capability | Why surfaced | Target | Status |
|---|---|---|---|
| Confluence connector (read + structured-row append) | Required by #10 (D30) and #12; previously assumed deferrable | `shared/connectors/confluenceConnector.ts` | **ported** alongside D30: PAT auth, `getPage`, `updatePage`, `appendStructuredRow` (insert `<tr>` after a named anchor, version-conflict retries, XML escaping). Only consumer today is `dateMoverService`; #12 (Confluence template engine) port will reuse it. |

## Skip (no usable code)

- `PM-App` — empty (.git only)
- `NamPortfolioManagement` — one orphan file
- `jira-pm-app-full` — early ancestor of #20
- `ndb-status-update-app` — early ancestor of #20
- `GitHub-Commits` — docs only
- `NDB-SWOT` — docs only
- `Data-Dash` — appears to be an earlier branch of the chatbot app; supersede with #1-#6

## Speculative stubs to retire when their port lands

These were written in Phase D1 before the inventory was done. Each is replaced by the corresponding ported service above.

- `shared/services/statusService.ts` (releaseRag + topBlockers) → folded into #1, #3
- `shared/services/predictabilityService.ts` (predictLanding + sayVsDo stubs) → replaced by #4 + #15
- `shared/services/dependencyService.ts` (graph stubs) → leave for now, port later
- `shared/services/chartService.ts` (placeholder SVG) → replaced by #5

## Open D1 wiring gap (see DECISIONS.md D34/D35/D36)

`productService` now exposes `getLabelPrefix`, `getReleasePrefix`, and
`getSprintCalendar` (D34). Every new TypeScript service that takes a D1
input is wired through these getters in `shared/scripts/smoke-product-service-d1.mjs`.
Wiring at production call sites is intentionally lazy — done at the moment
a route actually needs the service — to avoid touching working code for
no functional gain.

Per D36, "payload" splits into two named concepts: **Engineering Payload**
(project-scoped, legacy) and **Release Payload** (cross-project, new).
Most fetch / insights services today compute Engineering Payload only;
Release Payload variants will be added when the first cross-team consumer
lands.

Current state of each new D1 consumer:

| Service | Requires | Payload concept | Production caller | Resolved via productService? |
|---|---|---|---|---|
| `payloadJqlService.buildEngineeringPayloadJql` | projectKey | Engineering | none yet | n/a until a sprint-burndown / dev-velocity route lands |
| `payloadJqlService.buildReleasePayloadJql` | — (release only) | Release | none yet | n/a — new concept, no consumer yet |
| `ticketFetchService.buildAllTicketsJql` | projectKey (optional) | n/a (FEAT-walk, cross-project by design) | `/api/jira/issue-breakdown` | **no** — passes only the FEAT keys, matching legacy. Wire when scoping is needed. |
| `releaseDatasetService.fetchReleaseData` | labelPrefix (required); projectKey optional; futureReleases optional | **Release Payload by default** (no project scope, 2026-06-13); Engineering Payload if `projectKey` passed | none yet | n/a until a route lands |
| `releaseDatasetService.processMaster` | labelPrefix + productPrefix | n/a (derivation, payload-agnostic) | none yet | n/a (same as above) |
| `releaseDatasetCache` (constructor + save/load) | productId + projectKey + labelPrefix (+ productPrefix for bundle) | n/a (storage) | none yet | n/a — every public method takes the D1 inputs from the caller; Phase 3 smoke wires them all via productService |
| `syncReleaseDataset` | projectKey (for cache key + versions API) + labelPrefix + productPrefix + sprintCalendar | **Release Payload** (no project scope on fetches, 2026-06-13) | none yet | n/a — smoke proves end-to-end |
| `releaseClassificationService.classifyRelease` | productPrefix | n/a | none yet | n/a |
| `sprintsService.enumerateSprints` | sprintCalendar | n/a | none yet | n/a |
| `releaseInsightsService.*` | labelPrefix + productPrefix | Engineering (operates on processed dataset) | none yet | n/a |

The contract is honest: when any of these get a production route, the
route MUST resolve through `productService`. The smoke test proves the
chain works for NDB end-to-end today for both Engineering Payload and
Release Payload JQL.

## Port pattern (the contract every row follows)

Each capability port lands in a single PR-shaped commit with:

1. The TS module in `shared/services/` (pure logic, no Express, no React)
2. Unit tests in `shared/tests/<service>.test.ts` covering the same behaviour the Python tests covered
3. An API route in `apps/delivery-ops/server/routes/` that calls the service
4. A UI surface in `apps/delivery-ops/client/src/` that calls the route (when applicable)
5. Update this table: status `pending` → `porting` → `ported` → `wired`
6. Update `DECISIONS.md` only when a design choice is forced (not for routine ports)
