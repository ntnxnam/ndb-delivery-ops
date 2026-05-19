# .cursor/AGENTS.md — project-specific Cursor guidance

Read order when you start a session in this repo:

1. `~/.cursor/AGENTS.md` — user-level persona (Namratha, NDB-Ops, role definitions).
2. `~/.cursor/context/ndb-ops/AGENTS.md` — domain primer.
3. This file — repo-specific deltas.
4. The workspace you're touching (`apps/delivery-ops/`, `apps/tpm-confluence-tools/`, `mcp-server/`, `shared/`).

## Project sub-agents (invoke by name)

- `tpm-assistant` — see `.cursor/agents/tpm-assistant.md`.
- `rm-assistant` — see `.cursor/agents/rm-assistant.md`.

## Project workflows

Multi-step playbooks that chain MCP tools + skills. See `.cursor/workflows/`:

- `monday-release-status.md` — weekly release status pipeline.
- `quarterly-vp-report.md` — predictive VP report + Confluence publish.
- `release-cascade-rename.md` — safe end-to-end version rename across filters.

## MCP server

Registered via `.cursor/mcp.json`. Implemented in `mcp-server/`. Build with
`npm run mcp:build`; start manually with `npm run mcp:start` (stdio transport).

## Layered loading (recap from user-level)

Project overrides user; user overrides plugin; plugin overrides Cursor product.
If a project rule contradicts a user rule, flag it so we can decide whether
the project actually needs the override.
