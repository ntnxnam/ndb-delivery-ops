# .cursor/AGENTS.md — Cursor adapter (D38)

This file is **host-specific**. The cookbook lives in `agent-pack/`.
`.cursor/agents`, `.cursor/skills`, and `.cursor/workflows` are
symlinks into that pack. Do not add a skill or specialist only here.

Read order when you start a session in this repo:

1. `~/.cursor/AGENTS.md` — user-level persona (Namratha, Portfolio Manager).
2. `~/.cursor/context/audience.md` — eleven audiences (product-agnostic).
3. `AGENTS.md` (repo root) — repo-specific deltas.
4. This file — Cursor-specific bootstrap.
5. `agent-pack/identity/ops-assistant.md` — orchestrator protocol.
6. `agent-pack/context/INDEX.md` + `agent-pack/prompts/INDEX.md` — portable domain + LLM prompts (leave Cursor without losing these).
7. `DECISIONS.md`, `ARCHITECTURE.md`, `FEATURE_CATALOG.md`.

Context/prompts SoT is `agent-pack/` — not `.cursor/context/` (stubs only).

## The Ops Assistant — single user-facing agent (D16)

ONE user-facing agent (`agent-pack/identity/ops-assistant.md`)
orchestrates internal specialists (`agent-pack/identity/specialists/`).
Users never invoke specialists directly.

Invoke with `@ops-assistant` in Cursor, or any delivery-ops chat
surface. Both hosts must load the same pack via `loadAgentPack()`.
Web chat runs `runAgentTurn` (D39), not a one-shot mailbox prompt.

The orchestrator:

1. Reads the session context (caller's role, active product list, active releases)
2. Selects the right specialist + skill for the question
3. Calls services / connectors / MCP tools as needed
4. Renders the answer with the right audience preset (per `audience.md`)
5. Cites every claim (per `citation-first-output.mdc`)

## Skills the orchestrator can dispatch

Registry: `agent-pack/manifest.json`. Paths below are pack-relative.

| Skill | Specialist | Use when |
|---|---|---|
| `skills/team-exec-briefing/` | `team-exec-specialist` | Unified exec view: status (compound Q + risk register) / report (6 sections) / briefing (RAG + blockers + 7-day) — mode=status/report/briefing |
| `skills/weekly-status-email/` | `tpm-specialist` | Weekly TPM status email (Monday job or on demand) |
| `skills/kpi-pulse-analytics/` | `tpm-specialist` | Reusable KPI Pulse band (last 2 Qs, MTTR, status dwell) |
| `skills/backlog-triage/` | `triage-specialist` | Unified backlog health: new defects + stale idle + pending unreplied asks (mode=new/stale/pending/all) |
| `skills/crisis-triage/` | `triage-specialist` | P0 / escalation |
| `skills/sprint-gantt-chart/` | `tpm-specialist` | Date-hierarchy-aware Gantt |
| `skills/ticket-insights/` | `tpm-specialist` | Unified fetch+breakdown: 8-clause JQL + 6-group / Dev vs QA / status |
| `skills/release-dataset-sync/` | `rm-specialist` | 3-group/6-bucket release dataset sync pipeline |
| `skills/dependency-walk/` | `dependency-tracker-specialist` | "What blocks my feature?" |
| `skills/release-gate-ops/` | `rm-specialist` | Unified gate-date move (JIRA + config) with mandatory reason + audit (D30/D31) |
| `skills/confluence-width-cleanup/` | `confluence-publisher-specialist` | Cleaning Confluence storage XML |
| `skills/multi-model-review/` | `ops-assistant` (builder) | Pipeline stage 2 — parallel multi-model Code Review |
| `skills/exec-perspective/` | `ops-assistant` (builder) | Pipeline stage 5 — Exec sign-off (high-level → drill-down) |

**Invoke from the pack:** read `agent-pack/skills/<name>/SKILL.md` or
`pack.skills.get('<name>')`. Do not open a Cursor-only / Claude-only copy.

## Workflows

`agent-pack/workflows/` — Monday status, quarterly Team-Exec report,
release cascade rename.

## Lift-and-shift

To run this product on another host, implement an adapter
(`agent-pack/adapters/future-host.md`). Do not copy skills into a
vendor format as a fork.
