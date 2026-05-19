# ndb-delivery-ops — project AGENTS

This file is the **project-level** persona delta. It assumes you have already
read the user-level persona at `~/.cursor/AGENTS.md` and the NDB-Ops context
library at `~/.cursor/context/ndb-ops/`. Do not redefine concepts that already
live there; only describe what is specific to this repository.

## What this repo is

A single monorepo that consolidates the entire NDB-Ops delivery toolchain:

| Workspace | Stack | Purpose |
|---|---|---|
| `apps/delivery-ops/` | Node/Express + React | Web app — release versions, sprint reports, KPIs, exec summary, status emailer. Was previously `~/ndb-status-sender/`. |
| `apps/tpm-confluence-tools/` | Python / Streamlit | TPM bulk Confluence page creation, was previously `~/Confluence-Page-Creator/`. |
| `mcp-server/` | TypeScript, `@modelcontextprotocol/sdk` | Custom MCP server exposing every NDB-Ops capability as a tool that Cursor / Claude Desktop / Claude.ai connectors can call. |
| `shared/` | TypeScript / JS | Helpers re-used across the Node-side workspaces (auth, jira, config). |

## The five pillars (Anthropic agentic architecture)

| Pillar | Path | What lives here |
|---|---|---|
| MCP server | `mcp-server/src/index.ts` | Single server registering every tool + resource |
| Connectors | `mcp-server/src/connectors/*.ts` | Thin upstream facades: `jiraConnector`, `confluenceConnector`, `tcmsConnector`, `slackConnector` |
| Rules | `.cursor/rules/` (project) + `~/.cursor/rules/` (inherited) | Must-follow constraints |
| Skills | `.cursor/skills/` (project) + `~/.cursor/skills/` (user) | Reusable capabilities the agent reads on demand |
| Workflows | `.cursor/workflows/` | Multi-step orchestrations that chain tools + skills |

## Sub-agents you can invoke by name

Project-level:
- `tpm-assistant` — Confluence pages, sprint planning, ticket triage, status emails.
- `rm-assistant` — release timelines, version cascade rename, exec summary, risk reporting.

Inherited from `~/.cursor/agents/`:
- `ndb-rca-agent` — incident RCA, read-only.
- `ndb-framework-builder` — NDB test framework codegen.
- `ndb-test-architect` — test architecture design.

## Recipient roles (audience tiers)

The expanded role list lives in `~/.cursor/context/ndb-ops/audience.md`.
Every output must answer: "Which of TPM / RM / FEAT Mgr / Team Executive
Leadership / Team Leader / Team Manager / Engineer is consuming this?"

## Project defaults

- **No hard-coded localhost** in app code (see `no-localhost` rule).
- **Minimal architecture** (see `minimal-architecture` rule) — components render, hooks fetch, services transform; routes stay under 150 lines.
- **JIRA dates** follow the Nutanix hierarchy (`nutanix-jira-date-hierarchy` rule).
- **Custom field IDs** live in `shared/jira/fields.ts` (server) and `apps/delivery-ops/client/src/utils/jiraFields.js` (client) — never inline `customfield_NNNNN` a second time.
- **Reports** named `{Type}-{Product}-{Release}-{YYYY-MM-DD}{-Variant}.{ext}` (see `documentation-consistency` rule).
- **Gerrit pushes** use `refs/for/<branch>` for code review (see `DPRO-Gerrit-Push-For-Review` rule).

## When you start a task in this repo

1. Check `~/.cursor/context/ndb-ops/AGENTS.md` for the domain primer.
2. Pick the workspace (`apps/delivery-ops`, `apps/tpm-confluence-tools`, `mcp-server`, `shared`).
3. Identify the right pillar (tool, skill, workflow, rule).
4. Follow the rules — don't create new util files that overlap with existing ones.
