# Portfolio Delivery Ops — App Guide

**One-liner:** A single web app (React, port 8888) that turns JIRA + Confluence + GitHub + AI into release status, sprint health, KPI dashboards, and an Ops Assistant chat that answers "when are we landing and what's blocking us?" with citations.

**Who it's for:** Portfolio Managers, Team Executives/Directors, TPMs, RMs, FEAT Managers, EMs, ICs, QA Leads, Architects, Admins. Everyone sees every non-admin tab; role drives presentation density (executive = chart-first; engineer = firehose + JQL), not access.

**Problem it solves:** PMs/TPMs spend 70%+ of their week on reactive pings. The app makes status self-service via deterministic workflows (Team-Executive Report, Weekly Status Email, SoS summaries) and an Ops Assistant agent for ad-hoc questions.

---

## How to use it (top-level)

1. Sign in with your **JIRA Personal Access Token** (validated against `GET /rest/api/2/myself`).
2. Pick your **product** (NDB, DataLens, …) and **release** in the top bar — drives all JQL/boards.
3. Pick your **role lens** (preview-as-X) to see the page the way that persona sees it.
4. Use the **Ops Assistant chat** (`/chatbot`) for ad-hoc questions; use the pages for drill-in and tables.

---

## Pages — why behind the page + how to use it

| Route | Page | Why it exists | How to use it |
|---|---|---|---|
| `/` | Email Sender | Compose & send a release status email from a JIRA query + AI draft | Pick release, edit recipients/subject, generate AI draft, preview, send; history logged |
| `/project-status` | Project Status | Single pane for a release: FEAT/Initiative table, Gantt, exec-summary cells | Pick release; filter FEATs; read RAG/dates/owners; click a FEAT for detail; export exec summary |
| `/feature-dashboard` | Feature Dashboard | Reconciliation of payload gates vs reality | Pick release; review gate mismatches and outstanding items |
| `/release/retrospective` | Retrospective | Gate compliance + "naughty ranking" of projects vs CC/CG/PG/GA | Pick release; read per-project gate adherence; coach follow-ups |
| `/release-setup` | Release Setup | Create / rename / cleanup a release version | Enter release name + dates; creates JIRA fixVersion + config |
| `/release-config` | Release Config | Edit gate dates (EC, CC, CG, PG, GA) for a release | Adjust dates; moves require a reason (audited to Confluence) |
| `/generic-emailer` | JIRA Emailer | Ad-hoc JQL → email (no template) | Paste JQL, preview rows, compose, send |
| `/email-history` | Email History | Audit log of sent emails with re-send | Browse/filter sent emails; re-send any |
| `/sprint-report` | Sprint Report | Sprint health: committed vs delivered, carry-over %, scope creep % | Pick team + sprint; read metrics; drill into tickets |
| `/sprint-performance` | Sprint Performance | Say-vs-do by team/leader/manager across sprints | Pick scope + window; read trend; ask AI for asks |
| `/component-report` | Component Report | Component health + deferrals | Pick component; read health + deferral list |
| `/chatbot` | AI Chatbot | Conversational Q&A over portfolio data — now with Custom JQL Digging (enter any JQL → Fetch & Index → ask scoped questions) | Active Releases: pick release → ask; Digging: toggle Custom JQL Digging → JQL (autocomplete Tab to accept, presets) → Fetch & Index → card shows live `N tickets` + sample → ask about that set; mutate HITL-queued |
| `/kpis` | KPIs | Configured KPI chips (bug count, velocity, predictability) | Pick team; read KPI chips + pulse analytics |
| `/system-test-scale` | System-Test Scale | System-test bug scale/trends | Pick release; read charts |
| `/oncalls` | OnCalls | OnCall → TechHelp → eng-fix pulse + AI briefing | Pick window; read outcomes; read AI briefing |
| `/sos-summary` | SoS Summary | Cross-release FEAT SoS + tier AI briefings | Pick releases; read SoS + tier briefings; email |
| `/sos-leader-summary` | SoS by Leader | Same SoS regrouped by eng leader + coaching + email | Pick leader; read coaching; send Friday email |
| `/release/brief` | Release Brief | Release RAG + blockers + 7-day action list | Pick release; read RAG, blockers, forecast; act on asks |
| `/team-management` | Admin | Teams, users, RBAC, KPI defs, system config | Admins manage teams/users/permissions |
| `/dependency-view` | Dependency View | 3-axis dependency matrix + hygiene (read-only) | Pick release; read upstream/downstream blockers |
| `/bin-packing/*` | Bin-Packing | Suggest which projects fit given team capacity | Enter capacity + projects; get packing plan |

