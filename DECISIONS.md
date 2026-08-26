# Decision Log — Portfolio Delivery Ops

A chronological record of product/architecture decisions made with the
Portfolio Manager (Namratha). Every entry is a **locked** decision; reversing
one requires explicit re-litigation in chat. Use IDs (`D1`, `D2`, …) to
reference decisions from other docs.

---

## Round 0 — Consolidation foundation (already executed)

| ID | Decision | Status |
|---|---|---|
| D0.1 | Consolidate 17 legacy projects into one monorepo at `~/NDB-Ops-Tools/ndb-delivery-ops/` | done |
| D0.2 | Tier-B projects (7) become MCP tools, not standalone apps | done |
| D0.3 | Tier-D projects (8) are archived only, not migrated | done |
| D0.4 | Old project folders deleted; tarballs kept in `~/NDB-Ops-Tools/_archive/` | done |

---

## Round 1 — Product strategy (locked this session)

### D1 — Platform is product-agnostic

**Statement.** The platform is not "an NDB tool." It is a delivery-ops platform
that supports any product. NDB is one tenant; DataLens, NCM, and future
products are equally valid.

**Implications.**
- Rename `ndb-delivery-ops` → `portfolio-delivery-ops` (see D2)
- Every NDB-specific string in code becomes a config lookup
- `teamBoardConfig.json` is a multi-team registry (D43); NDB is one entry, not the only one
- Audience definitions reference "the active product's Team Executive", not "NDB Team Executive"
- MCP tools take `productId` as input
- Agents load product context at session start

**Scope intentionally excluded.** Full multi-tenancy with separate orgs / auth
domains. We do **product-aware config** (D5), not SaaS-grade tenancy.

### D2 — Rename to `portfolio-delivery-ops`

**Statement.** Repo, root directory, and product name become
`portfolio-delivery-ops`. The web app may still be called `delivery-ops`
under `apps/`.

**Implications.**
- `~/NDB-Ops-Tools/ndb-delivery-ops/` → `~/NDB-Ops-Tools/portfolio-delivery-ops/`
- `package.json` `name` field updated
- Internal references across READMEs, scripts, mcp.json updated
- Git remote re-set (deferred until rename session)

**Deferred to.** A dedicated rename session — the rename touches many files
and we don't want to do it mid-feature.

### D3 — Five connectors are first-class

**Statement.** The platform integrates with five external systems via
dedicated connector modules in `shared/connectors/`:

1. **JIRA** — issues, sprints, boards, dates
2. **Confluence** — pages, templates, storage XML
3. **GitHub** — commits, PRs, repos, CI/CD signals
4. **Slack** — read channels, post messages, DM agent
5. **Email** — send digests; potentially read inbox for status pings

**Implications.**
- Each connector is **one TS module**, single source of truth
- No more 2 Confluence clients (one Python, one JS) — consolidate
- GitHub connector extracted out of the existing `leadershipCommitReport.ts`
- Slack + Email are new builds (Phase B in `ARCHITECTURE.md` rollout)
- New connector category goes through the same auth/retry/error patterns

### D4 — Team Executive is a primary agent user, not just a report consumer

**Statement.** The Engineering Team Executive uses the platform **directly** via natural
language. They do not write JQL. They do not click through menus. They ask
plain-language questions ("how's NDB-2.11?") and expect back an **executive
dashboard** of 3–5 charts.

**Implications.**
- Team Executive becomes an agent user (was: report recipient only)
- New Layer-3 service: `chartService` — renders RAG-over-time, predictability,
  top-risks-by-owner, scope-creep, etc., as inline images/SVG
- New Layer-3 service: `nlpQueryService` — natural language → tool-call plan
- The Ops Assistant agent gains "Team Executive mode" — different presenter, different
  density, charts-first per `audience.md`
