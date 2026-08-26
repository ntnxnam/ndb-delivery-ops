# Adapter — delivery-ops web runtime

The web chat (`POST /api/ai/chat`) loads this pack through
`loadAgentPack()` and runs `runAgentTurn()` from
`@portfolio-delivery-ops/shared`. It must not keep a parallel system
prompt or skill list inside `naiService.js`.

Runtime shape (Wave 1):

1. **Perceive** — `chatIntentRouter.extractScope` + `chatSnapshotBuilder.buildSnapshot`
2. **Bootstrap** — orchestrator identity + constitutional rules + compact perceive JSON
3. **Plan / act** — read-only tool loop (`list_skills`, `read_skill`, `read_specialist`, `get_release_snapshot`, `get_release_health`)
4. **Answer** — final assistant prose; `trace` is returned to the client

Exec / release summary endpoints still use one-shot `chatCompletion`. Do
not add new SOPs there. Session memory (`memory/schema.json`) is not
wired yet (Wave 4). Mutating tools stay refused until D26.
