# NDB Delivery Ops — Full Capability Brief (Exec-Slide Source)

**Document purpose**: Dense source material to convert into executive slides (“what was built”).  
**Surface**: Delivery Ops web app (React UI typically `:8899` in local; Express API typically `:8001` / `:6001`)  
**Scope**: Every navigable page + shared platform chrome  
**Depth**: Capabilities, audiences, outcomes, UI surface, trust model, and suggested slide talking points  

> Dependency rules SoT:  
> [`agent-pack/context/domain/dependency_rule.md`](../../agent-pack/context/domain/dependency_rule.md)

---

## Suggested slide outline (copy into deck)

| Slide | Title | Source section below |
|------:|-------|----------------------|
| 1 | What we built | §1 Executive summary |
| 2 | The problem we solved | §2 Problem → solution |
| 3 | Who uses it | §3 Audiences |
| 4 | App at a glance (19 pages) | §4 App map |
| 5 | Trust model — every number → JIRA | §5 Trust & authenticity |
| 6 | Theme: Communicate | §7.1 |
| 7 | Theme: Release control | §7.2 |
| 8 | Theme: Scrum & leadership say/do | §7.3 |
| 9 | Theme: Quality & scale | §7.4 |
| 10 | Theme: Cross-team dependencies & SoS | §7.5 |
| 11 | Theme: AI assist (with guardrails) | §7.6 |
| 12 | Theme: Govern & multi-team | §7.7 |
| 13–31 | One slide per page (optional deep dive) | §8 page cards |
| 32 | Platform foundations | §6 Platform |
| 33 | What’s live vs WIP | §9 Honesty / WIP |
| 34 | Closing pitch | §10 Closing |
| 35–40 | **JIRA hygiene / hierarchy / fields / links** | **§12** (new — exec + TPM deep dive) |

---

## 1. Executive summary — what was built

**NDB Delivery Ops** is a single authenticated internal web application that consolidates portfolio delivery operations for Nutanix product engineering (NDB-first, multi-team capable).

### Headline outcomes

1. **One control plane** for release payload, gates, SoS, sprint say/do, status email, KPIs, quality scale, and cross-team dependencies — instead of fragmented Confluence + ad-hoc JIRA searches + offline spreadsheets.
2. **Forwardable truth**: every displayed count is designed to open the **exact JIRA query** that produced it (JIRA authenticity).
3. **Persona-ready surfaces**: same underlying data packaged for Portfolio Manager / TPM workflow, RM gate ops, director / Team Exec leadership views, FEAT managers, EMs, and QA leads.
4. **AI where it helps — with guardrails**: release synopsis & forecast, SoS exec summaries, sprint leadership asks, chatbot Q&A; citations required; JIRA mutates stay HITL / blocked under open policy.
5. **Operational email path**: compose and send status / SoS / query emails via corporate SMTP, with audit history and Outlook fallback.
6. **Admin without server edits**: onboard teams from a JIRA base filter, manage permissions, clear caches, trigger syncs.

### Scale of the product surface

| Dimension | Count |
|-----------|------:|
| Primary navigable pages | **19** |
| Shared platform capabilities | Auth, RBAC, team context, release context, SMTP, bundles |
| AI-touched surfaces | Email Sender, Release Brief, SoS, SoS-by-Leader, Sprint Performance asks, Chatbot |
| Sibling link | Bin Packing (`/bin-packing/`) |

### One-line job

> One ops console: **see release health, run SoS & sprint leadership views, chase dependencies, send verified status email, ask AI** — with **every metric one click into JIRA**.

---

## 2. Problem → solution (slide narrative)

| Before (pain) | After (Delivery Ops) |
|---------------|----------------------|
| Status email assembled by hand from Confluence + JIRA | Email Sender pulls ticket, gates, Gantt, risk; AI risk summary; SMTP send + history |
| “What’s in the release?” requires multiple JQLs | Project Status: full payload table + Gantt + KPI chips |
| Feature managers juggle trees vs fixVersions | Feature Dashboard: overall Gantt + reconciliation + bug phases |
| Gate slips live in tribal knowledge | Release Config: numbered revisions + mandatory reasons + Gantt |
| Renaming a release is multi-project toil | Release Setup: create / rename / cascade / filter cleanup with preview |
| Leadership can’t see org say/do without Excel | Sprint Performance: JIRA-matched say/do by leader/manager + downloadable HTML |
| SoS prep is a fire drill | SoS Summary: all active releases, AI summaries, Email SoS snapshot |
| Partner deps are invisible until a gate slips | Dependency View: who waits on whom, wishlist, train alignment, chase list |
| KPI widgets are one-off filters | KPIs page: team baseFilter AND configurable widgets |
| System-test / regression story is tribal | System-Test Scale: typed regressions, trends, carry-over, component hotspots |
| “Did we follow gate contracts?” is anecdotal | Retrospective: compliance, naughty list, cross-release comparison |
| AI answers without audit trail | Chatbot: tool trace, provenance, remember:, HITL mutates |

---

## 3. Who uses it (audiences)

| Audience | Primary pages | What they get |
|----------|---------------|---------------|
| **Portfolio Manager / TPM** | SoS, Project Status, Dependency View, Chatbot, Email | Cross-release inventory, chase lists, briefing email |
| **Release Manager** | Release Config/Setup, Project Status, Retrospective, Email | Gates, renames, compliance, status send |
| **Director / Team Exec** | Sprint Performance, Release Brief, SoS, Retrospective | Say/do, forecast, RAG, forwardable HTML |
| **Feature Manager** | Feature Dashboard, Email Sender, Project Status | Feature payload, reconciliation, status email |
| **EM / Team lead** | Sprint Report, KPIs, Project Status | Velocity streams, team KPIs |
| **QA lead** | System-Test Scale, KPIs, Sprint Report | Regression scale, TBV, ST pulse |
| **App admin** | Team Management | Teams, RBAC, cache, sync |

---

## 4. App map — every page leadership can name

