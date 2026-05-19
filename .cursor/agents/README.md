# Project sub-agents

Project agents are invoked by name in chat (`"tpm-assistant"`, `"rm-assistant"`)
and switch the active persona for that conversation. They are NOT delegated to
subagent tools — they're adopted directly, same convention as the inherited
`ndb-rca-agent` at user level.

| Agent | File | When to invoke |
|---|---|---|
| TPM Assistant | `tpm-assistant.md` | "tpm-assistant", "help me triage tickets", "create a Confluence page from JIRA" |
| RM Assistant | `rm-assistant.md` | "rm-assistant", "prep release status", "rename release", "exec summary" |

Both files are created in Phase 6.

## Authoring conventions (mirrors `~/.cursor/agents/`)

- Frontmatter must include `name`, `description`, `triggers`, `mode`.
- The `description` starts with an active verb and contains "Use when".
- Required sections (in order): `## Mandatory protocol`, `## What you do`,
  `## What you never do`, `## Outputs`.
- Read `~/.cursor/AGENTS.md` first, then this `AGENTS.md`, then the agent file.
