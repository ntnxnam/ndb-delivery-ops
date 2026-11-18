# 02 — Capability Map: Full Feature Inventory

> Source: `FEATURE_CATALOG.md:14-194`, `ARCHITECTURE.md:122-155`, `CONSOLIDATION.md`, `agent-pack/manifest.json:1`

---

## 1. How to Read This Doc

- **Capability = service (Layer 3)** — not a page. One service, consumed by every surface that needs it (`FEATURE_CATALOG.md:22-52`).
- **State:** `live` = in monorepo today, `mcp-only` = MCP tool only, `archived` = tarball, `never-built` = gap.
- **Surfaces:** React page (Layer 5), MCP tool (Layer 4), or skill/workflow (agent-pack).

---

## 2. Reuse Matrix — Capabilities Are Not Pages

These services are called from **multiple surfaces** — the Services layer exists so each is implemented once (`FEATURE_CATALOG.md:24-52`).

| Capability (service) | Key surfaces |
|----------------------|--------------|
| Story Point Roll-up (`storyPointsService.rollUp`) | Feature Dashboard, Release Versions column, Outstanding Work, Team-Executive Report, MCP `calculate_story_points` |
| RAG / Risk Score (`statusService.calcRag`, `shared/src/services/riskIndicator.ts:248`) | Release Versions, Team-Executive Report, Release Brief, Outstanding Work |
| Date Shift (`dateMoverService`, `shared/src/services/dateMoverService.ts:358`) | Date Mover page, inline shift on Release Versions row, cascade-rename workflow, MCP `move_jira_dates` |
| Say vs Do (`predictabilityService.sayVsDo`) | Standalone page, Team Executive Dashboard, Team Profile, Release Versions FEAT column, MCP `say_vs_do` |
| Sprint Health (`sprintMetrics.getSprintMetrics`, `shared/src/services/sprintMetrics.ts:55`) | Sprint Report, Team Profile, KPI sparkline, Sprint Planner input |
| Exec-summary signals (`deriveSignals`, `shared/src/domain/execSummarySignals.cjs:1`) | SoS Summary, release briefing, chat snapshot |
| Bundle-first derives (`bundleDerive`, `shared/src/domain/bundleDerive.js:1244`) | Retrospective, Release Brief, Component Report, Sprint Report (past sprints) |
| Capacity calc (`capacityService.estimate`) | Capacity Planner, Bin-Packing input, Team Profile, MCP `plan_capacity` |
| Sprint Velocity (`velocityService`, `shared/src/services/velocityService.ts:391`) | Release Brief velocity panel, `GET /api/release-dataset/velocity` |
| Predictive Landing (`landingForecastService`, `shared/src/services/landingForecastService.ts:348`) | Release Brief `LandingForecastPanel`, `GET /api/release-dataset/forecast`, CrystalBall page (mock) |
| JIRA Connector (`jiraConnector`, `shared/src/connectors/jiraConnector.ts:473`) | Every feature in every domain |
| Chart rendering (`chartService`, D4) | Chat replies, Team-Executive Report, KPIs, status email HTML |
| Agent memory/provenance/HITL (`agentRuntime`, `shared/src/agentRuntime/`) | Chatbot session memory, provenance chip, HITL inbox `/api/ai/approvals` |
| Product context (`productService`, `shared/src/services/productService.ts:361`) | Every Layer-3 service, product picker, audience overrides |

---

## 3. Full Domain Catalog

### Domain 1 — Release Status & Reporting

| Feature | Job | State | Source | Decision |
|---------|-----|-------|--------|----------|
| Release Versions Table | Every FEAT/Initiative per release with risk, dates, owners | live | `apps/delivery-ops` ReleaseVersionTab | keep |
| Team-Executive Report | Single-page RAG + top risks | live | `apps/delivery-ops` + `team-exec-release-report` skill | keep, polish |
| Status Email Sender | Compose + send status email from JQL | live | `apps/delivery-ops` GenericEmailer | keep |
| Release Brief / One-Pager | Compact publishable doc | archived | `_archive/.../Release_Brief.py` | rebuild as React page |
| Outstanding Work Tracker | Work-not-done with ETAs/blockers | archived | `NDB-Outstanding-Work-Realistic-Timelines` | rebuild as React page |
| Email History | Audit log with re-send | live | `apps/delivery-ops` | keep |
| Status Update Sender (legacy) | Old standalone app | archived | `ndb-status-update-app` | cut — superseded |

### Domain 2 — Planning & Capacity

