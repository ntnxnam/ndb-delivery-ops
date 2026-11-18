---
name: move-gate-date
description: DEPRECATED — use release-gate-ops. Kept as stub for backward compatibility until 2026-12-12. See agent-pack/skills/release-gate-ops/SKILL.md (Route J).
audience: rm, tpm, portfolio_mgr
---

# DEPRECATED — Merged into `release-gate-ops`

This skill was merged on **2026-11-12** into:

```
agent-pack/skills/release-gate-ops/SKILL.md
```

Use `release-gate-ops` (Route J) for all JIRA FEAT gate-date moves. This stub will be deleted after **2026-12-12**.

**Mapping:**

| Old | New |
|---|---|
| `move-gate-date` | `release-gate-ops` Route J (`ticketKey` present) |
| `POST /api/date-mover/move-gate-date` | Same endpoint, invoked via `release-gate-ops` |

Do not add new references to this file.