| # | Nav label | Route | Permission | One-line job |
|---|-----------|-------|------------|--------------|
| 1 | Email Sender | `/` | authenticated | Pull ticket → compose status email → SMTP send |
| 2 | Project Status | `/project-status` | `release_versions_view` | Release payload table + Gantt + KPI chips |
| 3 | Release Config | `/release-config` | `release_config_manage` | Edit gate dates with revision history + reasons |
| 4 | Release Setup | `/release-setup` | `release_setup_manage` | Create / rename / cascade releases; cleanup filters |
| 5 | Release Brief | `/release/brief` | `release_versions_view` | AI health + forecast + KPIs + burndown for one release |
| 6 | Feature Dashboard | `/feature-dashboard` | `release_versions_view` | Feature deep dive + reconciliation |
| 7 | Retrospective | `/release/retrospective` | `release_versions_view` | Gate contract compliance + cross-release compare |
| 8 | JIRA Emailer | `/generic-emailer` | `email_send_generic` | Any JQL → formatted table email |
| 9 | Email History | `/email-history` | `email_history_view` | Audit + re-send of sent mail |
| 10 | Sprint Report | `/sprint-report` | `sprint_reports_view` | Per-team sprint velocity (3 streams) |
| 11 | Sprint Performance | `/sprint-performance` | `sprint_reports_view` | Org-wide say/do leadership report (HTML) |
| 12 | SoS Summary | `/sos-summary` | `release_versions_view` | All active releases SoS + AI + Email SoS |
| 13 | SoS by Leader (temp) | `/sos-leader-summary` | `release_versions_view` | SoS regrouped by eng leader |
| 14 | Component Report | `/component-report` | `release_versions_view` | Component health, P0/P1, cleanup |
| 15 | Dependency View | `/dependency-view` | `release_versions_view` | Cross-team deps map (read-only MVP) |
| 16 | KPIs | `/kpis` | `kpi_view` | Configurable team KPI widgets |
| 17 | System-Test Scale | `/system-test-scale` | `kpi_view` | ST bug scale, regressions, trends |
| 18 | AI Chatbot | `/chatbot` | `ai_insights_view` | Conversational release/ticket Q&A |
| 19 | Team Management | `/team-management` | `admin_panel_access` | Teams, RBAC, cache, sync |
| — | Bin Packing | `/bin-packing/` | sibling app | Capacity / packing (linked, not in React tab) |
| — | Login | `/login` | public | JIRA token auth |
| — | Legacy redirects | `/sync-hub`, `/all-status`, `/admin` | — | → Project Status / Team Management |

---

## 5. Trust & authenticity (cross-cutting — make this a slide)

**Principle**: Numbers are not decorative. If the UI shows a count, a user can open JIRA and see the same set.

| Mechanism | What it means for execs |
|-----------|-------------------------|
| Clickable metrics | Count → encoded JQL URL in new tab |
| Tooltips with JQL | Hover shows the query behind the number |
| Empty still links | Zero counts keep valid “open in JIRA” links |
| Sprint Performance | Matches board → Reports → Sprint Report math |
| AI citations | Ticket keys / queries cited; no invented keys |
| Email audit | History stores what was sent (+ JQL for Emailer) |
| Dataset + live | Bundles for resilience; Pull/Refresh for live JIRA |
| RBAC | Sidebar only shows what the user may use |

---

## 6. Platform / shared foundations

Capabilities available across the app (not tied to one tab):

| ID | Capability | Detail for slides |
|----|------------|-------------------|
| P-01 | JIRA PAT login | Bearer token; server validates before sensitive calls |
| P-02 | Fine-grained RBAC | `allowedUsers.json` → permissions; unauthorized tabs hidden |
| P-03 | Test Connection & Refresh Permissions | Re-fetch auth mapping without redeploy |
| P-04 | Logout | Clears session/token usage path |
| P-05 | Collapsible sidebar | Persist collapsed state in localStorage |
| P-06 | Shared Team picker | Stage team → **Fetch** applies; reloads team-scoped pages |
| P-07 | Team-required gate | Empty state until a team is applied |
| P-08 | Selected release context | Release choice shared across pages where applicable |
| P-09 | Multi-team config | Per team: `baseFilter`, project, board, sprint calendar, components |
| P-10 | Release dataset / bundles | On-disk snapshots; SoS/retros survive JIRA rate limits |
| P-11 | SMTP via mail relay | Corporate send path (treated as sacred / carefully changed) |
| P-12 | Outlook fallback | Copy path when SMTP or client needs alternate |
| P-13 | Notifications / toasts | Success and failure feedback |
| P-14 | Compact density | Targets 13" / ~1280–1440px workflows |
| P-15 | No localhost in prod client | Relative `/api/...` or env-based bases |
| P-16 | Architecture layers | Components render · hooks fetch · services transform · thin routes |

---

## 7. Capability themes (slide groups)

### 7.1 Communicate

**Pages**: Email Sender · JIRA Emailer · Email History · SoS Email  

**What was done**: Turn ops communication into a productized flow — pull live engineering context, compose, preview, send, audit, re-send.

**Slide bullets**:
- Status email from a Feature/Initiative key (gates, Gantt, risk, AI summary)
- Arbitrary JQL → table email with column control + test mode
- SoS briefing email = snapshot of already-loaded page (no second JIRA crawl)
- Full audit trail with HTML preview and re-send

---

### 7.2 Release control

**Pages**: Project Status · Feature Dashboard · Release Brief · Release Config · Release Setup · Retrospective  

**What was done**: End-to-end release lifecycle visibility — payload → feature drill-down → forecast → gate calendar → rename ops → post-gate learning.

**Slide bullets**:
- Full release payload + Gantt with gate rulers
- Feature reconciliation (tree vs fixVersion)
- Landing forecast (planned vs forecast GA, confidence, required velocity)
- Gate slips with numbered revisions + mandatory reason
- Create / rename / cascade releases across JIRA projects
- Gate compliance + naughty list + cross-release comparison

---

### 7.3 Scrum & leadership say/do

**Pages**: Sprint Report · Sprint Performance · KPIs  

**What was done**: Separate **team sprint hygiene** from **org leadership say/do**, and keep velocity as **three streams** (Dev / QA verification / QA test tasks) — never one blended number.

**Slide bullets**:
- Past & current sprint report with fiscal quarter lens
- Org-wide ~18-month say/do matching JIRA Sprint Report
- Heatmaps, discipline timeline, gate-adjacent say/do, Dev→QA lag
- Chronic carry-over (tickets planned into 3+ sprints)
- Downloadable HTML report for directors to forward
- Configurable KPI widgets AND’d with team base filter

---

### 7.4 Quality & scale

**Pages**: System-Test Scale · Component Report  

**What was done**: Make System-Test / regression and component risk **chart-first and JIRA-linked** for TPM / RM / QA / directors.

**Slide bullets**:
- Typed regressions (`Regression?` field), ST pulse, carry-over, component hotspots
- Current vs Compare release deltas + all-release heatmaps/trends
- Component RAG, P0/P1 age badges, project-level info, cleanup stale projects

---

### 7.5 Cross-team dependencies & SoS

**Pages**: Dependency View · SoS Summary · SoS by Leader  

**What was done**: Surface Dependency / Partnership / wishlist deps and a Scrum-of-Scrums control surface across all active releases — including leader org rollup.

**Slide bullets**:
- Who waits on whom (swimlanes) + Ask vs Committed + train alignment
- Next-actions chase list before the next gate
- SoS: Features/Initiatives + AI exec summary + KPI strip + Email SoS
- Leader view: Anil / Naveen / Jovan / Ashish + Unmapped managers

---

### 7.6 AI assist (with guardrails)

**Surfaces**: Email Sender AI risk · Release Brief synopsis/forecast · SoS / Leader GenAI · Sprint Performance leadership asks · Chatbot  

**What was done**: AI accelerates narrative and prioritization; **does not invent ticket keys**; mutates stay human-gated.

**Slide bullets**:
- Citation-first answers; tool traces + provenance IDs in chatbot
- `remember:` session corrections
- Approve/Reject for mutates — Approve does **not** write JIRA while D26 open
- AI asks fall back to rule-based asks if model fails
- Raw Status Update field never shown raw — only via AI summary pipeline on SoS

