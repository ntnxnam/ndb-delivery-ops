# NDB-Delivery-Ops

The consolidated NDB-Ops delivery toolchain — one repository, one persona, one
MCP surface.

## Workspaces

| Path | Stack | Run command |
|---|---|---|
| [`apps/delivery-ops/`](apps/delivery-ops/) | Node/Express + React | `./restart` (from inside the workspace) |
| [`apps/tpm-confluence-tools/`](apps/tpm-confluence-tools/) | Python / Streamlit | `streamlit run app.py` (inside its own venv) |
| [`mcp-server/`](mcp-server/) | TypeScript, MCP SDK | `npm run mcp:start` (from repo root) |
| [`shared/`](shared/) | TypeScript / JS | Library only, no entry point |

## Architecture — Anthropic's five pillars

```
                                            +-----------------+
   Cursor / Claude Desktop / Claude.ai ---->|   mcp-server    |
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
| 1. MCP server | `mcp-server/src/index.ts` |
| 2. Connectors | `mcp-server/src/connectors/` |
| 3. Rules / system instructions | `~/.cursor/rules/` (inherited) + `.cursor/rules/` |
| 4. Skills | `~/.cursor/skills/` (inherited) + `.cursor/skills/` |
| 5. Workflows | `.cursor/workflows/` |

## Sub-agents

| Agent | Trigger words | Owns |
|---|---|---|
| `tpm-assistant` | "tpm-assistant", "help me create a confluence page", "triage tickets" | Confluence creation, sprint planning, ticket triage, status emails |
| `rm-assistant` | "rm-assistant", "prep release status", "rename release" | Release timelines, version cascade, exec summary, risk reporting |

## Quick start

```bash
# Web app
cd apps/delivery-ops
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
      "args": ["/Users/namratha.singh/NDB-Ops-Tools/ndb-delivery-ops/mcp-server/dist/index.js"]
    }
  }
}
```

## Repo lineage

This repo replaces:
- `~/ndb-status-sender/` (carried into `apps/delivery-ops/`)
- `~/Confluence-Page-Creator/` (carried into `apps/tpm-confluence-tools/`)
- ~7 sibling NDB tools, ported to MCP tools under `mcp-server/src/tools/` — see
  the migration plan at `.cursor/plans/` (user-level).

Originals are kept at `~/NDB-Ops-Tools/_archive/` until the new structure is
fully proven, then deleted.
