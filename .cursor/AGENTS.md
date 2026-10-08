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
| `skills/team-exec-status-answer/` | `team-exec-specialist` | Team Executive / Director asks about release status |
| `skills/weekly-status-email/` | `tpm-specialist` | Weekly TPM status email (Monday job or on demand) |
| `skills/bug-triage/` | `triage-specialist` | New defects need triage |
| `skills/crisis-triage/` | `triage-specialist` | P0 / escalation |
| `skills/stale-ticket-sweep/` | `triage-specialist` | Periodic backlog hygiene |
| `skills/pending-response-chase/` | `triage-specialist` | Chase un-answered dependency / deferral asks |
| `skills/dependency-walk/` | `dependency-tracker-specialist` | "What blocks my feature?" |
| `skills/move-gate-date/` | `rm-specialist` | Gate date move with mandatory reason + audit (D30) |
| `skills/confluence-width-cleanup/` | `confluence-publisher-specialist` | Cleaning Confluence storage XML |
| `skills/release-ai-briefing/` | `tpm-specialist` | Release-level RAG + top blockers + 7-day action list |

## Workflows

`agent-pack/workflows/` — Monday status, quarterly Team-Exec report,
release cascade rename.

## Lift-and-shift

To run this product on another host, implement an adapter
(`agent-pack/adapters/future-host.md`). Do not copy skills into a
vendor format as a fork.