---

### 7.7 Govern & multi-team

**Pages**: Team Management (+ platform RBAC)  

**What was done**: Ops can onboard a team from a JIRA base filter, detect board/project/components, manage who sees which tabs, and manage dataset cache — without redeploying for every permission tweak.

---

## 8. Page cards (deep detail for optional slides)

Each card: **Purpose · Audience · Capabilities · UI surface · Trust · Talking points · Status notes**

---

### 8.1 Email Sender (`/`)

**Purpose**  
Original and still-central feature: compose and send a release/feature status email with charts and AI, via SMTP.

**Audience**: RM, TPM, FEAT managers, team leads  

| Cap | Detail |
|-----|--------|
| Ticket fetch | Enter Feature / Initiative / X-FEAT / Capability key → Fetch |
| Pulled context | Ticket strip, collapsed fields, sprint Gantt |
| Gates | EC → CCM → CG → PG visualization |
| Risk | Risk Indicator + Assessment + Path to Green |
| Compose | Subject (header), Highlights / Lowlights / Support (required sections) |
| AI | **AI risk summary required** for send; emailed with body |
| Recipients | To/CC; config-driven defaults |
| Preview | Rendered preview includes AI + sprint timeline |
| Send | SMTP; success toast or verbatim failure |
| Fallback | Outlook copy path |
| Confluence | URL extract flow (where wired) for page content |
| History | Sent mail appears in Email History |

**UI shape**: Pulled data on top; typed entry above Send (UI is reverse of email body order).  

**Talking points**:
- “Status email stops being a copy-paste fire drill.”
- “AI summary is mandatory in the emailed artifact — not optional fluff.”

---

### 8.2 Project Status (`/project-status`)

**Purpose**  
Central release payload dashboard: everything in scope for a selected release, filterable, with Gantt against gates.

**Audience**: TPM, RM, director  

| Cap | Detail |
|-----|--------|
| Team + Fetch | Stage team → Fetch loads versions from team’s JIRA project |
| Release picker | Unreleased fixVersions from team baseFilter; persists selection |
| Payload table | Hierarchy-aware full payload (sortable columns) |
| Filters | Team, component, status, priority, issue type (client-side after load) |
| KPI chips | Total issues, open bugs, P0/P1, closed % — each → JIRA |
| Gantt | Date hierarchy: gate dates (FEAT tier), dueDate (Epic), sprint end (lower) |
| Gate rulers | CCM / CG / PG / GA vertical markers from release calendar config |
| RAG | Per project row without opening JIRA |
| Scale | Virtualised table; Gantt capped for very large payloads |
| Email handoff | Generate status email from current view |
| Empty / error | Empty states, retry on timeout, unscheduled bars when no dates |

**Talking points**:
- “One Fetch → full release inventory + timeline.”
- “Filters don’t hide authenticity — chips still open JIRA.”

---

### 8.3 Release Config (`/release-config`)

**Purpose**  
Authoritative edit surface for release **gate calendar** used across Gantt, SoS, Dependency View, etc.

**Audience**: RM  

| Cap | Detail |
|-----|--------|
| Gates | EC, CCM, Commit Gate, Promotion Gate, GA |
| Slip model | Numbered revisions: prior solid → dotted; new solid slot (never silent overwrite) |
| Reasons | Mandatory reason stamped on current revision |
| Visualization | Release Gantt of configured gates |
| Persistence | Writes release gate configuration (config SoT) |

**Talking points**:
- “Gate slips leave a trail — date history + reason, not tribal knowledge.”

---

### 8.4 Release Setup (`/release-setup`)

**Purpose**  
RM-only JIRA release administration without raw JIRA admin toil.

**Audience**: RM  

| Cap | Detail |
|-----|--------|
| Create | Name, description, release date → new JIRA version |
| Rename | Preview affected versions/config → confirm |
| Cascade | Companion versions renamed to match parent pattern |
| Multi-project | Team project + FEAT, SDL, LEG, TECHPUBS, etc. |
| Cleanup | Stale saved filters that still reference old releases |
| Safety | Preview then confirm on every destructive action |

**Talking points**:
- “Rename once; cascade companions; clean filters — with preview.”

---

### 8.5 Release Brief (`/release/brief`)

**Purpose**  
Leadership one-pager for a single release: KPIs, synopsis, forecast, outstanding work, project matrix, velocity, burndown, gates.

**Audience**: TPM, director / Team Exec  

| Cap | Detail |
|-----|--------|
| Routing | `/release/brief` or deep link `/release/:name/brief` |
| Team scope | Requires team; KPIs scoped to team |
| KPI cards | Batch live counts; each number → JIRA |
| Synopsis | Payload / health narrative panel |
| Landing forecast | Verdict, planned vs forecast GA, gap weeks, confidence, required velocity |
| Outstanding streams | Dev unresolved · QA verification pending · QA test tasks (3 streams) |
| Outstanding list | Drillable outstanding work |
| Project matrix | Breakdown across projects/features |
| Sprint velocity | Velocity panel with JIRA links |
| Gates | Gate timeline panel |
| Burndown | Burndown chart for selected release |
| Freshness | Meta strip: team, metric count, synced state; Refresh |

**Talking points**:
- “Will we land?” gets a forecast with confidence — not a gut feel.”
- “Outstanding work split into Dev / QA verification / QA tests — same three streams as velocity.”

---

### 8.6 Feature Dashboard (`/feature-dashboard`)

**Purpose**  
FEAT-manager deep dive: overall release feature Gantt, then one feature’s gates, bugs by phase, epic trend, reconciliation.

**Audience**: FEAT manager, TPM  

| Cap | Detail |
|-----|--------|
| Overall Gantt | All Features/Initiatives vs EC→GA; Risk Indicator colors; click row to open |
| Feature choose | Dropdown or FEAT key; `?feat=` shareable URL |
| Gate chips | CCM / CG / PG open counts + RAG → JIRA |
| Bug phases | Regression, System Test, Longevity, Performance, Stress, Unit Test |
| Epic trend | Cumulative closed epics over weeks; gate reference lines |
| Reconciliation | Children in tree missing/wrong fixVersion |
| Overrides | Intentional defer / wrong version / need to tag (localStorage) |
| Cross-release | Same feature key persists when switching releases |

**Talking points**:
- “Catch scope leaks before they surprise you at Commit Gate.”

---

### 8.7 Retrospective (`/release/retrospective`)

**Purpose**  
Answer: did teams honor gate contracts? How does this release compare to recent major/minor releases?

**Audience**: RM, director, TPM  

| Cap | Detail |
|-----|--------|
| Cross-release table | Latest ~3 big releases + selected; deltas + sparklines |
| Delivery rows | Task closure %, bugs, P0/P1 open, reopen rate |
| PG verification | Unverified@PG, verify-lag median, reopen |
| KPI categories | Live per-team KPI rows in comparison |
| Gate timeline | Planned vs actual CCM/CG/PG/GA |
| Compliance cards | Per-gate open/deferred/found-after metrics |
| Naughty list | Top violators; expand to tickets |
| Reopen quality | Projects with highest reopen rates |
| Companion readiness | Companion releases ready when parent shipped? |
| PG→GA panel | Calendar days per project; benchmark |
| Data | Bundle-first; live fallback with badge |

