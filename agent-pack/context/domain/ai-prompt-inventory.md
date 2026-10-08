---
name: ai-prompt-inventory
area: platform
---

# AI prompt inventory

Canonical portable copies live under `agent-pack/prompts/`. Runtime JS may
still embed the same text until wired to `loadAgentPack().prompts`.

## Production (shipped)

| Prompt id | Runtime constant / file | Surfaces |
|---|---|---|
| `feature-exec-summary` | `naiService.EXEC_SUMMARY_SYSTEM_PROMPT` | Project Status, SoS, Feature Dashboard cells |
| `release-health-briefing` | `naiService.RELEASE_SUMMARY_SYSTEM_PROMPT` | Release Brief |
| `sos-tier-briefing` | `naiService.SOS_TIER_SYSTEM_PROMPT` | SoS Summary tier boxes |
| `sprint-leadership-asks` | `naiService.SPRINT_LEADERSHIP_ASKS_SYSTEM_PROMPT` | Sprint Performance |
| `team-exec-report` | `aiReportService` system string | Team-Exec report polish |
| Chat / agent loop | `identity/ops-assistant.md` + `shared/agentRuntime` | `/chatbot` |

## Draft (not wired)

| Prompt id | Intent |
|---|---|
| `sos-leader-coaching` | Per-leader action items after SoS-by-leader load |
| `component-report-narrative` | Optional component health prose (context exists; no NAI constant yet) |

## Sync checklist (when editing a production prompt)

1. Edit `agent-pack/prompts/production/<id>.md` System Prompt block
2. Mirror into the JS constant named in frontmatter `runtime:`
3. Keep VALID TICKET KEYS + integrity block intact
4. Update this inventory if area/surfaces change
