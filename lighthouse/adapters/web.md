# Adapter — delivery-ops web runtime

The web chat (`POST /api/ai/chat`) loads this pack through
`loadAgentPack()` and runs `runAgentTurn()` from
`@portfolio-delivery-ops/shared`. It must not keep a parallel system
prompt or skill list inside `naiService.js`.

Runtime shape (Wave 4 / D42):

1. **Perceive** — `chatIntentRouter.extractScope` + `chatSnapshotBuilder.buildSnapshot`
2. **Memory** — load session/user/org records; merge resolved entities; optional `remember:` line
3. **Bootstrap** — orchestrator identity + constitutional rules + compact perceive JSON + memory
4. **Plan / act** — `read` / `draft` tools run; `mutate` (`propose_jira_write`) is HITL-queued and never executed
5. **Answer** — final assistant prose; `trace`, `provenanceId`, `pendingApprovals` returned to the client

Exec / release summary endpoints still use one-shot `chatCompletion`. Do
not add new SOPs there. D26 (who may approve which mutate) is still open.