**Talking points**:
- “Post-mortem without anecdotes — contracts vs behavior, plus trend vs prior releases.”

---

### 8.8 JIRA Emailer (`/generic-emailer`)

**Purpose**  
Any JQL → preview → choose columns → email a table. Complements Confluence/ticket-based Email Sender.

**Audience**: RM, TPM  

| Cap | Detail |
|-----|--------|
| JQL fetch | Run query; preview capped (e.g. first 500 of N) |
| Templates | Saved common queries |
| Columns | Only fields-with-data; drag-reorder; remove |
| Compose | Subject (date appended), To/CC, intro body |
| Project team CC | Assignees / QA / PM fields from results (config) |
| Preview | HTML email preview + paginated table |
| Test mode | Self-only, `[TEST]` subject, no CC |
| Render | Wiki/ADF → HTML in cells; empty → N/A |
| Audit | History stores JQL |

**Talking points**:
- “Reminder/list emails without building a Confluence page.”

---

### 8.9 Email History (`/email-history`)

**Purpose**  
Audit trail for Email Sender + JIRA Emailer.

**Audience**: RM, TPM, admin  

| Cap | Detail |
|-----|--------|
| List | Date, sender, subject, release, recipient count, source |
| Filters | Date range, sender, subject keyword, release |
| Detail | Full recipients, HTML body, source JQL |
| Re-send | Prefill compose path |
| Visibility | Own sends vs admin sees all |
| Pagination | ~25 per page |

**Talking points**:
- “Who sent what, when — replayable.”

---

### 8.10 Sprint Report (`/sprint-report`)

**Purpose**  
Team-scoped sprint reporting with **three velocity streams**.

**Audience**: EM, TPM, team lead  

| Cap | Detail |
|-----|--------|
| Modes | Past · Current · Trends (WIP / coming soon) |
| Team | Shared TeamContext + Fetch |
| Sprint select | Numerical order S1, S2, … S10 |
| Fiscal | Nutanix FY quarters (Q1 = Aug–Oct) |
| Dev velocity | Non-portfolio, non-Test work |
| QA verification | Bug/Improvement closed (×0.33 adjusted count model) |
| QA test tasks | `issueType = Test` |
| Resolution pie | Done / Unresolved / Dupe-NotRepro / Others |
| Issue-type pie | Task / Bug / Improvement / Test / other |
| Current P0/P1 | Open bugs table for in-flight sprint |
| Data | Bundle for past; live board API for current |
| Export | CSV where implemented |

**Talking points**:
- “Velocity is never one bar — Dev, QA verify, QA tests stay separate.”

---

### 8.11 Sprint Performance (`/sprint-performance`)

**Purpose**  
Leadership view of say/do across **all scrum teams** for ~18 months, grouped by reporting line. Forwardable as self-contained HTML.

**Audience**: Director / Team Exec (primary); TPM; EM  

| Cap | Detail |
|-----|--------|
| Source of truth | Matches JIRA Sprint Report Completed / Not Completed / Removed |
| Window | Rolling ~26 three-week slots ending on in-flight sprint |
| Org verdict | RAG + rule thresholds |
| Highlights / lowlights | Each cites underlying JIRA |
| Filters | Leader, manager, scrum team, Dev/Test; URL hash persists |
| KPI tiles | Say/Do · Dev finished · QA bandwidth gap · QA queue · Scope added · Slipped |
| Discipline timeline | Auto phases; narrative; gate markers; superseded dates as hollow diamonds |
| Gate adjacency | Say/do ±2 sprints around CC/CG/PG/GA (EC optional) |
| Heatmaps | Completed say/do; Dev-finished (Resolved∪Closed); type rows when team selected |
| Drill-down | Ticket outcomes + planned vs mid-sprint add (*); links to JIRA Sprint Report |
| Dev→QA lag | Days Resolved→Closed + aged Resolved queue |
| Delivery trend | Say/Added/Removed + type-matched rates + three-velocity chart |
| Chronic carry-over | Planned into 3+ sprints; search; Still open / Awaiting QA / Closed tabs; paginated |
| AI asks | Org-wide leadership asks; rules fallback |
| Export | Download HTML / open in new tab |
| Regenerate | Live JIRA job with progress; keeps prior report on failure |
| Range | Last 6 / 12 / 18 sprints or all |

**Talking points**:
- “Directors get a forwardable HTML that matches JIRA’s own Sprint Report.”
- “QA bandwidth is visible separate from ‘did Dev finish.’”

---

### 8.12 SoS Summary (`/sos-summary`)

**Purpose**  
Scrum-of-Scrums control surface: all active releases’ Features & Initiatives, AI summaries, KPIs, Email SoS.

**Audience**: VP / director (consume); Portfolio Manager / TPM (compose)  

| Cap | Detail |
|-----|--------|
| All releases | Newest-first; no per-release selection required |
| Tables | Key, summary, status, risk, CC/CG/PG, assignee, AI summary, task breakdown |
| Risk | Indicator (+ history strikethrough) + Assessment + Path to Green |
| Dates | Current gate + prior hops struck through |
| AI | Generate per row or bulk; Status Update raw text never rendered |
| KPIs | Lazy load on expand; count chips + list widgets → JIRA |
| Component filter | From team’s JIRA project components |
| Refresh | Refresh All (live, 429→cache); per-release refresh |
| Email SoS | HTML snapshot of loaded page; To/CC from status-sender config; **no JIRA refetch on send** |
| Identity | Test Lead preferred; QA Contact shown when needed |
| Dataset | On-disk release dataset for rate-limit resilience |

**Talking points**:
- “SoS email is a snapshot of what leadership already sees — not a second divergent report.”

---

### 8.13 SoS by Leader — temp (`/sos-leader-summary`)

**Purpose**  
Validate eng-leader org map before a weekly digest: Overall → Leader → Release.

**Audience**: TPM, RM (layout review)  

| Cap | Detail |
|-----|--------|
| Leaders | Anil · Naveen · Jovan · Ashish from `ndbLeaderOrgConfig` |
| Attribution | Assignee Manager → leader rollup (nested managers supported) |
| Unmapped | Bottom section lists managers to add to config |
| Overall | RAG heatmap, KPIs, GenAI summary, FEAT/Standalone/Direct counts, release Gantts |
| Leader×release | One GenAI coaching summary (not FEAT-tier boxes) |
| Refresh | Same SoS APIs as SoS Summary |
| Not yet | Email SoS / Friday cron (explicitly out of this phase) |

**Talking points**:
- “Same SoS truth, cut by eng leadership org — Unmapped drives config hygiene.”

---

### 8.14 Component Report (`/component-report`)

**Purpose**  
Director-focused component health: P0/P1, other priority, projects by fixVersion, cleanup.

**Audience**: Director, RM  

