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
- `teamBoardConfig.json` is per-user, not global
- Audience definitions reference "the active product's VP", not "NDB VP"
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

### D4 — VP is a primary agent user, not just a report consumer

**Statement.** The Engineering VP uses the platform **directly** via natural
language. They do not write JQL. They do not click through menus. They ask
plain-language questions ("how's NDB-2.11?") and expect back an **executive
dashboard** of 3–5 charts.

**Implications.**
- VP becomes an agent user (was: report recipient only)
- New Layer-3 service: `chartService` — renders RAG-over-time, predictability,
  top-risks-by-owner, scope-creep, etc., as inline images/SVG
- New Layer-3 service: `nlpQueryService` — natural language → tool-call plan
- The Ops Assistant agent gains "VP mode" — different presenter, different
  density, charts-first per `audience.md`
- The VP exec dashboard composition: agent runs 3–5 service calls in parallel,
  collects chart data, composes layout (Anthropic's *parallelization* pattern)

**Specific VP exec dashboard view (locked).** 3–5 charts:
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

### D6 — Role lens is a presenter, not a filter

**Statement.** The "switch role" affordance does **not** hide pages from
the user. It re-renders the same data using a different audience preset
(VP / TPM / RM / FEAT / EM / IC). Same data, different presenter.

**Implications.**
- Backed by `audience.md` style definitions (per-persona density, link policy,
  RAG-first vs detail-first)
- Available on any page that produces audience-sensitive output
- Default lens = the user's primary role (for the Portfolio Manager, "all")
- A "preview as VP" / "preview as EM" toggle is the main use case

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
pings from VP, RMs, TPMs, EMs. The platform's primary value is reducing this
load by making the agent self-service to others (so they ping the agent, not
the human).

**Implications.**
- Web chat must support **non-Portfolio-Manager users** with the same agent
- Agent must adopt audience tone automatically (caller's role drives presenter)
- Quality of agent answers is more important than dashboard polish
- "Time saved per day for the Portfolio Manager" is the headline KPI

### D9 — VP Executive Report is the single most-hated artifact

**Statement.** Among recurring artifacts, the VP Executive Report is the one
the Portfolio Manager would most like to never hand-produce again. It's the
priority candidate for a deterministic **workflow** (vs an agent).

**Implications.**
- `.cursor/workflows/vp-executive-report.md` is the highest-value workflow
- Output formats (locked in later sub-decision): Markdown + email HTML +
  Confluence storage XML (pushable as a page directly)
- Reuses `statusService`, `predictabilityService`, `chartService`
- Triggered from a button in delivery-ops AND from the agent

---

## Round 2 — VP persona deep-dive (locked this session)

### D10 — Dual trust model for VP-facing agent answers

**Statement.** Different VPs have different tolerance for AI output. The
platform must support **both** workflows simultaneously:

- **Draft mode** — agent produces output → Portfolio Manager reviews →
  forwards/publishes to VP
- **Direct mode** — agent answers VP directly, with citations on every claim

**Implications.**
- Every numerical or status claim in agent output must include a citation:
  JIRA ticket key, query, or data source link
- Confidence indicator on every assertion (high / medium / low) — VP knows
  when to push back
- "Escalate to Portfolio Manager" button on any agent response in VP-lens
- Audit log of which mode was used per VP per question (helps tune trust)
- Citation-first design is a global rule (not VP-only) — promote to a rule
  in `.cursor/rules/citation-first-output.mdc`

### D11 — Dashboard freshness = Sync Hub pattern

**Statement.** Data is served from cache; the user clicks "Refresh now" when
they need real-time. Optional background sync warms the cache on a schedule.

**Implications.**
- Reuse the `Sync_Hub.py` pattern from the archived `release-sprint-analysis`
  (live progress UI during refresh, per-component status table, ETA)
- Caching layer added to `statusService` and `predictabilityService`
- Cache key includes `(productId, releaseName, audience)` — distinct caches
  per persona's view
- Charts in `chartService` invalidate when underlying data refreshes
- UI shows "Last refreshed N min ago" with the Refresh button next to it

### D12 — VP default landing = all active releases (per active product set)

**Statement.** When the VP lands in chat without a prompt, the Ops Assistant
greets them with a summary of **all currently-active releases** for their
active products, RAG roll-up across them.

**Implications.**
- "Active release" = needs precise definition (see open D-question below)
- VP lens default render:
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
- All "give me active releases" queries (VP landing, dashboards, weekly
  status email) read from this single field
- `statusService` exposes `getActiveReleases(productId)` as the canonical
  filter

### D14 — VP cadence is per-VP, not platform-wide

**Statement.** Different VPs check the platform at different cadences —
daily, weekly, or only when something escalates. The platform does not
assume a cadence.

**Implications.**
- No mandatory daily digest, no forced weekly cron
- **Per-user notification preferences**: each VP (or any user) can opt into:
  - Daily digest email (default: off)
  - Weekly digest email (default: off)
  - Alert on RAG-status change (default: off)
  - Alert on predictability drop (default: off)
- The agent and dashboards are "always there when needed"; they don't push
- This makes Email and Slack connectors (D3) *opt-in proactive channels*

---

### D15 — VP answer protocol (the compound question + risk-register answer + always-clarify)

**Statement.** Every VP question is effectively the same compound question:
**"When are we landing a release?"** *and* **"What's blocking us?"** — even
when only one half is voiced. The agent always answers **both halves** and
always asks a clarifying question first if scope is ambiguous.

**The locked protocol for the Ops Assistant agent in VP lens.**

```
1. Receive VP question.
2. If scope is ambiguous (no release named):
     ASK ("Which release? Active right now: NDB-2.11 (amber), NDB-3.0 (green), …")
   Else proceed.
3. In parallel (Anthropic *parallelization* pattern):
     A. predictabilityService.predictLanding(release)  → date + confidence + chart
     B. statusService.topBlockers(release)            → ranked risk list w/ owners + mitigation
4. Render in VP lens (risk-register format, NOT 3-bullet summary):
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
| VP-in-chat | VP types in the chat panel | inline HTML in chat (charts as SVG, citations as JIRA links) |
| VP-in-email-digest | scheduled cron (opt-in per VP, D14) | inline-CSS HTML email, max 800px, citations as full URLs |
| VP-in-Confluence-page | "Publish to Confluence" button or weekly workflow | Confluence storage XML (after width cleanup, per existing skill) |

Same content. Three renderers. Solves the format-conversion repetitive task
(D8) at the protocol level: the canonical answer is built once, never re-authored.

**Implications.**
- Becomes a `.cursor/skills/vp-status-answer/SKILL.md` so the protocol is
  reproducible across sessions
- `topBlockers` is a new method on `statusService` — ranks by `impact ×
  uncertainty × proximity-to-RTM`
- The chart `chartService` must emit is "landing-date confidence + risk
  burndown" — design this as one of the canonical chart types
- Drill-in (step 6) implies the agent maintains conversation memory per
  session so "dig into risk X" can resolve which X
- Every status email and VP report must use the same answer shape — no two
  formats for the same content

---

## Round 4 — TPM persona + Agent design (locked this session)

### D16 — Agent design: orchestrator-workers (Anthropic pattern)

**Statement.** The agent layer follows Anthropic's **orchestrator-workers**
pattern:

- **One user-facing orchestrator**: `.cursor/agents/ops-assistant.md`. This is
  what every user (Portfolio Manager, VP, RM, TPM, EM, FEAT, IC) interacts with.
- **N specialist sub-agents** internal to the orchestrator, each deep on one
  persona or task. Sub-agents are not directly addressable by users; the
  orchestrator delegates.

**Specialist sub-agents (initial set).**
- `vp-specialist` — VP protocol (D15: compound question, risk register,
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
VP report is to Portfolio Manager) has a fixed 3-tier structure:

1. **Top — Release-level**: per-release RAG + landing-date + 1-line "why" for each active release.
2. **Middle — Team-level**: per-team weekly delta (what shipped, what's at risk, what's blocked).
3. **Bottom — FEAT-level callouts**: standout features whose status changed this week, each as a paragraph with citations.

**Audience**: VP + Directors + EMs + principal engineers + other TPMs. Each
tier of the email serves a different segment — VPs read the top, EMs read
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
- `.cursor/agents/specialists/vp-specialist.md` (NEW)
- `.cursor/agents/specialists/tpm-specialist.md` (NEW, replaces existing `tpm-assistant.md`)
- `.cursor/agents/specialists/rm-specialist.md` (NEW, replaces existing `rm-assistant.md`)
- `.cursor/agents/specialists/triage-specialist.md` (NEW)
- `.cursor/agents/specialists/confluence-publisher-specialist.md` (NEW)
- `.cursor/agents/specialists/dependency-tracker-specialist.md` (NEW)
- `.cursor/skills/vp-status-answer/SKILL.md` (NEW — protocol from D15)
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

## Round 6 — Pending decisions (open)

| ID | Decision needed | Blocked on |
|---|---|---|
| D24 | "Pending-response" detection mechanism — JIRA comments? Labels? Custom fields? | Build-time question for `pending-response-chase` skill |
| D25 | Which legacy projects to permanently cut vs rebuild | Reconfirm cuts from FEATURE_CATALOG.md |
| D26 | First gap to build (post-Phase-A) | Phase H planning |
| D27 | Next role to deep-dive after Phase A ships (RM / Director / EM) | After Phase A complete |

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