---

## Reading the tabs & generating insights

General tips (apply to every page):
- **RAG colour** = Red/Amber/Green risk; hover the badge for the driver (scope, dates, blockers).
- **Drill, don't eyeball:** every count/badge is clickable → underlying JIRA tickets; use "Open in JIRA" for the exact JQL.
- **Role lens:** switch preview-as-X to see executive (chart-first) vs engineer (firehose) density.
- **Ask the agent:** paste a screenshot's numbers into `/chatbot` for a cited summary or next-step list.

Per-page reading guide:
- **Email Sender (`/`)**: read the AI-drafted cells; check recipient list and subject; insight = which FEATs moved since last send.
- **Project Status (`/project-status`)**: read FEAT table rows top-to-bottom by RAG; Gantt shows date clashes; insight = who owns the reds and their ETAs.
- **Feature Dashboard (`/feature-dashboard`)**: compare payload gates vs actual; insight = which gates are red and why (scope/date).
- **Retrospective (`/release/retrospective`)**: read naughty-ranking; insight = which teams slipped CC/CG/PG and the pattern (scope creep vs carry-over).
- **Release Setup/Config**: read current gate dates; insight = whether CC→CG→PG→GA ordering is realistic.
- **JIRA Emailer (`/generic-emailer`)**: read preview rows; insight = whether the JQL captures the right population before sending.
- **Email History (`/email-history`)**: read sent log; insight = cadence/compliance and re-send gaps.
- **Sprint Report (`/sprint-report`)**: read committed vs delivered and carry-over %; insight = velocity trend and scope-creep culprit.
- **Sprint Performance (`/sprint-performance`)**: read say-vs-do by leader; insight = predictability of teams/leaders.
- **Component Report (`/component-report`)**: read health + deferrals; insight = which components are chronic deferrers.
- **AI Chatbot (`/chatbot`)**: read citations; insight = ask follow-ups ("top 3 blockers", "landing date confidence").
- **KPIs (`/kpis`)**: read chips + pulse (created vs resolved, MTTR, dwell); insight = whether bug flow is improving.
- **System-Test Scale (`/system-test-scale`)**: read trend charts; insight = defect density per release.
- **OnCalls (`/oncalls`)**: read outcome taxonomy; insight = env/docs/knowledge vs eng-miss split.
- **SoS Summary (`/sos-summary`)**: read tier briefings; insight = cross-release FEAT status for leadership.
- **SoS by Leader (`/sos-leader-summary`)**: read coaching; insight = leader-specific actions for Friday email.
- **Release Brief (`/release/brief`)**: read RAG + blockers + 7-day asks + forecast; insight = landing date & confidence band.
- **Admin (`/team-management`)**: read team/user config; insight = coverage gaps in boards/filters.
- **Dependency View (`/dependency-view`)**: read 3-axis matrix; insight = upstream/downstream blockers and hygiene.
- **Bin-Packing (`/bin-packing/*`)**: read packing plan; insight = what fits in capacity and what to defer.

---

## Non-UI surfaces

- **MCP server** (stdio, 8 tools): `calculate_story_points`, `plan_capacity`, `bin_pack_projects`, `move_jira_dates`, `say_vs_do`, `gantt_release_timeline`, `leadership_commit_report`, `release_health` — same Layer-3 services as the UI.
- **Ops Assistant agent** (`/chatbot` + Cursor): orchestrator + 6 specialists + 22 skills; reads/writes via connectors; mutate actions are HITL-queued.
- **Workflows:** Monday weekly status email (3-tier), Friday leader email, release cascade rename, release-gate-ops (JIRA gate + Confluence audit / release-config slip).

---

## Tech at a glance

React 18 + Express (Node ≥20) on `:8888` · shared TS lib (`@portfolio-delivery-ops/shared`) · connectors: JIRA, Confluence, GitHub, Email, AI (Nutanix Enterprise AI, model `ntnx-beam`) · JIRA PAT auth only · data cached in `shared/.cache/release-dataset/` with 15-min sync.

For deeper detail: `01-Platform-Overview.md`, `FEATURE_CATALOG.md`, `ARCHITECTURE.md`, `DECISIONS.md`.