| Cap | Detail |
|-----|--------|
| Explicit fetch | Fetch Components → Fetch data (no surprise auto-load) |
| Health card | RAG from worst severity; P0/P1 counts; verdict |
| Releases | Multi-select NDB-X.Y + master; filter client-side |
| Widgets | P0 · P1 · Other Priority (accordions); Projects by fixVersion |
| Sections | A = selected releases/master; B = everything else; C = cleanup |
| Age badges | &lt;30 green · 30–59 orange · ≥60 red (from created) |
| Stale cleanup | Closed/cancelled projects with outstanding descendants |
| Anomalies | affectedVersion ERA Future / Triage highlighted |
| WIP | KPI counts + Deferral Behaviour widgets may still be placeholders |
| Trust | Every count → JIRA |

**Talking points**:
- “Which component is burning — P0 age and project hygiene in one scroll.”

---

### 8.15 Dependency View (`/dependency-view`)

**Purpose**  
Read-only NDB-first **3-axis** map for a release: project type × Mode (Dependency | Partnership) × aligned train — plus wishlist/ask discovery and hygiene chase. Companionship retired.

**Audience**: TPM, Portfolio Manager, RM, FEAT manager  

| Cap | Detail |
|-----|--------|
| Axes | Project type (`*-ew`) · Mode Dependency (links) / Partnership (hierarchy) · Aligned release |
| Directions | **I wait** vs **They wait** demarcated; includes NDB↔NDB (`ndb-ew`); team-internal FYI only |
| Wishlist | `ndb-*-wishlist` on **NDB** tickets |
| Train asks | `ndb-{train}-ask(s)/dependency` on **their** tickets |
| Commitment | Release Commit = nature (Commit / Stretch / blank) + real fixVersion |
| Hygiene | NDB: Dependency without wishlist · Them: Commit/Stretch↔fixVersion gaps · Missing labels on they-wait |
| Safety | **No JIRA link/parent writes** in MVP |

**Rules SoT**: [`dependency_rule.md`](../../agent-pack/context/domain/dependency_rule.md) · page docs: requirements + data-layer (rebuild in progress)

**Talking points**:
- “Who waits on whom — and whose hygiene is broken — before the next gate.”
- “Train asks and EW project type stay separate — no glossary collision.”

---

### 8.16 KPIs (`/kpis`)

**Purpose**  
Configurable per-team KPI dashboard; every widget AND’d with team base filter.

**Audience**: TPM, RM, team; admins edit  

| Cap | Detail |
|-----|--------|
| Scope | `(team.baseFilter) AND (kpi.baseQuery)` |
| Types | Count chips · issue list widgets |
| Batch load | `/api/jira/kpi-results-batch` |
| Admin | Add / edit / delete / reorder KPIs |
| Base filter edit | Propagates into TeamContext for other pages |
| Gate | TeamRequiredGate if no team |

**Talking points**:
- “KPIs stay honest to the team’s base JQL — one place to manage them.”

---

### 8.17 System-Test Scale (`/system-test-scale`)

**Purpose**  
Exec-facing System-Test bug scale and regression health.

**Audience**: TPM, RM, QA lead  

| Cap | Detail |
|-----|--------|
| Scope | `filter={teamCode}-System-Test` |
| Typed regs | `cf[13260]` Regression? (Yes*, R2R, EMPTY as DQ) |
| Filtered band | Current vs Compare heroes, ST pulse, deltas, carry-over, component map |
| All-release band | Heatmap + trend charts (volume, rates, aging, TBV) — ignores Current/Compare for series |
| ST pulse | Label widgets aligned to known JIRA filters (all/open/RNC/affected/fixVersion) |
| Pull | Live re-count; Current/Compare switch client-side |
| Trust | Counts and rate numerators → JIRA |

**Talking points**:
- “System-Test story is chart-first and release-comparable — not a filter scavenger hunt.”

---

### 8.18 AI Chatbot (`/chatbot`)

**Purpose**  
Ops Assistant conversational surface over release snapshots and tools (D7).

**Audience**: TPM default; RM / portfolio / team-exec via audience  

| Cap | Detail |
|-----|--------|
| Ask | Release/ticket Q&A grounded in on-disk snapshot |
| Release focus | Change focus without leaving page |
| Clear | New `sessionId` — no memory leak |
| Trace | Tool calls shown under replies |
| Provenance | Audit id per assistant reply (not a RAG color) |
| Links | Ticket keys → JIRA |
| remember: | Persist corrections for later turns |
| HITL | Approve/Reject queued mutates; Approve → `blocked_d26` (no JIRA write while D26 open) |
| Honesty | Missing snapshot → say unavailable; never invent counts |

**Talking points**:
- “Chat with audit: tools used, provenance, human gate on writes.”

---

### 8.19 Team Management (`/team-management`)

**Purpose**  
App admin: RBAC, team onboarding from base filter, JIRA diagnostics, cache/sync.

**Audience**: App admin  

| Cap | Detail |
|-----|--------|
| Permissions UI | Add/remove users from groups without hand-editing JSON |
| Team cards | Code, project, board, calendar, base filter, components, KPI count |
| Detect | From base filter: main project, versions, board, sprint calendar, components |
| Overrides | Type project key / board id; S1 start + length if board has no dates |
| Components | Multi-select from project components |
| Tests | Per-team Test + app-level JIRA connection test |
| Cache | Clear bundle / clear full / trigger release dataset sync |
| UX | New teams appear in global Team dropdown without full reload |

**Talking points**:
- “Onboard a team with a name + base filter — detect the rest, confirm, save.”

---

### 8.20 Related surfaces

| Surface | Status | Note for slides |
|---------|--------|-----------------|
| Bin Packing | Linked sibling | Sidebar opens `/bin-packing/` (backend-served in prod) |
| Sync Hub | Removed | Redirects to Project Status |
| `/all-status` | Redirect | → Project Status |
| `/admin` | Redirect | → Team Management |
| Release Trends | Historical | Logic moved; some deep-links may remain |

---

## 9. Honesty / WIP — what to say carefully on slides

| Item | Status | Recommended wording |
|------|--------|---------------------|
| Dependency View writes | Not in MVP | “Read-only inventory & chase; link edits stay in JIRA for now.” |
| Chatbot mutates | Blocked (D26) | “AI can propose; writes stay human-gated / blocked until policy closes.” |
| Sprint Report Trends | WIP | “Past & Current live; Trends coming soon.” |
| Component KPI/Deferral widgets | Partial | “P0/P1/projects/cleanup live; some widgets still landing.” |
| SoS by Leader email | Temp / no cron | “Leader layout validated; weekly email job not shipped yet.” |
| Sync Hub | Retired | “Absorbed into Project Status / dataset flows.” |
| Multi-product | Config-driven direction | “NDB-first today; Team picker + config path for other products.” |

---

## 10. Closing pitch (final slide)

> **NDB Delivery Ops** is the portfolio delivery control plane for Nutanix engineering ops.  
>  
> We built **19 operational surfaces** on one authenticated app so Portfolio Managers and adjacent roles can **see release health, run SoS and sprint leadership views, chase cross-team dependencies, send verified status email, and ask AI** — with **every metric one click into JIRA**.  
>  
> The outcome: **less scavenger hunting, more forwardable truth, faster chase before the next gate.**

