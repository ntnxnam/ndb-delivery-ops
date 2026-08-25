# Adapter — future host (lift-and-shift checklist)

To run this product on Slack, another IDE, or a vendor agent platform:

1. Point the host at this `agent-pack/` directory (or set `AGENT_PACK_ROOT`).
2. Call `loadAgentPack()` — do not re-parse ad hoc.
3. Register the same MCP server / Layer 3 services as tools.
4. Map host auth → pack identity (`role`, `audience`, `productId`).
5. Honor `toolClass`: `mutate` stays HITL on every host.
6. Persist memory with the schema in `memory/schema.json`.
7. Do **not** copy skills into the host’s proprietary format as a fork.
   If the host requires its own files, generate them from the pack.

A successful lift is: new adapter directory + host config. Zero new SOP
markdown.
