# TPM Agent — Holistic Goals

> **Audience:** Portfolio Manager, Team Executive, Director, TPM, RM, FEAT, Team Lead, IC
> **Status:** Draft — demo 19 Nov 2026 | Product-agnostic per D1 · 5 connectors per D3 · orchestrator-workers per D16

---

## 1. Vision / Problem Statement

- **Today:** TPMs chase KPIs by hand — JQL tabs, Slack pings, weekly status emails (D17). Things slip.
- **Goal:** One agent that watches KPIs and JIRA hygiene, and nudges the right person at the right time.
- **Two levels of follow-up:**
  - **Release level** — "Is this version clean?"
  - **Overall KPI level** — "Is the product portfolio healthy?"
- **Why an agent (not a dashboard):** Dashboards wait for you to look. An agent comes to you — immediate email when something changes, daily summary so nothing falls through.
- **Why now:** Release Versions page, KPI board, and 5 connectors (D3) already exist. Agent adds the brain.

---

## 2. Personas and Hierarchy — Who Sees What

| Role | Scope | What they see |
|---|---|---|
| **IC (dev / QA / architect)** | Own tickets | My open items, my SLA breaches, my hygiene misses |
| **Team Lead** | Their team | Team's open work + hygiene + team-level KPIs |
| **RM** | One release at a time | All KPIs for that one release — RAG, gates, hygiene, blockers |
| **TPM** | All releases across all teams (cross-team) | All KPIs for all active releases + cross-team blockers + hygiene roll-up |
| **Director** | Entire org / portfolio | All releases + all KPI groups + org roll-up |
| **Sr Dir / VP** | Multi-org | Portfolio roll-up across products (D1: product is config, not code) |

- **Key rule:** RM sees one release at a time; TPM sees all releases across all teams; Director/Sr Dir/VP widen to org → portfolio. Same agent, different scope.
- **Agent knows who you are** (D6 role lens) — same data, different view. No separate builds per role.
- **One agent, many surfaces:** Web chat panel (D7), email digests, future Slack — same orchestrator (D16).

---

## 3. Holistic Goals by Lifecycle Phase

Goals below map to `kpiConfig.json` after we add `lifecyclePhase` grouping. Existing config is flat — no grouping yet.

### Phase A — During Release Execution

- **KPIs in this phase:** P0, P1, open dev work, open test work
- Goals:
  - Every P0/P1 has owner + ETA — no orphan criticals
  - Open dev/test work shrinks every week toward release
  - Blockers surface early, not the week before ship

### Phase B — At Time of Release

- **KPIs in this phase:** Regression, system test, open verification work
- Goals:
  - Regression + system test pass rates tracked per version
  - No ticket marked "ready to ship" with open verification
  - Release-gate checklist (D20) and KPIs agree — one truth

### Phase C — Post Release

- **KPIs in this phase:** Oncalls, CFDs, CFIs
- Goals:
  - CFDs/CFIs triaged fast — filed, assigned, prioritised
  - Oncall load is even — no single team drowning
  - Post-release signal feeds back into next release planning

### Phase D — Overall / Generic (Always On)

- **KPIs in this phase:** SLA (and any cross-cutting metric)
- Goals:
  - SLA breaches flagged before they breach, not after
  - One portfolio view that works for any product (D1: NDB today, DataLens/NCM tomorrow)

### Hygiene Goals (Cut Across All Phases)

- Every ticket in a release has a fixVersion
- Due dates are set and not stale
- Status matches reality — no "In Progress" untouched for 3 weeks
- Sprint field populated where needed (`customfield_10360` per teamBoardConfig)

### Trigger Goals (When Agent Speaks Up)

- **Immediate email** when:
  - CFD or CFI filed or changed
  - fixVersion added / removed / moved
  - Due date changed or cleared
- **Daily digest** — "Your focus list for the day" per person/role (opt-in by scope)
- Triggers use `jiraConnector` (D3) change detection — one place, one webhook/poll.

### Digest Goals

- Daily focus list is short — top 5–10 items, not a dump
- Grouped by action: "needs your attention" → "FYI" → "healthy"
- IC view: what's on my plate by category (regression / system test / verification / execution) + hygiene + how to fix
- Respects role scope (IC sees theirs, Director sees org)

### Reward System (IC motivation)