---

## 11. Optional appendix — theme → page checklist (print for speaker notes)

**Communicate**  
☐ Email Sender · ☐ JIRA Emailer · ☐ Email History · ☐ SoS Email  

**Release control**  
☐ Project Status · ☐ Feature Dashboard · ☐ Release Brief · ☐ Release Config · ☐ Release Setup · ☐ Retrospective  

**Scrum**  
☐ Sprint Report · ☐ Sprint Performance · ☐ KPIs  

**Quality**  
☐ System-Test Scale · ☐ Component Report  

**Cross-team**  
☐ Dependency View · ☐ SoS Summary · ☐ SoS by Leader  

**AI**  
☐ Chatbot · ☐ Brief synopsis/forecast · ☐ SoS GenAI · ☐ Sprint asks · ☐ Email AI risk  

**Govern**  
☐ Team Management · ☐ RBAC · ☐ Cache/Sync  

---

## 12. JIRA hygiene, hierarchy, fields & links (how we use JIRA)

> **Why this section exists**: Delivery Ops does not invent a parallel project system. It **reads Nutanix ERA/NDB JIRA conventions** — hierarchy, custom fields, labels, link types, and workflows — and turns them into dashboards, emails, and chase lists.  
> **Sources**: `agent-pack/context/domain/*`, `jiraFieldsConfig.json`, Dependency View / SoS / release-dataset skills, and conversation-established rules (issue-type grouping, velocity, gates).

### 12.0 Slide talking points (short)

1. **Hierarchy**: X-FEAT/Capability → Feature/Initiative → Epic → work items — wired by **Parent Link** and **Epic Link**, not guesswork.  
2. **Release membership**: `fixVersion` / `affectedVersion` / train & must-fix **labels** — with Ask vs Commit via fixVersion **or** Release Commit field.  
3. **Gates live on FEAT-tier dates**; lower tiers use Due Date / Sprint end.  
4. **Risk is three fields**: Indicator + Assessment + Path to Green (Yellow/Red require the last two).  
5. **Deps are two Modes**: **Dependency** (`blocks` / `is blocked by`) vs **Partnership** (FEAT → Epic hierarchy). Companionship retired.  
6. **`status=Resolved` ≠ done** — that is **TBV**; Closed + positive resolution = shipped.  
7. **Hygiene = missing dates/links/risk/stale status** — phase-aware; never flag TEAM_NA.

---

### 12.1 Issue-type hierarchy (what “parent” means)

```
X-FEAT / Capability
        ↓  Parent Link (portfolio)
Feature / Initiative
        ↓  Parent Link
      Epic
        ↓  Epic Link
Bug / Improvement / Task / Unit Test / Test / Story / …
```

| Level | Issue types | Role in Delivery Ops |
|-------|-------------|----------------------|
| Portfolio top | X-FEAT, Capability | Strategic containers; gate dates apply |
| Portfolio mid | Feature, Initiative | SoS rows, Email Sender targets, Feature Dashboard roots |
| Mid | Epic | Due Date for Gantt; children roll under via Epic Link |
| Work | Bug, Improvement, Task, Unit Test, Test, … | Velocity, sprint say/do, direct tickets, QA streams |
| Collaterals | PRD, Design Doc, Test Plan, UX, SDL, … | Separate workflows; completion links on FEAT |

**Issue-type groups** (analytics / filters — not JIRA native):

| Group | Types | Work class |
|-------|-------|------------|
| Project Hierarchy | Feature, Initiative, Epic, X-FEAT, Capability | Portfolio (usually excluded from Dev velocity) |
| Bug | Bug | Dev |
| Improvement | Improvement | Dev |
| Dev Code | Task, Unit Test | Dev |
| Test | Test | QA (test-task velocity) |
| Everything Else | all other | Dev (default) |

---

### 12.2 How tickets are linked (relationship model)

Delivery Ops uses **three different wiring mechanisms**. Mixing them up is the #1 source of wrong counts.

#### A. Portfolio hierarchy fields (structure)

| Field | ID (SoT) | Links | Depicts |
|-------|----------|-------|---------|
| **Parent Link** | `customfield_20363` | Epic → Feature/Initiative (JPO) | “This epic belongs under that FEAT” — Mode **Partnership** when multi-team delivery shares one hierarchy |
| **Epic Link** | `customfield_10361` | Bug/Task/Test/… → Epic | “This work item is in that epic” |

**Fetch strategy (release dataset)**: prefer indexed Parent Link / Epic Link waves over ScriptRunner when possible; click-through JQL may still use `portfolioChildrenOf` / `issuesInEpics` so a human can open one URL without pre-collecting keys.

#### B. Formal issue links (Mode Dependency)

| Link type (name) | Direction in UI | Depicts |
|------------------|-----------------|---------|
| **is blocked by** | “I wait on them” (upstream) | Our release work is waiting on that ticket |
| **blocks** | “They wait on me” (downstream) | Their ticket is waiting on our work |
| **relates to** (and others) | Wishlist Q7b (optional filter) | Soft association; default wishlist pull = **all** link types |
| **Clone / Duplicate** | Ignored as dependency edges | Not a real “wait on” relationship — hygiene if wishlist only has these |

Mode Dependency discovery: `linkedIssuesOf("fixVersion = {release}", "is blocked by"|"blocks")`.

#### C. Labels (discovery & callouts — not structure)

Labels mark intent / train / hygiene; they do **not** replace Parent Link or `blocks`. See `dependency_rule.md`.

| Label pattern | Depicts | Used by |
|---------------|---------|---------|
| `ndb-{trainSlug}-dependency` / `-asks` / `-ask` | Train ask on **their** ticket | Dependency View Q5 / hygiene |
| `ndb-{releaseSlug}-wishlist` | Wish into NDB release — on **NDB** tickets | Dependency View Q7 |
| `{version}-mustfix` | Release-blocking regardless of hierarchy | Release Brief / RAG floor |
| `{prefix}-*-long-term-funded` | Funded but not short-term commit (exclude from some commit counts) | Commit / brief queries |
| `global-ew` / `nutanix-ew` / `ndb-ew` | **Project type** (EW) — types 1–3 in matrix; team-internal FYI | Dependency View filter |
| `longevity`, ST pulse labels | System-test / quality pulse | System-Test Scale |
| `{release}-deferred` (and changelog kicks) | Deferral / kick patterns | Component / ST / deferral analysis |

**Hard rule**: train ask / wishlist labels ≠ Project type (`*-ew`). UI keeps them as separate controls.

---

### 12.3 Release membership — what “in this release” means

| Signal | Depicts | Notes |
|--------|---------|-------|
| **fixVersion = NDB-X.Y** | Committed / targeted to that release | Primary release membership |
| **fixVersion = master** | Active / funded, not yet on a train | Component Report Section A |
| **fixVersion = ERA Future / Triage** | No real commit | Anomaly / data hygiene |
| **affectedVersion** | Release impacted (bugs) | Valid for NDB-X.Y / master; ERA Future/Triage = anomaly |
| **fixVersion was X** (changelog) | Historical membership / deferral kicks | Deferral = distinct fixVersions over time |
| **Release Commit** field | Nature of **their** commitment (Commit / Stretch / blank) | Dependency View (`customfield_11061`) |
| Train **ask** labels | Callout on their ticket for a train | Not the same as Release Commit nature |

