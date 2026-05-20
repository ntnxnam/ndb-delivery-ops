# NDB-Delivery-Ops

The consolidated NDB-Ops delivery toolchain — one repository, one persona, one
MCP surface.

## Workspaces

| Path | Stack | Run command |
|---|---|---|
| [`apps/delivery-ops/`](apps/delivery-ops/) | Node/Express + React | `./restart` (from inside the workspace) |
| [`apps/bin-packing/`](apps/bin-packing/) | Vanilla JS / ESM | Served statically by `delivery-ops` server at `/bin-packing/`. Standalone: `npm start` (port 3847). |
| [`apps/tpm-confluence-tools/`](apps/tpm-confluence-tools/) | Python / Streamlit | `streamlit run app.py` (inside its own venv) |
| [`mcp-server/`](mcp-server/) | TypeScript, MCP SDK | `npm run mcp:start` (from repo root) |
| [`shared/`](shared/) | TypeScript (ESM) | Library only — connectors + services + types consumed by everything above |

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
| 2. Connectors | `shared/connectors/*.ts` (JIRA, Confluence today; GitHub / Slack / Email / AI pending) |
| 3. Rules / system instructions | `~/.cursor/rules/` (inherited) + `.cursor/rules/` |
| 4. Skills | `~/.cursor/skills/` (inherited) + `.cursor/skills/` |
| 5. Workflows | `.cursor/workflows/` |

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
