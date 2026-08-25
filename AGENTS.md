# portfolio-delivery-ops — project AGENTS

This is the **project-level** persona delta. Read alongside the user-level
persona at `~/.cursor/AGENTS.md` and the audience definitions at
`~/.cursor/context/audience.md`. Do not redefine concepts that already
live there.

The repo will be renamed `portfolio-delivery-ops` per **D2**; in the meantime
it lives at `~/NDB-Ops-Tools/ndb-delivery-ops/`. All code is product-agnostic
per **D1** — NDB is one tenant, DataLens and others are equally valid.

## What this repo is

A single monorepo for **portfolio delivery operations** across products.
Designed for one consumer category — the **Portfolio Manager** — and its
adjacent personas (Team Executive, Director, TPM, RM, EM, FEAT Mgr, IC, QA, Architect).

| Workspace | Stack | Purpose |
|---|---|---|
| `apps/delivery-ops/` | Node/Express + React | Web app — release versions, sprint reports, KPIs, exec dashboard, status emailer, embedded chat panel (D7). |
| `apps/tpm-confluence-tools/` | Python / Streamlit (Phase F: rewrite in React) | Bulk Confluence pages, templates, Release Gates Checklist (D20). |
| `mcp-server/` | TypeScript, `@modelcontextprotocol/sdk` | MCP server exposing every capability as a tool. |
| `shared/` | TypeScript | Connectors (5 per D3), domain models, services consumed across workspaces. |

## Architecture — see `ARCHITECTURE.md`

5-layered: Connectors → Domain Models → Services → API+MCP → UI & AI Surfaces.
**One feature, one place**.

## Five connectors (D3)

`shared/connectors/` — one TypeScript module per external system:

| Connector | Purpose |
|---|---|
| `jiraConnector` | All JIRA REST + Agile API calls |
| `confluenceConnector` | All Confluence REST calls |
| `githubConnector` | GitHub commits / PRs / repos / CI signals |
| `slackConnector` | Slack reads/posts/DMs |
| `emailConnector` | Send digests, optional inbox reading |

(Plus `aiConnector` for LLM calls — separate category.)

## AI layer — orchestrator-workers pattern (D16)

**One user-facing orchestrator agent**: `agent-pack/identity/ops-assistant.md`
(D38). Every host — Cursor, web chat, future Slack — loads this pack.
Specialists are internal sub-agents the orchestrator delegates to.

**Specialist sub-agents** (in `agent-pack/identity/specialists/`, D38):

- `team-exec-specialist` — Team Executive protocol (D15: compound question, risk register, citations)
- `tpm-specialist` — weekly status (D17), cross-team deps (D18), 4 triage flavours (D19)
- `rm-specialist` — release readiness, cascade renames, gate dates
- `triage-specialist` — bug / crisis / stale-ticket / pending-response (D19)
- `confluence-publisher-specialist` — bulk pages, templates, width cleanup
- `dependency-tracker-specialist` — cross-team dep graph (D18)

The orchestrator decides delegation; users never address a specialist by name.

## Skills (`agent-pack/skills/`)

Reusable capabilities the agent reads on demand. Each one is task-specific
and references the specialist that owns it.

- `team-exec-status-answer/` — D15 protocol
- `weekly-status-email/` — D17 3-tier structure
- `bug-triage/`, `crisis-triage/`, `stale-ticket-sweep/`, `pending-response-chase/` — D19
- `dependency-walk/` — D18
- `confluence-width-cleanup/` — pre-existing, kept

## Rules (`agent-pack/rules/` + builder-only `.cursor/rules/`)

Recovered + new:

| File | Purpose |
|---|---|
| `no-localhost.mdc` | No hardcoded localhost in production code |
| `jira-date-hierarchy.mdc` | Issue-type-aware date field mapping |
| `minimal-architecture.mdc` | Components render, hooks fetch, services transform |
| `documentation-consistency.mdc` | Report naming + skill structure |
| `confluence-cleanup-clarification.mdc` | Always clarify before Confluence cleanup |
| `gerrit-push-for-review.mdc` | Use `refs/for/<branch>` |
| `persona-aware-output.mdc` | Declare audience, use presenter (D6) |
| `citation-first-output.mdc` | Every claim cites a source (D10) |
| `product-agnostic.mdc` | No hardcoded product strings (D1) |

## Recipient roles (audience tiers)

Eleven audiences defined in `~/.cursor/context/audience.md`. Every output
declares `audience: team-exec | director | portfolio_mgr | tpm | rm | feat |
team_lead | team_mgr | ic | qa_lead | architect`.

## Project defaults

- **Product-agnostic by design** (D1) — every NDB-specific value is config-driven
- **5 connectors, no parallel implementations** (D3)
- **Citation-first output** (D10) — every claim sourced
- **Persona-aware output** (D6) — declare audience, use presenter
- **Workflows for recurring artefacts; agents for ad-hoc questions** (D8, D9)
- **Single React runtime** on `:8888` — no Streamlit in user-facing path
- **Web chat panel** (D7) is the agent surface for non-IDE users
- **Agent pack is portable** (D38) — cookbook in `agent-pack/`; Cursor is one adapter

## Phase plan (see `DECISIONS.md` → Round 6)

| Phase | Scope |
|---|---|
| A (this commit) | AI layer rebuild: rules, audience.md, orchestrator, specialists, skills |
| B | Persona-aware Sidebar + role lens (D6) + product picker (D1) |
| C | Embedded chat panel (D7) in delivery-ops React |
| D | Connectors consolidation into `shared/connectors/` (5 connectors per D3) |
| E | Streamlit → React rewrite of release-analytics |
| F | Streamlit → React rewrite of tpm-confluence-tools + Release Gates Checklist (D20) |
| G | New MCP-backed pages: Capacity Planner, Bin-Packing, Story Points, Date Mover, Say-vs-Do |
| H | Gap features: Sprint Planner, Status Page Auto-Publisher, etc. |

## When you start a task in this repo

1. Read `DECISIONS.md` — every architectural decision has an ID
2. Read `ARCHITECTURE.md` for layer model
3. Read `~/.cursor/context/audience.md` for persona detail
4. Pick the workspace (`apps/*`, `mcp-server`, `shared`)
5. Identify the right layer (Connector, Domain Model, Service, API/MCP, UI/AI)
6. Follow rules — never duplicate existing services or connectors