| Feature | Job | State | Source | Decision |
|---------|-----|-------|--------|----------|
| Capacity Planner | Engineer-days for release window (PTO/holidays) | mcp-only | `mcp-server/src/tools/planCapacity.ts:82` | build UI page |
| Project Bin-Packing | Suggest what fits given capacity | mcp-only (+ static) | `mcp-server/binPackProjects.ts:141` + `apps/bin-packing/` | build UI page (static mount D37 today) |
| Story Point Roll-up | Sum SP for Feature/Initiative | mcp-only | `mcp-server/calculateStoryPoints.ts:115` | build UI page |
| Date Mover | Bulk-cascade JIRA dates safely | mcp-only | `mcp-server/moveJiraDates.ts:188` + `shared/dateMoverService.ts` | build UI page |
| Release Setup | Create new release version | live | `apps/delivery-ops` ReleaseSetup | keep |
| Release Config | Edit release/milestone gate dates | live | `apps/delivery-ops` ReleaseConfig | keep |
| Sprint Planner | Recommend commit list from velocity | never-built | — | build (high-value gap) |

### Domain 3 — Timeline & Predictability

| Feature | Job | State | Source | Decision |
|---------|-----|-------|--------|----------|
| Release Timeline Gantt | Gantt of features across release | mcp-only + live partial | `mcp-server/ganttReleaseTimeline.ts:158` + ReleaseVersionGantt | merge into one page |
| Sprint Gantt | Sprint-by-sprint ticket timeline | live | `apps/delivery-ops` | keep |
| Say vs Do | Committed vs delivered (predictability) | mcp-only | `mcp-server/sayVsDo.ts:124` | build UI page |
| Predictive Landing (CrystalBall-I) | AI landing-date prediction | live (brief) / mock (page) | `landingForecastService` + Release Brief | keep brief wired; CrystalBall page mock |
| Sprint Analysis | Per-sprint deep-dive | live | `apps/delivery-ops` SprintReportPage | keep, merge with archived |
| Release Analysis | Per-release deep-dive | live | `apps/delivery-ops` ReleaseAnalysisPage | keep |

### Domain 4 — Triage & Backlog

| Feature | Job | State | Source | Decision |
|---------|-----|-------|--------|----------|
| Ticket Triage | Categorise bugs/stories, propose owners | never-built | (tpm-assistant plan) | build as agent workflow + light UI |
| Spec-to-Backlog | Confluence spec → Epic + child tickets | never-built | (Atlassian plugin) | build as workflow |
| Bug Trend Analysis | Defect rates per team/component | archived | `.../Insights.py` | rebuild as React page |
| JIRA Query Runner | Free-form JQL → table | live | `apps/delivery-ops` JiraQuery | keep |

### Domain 5 — Confluence Publishing

| Feature | Job | State | Source | Decision |
|---------|-----|-------|--------|----------|
| Bulk Page Creator | N pages from JQL via template | live (Streamlit) | `apps/tpm-confluence-tools/` | rewrite in React |
| Template Editor | Customise base template | live (Streamlit) | `tpm-confluence-tools/pages/2_Template_Editor.py` | rewrite in React |
| Confluence Extractor | Pull page back as structured data | live (partial) | `apps/delivery-ops` | keep, unify with connector |
| Status Page Auto-Publisher | Weekly email → Confluence (one-click) | never-built | — | build (Domain 1+5 gap) |
| Confluence Width Cleanup | Sanitise width styles on XML | live (skill) | `skills/confluence-width-cleanup/` | keep — invoked by all 4 above |

### Domain 6 — Sprint Analytics & Team Health

| Feature | Job | State | Source | Decision |
|---------|-----|-------|--------|----------|
| Sprint Health Scoreboard | Committed vs delivered, carry-over, scope creep | live | `apps/delivery-ops` SprintReportPage | keep |
| Sprint Trends | Multi-sprint trend lines | live | SprintReportPage (Past mode) | keep |
| Sprint Insights | Patterns/anomalies/AI commentary | archived | `Insights.py` | rebuild as React (small) |
| Team Profile | Velocity, members, components, load | archived | `Team_Profiles.py` | rebuild as React |
| Sync Hub | Background data pull | archived | `Sync_Hub.py` | cut — pages fetch live; React SyncHub removed |
| Carry-over / Scope Creep | Standalone slipped-work view | partial | SprintReportPage | promote to own page |

### Domain 7 — KPI & Custom Metrics

| Feature | Job | State | Source | Decision |
|---------|-----|-------|--------|----------|
| KPI Dashboard | Track KPIs over time | live | `apps/delivery-ops` KPIPage | keep |
| KPI Editor | Define/modify KPIs + thresholds | live | `apps/delivery-ops` (KPI admin) | keep |
| Leadership Commit Report | GitHub activity for managers | mcp-only | `mcp-server/leadershipCommitReport.ts:127` | keep as MCP-only |
| Predictive Team Executive Analytics | Forecast quality/completion/risk | live (skill) | `skills/predictive-team-exec-analytics/` | keep |

### Domain 8 — Admin & Platform

| Feature | Job | State | Source | Decision |
|---------|-----|-------|--------|----------|
| User Management | Add/remove users, set roles | live | `apps/delivery-ops` AdminPanel | keep |
| Team Management | Teams, project keys, board IDs, base filters | live | `apps/delivery-ops` TeamList | keep |
| Role-Based Permissions | Map users → personas → pages | live (light) | `apps/delivery-ops` auth/permissions | extend for persona-aware nav |
| Auth (JIRA PAT) | Login via PAT | live | `apps/delivery-ops` auth/ | keep |
| Notifications | Toasts, error banners | live | `apps/delivery-ops` notificationService | keep |

