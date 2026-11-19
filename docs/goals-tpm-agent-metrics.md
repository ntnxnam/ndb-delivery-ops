# Goals & Success Metrics — TPM Agent

> Owner: Goal Development Lead · Date: 2026-11-19 · Audience: `portfolio_mgr` + `tpm`
> Product-agnostic per **D1** — NDB is one example tenant. Every JQL shape below uses
> `productService` / `teamBoardConfig` values, never hard-coded project keys. (D1, D3, D26, D30, D36)

---

## 1. North Star

**One sentence:** Every person who owns work for a release knows what is at risk, what to do next, and who to talk to — without asking the TPM.

**What that means in practice:**

- No one is surprised by a gate slip — they heard it from the agent before the meeting.
- Release status is answerable in one question: "How is <release> doing?" gets RAG + top risks + owners + dates, cited.
- The TPM spends time on judgment (what to escalate, how to replan), not on copy-pasting JIRA lists.

**How we know we hit it:**

- TPM reactive pings down (fewer "what is the status?" DMs).
- Time saved per week for the TPM (self-reported + measured: hours not spent hand-building status).
- Trust: users act on the agent's answer without double-checking in JIRA.

---

## 2. Holistic Goals

Each goal has a measurable target and leading + lagging signals.

### G1 — Release confidence is visible early

- **Target:** By mid-release, landing-date forecast is within 1 sprint of actual GA for 80% of releases.
- **Leading metric:** % of open work with a credible due date / sprint assignment; forecast churn week-to-week.
- **Lagging metric:** Forecast error at GA (predicted GA date vs real GA date).

### G2 — Right work gets attention

- **Target:** P0 / P1 overdue items are acknowledged or re-planned within 1 business day.
- **Leading metric:** Count of unacknowledged P0 / P1 past due date.
- **Lagging metric:** P0 / P1 carry-over into next release; post-release hotfix count tied to known risks.

### G3 — Hygiene stops being manual

- **Target:** Hygiene score >= 95% for every active release, every week. (Definition in §4.)
- **Leading metric:** Hygiene debt count by type (stale, missing fixVersion, no assignee, etc.).
- **Lagging metric:** Hours TPM spends on hygiene follow-ups per week → toward zero.

### G4 — Triggers are instant, digests are read

- **Target:** Immediate triggers fire within SLA (§5); daily digest open rate >= 60%, follow-through >= 40%.
- **Leading metric:** Trigger delivery latency; digest open / click rate.
- **Lagging metric:** Days from trigger to owner action; overdue item age trend.

### G4b — ICs get clarity + motivation (plate + hygiene + reward)

- **Target:** Every IC knows what's on their plate by category, hygiene debt, and exact fix step; superstars get "awesome!" and counts drive a leaderboard.
- **Leading metric:** # awesome vs # naughty emails per person per week; hygiene fix-through rate.
- **Lagging metric:** IC satisfaction ("my digest tells me what to fix"); hygiene score trend per IC.

### G5 — Leaders get roll-ups without extra work

- **Target:** Director / VP roll-up is available on demand and matches the sum of its releases — no manual deck.
- **Leading metric:** Roll-up freshness (hours since last sync).
- **Lagging metric:** Leader satisfaction ("I can answer my boss from this page").

---

## 3. KPI Lifecycle Phases — What "Good" Looks Like

The 4 lifecycle groups (user-confirmed) map to different questions and different JQL.

> Notation: `productScope` = product-aware filter from `productService` (D1, D36). Do not hard-code `project = ERA`.
> `releaseVersion` = e.g. `NDB-2.12`. `activeReleases` = list from `releaseVersionsEmailConfig.releaseGateDates`.
> `baseQuery` / `teamBaseFilter` / `releaseBaseFilter` come from `kpiService` patterns already in the stack.

### Phase A — Post-release: oncalls, CFDs, CFIs

- **Question:** Did we ship cleanly? Are customers seeing issues?
- **Good looks like:**
  - No open CFD / CFI past SLA for the shipped release.
  - Oncall load is tracked and not spiking week-over-week.
- **How we measure:**
  - Open CFD / CFI count for the release (by fixVersion).
  - CFD / CFI age (days since created) vs SLA threshold.
  - Oncall ticket count and trend (week-over-week delta).
