# Agent pack

Portable source of truth for the product’s agent cookbook (D38).

This directory is **not** a Cursor feature. Cursor, the delivery-ops web
runtime, MCP, and any future host are **adapters**. Lift-and-shift means
copying or pointing a new host at this pack and implementing one adapter.
Do not fork skills per surface.

## Layout

| Path | Cookbook ingredient | What it is |
|---|---|---|
| `identity/` | `system.md` | Orchestrator + specialist roles, boundaries, bootstrap |
| `skills/` | `skills.md` | Isolated, repeatable SOPs |
| `workflows/` | process graphs | Multi-step playbooks that chain skills |
| `rules/` | constitution | Runtime constraints the model cannot override |
| `context/` | domain + page briefs | Host-agnostic knowledge so leaving Cursor is not a rewrite |
| `prompts/` | LLM system prompts | Production + draft prompts; canonical copy for every generative surface |
| `memory/` | `memory.md` schema | Session / user / org memory contract (store is runtime) |
| `manifest.json` | registry | Capability type, tool class, owner, paths, context, prompts |
| `adapters/` | host notes | How Cursor / web / a future host consume this pack |

Start on a new host: `context/INDEX.md` → `prompts/INDEX.md` → identity.

## Capability types (Stage 6)

Every skill and workflow in `manifest.json` has one type. Do not put an
LLM in type `deterministic`.

| Type | Meaning |
|---|---|
| `deterministic` | Job / policy / JQL / sync. No model. |
| `generative` | One-shot bounded LLM with evals. |
| `agent` | Goal + tool loop until done. |
| `agentic` | Orchestrator + specialists + HITL. |

## Tool classes (Stage 13)

| Class | Policy |
|---|---|
| `read` | Auto; cite source |
| `draft` | Auto; human sends |
| `mutate` | HITL, dry-run, rollback |

## How a host loads the pack

```ts
import { loadAgentPack, extractSystemPromptBody } from '@portfolio-delivery-ops/shared';

const pack = loadAgentPack(); // or loadAgentPack('/path/to/agent-pack')
pack.identity.orchestrator.body;
pack.skills.get('team-exec-status-answer');
pack.constitutionalRules.map((r) => r.body);
pack.context.get('sos-leader')?.body;
const sys = extractSystemPromptBody(pack.prompts.get('release-health-briefing')!);
```

`AGENT_PACK_ROOT` overrides the default repo-relative path.

**Prompt sync:** production prompt markdown under `prompts/production/` is the
portable source of truth. `apps/delivery-ops/server/services/naiService.js`
still embeds copies until runtime wiring uses `extractSystemPromptBody`.

## What does **not** live here

Builder-only Cursor rules stay in `.cursor/rules/` (`minimal-architecture`,
`api-docs-required`, `page-docs-required`, `documentation-consistency`,
`gerrit-push-for-review`). Those are for people writing code in this
repo. They do not ship with a lifted agent.
