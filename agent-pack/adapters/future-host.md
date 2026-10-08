# Adapter — future host (lift-and-shift checklist)

To run this product on Slack, another IDE, or a vendor agent platform:

1. Point the host at this `agent-pack/` directory (or set `AGENT_PACK_ROOT`).
2. Call `loadAgentPack()` — do not re-parse ad hoc.
3. Load `pack.context` (start with `context/INDEX.md`) and `pack.prompts`
   (`extractSystemPromptBody` for one-shot NAI calls).
4. Register the same MCP server / Layer 3 services as tools.
5. Map host auth → pack identity (`role`, `audience`, `productId`).
6. Honor `toolClass`: `mutate` stays HITL on every host.
7. Persist memory with the schema in `memory/schema.json`.
8. Do **not** copy skills / prompts / context into the host’s proprietary
   format as a fork. If the host requires its own files, generate them
   from the pack.

A successful lift is: new adapter directory + host config. Zero new SOP
or prompt markdown.

### Minimum files a non-Cursor host must see

| Need | Pack path |
|---|---|
| Orchestrator | `identity/ops-assistant.md` |
| Surface map | `context/domain/app-surface-map.md` |
| Prompt registry | `prompts/INDEX.md` |
| Ticket-key rule | `rules/ai-ticket-key-integrity.mdc` |
| Citation rule | `rules/citation-first-output.mdc` |
| Persona rule | `rules/persona-aware-output.mdc` |
