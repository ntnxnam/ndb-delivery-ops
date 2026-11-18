# Workflows

Portable playbooks (D38). This directory is the source of truth.
`.cursor/workflows` is a symlink for the Cursor adapter.

A **workflow** is a multi-step orchestration that chains MCP tools and skills.
Each workflow is a markdown file with:

1. **Trigger** — when this workflow kicks in (user phrase or schedule).
2. **Inputs** — what the agent must collect before starting.
3. **Steps** — numbered, each calling a specific tool/skill/agent.
4. **Outputs** — the expected artefact (report, email, JIRA ticket, etc.).
5. **Failure handling** — what to do if any step fails.

Workflows differ from skills in two ways:
- A skill is a **capability**; a workflow is a **process** that combines
  capabilities.
- A workflow can call multiple agents; a skill stays inside one persona.

See `~/.cursor/skills-cursor/canvas/SKILL.md` for the broader pattern.

Workflows in this repo (populated during Phase 6 of the consolidation):

- `monday-release-status.md` — weekly release status pipeline.
- `quarterly-team-exec-report.md` — predictive Team Executive report + Confluence publish.
- `release-cascade-rename.md` — safe end-to-end version rename across filters.