**Commitment hygiene (Dependency View Q6 — post-fetch; see `dependency_rule.md`)**:

```
Clean     ⇔  Release Commit ∈ {Commit, Stretch}  AND  real fixVersion (not denylisted)
Their fault ⇔  Commit/Stretch without real fixVersion  OR  valid fixVersion with blank Release Commit
```

UI shows **which signal applied**: via fixVersion · via Release Commit field · both.

---

### 12.4 Release payload buckets (how a release is assembled)

Logical components used across Project Status / dataset / JQL frameworks:

| Bucket | Meaning | Typical discovery |
|--------|---------|-------------------|
| 1. Top-level projects | FEAT/Initiative/… tagged to release (not Cancelled/Backlog) | `fixVersion` + portfolio issue types |
| 2. Portfolio children | Tickets rolling up under those projects | Parent Link wave / `portfolioChildrenOf` |
| 3. Epic children | Implementation under those epics | Epic Link wave / `issuesInEpics` |
| 4. Standalone epics | Epics on release with **Parent Link empty** | Orphaned epic work |
| 5. Direct tickets | Non-portfolio types on fix/affected version with **Epic Link empty** | Loose bugs/tasks |

SoS / Feature Dashboard additionally reason about **FEAT Work vs Standalone Epics vs Direct Tickets** for tier briefings and “not done by CG” callouts.

---

### 12.5 Date fields by hierarchy (Gantt / timeline truth)

| Issue tier | End / gate dates used | Start fallback |
|------------|----------------------|----------------|
| X-FEAT, Capability, Feature, Initiative | Code Complete (`customfield_11067`), Commit Gate (`customfield_35863`), Promotion Gate (`customfield_35864`) | Ticket start date → else release **EC** |
| Epic | **Due Date** | same start fallback |
| Everything else | **Sprint end** (from Sprint API / sprint field) | same; no sprint → blank / unscheduled bar |

**Release-level calendar** (Release Config, not always on the ticket): EC, CCM₁…ₙ, CG₁…ₙ, PG₁…ₙ, GA — with **numbered slip revisions** (prior dotted + reason; new solid).

Maintenance / patch releases: typically **CC + GA only**; interim gates should stay empty.

**Aligned trains** (Dependency View): NDB gates shown beside AOS-family train (Janus / Kronos / Leto) from `dependencyViewConfig.alignedTrains`.

---

### 12.6 Custom fields we rely on (canonical table)

SoT: `apps/delivery-ops/server/config/jiraFieldsConfig.json` (client mirrors via `jiraFields.js`). Do not scatter new hard-coded IDs.

#### Gates & checkpoints

| Field | ID | Depicts | Surfaces |
|-------|-----|---------|----------|
| Code Complete Date | `customfield_11067` | CC / CCM on FEAT-tier | Gantt, SoS, Brief, Email, Feature Dashboard |
| Commit Gate Ready Estimation Date | `customfield_35863` | CG date | same |
| Promotion Gate Ready Estimation Date | `customfield_35864` | PG date | same |
| Test Plan Date | `customfield_11068` | Test plan ready | Hygiene / tables / email |
| FS/DS Done Date | `customfield_13861` | Functional/design spec done | Hygiene / exec summary |
| Status Update Last Updated Date | `customfield_45660` | Freshness of attestation | Stale ≥14d hygiene |

#### Risk triad

| Field | ID | Depicts | Hygiene rule |
|-------|-----|---------|--------------|
| Risk Indicator | `customfield_23560` | Green / Yellow / Red (select) | NotSet → SoS callout (even closed for retros); exclude pure terminals from chase |
| Risk Assessment | `customfield_47780` | Free-text why at risk | **Required when Indicator Yellow/Red** |
| Path to Green | `customfield_55664` | What returns to green | **Required when Indicator Yellow/Red** |

#### Commitment & content

| Field | ID | Depicts |
|-------|-----|---------|
| Release Commit | `customfield_11061` | Commit / ask signal for Dependency View |
| Status Update | `customfield_23073` | Long-form status — **AI input only on SoS; never render raw to users** |
| Executive Status Update | `customfield_38460` | Exec-oriented text |

#### Collateral links (completion hygiene)

| Field | ID | Depicts |
|-------|-----|---------|
| Link to Requirements | `customfield_14463` | Requirements collateral |
| Link to Design Doc | `customfield_14464` | Design collateral |
| Link to Test Plan | `customfield_14465` | Test plan collateral |
| TCMS Link | `customfield_31460` | Test case management |
| Link to CG checklist | `customfield_55662` | Commit Gate checklist |
| Link to PG checklist | `customfield_55663` | Promotion Gate checklist |

Flag missing Requirements / Design / Test Plan when status/phase is Closed / CG Met / PG Met / Shipped (or equivalent). Respect **TEAM_NA** — never flag declared N/A.

#### People

| Field | ID | Depicts | Surfaces |
|-------|-----|---------|----------|
| Test Lead | `customfield_11065` | Primary QA identity on SoS | Prefer over QA Contact |
| QA Contact | `customfield_10860` | Secondary QA identity | Shown if Test Lead empty / different / N/A |
| TPM Owner | `customfield_27764` | TPM | Tables / email / AI |
| PM Owner | `customfield_11260` | Product manager | Emailer project-team CC |
| UX Owner / GUI Lead | `customfield_15968` / `11861` | UX ownership | Tables / email |
| Assignee Manager | `customfield_19262` | Manager of assignee | **SoS-by-Leader rollup** |
| Team Members / Participants | `customfield_51460` / `11960` | Extra people | Email |

#### Relationships & agile

| Field | ID | Depicts |
|-------|-----|---------|
| Parent Link | `customfield_20363` | Epic → FEAT (portfolio) |
| Epic Link | `customfield_10361` | Work → Epic |
| Sprint / Sprints | `customfield_10020` / `10021` | Board sprint(s) for Gantt / email columns |
| Primary Component | `customfield_15160` | Cascading component / sub-component |

#### Quality typing (System-Test Scale)

| Field | ID / key | Depicts |
|-------|----------|---------|
| Regression? | `cf[13260]` | Yes / Yes-build-to-build / Yes-release-to-release / No / EMPTY (DQ) |

---

### 12.7 Status & resolution hygiene (Nutanix ERA quirk)

**Critical dual meaning of “Resolved”:**

| Field | Value | Meaning in Delivery Ops |
|-------|-------|-------------------------|
| `resolution` | Resolved / Fixed / Done / Complete / Approved | **Positive completion family** |
| `status` | Resolved | **TBV — To Be Verified by QA** (dev done; not shipped) |

#### Portfolio hierarchy statuses (Feature / X-FEAT / Initiative)

