# Memory (schema only)

The compounding loop from the cookbook (`memory.md`) is a **runtime
store**, not a checked-in diary. This folder holds the contract.

Tiers:

| Tier | Key | Lifetime |
|---|---|---|
| `session` | conversation + resolved entities | one chat / job |
| `user` | corrections and preferences | until the user clears them |
| `org` | compounding SOP deltas | durable, reviewed |

See `schema.json`. Implementations live in the host (web DB, later
Slack, etc.). The pack does not embed secrets or live memory files.