- **Sample JQL shape to track:**
  - `productScope AND fixVersion = "<releaseVersion>" AND baseQuery(CFD_or_CFI) AND statusCategory != Done`
  - Age = `now - created`; group by assignee / component for drill-down.
  - Existing services: `cfdcfiService`, `oncallService`.

### Phase B — During release execution: P0, P1, open dev work, open test work

- **Question:** Is the build on track? What dev / test work is still open?
- **Good looks like:**
  - Zero P0 past due; P1 past due is small and shrinking.
  - Open dev work and open test work both burn down week-over-week.
  - Blockers have owners and next steps.
- **How we measure:**
  - Count of open P0 / P1 for the release; count past due date.
  - Open dev work count; open test work count; burn-down slope.
  - Blocker count and average days blocked.
- **Sample JQL shape to track:**
  - P0: `productScope AND fixVersion = "<releaseVersion>" AND priority = "P0" AND statusCategory != Done`
  - Open dev work / open test work: same `fixVersion` + `baseQuery(devWork)` / `baseQuery(testWork)` from `kpiConfig` (team-scoped via `teamBaseFilter`).
  - Past-due slice adds `AND duedate < now()`.

### Phase C — At time of release: regression, system test, open verification work

- **Question:** Can we ship? Is quality gated?
- **Good looks like:**
  - Regression and system-test pass rates meet the gate bar before Commit / Promotion Gate.
  - Open verification work is near zero at GA; no surprise test debt.
- **How we measure:**
  - Regression open count and pass rate; system-test open count and pass rate.
  - Open verification work count for the release; trend to zero by gate date.
  - Gate readiness: % of required test types with status Done by gate date.
- **Sample JQL shape to track:**
  - `productScope AND fixVersion = "<releaseVersion>" AND baseQuery(regression_or_systemTest) AND statusCategory != Done`
  - Verification slice: `baseQuery(openVerificationWork)` for the release.
  - Gate overlay: compare `duedate` / gate date from `releaseGateDates` to open count.

### Phase D — Overall / generic: SLA

- **Question:** Are we meeting our service promises regardless of release phase?
- **Good looks like:**
  - SLA breach count is zero; time-to-first-response and time-to-resolve stay under target.
  - SLA trend is flat or improving quarter-over-quarter.
- **How we measure:**
  - SLA breach count (total and by priority).
  - Median age of SLA-tracked items; % breaching vs % at risk (near threshold).
- **Sample JQL shape to track:**
  - `productScope AND baseQuery(slaKpi) AND statusCategory != Done` plus SLA field filter (e.g. `SLA Breach = true` or `remaining SLA < threshold`).
  - Aggregate across active releases; also show per-release split for drill-down.

> All 4 phases share one rule (D36): active-release queries use Release Payload (cross-project, fixVersion-driven), not just one engineering project. Team-level drill-downs may narrow with `teamBaseFilter`.

---

## 4. Hygiene Goals

### What counts as hygiene debt

- **Stale ticket:** No status change and no comment for N days (default N = 14; P0/P1 use N = 7). Still assigned to someone or marked for current release.
- **Missing fixVersion:** Ticket matches release scope (label, component, or epic link) but has no `fixVersion` set.
- **Missing assignee:** Open ticket for an active release with `assignee is EMPTY`.
- **Wrong status for gate:** Ticket past its gate due date but still in To Do / In Progress with no update.
- **Orphan sub-task:** Sub-task whose parent is Done / Won't Fix but sub-task is still open.
- **Deferred without label:** Ticket moved out of release (fixVersion removed) but not tagged with `<release>-deferred` label.

This list lives in config, not hard-coded. Add types without code change.

### How we measure hygiene

- **Hygiene score:** `100 * (1 - hygieneDebtCount / totalScopedTickets)` per release. Scoped = Release Payload for that release (D36).
- **Hygiene debt by type:** Breakdown so owners know what to fix (stale vs missing fields vs orphans).
- **Hygiene trend:** Week-over-week delta per release.

### Targets

- Active release hygiene score >= 95% every week.
- No P0 / P1 counted as stale (tighter threshold catches them sooner).
- Missing fixVersion count = 0 for active releases (every in-scope ticket is tagged).
- New hygiene debt is flagged within 24 hours of appearing.

### Sample JQL shape

- Stale: `productScope AND fixVersion = "<releaseVersion>" AND statusCategory != Done AND updated < -14d`
- Missing fixVersion: `productScope AND labels in (<release-labels>) AND fixVersion is EMPTY` (product-aware label list from `productService`)
- Missing assignee: `productScope AND fixVersion = "<releaseVersion>" AND assignee is EMPTY AND statusCategory != Done`

