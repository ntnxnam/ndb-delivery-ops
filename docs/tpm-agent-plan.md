# TPM Agent — Delivery Plan

> Owner: PM Lead + Goal Dev Lead | Date: 2026-11-19 | Status: In discovery — recording answers
> Demo: NDB-2.12 / NDB-3.0 / NDB-2.11.1 + NDB-2.11.1.1 (GA 23 Nov 2026, OS image slip) — config already updated per release-gate-ops Route C

## Vision (1 line)

Every person who owns work for a release knows what is at risk, what to do next, and who to talk to — without asking the TPM.

## Scope — 4 lifecycle phases + cross-cutting

- **Post-release:** oncalls, CFDs, CFIs
- **During execution:** P0, P1, E-W projects (labels ndb-ew/global-ew/nutanix-ew — scoped by release base filter, super important when in that release), open dev work, open test work
- **At release time:** regression, system test, open verification work
- **Overall:** SLA
- **Always on:** JIRA hygiene (fixVersion, due date, stale, sprint field, status) + triggers (CFD/CFI/fixVersion/due date → immediate email + daily "your focus list")

## Roles — who sees what

- IC → own tickets
- Team Lead → their team
- RM → one release at a time
- TPM → all releases across all teams (cross-team)
- Director → entire org / portfolio
- Sr Dir / VP → multi-org portfolio (D1 product-agnostic)

## How it runs

- Poll changelog every 2 min for active releases → diff fixVersion/duedate/priority/status/CFD/CFI → immediate email (enqueue ≤2 min, deliver ≤5 min)
- Daily 7am cron → "your focus list" digest via emailConnector (D3) — per role, top 5–10 items
- To vs CC: To = assignee or QA contact (direct owner), CC = manager (watching) — role not inferable, anyone can be assignee
- Deferral starts after PG: only tickets moved after Promotion Gate need deferral justification — pending ones go in digest
- Reward system: track awesome vs naughty emails per person (superstar if clean plate + hygiene 100%) — leaderboard
- On-demand chat via agentRuntime (D39) — same brain, citations (D10)

## Delivery milestones

### Today — demo baseline (no new service)

- Tabs: NDB-2.12 | NDB-3.0 | NDB-2.11.1 (2.11.1.1 GA 23 Nov in config)
- 4 cards per tab (lifecycle groups) from existing kpiService — add lifecyclePhase tag to kpiConfig.json (flat today)
- Gate strip from releaseVersionsEmailConfig.releaseGateDates
- Trigger + digest as previews (flip flag to send real email)

### Sprint 1 — measure + trigger

- Ship hygiene service (6 debt types, hygiene score ≥95% target, §4 of goals doc)
- Ship trigger watcher (poll changelog, measure p50/p95)
- Wire internal metrics dashboard

### Sprint 2 — digest + roll-up

- Ship daily digest + director/VP roll-up (counts→rates, worst-first, trend)
- Gate-date move respects D30 (reason + Confluence audit) and D26 (RM/PM may execute)

## Open questions — recording answers (1/11)

Answer log lives at docs/tpm-agent-answers.md — now 12 Qs (Q12: E-W projects).

| # | Question | Status | Answer (JQL / field / decision) |
|---|----------|--------|----------------------------------|
| 1 | CFD / CFI definition | ✅ Saved filters, categorise by filter name on the fly | Saved filters — Top + Non-Top, resolve name via API |
| 2 | Oncalls KPI — what JQL or filter ID backs oncalls? | ✅ Saved filter | Saved filter |
| 3 | Regression / system test — filter IDs or custom flags? Same across products? | ✅ Saved filters | Saved filters |
| 4 | Open verification — what status/field means needs verification? | ✅ JIRA status | JIRA status |
| 5 | SLA field — which field holds SLA? duedate or plugin? Need "out of SLA" JQL | ✅ Saved filter | Saved filter |
| 6 | fixVersion vs team board — any shadow fixVersions via labels/components? | ✅ Only fixVersion | fixVersion is source of truth |
| 7 | Due date field — standard duedate or custom per issue type? | ✅ Standard duedate | duedate |
| 8 | P0/P1 — is priority the source (Blocker - P0 / Critical - P1)? Stable across products? | ✅ priority is truth | priority Blocker-P0/Critical-P1 |
| 9 | Trigger scope — every change or only tracked releases? | ✅ Category-scoped, DAILY not immediate | Category where CFDs tracked; duedate/fixVersion without deferral → daily email |
| 10 | Daily digest membership — by watcher/assignee or explicit roster? | ✅ To=assignee/QA, CC=manager + deferral after PG | To if assignee/QA contact, CC if manager (anyone can be assignee); deferral pending only after PG of live release, included in digest |
| 11 | NDB-2.11.1.1 slip wording — "OS image issue — new target Mon 23 Nov 2026" — approved? | ✅ Approved | OS image issue — patch slip, RM-approved |

## Decisions in play

D1 product-agnostic · D3 five connectors · D16 orchestrator-workers · D17 weekly status · D20 gates · D26 action auth · D30 reason+Confluence audit · D36 Release Payload · D40 Bearer PAT only

## Next after answers

After 11 answers → tag kpiConfig.json with lifecyclePhase, tag hygiene types, wire JQL — then dev can cut the grouped TPM Pulse page with live counts.