---

## 4. Consolidation Port Tracker (CONSOLIDATION.md)

17 archived apps + 5 skills → `shared/services/` + `mcp-server`. Status legend: pending / porting / ported / wired / skip.

| # | Capability | Source | Target | Status |
|---|-----------|--------|--------|--------|
| 1a | 6-bucket payload JQL builders | `payload_jql.py` | `shared/services/payloadJqlService.ts:578` | ported+extended (9/9 tests) — Group 1B + Group 2/3 |
| 1b | Canonical releaseDataset (trunk) | `data_layer.py` 1508 LOC | `releaseDatasetService.ts:1456` + Cache + Sync | Phase 1+2+3 ported (134 unit + 57 e2e), 56 columns, not yet route-wired |
| 2 | Sprint velocity 3-stream | — | `velocityService.ts:391` | wired `GET /api/release-dataset/velocity` |
| 3 | Insights engine | z-score etc. | `releaseInsightsService.ts:448` | payload+label slice ported 41/41 tests |
| 4 | Landing forecast | — | `landingForecastService.ts:348` + `landingForecastAssemble.ts:402` | wired `GET /api/release-dataset/forecast` |
| 5 | Chart catalog `[chart:<id>]` | — | — | pending |
| 6 | NAI chatbot | Streamlit | `agentRuntime` + NAI | pending (agentRuntime done, chatbot page exists) |
| 10 | Date mover D30 | `ndb-date-mover` | `dateMoverService.ts:358` + `confluenceConnector.ts:413` | ported + route-wired `/api/date-mover/*` |
| 14 | Bin packing | `ndb-projects-bin-packing` | `apps/bin-packing/` static mount | wired static D37; algo extraction deferred |
| 17 | Fetch project tickets | — | `ticketFetchService.ts:415` | ported+wired `GET /api/jira/issue-breakdown` |

Trunk (everything depends): **1a + 1b**. Capabilities reading trunk: #2–#4, #10, #14, #17.

---

## 5. Agent Skills & Workflows

`agent-pack/manifest.json:1` — 15 skills + 3 workflows. Each declares `capabilityType` + `toolClass`.

| Skill | Owner | Type / Class | Purpose |
|-------|-------|--------------|---------|
| team-exec-briefing | team-exec-specialist | agentic/draft | Unified exec view: status/report/briefing (merged 2026-11-12, D15/D9) |
| predictive-team-exec-analytics | team-exec-specialist | generative/read | Monte Carlo + completion probability (D8) |
| weekly-status-email | tpm-specialist | agentic/draft | 3-tier hybrid weekly status (D17) |
| release-retrospective | tpm-specialist | generative/read | Post-release retro (CCM/CG/PG/GA, naughty list) |
| ticket-insights | tpm-specialist | deterministic/read | Unified fetch + breakdown: 8-clause JQL + 6-group / Dev-QA / status (merged 2026-11-12) |
| kpi-pulse-analytics | tpm-specialist | deterministic/read | KPI pulse MTTR/status dwell |
| sprint-gantt-chart | tpm/rm | deterministic/read | Date-hierarchy-aware Gantt |
| backlog-triage | triage-specialist | agentic/draft | Unified backlog health: new/stale/pending (merged 2026-11-12, D19/D24) |
| crisis-triage | triage-specialist | agent/draft | P0/escalation coordination (D19) |
| dependency-walk | dependency-tracker | agent/read | Upstream/downstream dep graph (D18) |
| confluence-width-cleanup | confluence-publisher | deterministic/draft | Storage XML width sanitise |
| release-gate-ops | rm-specialist | deterministic/mutate | Unified gate move: JIRA gate (D30 audit) + release-config slip (D31) + sprint extension |
| release-dataset-sync | rm-specialist | deterministic/read | Sync dataset cache (atomic, jqlHash) |
| era-csv-jira-import | tpm/ops-assistant | deterministic/read | CSV/Excel → ERA Epics+Tasks |
| multi-model-review | ops-assistant | agentic/read | Pipeline stage 2: parallel code review |
| exec-perspective | ops-assistant | agent/read | Pipeline stage 5: exec sign-off |

Workflows: `monday-release-status`, `quarterly-team-exec-report`, `release-cascade-rename`.

---

## 6. Gaps (No App Ever Built, Ops Needs)

`FEATURE_CATALOG.md:232-245` — prioritised gaps:

- Sprint Planner (EM commit-list proposals from velocity)
- Status Page Auto-Publisher (email + Confluence in one click)
- Ticket Triage workflow (structured, agent-driven)
- Carry-over standalone page (currently buried in SprintReportPage)
- Cross-team dependency map — read-only `/dependency-view` exists; mutates pending

---

*For what the platform does at a glance, see `01-Platform-Overview.md`. For how to run it, see `03-Operations-Guide.md`.*