> No hygiene service exists yet — this section is the spec for it. It will use the 5 connectors via `jiraConnector` (Bearer PAT only, D40; D3).

---

## 5. Trigger / Digest Goals

### Immediate triggers (event-driven email)

Events that fire an email without waiting for the digest:

- fixVersion added / removed / changed for an active release.
- Due date moved past a gate date.
- CFD / CFI created for a shipped release.
- P0 / blocker status changed.

**Immediacy SLA:**

- Email enqueued within 2 minutes of the JIRA event (measured from JIRA changelog timestamp to send timestamp).
- Email delivered (accepted by mail server) within 5 minutes.
- p95 latency tracked; alert if p95 > 5 min for any hour.

**How we detect (no existing watcher yet):**

- Poll JIRA changelog for active releases on a short interval (e.g. 2 min) and diff `fixVersion` / `duedate` / `status` / `priority`.
- Future: JIRA webhook if available — same SLA, fewer polls. Keep polling as fallback.

### Daily digest — "Your focus list"

- **Sent:** Every morning in the user's local timezone (configurable per user).
- **Contains:** Top P0/P1 past due, hygiene debt assigned to you, pending responses (D24: unreplied JIRA comment threads), gate deadlines in next 7 days.
- **Targets:**
  - Open rate >= 60% (pixel or link-click proxy where pixel is blocked).
  - Follow-through rate >= 40% — recipient acts on at least one item within 1 business day (status change, comment, or explicit dismiss in the digest).
  - Unsubscribe / mute rate < 5% (signal the digest is useful, not noisy).
- **Anti-spam rule:** Same ticket does not appear in the digest more than 3 days in a row without new information — escalate instead of nag.

### How we measure trigger + digest health

- Trigger latency histogram (p50 / p95 / p99).
- Digest open rate, click-through rate, follow-through rate, mute rate.
- "Action lag" — hours from trigger/digest to owner action on the cited ticket.

---

## 6. Hierarchy Goals — Director / VP Roll-Up

Roll-up is not just "wider filter." Aggregation changes.

### What changes at each level

| Level | Scope | What the metric means |
|---|---|---|
| **RM** | One release at a time | Release-level RAG, gates, hygiene, blockers for that single release (deep dive). |
| **TPM** | All releases across all teams (cross-team) | All KPIs across active releases + cross-team blockers + hygiene roll-up; ticket-level drill-downs per release. |
| **Team** | One team, one product | Team-scoped counts: my open work, P0 past due, hygiene debt. |
| **Director** | All active releases for their org | Release-level roll-up: RAG per release, worst gate at risk, cross-release hygiene. |
| **VP / Sr Dir** | All active releases across products (D1: product-agnostic) | Portfolio view: how many releases are red/amber/green, total P0 exposure, capacity vs commitment. |

### Aggregation rules (not just filter widening)

- **Counts become rates:** Director sees "3 of 5 active releases have overdue P0" not just "12 overdue P0 tickets."
- **Worst-case surfaces first:** Red releases sort to top; within a release, P0 before P1, hygiene debt grouped by type.
- **Trend replaces snapshot:** VP view shows week-over-week delta (are we getting better or worse?) not just today's count.
- **Ownership stays attached:** Every rolled-up number drills to the owning team / assignee — no anonymous totals.
- **Gate dates are release-aware:** Roll-up aligns each release to its own gate calendar from `releaseGateDates` (D30 audit trail applies per release).

### Targets

- Director / VP can answer "which release needs my attention this week?" in under 30 seconds from the roll-up.
- Roll-up freshness: data no older than 1 hour when viewed.
- Drill-down from roll-up to ticket list in one click (metric-click dual action: count → in-app drill, Open in JIRA → exact JQL).

---

## 7. Anti-Goals — What the Agent Will NOT Do

