# NDB-Delivery-Ops

The consolidated NDB-Ops delivery toolchain — one repository, one persona, one
MCP surface.

## Workspaces

| Path | Stack | Run command |
|---|---|---|
| [`lighthouse/app/`](lighthouse/app/) | Node/Express + React | `./restart` (from inside the workspace) |
| [`apps/bin-packing/`](apps/bin-packing/) | Vanilla JS / ESM | Served statically by `delivery-ops` server at `/bin-packing/`. Standalone: `npm start` (port 3847). |
| [`apps/tpm-confluence-tools/`](apps/tpm-confluence-tools/) | Python / Streamlit | `streamlit run app.py` (inside its own venv) |
| [`lighthouse/mcp/`](lighthouse/mcp/) + [`loom/mcp/`](loom/mcp/) | TypeScript, MCP SDK | `npm run mcp:build` (from repo root) |
| [`platform/`](platform/) + [`shared/`](shared/) | TypeScript (ESM) | Shared email/AI + connectors/services (lighthouse owns its own; platform is cross-product) |

## Architecture — Anthropic's five pillars

```
                                            +-----------------+
   Cursor / Claude Desktop / Claude.ai ---->| lighthouse/mcp + loom/mcp |
                                            | (stdio bridge)  |
                                            +--------+--------+
                                                     |
                            +------------------------+-------------------------+
                            |                                                  |
                       Connectors                                            Tools
                       (jira, confluence,                                    (get_release_status,
                        tcms, slack)                                          move_jira_dates,
                            |                                                 say_vs_do, ...)
                            |
                  Upstream: JIRA API, Confluence API,
                  TCMS API, internal Nutanix services
```

| Pillar | Where |
|---|---|
| 1. MCP servers | `lighthouse/mcp/src/index.ts` + `loom/mcp/src/index.ts` |
| 2. Connectors | `lighthouse/mcp/src/connectors/` + `loom/mcp/src/connectors/` (per-product) + `platform/email+ai` (shared) |
| 3. Rules / system instructions | `agent-pack/base/rules/` (shared) + `lighthouse/rules/` / `loom/rules/` (per-product) |
| 4. Skills | `lighthouse/skills/` + `loom/skills/` |
| 5. Workflows | `lighthouse/workflows/` |

## Agents (orchestrator-workers, D16)

One user-facing agent dispatches to internal specialists. Users never invoke
specialists directly.

| Layer | Name | Role |
|---|---|---|
| Orchestrator | `ops-assistant` | Single entry point. Reads session context, picks specialist + skill, renders audience-appropriate output. Invoke with `@ops-assistant`. |
| Specialist | `team-exec-specialist` | Team Executive / Director release status answers |
| Specialist | `tpm-specialist` | Weekly status emails, sprint planning, cross-team coordination |
| Specialist | `rm-specialist` | Release timelines, gate-date moves (D30), version cascade |
| Specialist | `triage-specialist` | Bug / crisis / stale-ticket / pending-response triage flavours |
| Specialist | `dependency-tracker-specialist` | "What blocks my feature?" cross-team dep walks |
| Specialist | `confluence-publisher-specialist` | Confluence cleanup + publish operations |

## Quick start

```bash
# Web app
cd lighthouse/app
./restart

# Streamlit TPM tools (own venv)
cd apps/tpm-confluence-tools
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
streamlit run app.py

# MCP server (build once, then runs on demand from Cursor)
npm install
npm run mcp:build
```

## Wiring the MCP server into Cursor

`.cursor/mcp.json` in this repo registers the server automatically when the
workspace is open. For **Claude Desktop**, add this to
`~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ndb-delivery-ops": {
      "command": "node",
      "args": ["/Users/namratha.singh/NDB-Ops-Tools/ndb-delivery-ops/lighthouse/mcp/dist/index.js"]  // or loom/mcp for the builder MCP
    }
  }
}
```

## Repo lineage

This repo replaces:
- `~/ndb-status-sender/` (carried into `lighthouse/app/`)
- `~/Confluence-Page-Creator/` (carried into `apps/tpm-confluence-tools/`)
- ~7 sibling NDB tools, ported to MCP tools under `lighthouse/mcp/src/tools/` + `loom/mcp/src/tools/` — see
  the migration plan at `.cursor/plans/` (user-level).

Originals are kept at `~/NDB-Ops-Tools/_archive/` until the new structure is
fully proven, then deleted.
