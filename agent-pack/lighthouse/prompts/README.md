# Portable LLM prompts

Canonical system prompts for generative surfaces. Hosts load via
`loadAgentPack().prompts` (or by reading this directory).

## Layout

| Path | Meaning |
|---|---|
| `production/` | Shipped — must stay in sync with runtime JS until fully wired |
| `draft/` | Agreed taxonomy / not yet called from server |
| `INDEX.md` | Registry |

## File contract

Every prompt file has YAML frontmatter:

```yaml
name: kebab-id
area: page-or-domain
audience: vp | director | tpm | ...
status: production | draft
runtime: path#CONSTANT   # or "not wired"
```

Sections (required):

1. `## Purpose`
2. `## System Prompt` — fenced block with the exact text sent as `role: system`
3. `## User prompt contract` — what the deterministic packet must include
4. `## Related` — context + rules + skills

## Edit policy

1. Change the markdown here first.
2. Mirror into the `runtime` JS constant (until loader wiring lands).
3. Never weaken ticket-key integrity blocks.
4. Prefer shorter, stricter prompts over open-ended essay prompts.
