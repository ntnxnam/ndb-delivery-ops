---
name: update-release-date
description: DEPRECATED — use release-gate-ops. Kept as stub for backward compatibility until 2026-12-12. See agent-pack/skills/release-gate-ops/SKILL.md (Route C).
---

# DEPRECATED — Merged into `release-gate-ops`

This skill was merged on **2026-11-12** into:

```
agent-pack/skills/release-gate-ops/SKILL.md
```

Use `release-gate-ops` (Route C) for all release-config gate-date slips. This stub will be deleted after **2026-12-12**.

**Mapping:**

| Old | New |
|---|---|
| `update-release-date` | `release-gate-ops` Route C (`release` key, no ticket) |
| Direct JSON edit of `releaseVersionsEmailConfig.json` | Same file, via `release-gate-ops` slip pattern (dotted→solid + sprint extension) |

Do not add new references to this file.
