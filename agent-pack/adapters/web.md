# Adapter — delivery-ops web runtime

The web chat (`POST /api/ai/chat` today) must load this pack through
`loadAgentPack()` in `@portfolio-delivery-ops/shared`. It must not keep a
parallel system prompt or skill list inside `naiService.js`.

Target shape:

1. Bootstrap identity (orchestrator + caller audience + product set)
2. Attach constitutional rules as non-overridable policy
3. Select a skill from the manifest
4. Run the tool loop against Layer 3 services / MCP
5. Write session memory using `memory/schema.json`

Until the mailbox chat is replaced, treat any prompt inside
`naiService` as **legacy** and do not add new SOPs there.
