# Adapter — OpenAI Codex

Codex is a **host**, not the cookbook home (D38).

## Skills discovery

Project-level: `.codex/skills` → symlink to `agent-pack/skills`.

When adding a skill: create it under `agent-pack/skills/`, register in
`manifest.json`. Do not author a Codex-only long-form copy under `.codex/`.

## Load order

1. Point at this pack (`AGENT_PACK_ROOT` or repo-relative `agent-pack/`).
2. Prefer `loadAgentPack()` when the Node shared package is available.
3. Otherwise read `manifest.json` + skill paths directly.
4. Constitutional product rules: `agent-pack/rules/`.

## Builder pipeline skills

`multi-model-review` and `exec-perspective` live in the pack. Map "spawn
readonly subagent" to Codex's multi-agent / parallel task equivalent.
Keep Fix as a separate user-approved step.