Backlog → Concept Commit → Ready to Commit → Code Complete Met → Commit Gate Met → **Promotion Gate Met** / Closed / Cancelled.

#### Bug / Improvement / Story (work)

… → **Resolved (TBV)** → **Closed** (true completion) · Reopened.

#### “Is it done?” decision tree (app logic)

```
Cancelled                         → excluded / done-negative
Closed + positive resolution      → shipped
Closed + negative resolution      → done, not shipped
Closed + empty resolution         → treat done (data gap)
Resolved + resolution set         → TBV (awaiting QA)
Resolved + empty resolution       → OPEN (data gap)
else                              → OPEN
```

**Never** put `status=Resolved` in the terminal/shipped set.

Negative resolution examples (not velocity): Won’t Do / Won’t Fix, Cannot Reproduce, Duplicate, Invalid, Incomplete, No Response, …

---

### 12.8 Hygiene signals we surface (what “bad JIRA” looks like)

From `jira-hygiene-and-collaterals.md` + SoS / Component / Dependency usage:

| Signal | When it matters | Depicts |
|--------|-----------------|---------|
| Missing CG / PG date on open FEAT | Mid-flight FEAT | Gate planning incomplete |
| Missing Test Plan / Design / Requirements link | Especially when CG/PG Met / Closed / Shipped | Collateral incomplete |
| Risk Indicator NotSet | SoS callouts; retros even if closed | Risk process gap |
| Risk Assessment / Path to Green empty | Indicator Yellow/Red | Incomplete risk package |
| Status update age ≥ 14d | Open attestation | Stale status |
| Date field moved (last 7d) | SoS callout | Recent slip / change |
| Past gate lagging (FEAT Work) | After gate date | Delivery risk |
| Not done by CG (Standalone / Direct) | After CG | Tier hygiene |
| Parent/child fixVersion mismatch | Component Report `*` | Scope leak / data cleanup |
| Label-only wishlist / clone-only links | Dependency View | No real partner link |
| Partner orphan (train-dep, no wishlist link) | Dependency View | Ask without wishlist anchor |
| affectedVersion ERA Future / Triage | Component / DQ | Bad version hygiene |
| Closed/cancelled project with open descendants | Cleanup section | Stale project |
| `cf[13260]` EMPTY | System-Test Scale | Regression typing gap |
| Chronic deferral (3+ fixVersion kicks) | Deferral framework | Systemic kick pattern |
| TEAM_NA on a field | Everywhere | **Do not** flag as hygiene |

---

### 12.9 Velocity & sprint usage of JIRA

| Stream | JIRA filter idea | Measure |
|--------|------------------|---------|
| Dev velocity | Not portfolio hierarchy, not Test | SP or count |
| QA verification | Bug/Improvement **Closed** in window (QA sign-off) | count × 0.33 (adjusted tickets, **not** SP) |
| QA test tasks | `issueType = Test` | SP or count |

Sprint Performance additionally distinguishes:

- **JIRA Completed say/do** (board Sprint Report Completed list)
- **Dev-finished** = Resolved ∪ Closed at sprint close (same planned denominator) — so QA close lag does not understate Dev finish
- **Chronic carry-over** = planned into **3+** sprints

Sprint calendar (NDB fixture): 3-week Wednesday→Wednesday; names S1, S2… — **sort numerically**.

---

### 12.10 Org attribution (people → leaders)

| Source | Field / config | Depicts |
|--------|----------------|---------|
| Assignee | standard `assignee` | Who owns the ticket |
| Assignee Manager | `customfield_19262` | Manager for rollup |
| Leader map | `ndbLeaderOrgConfig.json` | Anil / Naveen / Jovan / Ashish + nested reports |
| Unmapped | empty/unknown manager | Config gap to drain |

Used by **SoS by Leader** — not a JIRA native hierarchy; a Delivery Ops overlay on Assignee Manager.

---

### 12.11 What “good JIRA hygiene” means for users of this tool

For FEAT / Initiative owners:

1. Parent Link / Epic Link wired so children roll into the right release payload.  
2. Gate dates (CC/CG/PG) filled on open FEATs; slips recorded with reasons in Release Config / ticket history.  
3. Risk Indicator set; if Yellow/Red → Assessment + Path to Green filled.  
4. Status Update kept fresh (&lt;14 days) — AI summaries consume it.  
5. Collateral links (Requirements / Design / Test Plan) present by CG/PG.  
6. Cross-team work: Mode **Dependency** (`blocks`/`is blocked by`) and/or Mode **Partnership** (hierarchy) — plus train ask / wishlist labels per `dependency_rule.md`.  
7. Partner commitment: real fixVersion **and** Release Commit in {Commit, Stretch} — not labels alone.  
8. Never leave Regression? empty on System-Test bugs if ST Scale is used for leadership.

For RMs / TPMs using the app:

- Chase lists (Dependency View Next actions, SoS callouts, Component cleanup) are **hygiene backlog**, not vanity metrics.  
- Every count opens the exact JQL — fix data in JIRA; the dashboard will follow.

---

### 12.12 Diagram — from JIRA object to Delivery Ops view

```
                    ┌─ Parent Link / Epic Link ──► Partnership hierarchy
JIRA Issue ─────────┼─ blocks / is blocked by ──► Mode Dependency (I wait / they wait)
                    ├─ fixVersion / Release Commit ► release membership, commitment nature
                    ├─ labels (train ask, wishlist, ew) ► discovery / RAG / project type
                    ├─ gate date customfields ─────► Gantt rulers, SoS date strip
                    ├─ Risk Indicator + RA + PtG ──► RAG, AI briefings, hygiene
                    ├─ Status Update (+ age) ──────► AI exec summary (not raw UI)
                    ├─ Status + Resolution ────────► TBV vs Closed vs velocity
                    └─ Sprint / Due Date ──────────► lower-tier Gantt bars
```

---

## Source map

| Kind | Location |
|------|----------|
| Routes / nav | `client/src/layout/utils/routeConfig.js`, `Sidebar.js` |
| Page requirements | `docs/pages/*-requirements.md` |
| Agent page briefs | `agent-pack/context/pages/*.md` |
| Dependency rules SoT | `agent-pack/context/domain/dependency_rule.md` |
| Domain (deps JQL) | `agent-pack/context/domain/cross-team-dependencies.md` |
| Domain (hygiene) | `agent-pack/context/domain/jira-hygiene-and-collaterals.md` |
| Domain (workflows) | `agent-pack/context/domain/jira-workflows-and-resolutions.md` |
| Domain (gates) | `agent-pack/context/domain/release-gates.md` |
| Domain (deferral) | `agent-pack/context/domain/deferral-tracking.md` |
| Domain (velocity) | `agent-pack/context/domain/velocity-and-sprints.md` |
| Domain (leader org) | `agent-pack/context/domain/leader-org.md` |
| Field SoT | `server/config/jiraFieldsConfig.json` |
| Dataset hierarchy | `agent-pack/skills/release-dataset-sync/SKILL.md` |

---

*Exec-slide source. Short deck: §1–§3 + §5 + §10. JIRA deep dive: §12. Per-page: §8.*
