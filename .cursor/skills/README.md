# Project skills

Project-specific skills. Each is invoked by a specialist sub-agent under
`ops-assistant`. See `.cursor/agents/specialists/*.md` for which skill each
specialist owns.

## Skills in this project

| Skill | Owner specialist | Purpose | Decision IDs |
|---|---|---|---|
| `vp-status-answer/` | `vp-specialist` | Compound question + risk register answer for VP / Director | D4, D10, D15 |
| `weekly-status-email/` | `tpm-specialist` | 3-tier hybrid weekly status for broad leadership | D17, D15d |
| `bug-triage/` | `triage-specialist` | Proposes owner/priority/component/severity for new defects | D19 |
| `crisis-triage/` | `triage-specialist` | P0 / escalation response coordination | D19 |
| `stale-ticket-sweep/` | `triage-specialist` | Weekly backlog hygiene | D19 |
| `pending-response-chase/` | `triage-specialist` | Chase un-answered dep / deferral asks (D24 open) | D19, D24 |
| `dependency-walk/` | `dependency-tracker-specialist` | Upstream/downstream walk in JIRA dep graph | D18 |
| `confluence-width-cleanup/` | `confluence-publisher-specialist` | Pre-push storage XML cleanup (canonical at user level) | D3, D15d |

## User-level skills also available

Inherited automatically from `~/.cursor/skills/`:

- `vp-release-report/`
- `fetch-project-tickets/`
- `sprint-gantt-chart/`
- `predictive-vp-analytics/`
- `confluence-width-cleanup/` (canonical version)
- `vp-release-report/` (user-level)

## Skill authoring rules

Per `.cursor/rules/documentation-consistency.mdc`:

- Frontmatter: `name`, `description` (active verb + "Use when"), optional `audience`
- Required sections in order: `## When to Use This Skill`, `## Quick Start`,
  `## Core Rules`, `## Output Format`, `## Quality Validation`
- Description must use active verbs ("Generate...", "Fetch...")
- Reference decision IDs (D1, D10, etc.) and rules when explaining "why"
