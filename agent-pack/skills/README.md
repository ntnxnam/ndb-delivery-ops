# Project skills

Project-specific skills. Each is invoked by a specialist sub-agent under
`ops-assistant`. See `agent-pack/identity/specialists/` for which skill each
specialist owns. Canonical home is this directory (D38), not `.cursor/`.

## Skills in this project

| Skill | Owner specialist | Purpose | Decision IDs |
|---|---|---|---|
| `team-exec-status-answer/` | `team-exec-specialist` | Compound question + risk register answer for Team Executive / Director | D4, D10, D15 |
| `weekly-status-email/` | `tpm-specialist` | 3-tier hybrid weekly status for broad leadership | D17, D15d |
| `bug-triage/` | `triage-specialist` | Proposes owner/priority/component/severity for new defects | D19 |
| `crisis-triage/` | `triage-specialist` | P0 / escalation response coordination | D19 |
| `stale-ticket-sweep/` | `triage-specialist` | Weekly backlog hygiene | D19 |
| `pending-response-chase/` | `triage-specialist` | Chase un-answered dep / deferral asks (D24 open) | D19, D24 |
| `dependency-walk/` | `dependency-tracker-specialist` | Upstream/downstream walk in JIRA dep graph | D18 |
| `confluence-width-cleanup/` | `confluence-publisher-specialist` | Pre-push storage XML cleanup (canonical at user level) | D3, D15d |
| `move-gate-date/` | `rm-specialist` | Gate-date moves (CC/CG/PG) with mandatory reason + Confluence audit | **D30** |
| `fetch-project-tickets/` | `tpm-specialist` / `team-exec-specialist` | 8-clause portfolio-children JQL primitive (canonical at user level) | — |
| `team-exec-release-report/` | `team-exec-specialist` | Team Executive-Executive release report with risk escalation rules | D9 |
| `predictive-team-exec-analytics/` | `team-exec-specialist` | Monte Carlo + completion-probability forecasts | D8, D9 |
| `sprint-gantt-chart/` | `tpm-specialist` / `rm-specialist` | Date-hierarchy-aware Gantt for sprint-tier tickets | — |

The last five are project-level references whose canonical content
lives at `~/.cursor/skills/`. Read the project copy for usage in this
codebase; read the user-level copy for the full procedure / scripts /
templates.

## Anthropic-pattern mapping

For each skill, the layers it touches:

- **Agent** — `agent-pack/identity/ops-assistant.md` routes the user request
- **Specialist** — one of `agent-pack/identity/specialists/*.md` owns the
  skill's domain
- **Skill** — the file in this directory describes the workflow
- **Tool** — usually an API endpoint in
  `apps/delivery-ops/server/routes/` and/or an MCP tool in
  `mcp-server/src/tools/`
- **Service** — pure logic in `shared/src/services/`
- **Connector** — JIRA / Confluence / GitHub / Slack / Email in
  `shared/src/connectors/`

The `move-gate-date` skill is the first one to exercise the *full*
stack: orchestrator → rm-specialist → skill → `/api/date-mover/move-gate-date`
→ `DateMoverService` → `JiraConnector` + `ConfluenceConnector`. Use it
as the reference shape when porting other capabilities from
`CONSOLIDATION.md`.

## Skill authoring rules

Per `.cursor/rules/documentation-consistency.mdc`:

- Frontmatter: `name`, `description` (active verb + "Use when"), optional `audience`
- Required sections in order: `## When to Use This Skill`, `## Quick Start`,
  `## Core Rules`, `## Output Format`, `## Quality Validation`
- Description must use active verbs ("Generate...", "Fetch...")
- Reference decision IDs (D1, D10, etc.) and rules when explaining "why"