- Superstar = clean plate + hygiene 100% + no past-due → "You are awesome!" email
- Otherwise → nudge email with what to fix
- Counts kept: # awesome vs # naughty per person → leaderboard / reward system

---

## 4. Job-to-Be-Done per Goal

| Goal | Job-to-be-done |
|---|---|
| **P0/P1 clean** | As a TPM, I want every P0/P1 owned and ETA'd so I can report "clean" with confidence. |
| **Dev/test burn-down** | As a Team Lead, I want to see open work shrinking so I can call out risk early. |
| **Regression / system test** | As an RM, I want a green/red per version so I can gate the release. |
| **Open verification closed** | As a QA Lead, I want zero "ship-ready" tickets with open verification. |
| **CFDs/CFIs triaged** | As a TPM, I want every post-release defect assigned in 24h. |
| **Oncall fairness** | As a Director, I want oncall load balanced so no team burns out. |
| **SLA not breached** | As any IC, I want a heads-up before my ticket goes out-of-SLA. |
| **Hygiene clean** | As a TPM, I want fixVersion + due date correct without nagging each team. |
| **Immediate alert** | As an owner, I want to know the moment my ticket's CFD/CFI/fixVersion/due date changes. |
| **Daily focus list** | As a Director/TPM, I want one email each morning with what needs me — not 50 JIRA tabs. |
| **My plate + hygiene** | As an engineer, I want to see what's on my plate by category + hygiene + how to fix. |
| **Reward** | As an IC, I want an "awesome!" when I'm clean and a nudge when I'm not — with counts. |

---

## 5. Demo Scope — Today vs Next

### Show Today (19 Nov 2026)

- **Versions:** NDB-2.12, NDB-3.0, NDB-2.11.1 — plus NDB-2.11.1.1 (slipped to Mon 23 Nov 2026, OS image issue, Route C via release-gate-ops skill)
- What we demo:
  - Release Versions page with 4 KPI lifecycle groups (mocked grouping if config change not yet merged)
  - One hygiene check (e.g., fixVersion coverage) on a demo version
  - One trigger example (e.g., CFD filed → email preview)
  - Daily focus list mock for TPM and Director roles (same data, different scope)
  - Product picker proves D1 — NDB vs DataLens use same groups

### Next Iteration (Not Today)

- Live `kpiConfig.json` with `lifecyclePhase` on every entry + `groupOrder`
- Real JIRA webhook/poll for triggers (CFD, CFI, fixVersion, due date)
- Actual email sends via `emailConnector` (D3) — today we show previews
- Per-person daily digest with real JQL (needs open questions resolved)
- Org roll-up page for Sr Dir / VP
- Chat: "What moved yesterday?" → agent answers from KPI + hygiene data

---

## 6. Open Questions — Need JQL / Field Mapping

- **CFD / CFI definition:** Which JIRA field/type marks a CFD vs CFI? Label? Issue type? Component? Need JQL that the team already trusts.
- **Oncalls KPI:** What JQL or filter ID backs "Oncalls"? Is it a label, assignee group, or separate project?
- **Regression / system test:** Filter IDs or custom flags? Same filters across products or per-product mapping?
- **Open verification:** What status/field means "needs verification"? `status = "Ready for QA"`? Custom field?
- **SLA field:** Which field holds SLA? `duedate`? SLA plugin field? Need JQL for "out of SLA" per product.
- **fixVersion vs team board:** fixVersion is release-level (JIRA versions). Confirm no team uses labels/components as shadow fixVersions — affects trigger accuracy.
- **Due date field:** Standard `duedate` or custom? Any per-issue-type override (per `jira-date-hierarchy` rule)?
- **P0/P1:** Is priority the source of truth? Confirm `Blocker - P0` / `Critical - P1` names are stable across all products (D1).
- **Trigger scope:** Immediate email for every CFD/CFI/fixVersion/due date change — or only for tickets in tracked releases? Need to avoid noise.
- **Daily digest membership:** Who gets which digest? By JIRA watcher/assignee or explicit roster in `teamBoardConfig`?
- **NDB-2.11.1.1:** Confirm slip reason copy for demo ("OS image issue — new target Mon 23 Nov 2026") — who approves that wording?

---

*Refs: D1 product-agnostic · D3 five connectors · D16 orchestrator-workers · D17 weekly status · D20 release gates · ARCHITECTURE.md 5-layer model*