- The Team Executive exec dashboard composition: agent runs 3–5 service calls in parallel,
  collects chart data, composes layout (Anthropic's *parallelization* pattern)

**Specific Team Executive exec dashboard view (locked).** 3–5 charts:
- RAG over time
- Top risks by owner
- Predictability (say vs do)
- Scope creep
- (+ one optional headline narrative)

### D5 — Product-aware config, not full multi-tenancy

**Statement.** Configure which products a user can see via per-user product
list. Don't build separate auth domains, separate databases, or org
boundaries until a non-NDB organisation actually signs up.

**Implications.**
- One auth realm (JIRA PAT)
- Per-user `activeProducts: [ndb, datalens, ...]`
- Data is filtered by product list at the service layer
- Agents and reports respect the active product set

### D6 — Tab visibility, default landing, and role lens (revised 2026-05-19)

**Statement.** Three distinct concepts; the original D6 conflated them.

**(a) Tab visibility — admin-only filter, nothing else.**
- Admin tabs (user mgmt, team config, system settings) are gated by admin role.
- Every other tab is visible to every user, regardless of specialist role.
- A Team Executive can navigate to Date Mover if they want; they just won't by default.

**(b) Default landing page — per-role UX default (not a filter).**
- Team Executive / Director → Ops Assistant chat (D4: Team Executive is agent-first)
- Portfolio Manager / Admin → Ops Assistant chat + Release Versions
- TPM → Release Versions
- RM → Sync Hub (Phase E rebuild) / Release Versions
- FEAT Manager → Release Versions filtered to their FEAT
- EM / Team Manager → My Team Profile
- IC → My Tickets
- QA Lead → Sprint Insights
- Architect → Release Timeline
- This is a UX default. The user can navigate anywhere else freely.

**(c) Role lens (preview-as-X) — universal, available to every user.**
- Every page that emits audience-sensitive output has a lens dropdown in the header.
- A user clicks "preview as Team Executive" to re-render the current page in `vp` density
  (chart-first, RAG-first, citation-first, no JQL inline per `audience.md`).
- Useful for: Team Executives spot-checking what their report will look like; the
  Portfolio Manager drafting an EM-facing artefact; TPMs previewing their
  weekly status as the Team Executive will read it.
- Default lens = the user's primary role.

**Implications.**
- The existing `client/src/auth/constants/permissions.js` `TAB_PERMISSIONS`
  mechanism only filters admin tabs — non-admin tabs need no permission check.
- The `Sidebar.js` `visibleItems` filter applies the admin gate only.
- Default-landing is a user-preference value (per-role default, overridable).
- The role lens dropdown is a header-level component on every audience-sensitive page.
- Mutating actions (cascade rename, bulk date move) are gated by separate
  **action-level authorization**, NOT tab visibility — see open D26.

**What this is NOT.**
- It is NOT role-based nav filtering for specialist roles. Everyone sees
  every (non-admin) tab.
- It is NOT a security boundary. Tab visibility is a UX convenience; data
  access is enforced by the JIRA PAT's permissions at the connector layer.

### D7 — Agent surface = web chat embedded in delivery-ops

**Statement.** The Ops Assistant agent's primary user-facing surface is a
**web chat panel inside the delivery-ops React app**, not Cursor and not
Slack (for now).

**Implications.**
- New React component: persistent chat panel (sidebar or modal)
- Streaming responses, message history per session
- Charts/tables embedded inline in chat answers
- Cursor IDE chat continues to work for development
- Slack bot deferred (later round, when web chat proves out)

### D8 — Reactive load is the dominant design driver

**Statement.** Portfolio Manager's week is **70%+ reactive** — responding to
pings from Team Executive, RMs, TPMs, EMs. The platform's primary value is reducing this
load by making the agent self-service to others (so they ping the agent, not
the human).

**Implications.**
- Web chat must support **non-Portfolio-Manager users** with the same agent
- Agent must adopt audience tone automatically (caller's role drives presenter)
- Quality of agent answers is more important than dashboard polish
- "Time saved per day for the Portfolio Manager" is the headline KPI

### D9 — Team-Executive Report is the single most-hated artifact

**Statement.** Among recurring artifacts, the Team-Executive Report is the one
the Portfolio Manager would most like to never hand-produce again. It's the
priority candidate for a deterministic **workflow** (vs an agent).

**Implications.**
- `.cursor/workflows/vp-executive-report.md` is the highest-value workflow
- Output formats (locked in later sub-decision): Markdown + email HTML +
  Confluence storage XML (pushable as a page directly)
- Reuses `statusService`, `predictabilityService`, `chartService`
- Triggered from a button in delivery-ops AND from the agent

---

## Round 2 — Team Executive persona deep-dive (locked this session)

### D10 — Dual trust model for Team Executive-facing agent answers

**Statement.** Different Team Executives have different tolerance for AI output. The
platform must support **both** workflows simultaneously:

- **Draft mode** — agent produces output → Portfolio Manager reviews →
  forwards/publishes to Team Executive
- **Direct mode** — agent answers Team Executive directly, with citations on every claim

**Implications.**
- Every numerical or status claim in agent output must include a citation:
  JIRA ticket key, query, or data source link
- Confidence indicator on every assertion (high / medium / low) — Team Executive knows
  when to push back
- "Escalate to Portfolio Manager" button on any agent response in Team Executive-lens
- Audit log of which mode was used per Team Executive per question (helps tune trust)
- Citation-first design is a global rule (not Team Executive-only) — promote to a rule
  in `.cursor/rules/citation-first-output.mdc`

### D11 — Pages fetch live; Sync Hub is not a product surface

**Statement.** Pages hit JIRA on load, scoped to the selected team's `baseFilter`.
The Sync Hub UI was removed. Empty disk is not a dead end.

**Implications.**
- Version dropdowns list **unreleased** versions from
  `GET /rest/api/2/project/{team.projectKey}/versions` (one call). Choose
  team → that team's `projectKey` (e.g. ENG) → unreleased versions.
  Missing `projectKey` is HTTP 400; never silently fall back to another
  team. Ticket queries still AND `team.baseFilter`.
- Project Status, Release Brief / Retrospective, SoS, and chat grounding
  fetch live. SoS may fall back to disk only on HTTP 429, keyed by the
  selected team id (never another team's cache).
- Client in-memory TTL is 5 minutes. **Refresh** busts that TTL and re-hits
  the same live endpoints — it does not call `/api/release-dataset/refresh-now`
  or trigger a product sync.
- `/sync-hub` redirects to Project Status. No sidebar item. No page reads
  syncMeta or a disk bundle. Server sync endpoints may remain unused.

**Implications (legacy cache).**
- Caching layer remains on `statusService` / `predictabilityService` for
  derived views
- Cache key includes `(productId, releaseName, audience)` — `productId` is
  the selected team id, never a silent default of another team
- Charts in `chartService` invalidate when underlying data refreshes

### D12 — Team Executive default landing = all active releases (per active product set)

**Statement.** When the Team Executive lands in chat without a prompt, the Ops Assistant
greets them with a summary of **all currently-active releases** for their
active products, RAG roll-up across them.

**Implications.**
- "Active release" = needs precise definition (see open D-question below)
- Team Executive lens default render:
  - Summary line: "Showing 3 active releases — 1 green, 1 amber, 1 red"
  - One card per release with RAG + 1-sentence headline + click-through
  - Below: the 3–5 charts from D4 aggregated across releases (predictability,
    top risks by owner, scope creep)
- "Refresh now" (D11) sits in the header
- Product picker (D1, D5) controls which products' releases get aggregated

---

### D13 — "Active release" = explicit tag, set by Portfolio Manager

**Statement.** A release is "active" iff the Portfolio Manager has explicitly
marked it active in release config. No auto-detection from gate dates or
ticket activity. Manual but precise.

**Implications.**
- New field in release config: `status: planning | active | shipped | archived`
- Default for newly-created releases: `planning`
- Migration: existing releases need to be re-tagged (likely a one-time UI
  pass by Portfolio Manager)
- Release Setup / Release Config UI gets a status toggle per release
- All "give me active releases" queries (Team Executive landing, dashboards, weekly
  status email) read from this single field
- `statusService` exposes `getActiveReleases(productId)` as the canonical
  filter

### D14 — Team Executive cadence is per-Team Executive, not platform-wide

**Statement.** Different Team Executives check the platform at different cadences —
daily, weekly, or only when something escalates. The platform does not
assume a cadence.

**Implications.**
- No mandatory daily digest, no forced weekly cron
- **Per-user notification preferences**: each Team Executive (or any user) can opt into:
  - Daily digest email (default: off)
  - Weekly digest email (default: off)
  - Alert on RAG-status change (default: off)
  - Alert on predictability drop (default: off)
- The agent and dashboards are "always there when needed"; they don't push
- This makes Email and Slack connectors (D3) *opt-in proactive channels*

---

### D15 — Team Executive answer protocol (the compound question + risk-register answer + always-clarify)

**Statement.** Every Team Executive question is effectively the same compound question:
**"When are we landing a release?"** *and* **"What's blocking us?"** — even
when only one half is voiced. The agent always answers **both halves** and
always asks a clarifying question first if scope is ambiguous.

**The locked protocol for the Ops Assistant agent in Team Executive lens.**

```
1. Receive Team Executive question.
2. If scope is ambiguous (no release named):
     ASK ("Which release? Active right now: NDB-2.11 (amber), NDB-3.0 (green), …")
   Else proceed.
3. In parallel (Anthropic *parallelization* pattern):
     A. predictabilityService.predictLanding(release)  → date + confidence + chart
     B. statusService.topBlockers(release)            → ranked risk list w/ owners + mitigation
4. Render in Team Executive lens (risk-register format, NOT 3-bullet summary):
     - Headline: release name + RAG + landing-date-with-confidence
     - Risk register: every high-impact risk, each with:
         · what
         · owner
         · expected resolution date
         · mitigation status
         · impact on landing date
     - Supporting chart: landing-date confidence band + risk burndown
5. Cite every claim with a JIRA key or query (per D10 citation-first).
6. Offer drill-in: "Want me to dig into [risk X]?"
```

**D15a — compound question.** "When are we landing?" + "what's blocking us?"
are inseparable. Agent answers both even if only one is asked.

**D15b — answer shape.** Risk-register format. NOT "1 headline + 2 bullets."
The list is as long as the risks demand — leadership wants exhaustiveness
on high-impact items, not artificial compression.

**D15c — clarifying questions.** Agent always asks scope before answering.
Builds trust; prevents the wrong-release embarrassment.

**D15d — chat vs. email digest are the same protocol, different renderers.**
The 6-step protocol above produces one canonical answer object. Three
rendering targets share it:

| Surface | Trigger | Renderer |
|---|---|---|
| Team Executive-in-chat | Team Executive types in the chat panel | inline HTML in chat (charts as SVG, citations as JIRA links) |
| Team Executive-in-email-digest | scheduled cron (opt-in per Team Executive, D14) | inline-CSS HTML email, max 800px, citations as full URLs |
| Team Executive-in-Confluence-page | "Publish to Confluence" button or weekly workflow | Confluence storage XML (after width cleanup, per existing skill) |

Same content. Three renderers. Solves the format-conversion repetitive task
(D8) at the protocol level: the canonical answer is built once, never re-authored.

**Implications.**
- Becomes a `.cursor/skills/team-exec-status-answer/SKILL.md` so the protocol is
  reproducible across sessions
- `topBlockers` is a new method on `statusService` — ranks by `impact ×
  uncertainty × proximity-to-RTM`
- The chart `chartService` must emit is "landing-date confidence + risk
  burndown" — design this as one of the canonical chart types
- Drill-in (step 6) implies the agent maintains conversation memory per
  session so "dig into risk X" can resolve which X
- Every status email and Team Executive report must use the same answer shape — no two
  formats for the same content

---

## Round 4 — TPM persona + Agent design (locked this session)

### D16 — Agent design: orchestrator-workers (Anthropic pattern)

**Statement.** The agent layer follows Anthropic's **orchestrator-workers**
pattern:

- **One user-facing orchestrator**: `.cursor/agents/ops-assistant.md`. This is
  what every user (Portfolio Manager, Team Executive, RM, TPM, EM, FEAT, IC) interacts with.
- **N specialist sub-agents** internal to the orchestrator, each deep on one
  persona or task. Sub-agents are not directly addressable by users; the
  orchestrator delegates.

**Specialist sub-agents (initial set).**
- `team-exec-specialist` — Team Executive protocol (D15: compound question, risk register,
  citation-first, parallel calls, drill-in)
- `tpm-specialist` — weekly status, cross-team dependencies, triage flow
- `rm-specialist` — release readiness, cascade renames, gate dates
- `triage-specialist` — bug categorisation, ownership proposals
- `confluence-publisher-specialist` — bulk page creation, template apply,
  width cleanup
- `dependency-tracker-specialist` — cross-team dependency model (TBD; see open D)

**Implications.**
- Delete: existing `.cursor/agents/tpm-assistant.md` + `rm-assistant.md`
  (their content migrates into specialist sub-agents + skills)
- Create: `.cursor/agents/ops-assistant.md` (orchestrator)
- Each specialist lives in `.cursor/agents/specialists/<name>.md` with a
  tight scope
- The orchestrator decides delegation; user never picks a specialist by name
- Skills (`.cursor/skills/`) are the "how" — sub-agents reference skills
  rather than re-implementing protocols
- Aligned with Anthropic guidance: "Start with one agent + tools. Add
  multi-agent only when the single-agent is insufficient." Sub-agents are
  the *next* tier, not the default.

### D17 — Weekly status email = 3-tier hybrid, broad leadership audience

**Statement.** The weekly status email (TPM's most-hated artifact, same as
Team Executive report is to Portfolio Manager) has a fixed 3-tier structure:

1. **Top — Release-level**: per-release RAG + landing-date + 1-line "why" for each active release.
2. **Middle — Team-level**: per-team weekly delta (what shipped, what's at risk, what's blocked).
3. **Bottom — FEAT-level callouts**: standout features whose status changed this week, each as a paragraph with citations.

**Audience**: Team Executive + Directors + EMs + principal engineers + other TPMs. Each
tier of the email serves a different segment — Team Executives read the top, EMs read
the middle for their team, FEAT owners check the bottom for callouts.

**Implications.**
- New skill: `.cursor/skills/weekly-status-email/SKILL.md`
- Service calls (in parallel):
  - `statusService.releaseRagByActive(productIds)` for the top tier
  - `statusService.teamWeeklyDelta(teams)` for the middle tier
  - `statusService.featCallouts(features, sinceWeek)` for the bottom tier
- Renderer: one HTML email (inline CSS, max 800px), reusable as Confluence
  storage XML (per D15d's multi-renderer pattern)
- Schedulable as a cron job (Mondays, opt-in via D14 user prefs) — sent
  automatically OR previewed and approved by the Portfolio Manager first
- Each callout in the bottom tier cites the underlying JIRA ticket(s) per
  D10 citation-first

---

### D18 — Cross-team dependencies are inconsistently tracked today; canonicalise to JIRA

**Statement.** Today dependencies are scattered across JIRA links, Confluence
tables, spreadsheets, and Slack pings. The platform standardises on **JIRA
`blocks`/`is blocked by` links as the canonical source**, while reading
from the other places to surface untracked dependencies.

**Implications.**
- New feature: **Dependency Map** page (`domains/planning/DependencyMap`)
  showing the JIRA dependency graph for active releases — team-to-team and
  ticket-to-ticket views
- New service: `dependencyService` (Layer 3) — reads JIRA `issuelinks` of
  type `Blocks`/`is blocked by`, models them as a graph, computes critical
  paths and team-to-team blocker counts
- Agent skill: `dependency-walk` — given a ticket, traverse upstream
  blockers and report them
- "Audit dependencies" workflow: periodically scan Confluence pages and
  Slack for dependency mentions not yet in JIRA, prompt the Portfolio
  Manager to formalise
- Service is product-agnostic (D1) — works the same way for DataLens, NCM, etc.
- Maps onto Anthropic's "Augmented LLM" pattern: the agent's tools include
  `dependencyService.upstreamOf(ticket)` and `dependencyService.teamGraph(release)`

---

### D19 — Triage has four flavours; the 4th is novel

**Statement.** Triage on NDB means **four** distinct activities:

1. **Bug triage** — new defects need owner / priority / component / severity / fix-in-this-release-or-defer.
2. **Crisis triage** — P0 / blocker / exec-escalation: immediate ownership and response coordination.
3. **Stale-ticket sweep** — tickets idle for N weeks; re-prioritise, reassign, or close.
4. **Pending-response chase** (NEW) — track requests that need a *response* and aren't getting one. Two main subtypes:
   - **Dependency responses** — team X asked team Y for something; Y hasn't answered yet.
   - **Deferral responses** — a ticket / feature was proposed for deferral; the relevant owner hasn't confirmed.

**Implications.**
- 4 distinct triage skills under `.cursor/skills/`: `bug-triage`, `crisis-triage`, `stale-ticket-sweep`, `pending-response-chase`
- New service: `pendingResponseService` — tracks asks (from JIRA comments / labels / custom fields) without a corresponding reply, ages them, surfaces stuck ones
- This is the agent's job par excellence: scan the corpus daily, surface what's stuck, prompt the Portfolio Manager to chase. Saves time on the "all of the above" repetitive load (D8).
- **Open**: exact mechanism for "did someone respond?" — JIRA comment threads? Label changes? Status changes? Need to confirm before building the skill. (Captured as **D24**.)

### D20 — TPM Confluence pages incl. data-driven Release Gates Checklist

**Statement.** Besides the weekly status (D17), the TPM produces:

1. **Release plan page** — scope, dates, team commitments per release.
2. **Cross-team dependency / risk page** — living document updated weekly.
3. **Release Gates Checklist** — currently a static Confluence checklist; needs to become a **data-driven UI in delivery-ops that writes back to JIRA**.

**Implications.**
- Release plan + dependency page are renderers over data services (D17 pattern):
  - `releaseService.plan(release)` → renderable as Confluence storage XML
  - `dependencyService.teamGraph(release)` → renderable as Confluence table
- **Release Gates Checklist is a real new feature**, not a markdown task. Out
  of scope for Phase A (AI layer). Scheduled as **Phase F** in the build:
  - Each gate (EC, CC, Commit Gate, Promotion Gate, RTM) has structured checklist items
  - Items checked off in delivery-ops UI
  - Each check writes back to JIRA (custom field, ticket comment, or both — TBD)
  - Gate completion percentage feeds into release RAG roll-up
  - Currently lives in Confluence; the rebuild canonicalises it in the tool
- This feature crosses RM + TPM personas — RMs own the gates, TPMs ensure their programs progress through them.

### TPM persona — closed

TPM is now defined enough to build. Locked decisions covering TPM:
D3 (Confluence connector), D16 (agent design, incl. `tpm-specialist`),
D17 (weekly status email), D18 (cross-team deps), D19 (4 triage flavours),
D20 (Confluence pages). Open detail D24 (pending-response mechanism)
gets resolved when we actually build the `pending-response-chase` skill.

---

## Round 6 — Phase A build plan (next session)

Phase A is the **AI layer rebuild** — all markdown, no React code. Touches:

- `.cursor/agents/ops-assistant.md` — the orchestrator (NEW)
- `.cursor/agents/specialists/team-exec-specialist.md` (NEW)
- `.cursor/agents/specialists/tpm-specialist.md` (NEW, replaces existing `tpm-assistant.md`)
- `.cursor/agents/specialists/rm-specialist.md` (NEW, replaces existing `rm-assistant.md`)
- `.cursor/agents/specialists/triage-specialist.md` (NEW)
- `.cursor/agents/specialists/confluence-publisher-specialist.md` (NEW)
- `.cursor/agents/specialists/dependency-tracker-specialist.md` (NEW)
- `.cursor/skills/team-exec-status-answer/SKILL.md` (NEW — protocol from D15)
- `.cursor/skills/weekly-status-email/SKILL.md` (NEW — protocol from D17)
- `.cursor/skills/bug-triage/SKILL.md` (NEW)
- `.cursor/skills/crisis-triage/SKILL.md` (NEW)
- `.cursor/skills/stale-ticket-sweep/SKILL.md` (NEW)
- `.cursor/skills/pending-response-chase/SKILL.md` (NEW)
- `.cursor/skills/dependency-walk/SKILL.md` (NEW)
- `.cursor/skills/confluence-width-cleanup/SKILL.md` (refresh existing)
- `.cursor/rules/persona-aware-output.mdc` (NEW)
- `.cursor/rules/citation-first-output.mdc` (NEW per D10)
- `.cursor/rules/product-agnostic.mdc` (NEW per D1)
- Existing rules: confirm they're copied into the monorepo (lost when `~/ndb-status-sender/` was deleted)
- `~/.cursor/context/ndb-ops/audience.md` — refactor to be product-agnostic (D1)
- `.cursor/AGENTS.md` — update to point to new structure
- `AGENTS.md` (root) — update persona

**Deferred to later phases** (not Phase A):

- React Sidebar persona-awareness + product picker + role lens (Phase B)
- Embedded chat panel in delivery-ops (Phase C)
- Connectors consolidation into `shared/connectors/` (Phase D)
- Streamlit → React rewrite of release-analytics (Phase E)
- Streamlit → React rewrite of tpm-confluence-tools + Release Gates Checklist (Phase F)
- New MCP-backed pages: Capacity Planner, Bin-Packing, Story Points page, Date Mover, Say vs Do (Phase G)
- Gap features (Sprint Planner, Status Page Auto-Publisher, etc.) (Phase H)

## Round 7 — Tab visibility revision + action authorization (2026-05-19)

D6 was revised this round (see updated text above).

### D25 — Default-landing-page is a user preference (not hard-coded)

**Statement.** Each role has a sensible default landing page (per D6(b)),
but the **specific value is stored as a user preference**, overridable per
user. A new Team Executive can change theirs from "Ops Assistant chat" to "Team Executive Exec
Dashboard" if they prefer.

**Implications.**
- Add `defaultLandingPage` field to user prefs (stored alongside
  notification prefs from D14).
- Auth context loads user's `defaultLandingPage`; redirects from `/` to it
  on first navigation per session.
- Per-role *fallback* (used if user has no explicit preference) comes from
  a `ROLE_DEFAULT_LANDING` constant on the client.

---

## Round 8 — Consolidation porting (2026-05-19)

### D33 — Drop "Team Executive" terminology; use "team-exec" (Team Executive)

**Statement.** Across the platform, every "Team Executive" / "Team Executives" / "Team Executive" /
"Team Executive Report" reference is replaced with **team-exec** (display: "Team
Executive"). No backward-compatible aliases; the old term is dropped.

**Rationale.**

1. **D1 alignment.** The platform is product-agnostic and tenant-aware.
   Different orgs and different products use different titles for the
   same role — Team Executive (Nutanix), Director, Sr Director, GM, Head of
   Engineering, etc. Baking "Team Executive" into audience IDs, skill names, and
   report prefixes leaks Nutanix-isms into a platform that explicitly
   serves DataLens, NCM, and future products.
2. **Role > title.** What this audience actually is: *the leader the
   team rolls up to*. They consume the team-executive view because
   they're accountable for the team's delivery, regardless of org chart
   level. "Team Executive" names the role neutrally.
3. **Avoid recurrence.** The Portfolio Manager flagged this directly:
   "I hate that I said Team Executive" — the term carried implicit assumptions
   about a Nutanix-specific persona that the platform must not encode.

**Locked replacements (deterministic).**

| Old | New |
|---|---|
| audience id `vp` | `team-exec` |
| display name "Team Executive" | "Team Executive" |
| `team-exec-specialist` | `team-exec-specialist` |
| `team-exec-status-answer` skill | `team-exec-status-answer` |
| `team-exec-release-report` skill | `team-exec-release-report` |
| `predictive-team-exec-analytics` skill | `predictive-team-exec-analytics` |
| `quarterly-team-exec-report` workflow | `quarterly-team-exec-report` |
| report file prefix `TeamExec-` | `TeamExec-` |
| code identifiers `TeamExecReport*`, `TeamExecSpecialist`, etc. | `TeamExecReport*`, `TeamExecSpecialist`, etc. |

**Scope of the rename.**

- All active files in the monorepo: `.cursor/`, `shared/`, `mcp-server/`,
  `apps/delivery-ops/` (source + docs).
- User-level skills at `~/.cursor/skills/` are renamed too — they are
  read by the project agent and must match.
- **NOT** renamed: historical reports in `reports/CrystalBall-Enhanced-Team Executive-Report-*.md`
  and similar (per `documentation-consistency.mdc`: "files already in
  `reports/`: leave them"). New reports use the `TeamExec-` prefix.
- **NOT** renamed: legacy code in `apps/delivery-ops/crystalball-i/` and
  similar archived sub-trees — that code is on the retirement list and
  doesn't shape the consolidated platform's surface.

**Implications.**

- `audience.md` at `~/.cursor/context/` updates its role catalog.
- Any external doc / chat / email that previously used `vp-*` URLs
  (e.g. `/team-exec-status`) needs a redirect — handled at the route level if
  we ever published any such URL, otherwise nothing to do.
- DECISIONS.md entries D4, D9, D10–D15, D17 etc. that used "Team Executive" in
  their prose are not retroactively edited (decision text is immutable
  for audit trail); when those decisions are *applied*, the new term
  is what surfaces.

### D30 — Date mover requires a reason, audited to Confluence

**Statement.** When an authorised user moves a release gate date (Code
Complete, Commit Gate, Promotion Gate — `customfield_11067 / 35863 /
35864` on FEAT / X-FEAT / Capability tickets) through the consolidated
app, the app MUST:

1. Require a free-text **reason** before the mutation is sent to JIRA.
   The form rejects empty / whitespace-only reasons.
2. Apply the JIRA field update.
3. Append a structured row to a Confluence audit page in the same
   request lifecycle. The row carries: timestamp, actor (display name +
   ldap), ticket key, field, old → new value, reason.
4. If the Confluence write fails, the JIRA mutation MUST be rolled
   back (or a follow-up retry queued) — the audit trail is not optional.

**Authorisation.** RM and TPM roles can move dates. Other roles (Team Executive,
IC, etc.) see history but the move action is hidden / 403'd.

**Scope locked now.**
- Fields in scope: Code Complete (`customfield_11067`), Commit Gate
  (`customfield_35863`), Promotion Gate (`customfield_35864`). Other
  fields the legacy app tracked (Test plan, FS/DS, `customfield_45660`)
  remain *view-only* in the new app unless re-promoted later.
- Audit-trail medium: **Confluence**, not a JIRA ticket comment, not a
  JIRA custom field. JIRA's per-field changelog continues to exist for
  raw before/after; Confluence is the *human-readable narrative log*.

**Deferred to port time.**
- Exact Confluence target — dedicated "Date Change Log" page per
  release vs. section appended to the existing release status page vs.
  shared per-product log — will be settled when implementation lands
  against the actual execution page format (Portfolio Manager will
  point at the page in chat at that time).
- Whether the same audit also fires for moves made directly in JIRA
  (outside this app) is a future question; first cut is "only moves
  through our app".

**Why this matters.** Today the reason for a date slip lives in
people's heads or in random chat threads. The release goes from "we
slipped by 2 weeks" to "we slipped by 2 weeks because vendor X missed
delivery and we redirected a sprint to security CVE-2026-1234" only
when the right human is awake. Capturing the reason inline makes the
delivery narrative reconstructable from the artifact itself, which is
exactly the workflow product this platform is building toward.

**Implications for the port (capability #10 in `CONSOLIDATION.md`).**
- `dateMoverService.ts` takes `{ ticketKey, fieldId, newValue, reason,
  actor }` and orchestrates JIRA + Confluence in one atomic-ish step.
- The Confluence connector (`shared/connectors/confluenceConnector.ts`)
  is now a hard dependency of #10 — it can no longer be deferred to
  "port #12 only". It must land before or alongside #10.
- The legacy `ndb-date-mover/backend/ai_summarizer.py` (344 LOC) is
  retained as a port: it can pre-fill / suggest the reason from
  surrounding context (recent status updates, comments, etc.), but the
  user still has to confirm or override.

---

### D34 — productService is the only source of `projectKey`, `labelPrefix`, `releasePrefix`, `sprintCalendar`

**Decision:** Every D1-shaped input the new TypeScript services demand
(`projectKey`, `labelPrefix`, `productPrefix` / `releasePrefix`,
`sprintCalendar`) is resolved exclusively through `productService` reading
`teamBoardConfig.json`. No service may accept these as untyped strings from
a route handler that hardcodes them; the route must resolve via
`getProductService().getXxx(productId)` and pass the result through.

**Defaults (when a product config omits a field):**
- `labelPrefix` → `product.id` (lowercase, e.g. `ndb`)
- `releasePrefix` → `${product.name}-` (e.g. `NDB-`, `DataLens-`)
- `sprintCalendar` → **no default; throws.** Sprint cadence varies per
  team and a silent fallback would corrupt every sprint-derived metric.

**Why this came up:** I built a clean D1-shaped pipeline (`payloadJqlService`,
`releaseDatasetService`, `releaseClassificationService`, `sprintsService`,
`releaseInsightsService`) where every service requires these inputs, but no
production caller was supplying them. The contract existed on paper, not in
code. This decision closes the API+config side of that gap. Wiring at every
call site remains an open follow-up (see D35).

**Verified by** `shared/scripts/smoke-product-service-d1.mjs` — productService
supplies all four knobs for NDB end-to-end through `buildEngineeringPayloadJql`,
`buildReleasePayloadJql`, `getWishlistQuery`, `buildAllTicketsJql`,
`classifyRelease`, `enumerateSprints`.

---

### D36 — "Payload" splits into Engineering Payload and Release Payload

**Decision:** There are two distinct payload concepts. They are first-class,
named separately, and queried by separate functions. Neither replaces the
other.

**Engineering Payload** — the 5-bucket union scoped to a single
engineering JIRA project (e.g. `project = ERA AND (5 buckets)` for NDB).
This is what the legacy chatbot computed and what current completion-%
numbers everyone trusts are derived from. Audience: EM, IC, sprint
burndown, dev velocity. Function: `buildEngineeringPayloadJql`.

**Release Payload** — the 5-bucket union with **no project filter**.
Captures every ticket carrying the release fixVersion regardless of which
contributing team's project it lives in (ERA dev work + TECHPUBS docs +
FEAT capability + PM intake + anything else). Audience: TPM, RM, Team
Exec, "are we actually shipping?" dashboards. Function:
`buildReleasePayloadJql`. **NEW concept — did not exist in legacy.**

**Why the split exists:** NDB is a product / portfolio (D5), not a single
team. The NDB engineering team uses ERA; tech pubs use TECHPUBS; PM uses
PM; feature intake uses FEAT. All those teams routinely set
`fixVersion = NDB-2.11` on their own tickets when contributing to the
release. The legacy code's `project = ERA AND ...` wrapper silently
dropped non-ERA contributors from the count. That was fine for an
"engineering view" but wrong as "the release payload."

**Pollution guard:** None today. We trust `fixVersion`. If an unrelated
project mis-tags `NDB-2.11`, that's surfaced as a JIRA hygiene issue at
the data-quality layer, not silently filtered out by the query. Revisit
if pollution becomes a real problem.

**Migration impact:**
- `buildPayloadJql` renamed to `buildEngineeringPayloadJql`. The only
  callers were `shared/scripts/smoke-product-service-d1.mjs` and the
  re-export in `shared/src/index.ts`; both updated atomically.
- **2026-06-13 update:** `releaseDatasetService.fetchReleaseData` now
  **defaults to Release Payload** (no project scope). Pass `projectKey`
  to `fetchBucket` options to get the Engineering Payload. `syncReleaseDataset`
  no longer passes `projectKey` to the bucket fetches (only uses it for the
  cache key and the `getProjectVersions` call for Group 3). Existing reports
  and routes that haven't yet been wired to `fetchReleaseData` are unaffected.
- **5-bucket → 6-bucket:** `epics_of_projects` (Bucket 1B) added to both
  `payloadJqlService.PAYLOAD_BUCKET_KEYS` and the fetch plan. This closes
  the gap where Epics under Feature/Initiative roots were missing from the
  flat dump, causing `Portfolio Parent Key` lookups to return sparse results.
- **Group 2 (moved-out) and Group 3 (long-term funded)** are now fetched
  alongside Group 1 in every sync. Their tickets appear in the flat cache
  with distinct `Components` tags (`moved_out`, `long_term_projects`, etc.).
  `payloadJqlService` exports builders for all three groups.
- All existing reports and routes continue to show the same numbers they
  did before. The Release Payload metrics will be labeled explicitly when
  the first dashboard consumer lands.

**Verified by** the smoke test's new assertions: `buildEngineeringPayloadJql`
starts with `project = ERA AND`; `buildReleasePayloadJql` does NOT contain
`project = ` but does anchor by `fixVersion = NDB-2.11`.

---

### D37 — Bin-packing app ships as a static mount, not a React port

**Decision:** The legacy `ndb-projects-bin-packing/` standalone JS app
(7,000 LOC across HTML/JS/CSS, including an 800-LOC bin-packing algorithm
with resource pools, dev-blocker dependencies, and 3-tier display) is
brought into the monorepo as a static asset folder at
`apps/bin-packing/`, served by the existing delivery-ops Express server
at the URL prefix `/bin-packing/*`. A sidebar entry in the delivery-ops
React client provides same-tab navigation plus a `↗` new-tab
affordance.

**What this is NOT:** A React rewrite. The algorithm core was not
extracted to `shared/services/binPackingService.ts`. The HTML pages
(`index.html`, `upload.html`, `dependencies.html`, `bottom-up.html`,
`allocation.html`) are still vanilla DOM + ES modules in the browser.
The existing MCP tool `bin_pack_projects` remains a simplified
First-Fit-Decreasing algorithm and does NOT yet match the legacy app's
behavior (no resource pools, no dependency awareness).

**Why this shape:** User asked for "urgent + port" with "running today"
+ "CSV upload only" (no JIRA wiring). The legacy app is mature, the
algorithm has years of tuning, the CSV-driven flow is the actual
workflow. A React port is days of work that produces no functional
improvement; the static mount delivers exactly what the user uses today
inside the new monorepo, with one navigation click instead of a separate
deployment.

**Trade-offs accepted:**
- Two visual styles — bin-packing app has its own design language,
  delivery-ops has another. The sidebar entry **opens the app in a new
  browser tab** (target=_blank) so the two UIs never have to share a
  viewport. Tried in-place navigation first; user-tested poorly because
  in dev the React server (8888) and backend (6001) are different ports
  and CRA's string-proxy doesn't forward HTML requests. New tab sidesteps
  the dev/prod port asymmetry entirely.
- The sidebar link's URL is computed dynamically: in dev (port 8888 React
  server) it points at `${hostname}:${REACT_APP_BACKEND_PORT || 6001}/bin-packing/`;
  in prod (same origin) it's a relative `/bin-packing/`. Helper
  `getBinPackingUrl()` in `Sidebar.js`. No hardcoded localhost per
  `no-localhost.mdc` — hostname read from `window.location`.
- No auth on `/bin-packing/*` — matches legacy behavior (was on internal
  port 3847, no auth). Revisit when delivery-ops gets exposed beyond
  internal network.
- MCP tool drift — `bin_pack_projects` does NOT call the real algorithm;
  it's a simpler FFD. Anyone using MCP for capacity planning gets
  different (worse) output than the web app. Acceptable for now because
  the web app is the canonical surface.

**Migration path when a real port is needed:**
1. Extract `js/bin-packing.js` + `js/ranking.js` + `js/sizing.js` +
   `js/resource-groups.js` (~1,500 LOC) into
   `shared/services/binPackingService.ts` with full types and tests.
2. Rewrite the MCP tool to call the real service.
3. Build a React surface in `apps/delivery-ops/client/src/components/BinPacking/`.
4. Keep the static mount available behind a feature flag during
   migration; cut over when the React surface reaches parity.
5. Decommission `apps/bin-packing/` once the React surface is the only
   consumer.

**Verified by:** server route mount at `apps/delivery-ops/server/index.js`
serving from `path.join(__dirname, '..', '..', 'bin-packing')`; sidebar
entry in `Sidebar.js` rendering a native `<a>` (not react-router `<Link>`)
because the target is outside the React app boundary.

---

### D38 — Agent pack is portable; Cursor is one adapter

**Statement.** Identity, skills, workflows, constitutional rules, and
the memory schema live in `agent-pack/`. That pack is the source of
truth for every runtime. Cursor (`.cursor/` symlinks), the delivery-ops
web agent, MCP, and any future host are **adapters**. The product must
be liftable to another agent host without rewriting SOPs.

**Implications.**
- Never add a new skill, identity, or workflow only under `.cursor/`
- Any host loads the pack via `loadAgentPack()` in
  `@portfolio-delivery-ops/shared` (or `AGENT_PACK_ROOT`)
- Tools stay MCP + Layer 3 services — already host-agnostic
- Builder-only Cursor rules (`minimal-architecture`, API/page doc
  gates, Gerrit push) stay in `.cursor/rules/` and do **not** ship
  with a lifted agent
- A new host = a new file under `agent-pack/adapters/`, not a fork
  of skills
- Capability type (`deterministic` / `generative` / `agent` /
  `agentic`) and tool class (`read` / `draft` / `mutate`) are
  declared in `agent-pack/manifest.json`

**What this is NOT.** Replacing Cursor as a builder. Developers may
still edit markdown in the IDE. The IDE is not allowed to be the only
place those files can run.

---

### D39 — Web chat is an agent runtime, not a mailbox

**Statement.** `POST /api/ai/chat` must run `shared/agentRuntime`
(`runAgentTurn`): load the portable pack (D38), perceive from the
release snapshot, then loop tools until a final answer. Wave 1 shipped
read-only tools; Wave 4 (D42) runs `draft` and pauses `mutate` in HITL.
Stuffing the snapshot into a system prompt and calling
`chatCompletion` once is not the product.

**Implications.**
- Exec-summary and release-briefing stay one-shot `chatCompletion`
  (transcript + computed health). Do not add chat SOPs to `naiService`
- Wave 1 tools are `toolClass === 'read'` only. Wave 4 (D42) runs
  `draft` and pauses `mutate` in HITL; D26 still blocks execute
- Response keeps `reply` / `scope` / `snapshotMeta` and adds `trace`
  + `runtime: "agent"`
- `nlpQueryService` (D4) remains unbuilt; the tool loop is the planner

**What this is NOT.** Opening write-back to JIRA from chat. That stays
blocked until D26 (HITL inbox is D42).

---

### D40 — One JIRA connector; Data Center PAT Bearer only

**Statement.** MCP and Express call `shared/connectors/jiraConnector`.
There is no MCP-private JIRA client. Authentication is **JIRA Data
Center Personal Access Token** sent as `Authorization: Bearer <pat>`.
Not Cloud email+API-token Basic auth, not OAuth, not `cloudId`.

**Implications.**
- `mcp-server` tools import `JiraConnector` from
  `@portfolio-delivery-ops/shared`
- Express CJS hosts use `server/utils/jiraClient.js` (`getJira`,
  `searchPages`) onto the same connector. `jiraService.js` is
  risk-indicator UI only — no axios, no Bearer headers
- `move_jira_dates` is a thin adapter over `DateMoverService` (D30) —
  same mandatory reason + Confluence audit as
  `POST /api/date-mover/move-gate-date`
- `Env.jiraPat` is always a Data Center PAT, whether it came from
  process env (MCP / scheduler) or the user's Bearer header (web)

**What this is NOT.** Changing how users log into JIRA Cloud. This
deployment is Data Center.

---

### D41 — Domain derives live in shared, not in pages or fat routes

**Statement.** Pages, hooks, and Express routes fetch and render.
`shared/` owns derive / aggregate so MCP, web chat, and Express call
the same functions. Wave 3 lifts:

| Capability | Shared home | App leftover |
|---|---|---|
| Exec-summary signals (`deriveSignals`) | `shared/src/domain/execSummarySignals.cjs` | CJS shim in `server/utils/execSummarySignals.js` |
| Exec-summary analytics | `shared/src/domain/execSummaryAnalytics.cjs` | Route injects `gateDates` + `formatDate` |
| Release intelligence buckets | `shared/src/services/releaseIntelligence.ts` | App service keeps JIRA fetch + existing JQL |
| Sprint health rates | `shared/src/services/sprintMetrics.ts` (+ `.cjs`) | `sprintService` keeps live JIRA I/O |
| Bundle-first page derives | `shared/src/domain/bundleDerive.js` | CRA adapter copy in `client/.../bundleUtils.js` |

**Implications.**
- No new LLM. No JQL edits. Auth stays Data Center PAT Bearer (D40)
- Shared must not import app JSON (`releaseVersionsEmailConfig`);
  callers inject gate dates
- CRA cannot import `@portfolio-delivery-ops/shared` without pulling
  Node connectors — keep a same-export client copy, smoke-checked

**What this is NOT.** The JIRA HTTP consolidation (D40). Write-back
to JIRA (D26).

---

### D42 — Open the door safely: memory, provenance, HITL (Wave 4)

**Statement.** Web chat persists session/user/org memory (pack schema),
writes an append-only provenance row per turn, and pauses `mutate`
tools in a HITL inbox. **D26 stays open:** Approve does **not** execute
a JIRA write (`blocked_d26`). `propose_jira_write` exists so the door
can be seen; it never calls `execute()`.

**Implications.**
- Memory is JSON files under `AGENT_RUNTIME_DIR` (default
  `.cache/agent-runtime`). Not a vector store
- Provenance logs `{tools, dataScopes, replySha256, unknownKeysInReply,
  mode}` — citations stay in the reply; unknown keys are recorded, not
  silently rewritten
- `remember_correction` is `draft` (auto persist preference)
- Candidate D26 (not locked): mutate always RM/TPM by action; Team Exec
  is read + draft only. Do not implement that matrix until D26 closes

**What this is NOT.** Write-back to JIRA from chat. Settling D26.
Model routing (router vs reasoner). Unattended workflow engine.

---

### D43 — Multi-team registry after the app stabilized

**Statement.** The 2026-05-20 NDB-only freeze (`ARCHITECTURE_TARGET.md` v2:
`teamBoardConfig.json` has one entry; ProductService never resolves anything
but NDB) is **lifted**. The app is stable enough to onboard other teams
(Prism-Infra, MSP, future) through Admin. Each team is one object in
`teamBoardConfig.json`. NDB stays the default tenant (`defaultTeamId`).

**Implications.**
- Admin Save must persist the new team to `teamBoardConfig.json` on the
  running server’s disk — not only into the browser’s Team dropdown
- Version lists, Project Status, and live JIRA fetches use that team’s
  `baseFilter` / `projectKey`. No silent fallback to NDB
- ProductService already reloads when the file’s mtime changes
- Do not restore the file to an NDB-only template after a successful save

**What this is NOT.** Full SaaS multi-tenancy (still D5). Re-adding the
old DataLens/NCM blocks unless those teams are onboarded again through Admin.

---

## Round 7 — Pending decisions (open)

| ID | Decision needed | Blocked on |
|---|---|---|
| D24 | "Pending-response" detection mechanism — JIRA comments? Labels? Custom fields? | Build-time question for `pending-response-chase` skill |
| D26 | **Action-level authorization** — which actions require which roles? (e.g. cascade rename = RM only? bulk triage = TPM+? admin actions = admin only?) | HITL inbox exists (D42). Do not execute mutate from chat until this closes. |
| D27 | Which legacy projects to permanently cut vs rebuild | Reconfirm cuts from FEATURE_CATALOG.md |
| D28 | First gap to build (post-Phase-A) | Phase H planning |
| D29 | Next role to deep-dive (RM / Director / EM) | After Phase A complete |
| D31 | Exact Confluence target for date-change audit log (per-release page / section on status page / per-product shared log) | Build-time of #10, when PM points at the actual execution page format |
| D32 | Whether date moves made outside our app (directly in JIRA) should also be audited to Confluence (via webhook or scheduled diff) | After #10 ships first cut |
| D35 | Wiring every D1 consumer through `productService` — today `/api/jira/issue-breakdown` omits `projectKey` to match legacy behavior, and `releaseDatasetService` has no production caller yet. Will be addressed call-site by call-site as new consumers land. Tracked in `CONSOLIDATION.md`. | Resolve as each new consumer is added (Phase 3 of #1b, then #2 forward) |

---

## Principles (derived from the decisions above)

These are non-negotiables baked into all future design:

1. **One feature, one place** — services are shared; pages, MCP tools, and
   agents are thin consumers (from `ARCHITECTURE.md`).
2. **Product-agnostic by design** — never assume NDB. Every product-specific
   value reads from config (D1).
3. **Audience-aware output** — every artefact declares an audience and respects
   the corresponding style (D4, D6, `audience.md`).
4. **Agent-first for reactive load** — when in doubt about how a user finds
   information, the answer is "they ask the agent" (D7, D8).
5. **Workflow for recurring artefacts, agent for ad-hoc questions** — strict
   adherence to Anthropic's pattern selection (D9 vs D7).
6. **Single connector per external system** — no parallel implementations (D3).
7. **Role lens is a presenter, not a filter** — never hide capability from a
   user; only re-frame the output (D6).
8. **Agent pack is portable** — cookbook lives in `agent-pack/`; every host
   is an adapter (D38). Do not lock SOPs to Cursor.
