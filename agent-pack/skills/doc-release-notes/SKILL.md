---
name: doc-release-notes
description: Draft and maintain Release Notes — what shipped, what changed, breaking changes, upgrade notes per release. Use when a release ships, scope lands, or user asks "draft release notes".
audience: team_mgr, tpm, portfolio_mgr, team-exec, director
---

## When to Use This Skill

- Release cut / gate promoted (CCM/CG/PG/GA)
- User asks "draft release notes for NDB-2.11"
- Pipeline stage 8.5 when fixVersion scope changes
- Quarterly Team-Exec report needs release-notes section

## Quick Start

```
Input: { productId, releaseName, fromVersion, toVersion }
Output: apps/delivery-ops/docs/RELEASE_NOTES.md (rolling) + docs/release-notes/<release>.md (versioned)
```

Procedure:
1. Fetch landed scope: `project = NDB AND fixVersion = <release> AND status in (Resolved, Closed) AND resolution in (Fixed, Done)`
2. Group by issuetype: Feature → Enhancement → Bug Fix → Task
3. For each: key, summary, owner team, JIRA link, one-line impact (plain English)
4. Sections per `documentation-consistency.mdc`:
   - Frontmatter: `product`, `release`, `date`, `gateStatus`, `source @ timestamp`
   - Highlights (3-5 bullets, exec-readable)
   - What's New / Enhancements / Bug Fixes / Breaking Changes / Upgrade Notes
   - Known Issues pointer → `KNOWN_ISSUES.md`
5. Breaking changes flagged with `⚠️` and migration step
6. Cite every bullet with JIRA key

## Output Template

```markdown
---
product: NDB
release: "2.11"
date: 2026-05-19
gate: GA 2026-06-01
source: jiraConnector.searchByJql @ 2026-05-19T12:00Z
---

# Release Notes — NDB 2.11

## Highlights
- ...

## What's New
- [NDB-123] ... — [link]

## Breaking Changes
- ⚠️ ...

## Upgrade Notes
- ...

## Known Issues
See [KNOWN_ISSUES.md](./KNOWN_ISSUES.md)
```

## KPI contract

- `KPI: every fixVersion ticket appears exactly once` — MISS if missing/duped
- `KPI: breaking changes have migration steps` — MISS if bare
- `KPI: all claims have JIRA links + timestamp` — MISS if uncited

## Delegation

Owner: `doc-specialist`. Triggered by `ops-assistant` or pipeline stage 8.5.
