# Adapter — Cursor

Cursor is a **builder and one chat surface**, not the home of the cookbook.

`.cursor/agents`, `.cursor/skills`, and `.cursor/workflows` are directory
symlinks into this pack. Constitutional rules under `.cursor/rules/` that
belong to the product agent are file symlinks. Builder-only rules remain
real files in `.cursor/rules/`.

When adding a skill, agent, workflow, **context**, or **prompt**: create it
under `agent-pack/`, register it in `manifest.json`, and let the symlink /
pointer expose it to Cursor. Never create a Cursor-only long-form copy.

`.cursor/context/` holds short stubs pointing at `agent-pack/context/`.

MCP registration (`.cursor/mcp.json`) is host config, not cookbook. A
lifted host registers the same `mcp-server` with its own config.
