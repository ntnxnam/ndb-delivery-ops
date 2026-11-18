# Project skills

Project-specific skills. Each is invoked by a specialist sub-agent under
`ops-assistant`. See `agent-pack/identity/specialists/` for which skill each
specialist owns. Canonical home is this directory (D38), not `.cursor/`.

## Skills in this project

| Skill | Owner specialist | Purpose | Decision IDs |
|---|---|---|---|
| `team-exec-briefing/` | `team-exec-specialist` | Unified exec view: status (compound Q + risk register) + report (6 sections, dense bullets) + briefing (RAG + blockers + 7-day) | D4, D10, D15, D9 |
| `weekly-status-email/` | `tpm-specialist` | 3-tier hybrid weekly status for broad leadership | D17, D15d |
| `kpi-pulse-analytics/` | `tpm-specialist` | Reusable KPI Pulse band (last 2 Qs, MTTR, status dwell) | — |
| `sprint-gantt-chart/` | `tpm-specialist` / `rm-specialist` | Date-hierarchy-aware Gantt for sprint-tier tickets | — |
| `backlog-triage/` | `triage-specialist` | Unified backlog health: new defects + stale idle + pending unreplied asks (D19/D24) | D19, D24 |
| `crisis-triage/` | `triage-specialist` | P0 / escalation response coordination | D19 |
| `dependency-walk/` | `dependency-tracker-specialist` | Upstream/downstream walk in JIRA dep graph | D18 |
| `release-gate-ops/` | `rm-specialist` | Unified gate-date mutations: JIRA FEAT fields (D30 audit) + release config slip + sprint extension | **D30**, D31 |
| `ticket-insights/` | `tpm-specialist` | Unified fetch+breakdown: 8-clause JQL + 6-group / Dev vs QA / status with JIRA links | — |
| `release-dataset-sync/` | `rm-specialist` | 3-group/6-bucket release dataset sync pipeline | D36 |
| `release-retrospective/` | `tpm-specialist` | Gate contracts analysis (CCM/CG/PG/GA) + naughty ranking | — |
| `era-csv-jira-import/` | `tpm-specialist` / `ops-assistant` | CSV/Excel → ERA Epics+Tasks; fail-fast mandatory fields; AuthZ bulk import | — |
| `predictive-team-exec-analytics/` | `team-exec-specialist` | Monte Carlo + completion-probability forecasts | D8, D9 |
| `past-releases-report/` | `rm-specialist` | Live-verified past-release deck: Feature/Initiative counts, closed KPIs by Integrated Version (cf11360 OR fixVersion), gate Gantt (EC=Execute Commit), NAI capability grouping | D10, D15, D30 |
| `multi-model-review/` | `ops-assistant` (builder) | Parallel multi-model Code Review (pipeline stage 2) | — |
| `exec-perspective/` | `ops-assistant` (builder) | Exec sign-off: high-level first, then drill-down (stage 5) | — |

Host discovery: `.cursor/skills`, `.claude/skills`, `.codex/skills`, and
`.agents/skills` all symlink here. Do not fork skills under a host folder.

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

The `release-gate-ops` skill (merged from `move-gate-date`+`update-release-date`) exercises the *full*
stack: orchestrator → rm-specialist → skill → `/api/date-mover/move-gate-date`
→ `DateMoverService` → `JiraConnector` + `ConfluenceConnector` (Route J) or
`releaseVersionsEmailConfig.json` slip + `sprintDates` extension (Route C). Use it
as the reference shape when porting other capabilities from
`CONSOLIDATION.md`.

## Skill authoring rules

Per `.cursor/rules/documentation-consistency.mdc`:

- Frontmatter: `name`, `description` (active verb + "Use when"), optional `audience`
- Required sections in order: `## When to Use This Skill`, `## Quick Start`,
  `## Core Rules`, `## Output Format`, `## Quality Validation`
- Description must use active verbs ("Generate...", "Fetch...")
- Reference decision IDs (D1, D10, etc.) and rules when explaining "why"
