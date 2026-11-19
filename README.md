# portfolio-delivery-ops

Portfolio delivery operations — one monorepo, one persona (Portfolio Manager), product-agnostic by design (D1).

## Workspaces

| Path | Stack | Purpose |
|---|---|---|
| [`apps/delivery-ops/`](apps/delivery-ops/) | Node/Express + React | Web app — release versions, sprint reports, KPIs, exec dashboard, status emailer, embedded chat panel (D7). |
| [`apps/tpm-confluence-tools/`](apps/tpm-confluence-tools/) | Python / Streamlit (Phase F: rewrite in React) | Bulk Confluence pages, templates, Release Gates Checklist (D20). |
| [`mcp/lighthouse/`](mcp/lighthouse/) | TypeScript, MCP SDK | Product MCP server — bin `lighthouse-mcp`, 2 product-only tools + 8 shared tools (D44, D45). |
| [`mcp/loom/`](mcp/loom/) | TypeScript, MCP SDK | Builder MCP server — bin `loom-mcp`, 8 shared tools only (D44). |
| [`mcp/shared/`](mcp/shared/) | TypeScript | Deduplicated tool source — 8 tools + env + glossary imported by both MCP servers (D44). |
| [`shared/`](shared/) | TypeScript (ESM) | Connectors (5 per D3), domain models, services — `@portfolio-delivery-ops/shared`. |

## Architecture — five layers

```
                                     +-----------------------------+
  Cursor / Claude Desktop / Claude.ai |  mcp/lighthouse  mcp/loom  |
                                     |  (stdio — dual MCP)        |
                                     +-------------+---------------+
                                                   |
                         +-------------------------+-------------------------+
                         |                                                   |
                    Connectors                                          Tools
                    (jira, confluence,                                    (get_release_status,
                     github, slack, email)                                  move_jira_dates,
                         |                                                   say_vs_do, ...)
                         |
               Upstream: JIRA API, Confluence API,
               GitHub API, internal services
```

| Pillar | Where |
|---|---|
| MCP servers | `mcp/lighthouse/src/index.ts` (product), `mcp/loom/src/index.ts` (builder), shared tools in `mcp/shared/tools/` — D44, D45 |
| Connectors | `shared/src/connectors/*.ts` — one module per external system (D3) |
| Rules / system instructions | `agent-pack/lighthouse/rules/` + `agent-pack/loom/rules/` (via `agent-pack/harness/`) |
| Skills | `agent-pack/lighthouse/skills/` + `agent-pack/loom/skills/` (via `agent-pack/harness/`) |
| Workflows | `agent-pack/lighthouse/workflows/` + `agent-pack/loom/workflows/` |

See `docs/technical/ARCHITECTURE.md` and `AGENTS.md` for the full layer model.

## Agents (orchestrator-workers, D16)

One user-facing orchestrator dispatches to specialists. Users never invoke specialists directly.

| Layer | Name | Role |
|---|---|---|
| Orchestrator | `ops-assistant` (lighthouse) | Single entry point. Reads session context, picks specialist + skill, renders audience-appropriate output. |
| Orchestrator | `loom` (loom) | Builder orchestrator — `frontend-dev`, `backend-dev`, `connector-dev`. |
| Specialist | `team-exec-specialist` | Team Executive / Director release status answers |
| Specialist | `tpm-specialist` | Weekly status emails, sprint planning, cross-team coordination |
| Specialist | `rm-specialist` | Release timelines, gate-date moves (D30), version cascade |
| Specialist | `triage-specialist` | Bug / crisis / stale-ticket / pending-response triage |
| Specialist | `dependency-tracker-specialist` | Cross-team dep walks |
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

# MCP servers (build all tenanted packages)
npm install
npm run mcp:build
# Bins: lighthouse-mcp (mcp/lighthouse), loom-mcp (mcp/loom) — D45
```

## Wiring MCP into hosts

`.cursor/mcp.json` (Cursor) and `.claude.json` / host config (Claude Desktop, etc.) register the servers. Each host loads the appropriate tenancy — `lighthouse-mcp` for product use, `loom-mcp` for builder use. See `agent-pack/harness/mcp.json` and `docs/guides/DEVELOPER_GUIDE.md`.

## Repo lineage

This repo replaces:
- `~/ndb-status-sender/` (carried into `apps/delivery-ops/`)
- `~/Confluence-Page-Creator/` (carried into `apps/tpm-confluence-tools/`)
- ~7 sibling tools, now MCP tools under `mcp/shared/tools/` + `mcp/lighthouse/src/tools/` — D44

Originals are kept at `~/NDB-Ops-Tools/_archive/` until the new structure is fully proven, then deleted.
