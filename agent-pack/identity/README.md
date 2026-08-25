# Identity — orchestrator + specialists (D16, D38)

This folder is the portable identity pack (`system.md` equivalent).
Cursor sees it via `.cursor/agents` → this directory. Any other host
loads it with `loadAgentPack()`.

Per **D16**, this project follows Anthropic's **orchestrator-workers**
pattern. ONE user-facing agent (`ops-assistant.md`) is the front door.
Internal specialists (in `specialists/`) handle persona- or task-specific
deep work; the orchestrator delegates to them but users never address
them directly.

## The orchestrator

| Agent | File | When to invoke |
|---|---|---|
| Ops Assistant | `ops-assistant.md` | `@ops-assistant` in Cursor chat, or any question in the delivery-ops embedded chat panel |

## Internal specialists

The orchestrator dispatches based on audience + question type. Users do
not select these manually.

| Specialist | File | Owns |
|---|---|---|
| Team Executive Specialist | `specialists/team-exec-specialist.md` | Team Executive / Director status answers (D15 protocol) |
| TPM Specialist | `specialists/tpm-specialist.md` | Weekly status (D17), cross-team coordination |
| RM Specialist | `specialists/rm-specialist.md` | Release readiness, gates, cascade renames |
| Triage Specialist | `specialists/triage-specialist.md` | 4 triage flavours (D19) |
| Confluence Publisher Specialist | `specialists/confluence-publisher-specialist.md` | All Confluence writes |
| Dependency Tracker Specialist | `specialists/dependency-tracker-specialist.md` | JIRA dep graph (D18) |

## Authoring conventions

For both the orchestrator and specialists:

- Frontmatter: `name`, `role` (`orchestrator` | `specialist`), `parent`
  (specialists only), `description`, `audience`
- Description starts with an active verb and includes "Use when"
- Sections: `## When the orchestrator delegates to me` (specialist) /
  `## When to use this agent` (orchestrator), `## What I do` / `## Service calls` /
  `## Citation rules` / `## Audience rendering` / `## When to ASK` /
  `## Cross-references`
- Reference decision IDs (D1, D10, etc.) and skill files

## Read order

When the orchestrator boots a session:

1. Host persona (Cursor: `~/.cursor/AGENTS.md`; web: session role)
2. Audience presets (`audience.md`)
3. This pack’s orchestrator (`ops-assistant.md`)
4. Per question: specialist + skill from `agent-pack/skills/`

## Deprecated (deleted in Phase A)

- `tpm-assistant.md` — replaced by `specialists/tpm-specialist.md` + skills
- `rm-assistant.md` — replaced by `specialists/rm-specialist.md` + skills