- **Will not auto-close tickets.** The agent surfaces stale / orphan candidates; a human closes them. No silent status changes.
- **Will not auto-move tickets between releases.** Suggests `fixVersion` fixes; human confirms. Respects **D26 mutate gate** — TPM / Portfolio Manager approves writes; Team Executive and Director are read + draft only.
- **Will not auto-change gate dates.** The agent may propose a slip with a reason draft, but the move requires RM / TPM authorization and a mandatory reason audited to Confluence per **D30** (JIRA write + Confluence row, rollback on audit failure).
- **Will not invent data.** Every number cites its JQL or source. No hallucinated counts. Citation-first per D10.
- **Will not hard-code product strings.** No `project = ERA` or `NDB-` literals in code. All product-specific values resolve via `productService` / `teamBoardConfig` per **D1** and **D36** (Engineering vs Release Payload distinction preserved).
- **Will not bypass connectors.** All JIRA reads go through `jiraConnector` (Bearer PAT only, **D40**); all Confluence reads/writes through `confluenceConnector`. No ad-hoc axios calls per **D3**.
- **Will not spam.** Triggers are throttled per ticket; digests deduplicate; muted users stay muted. Frequency caps are config, not code.
- **Will not hide behind averages.** Roll-ups always expose the worst release / worst team — no averaging away a red.

---

## 8. Demo vs Production Milestones

### Today (demo baseline) — 2026-11-19

Use for the demo. No new services required.

- **Releases in scope:** NDB-2.12, NDB-3.0, NDB-2.11.1 (and NDB-2.11.1.1 slipped to 2026-11-23 — OS image issue, RM-approved, already in `releaseGateDates`).
- **What we show:**
  - Live KPI pulse for each lifecycle phase using existing `kpiService` (`searchCount` / `search`, `baseQuery` + `teamBaseFilter` / `releaseBaseFilter`).
  - CFD/CFI and oncall slices via existing `cfdcfiService` / `oncallService`.
  - Gate calendar from `releaseVersionsEmailConfig.releaseGateDates` rendered alongside open counts (no new watcher needed — read live on page load).
  - Hygiene preview: manual JQL run for stale / missing fixVersion counts (no hygiene service yet — show the query, not a score).
- **Success for demo:** Audience can see, for each active release, open counts per phase + gate dates + one hygiene debt number, with JQL links to verify in JIRA.

### Next 2 sprints (production milestones)

#### Sprint 1 — Measure and trigger

- Ship hygiene service (definition in §4, scorer + debt-by-type, 95% target). No auto-mutate — read + report only.
- Ship trigger watcher (poll JIRA changelog for active releases; email within 2 min SLA for fixVersion / due-date changes). Measure p50/p95.
- Wire hygiene score and trigger latency into an internal dashboard (even a simple page) so we track our own metrics from day one.
- Product-agnostic wiring: new code resolves product via `productService` (D1); queries default to Release Payload (D36).

#### Sprint 2 — Digest and roll-up

- Ship daily "your focus list" digest (top P0/P1 past due + hygiene debt + pending responses per D24). Track open rate and follow-through.
- Ship director / VP roll-up aggregation (rates, worst-case-first, week-over-week trend, drill-down). Not just a wider filter.
- Gate-date move flow respects D30 (mandatory reason + Confluence audit + rollback on failure) and D26 (only RM / Portfolio Manager may execute).
- Hygiene auto-suggest (draft fixVersion / assignee suggestions) behind HITL — propose, never execute without approval (D26).

### How we know we are ready to call it production

- Hygiene score >= 95% for all active releases for 2 consecutive weeks.
- Trigger p95 < 5 min sustained for 1 week.
- Digest open rate >= 50% in first 2 weeks (ramp to 60%).
- Director can run their weekly review from the roll-up alone (no side spreadsheet).

---

## Reference — Decisions cited

| Decision | Why it matters here |
|---|---|
| **D1** — Product-agnostic | No hard-coded `NDB`, `ERA`, `NDB-` strings. Every filter resolves via `productService`. |
| **D3** — Five connectors | JIRA / Confluence / GitHub / Slack / Email each have one connector. New hygiene + trigger code uses `jiraConnector` and `emailConnector`, not ad-hoc clients. |
| **D26** — Action-level authorization | Agent proposes writes; only TPM / RM / Portfolio Manager may execute. Team Executive and Director are read + draft only. |
| **D30** — Date mover requires reason + Confluence audit | Gate-date changes carry mandatory reason, Confluence row, and rollback on audit failure. Template for all future mutate flows. |
| **D36** — Engineering vs Release Payload | Active-release metrics use Release Payload (cross-project, fixVersion-driven). Team drill-downs may narrow with `teamBaseFilter`. |

---

*Keep this doc under ~400 lines. Simple words, bullets, one feature one place. Update targets after each sprint review.*
