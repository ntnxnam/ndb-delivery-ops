# .cursor/AGENTS.md — project-specific Cursor guidance

Read order when you start a session in this repo:

1. `~/.cursor/AGENTS.md` — user-level persona (Namratha, Portfolio Manager).
2. `~/.cursor/context/audience.md` — eleven audiences (product-agnostic).
3. `AGENTS.md` (repo root) — repo-specific deltas.
4. This file — Cursor-specific guidance.
5. `DECISIONS.md`, `ARCHITECTURE.md`, `FEATURE_CATALOG.md` — locked decisions, layered architecture, feature inventory.

## The Ops Assistant — single user-facing agent (D16)

This repo follows Anthropic's **orchestrator-workers** pattern. ONE
user-facing agent (`.cursor/agents/ops-assistant.md`) orchestrates internal
specialist sub-agents (`.cursor/agents/specialists/*.md`). Users never
invoke specialists directly.

Invoke the orchestrator with: `@ops-assistant` (in Cursor chat or any
delivery-ops chat surface).

The orchestrator:

1. Reads the session context (caller's role, active product list, active releases)
2. Selects the right specialist + skill for the question
3. Calls services / connectors / MCP tools as needed
4. Renders the answer with the right audience preset (per `audience.md`)
5. Cites every claim (per `citation-first-output.mdc`)

## Skills the orchestrator can dispatch

| Skill file | Specialist | Use when |
|---|---|---|
| `.cursor/skills/team-exec-status-answer/` | `team-exec-specialist` | Team Executive / Director asks about release status |
| `.cursor/skills/weekly-status-email/` | `tpm-specialist` | Weekly TPM status email (Monday job or on demand) |
| `.cursor/skills/bug-triage/` | `triage-specialist` | New defects need triage |
| `.cursor/skills/crisis-triage/` | `triage-specialist` | P0 / escalation |
| `.cursor/skills/stale-ticket-sweep/` | `triage-specialist` | Periodic backlog hygiene |
| `.cursor/skills/pending-response-chase/` | `triage-specialist` | Chase un-answered dependency / deferral asks |
| `.cursor/skills/dependency-walk/` | `dependency-tracker-specialist` | "What blocks my feature?" |
| `.cursor/skills/move-gate-date/` | `rm-specialist` | RM/TPM wants to move a gate date (CC / CG / PG) — enforces mandatory reason + Confluence audit (D30) |
| `.cursor/skills/confluence-width-cleanup/` | `confluence-publisher-specialist` | Cleaning Confluence storage XML |

## Project workflows

Multi-step playbooks that chain MCP tools + skills. See `.cursor/workflows/`:

- `monday-release-status.md` — weekly release status pipeline
- `quarterly-team-exec-report.md` — predictive Team Executive report + Confluence publish
- `release-cascade-rename.md` — safe end-to-end version rename

## Pillars (Anthropic agentic architecture)

| Pillar | Path | What lives here |
|---|---|---|
| MCP server | `mcp-server/src/index.ts` | Single server, every tool + resource |
| Connectors | `shared/connectors/*.ts` (Phase D) | One module per external system |
| Rules | `.cursor/rules/` (project) + `~/.cursor/rules/` (inherited) | Must-follow constraints |
| Skills | `.cursor/skills/` (project) + `~/.cursor/skills/` (user) | Reusable agent capabilities |
| Workflows | `.cursor/workflows/` | Multi-step playbooks |

## MCP server

Registered via `.cursor/mcp.json`. Implemented in `mcp-server/`. Build with
`npm run mcp:build`; start with `npm run mcp:start` (stdio transport).

## Layered loading (recap)

Project overrides user; user overrides plugin; plugin overrides Cursor product.
If a project rule contradicts a user rule, flag it.
