---
name: doc-known-issues
description: Maintain the Known Issues list — open bugs, workarounds, deferred items with JIRA links. Use when a bug is deferred, a workaround exists, or the user asks "what are the known issues?"
audience: ic, qa_lead, team_mgr, portfolio_mgr
---

## When to Use This Skill

- A bug is deferred or marked known-issue in JIRA (label `known-issue`, `deferred`, status `Deferred`)
- User asks "update known issues" / "document known issues" / "what's broken?"
- Pipeline stage 8.5 Doc sign-off when diff contains bug workarounds or deferred scope
- Release gate review needs known-issues appendix

## Quick Start

```
Input: { productId, releaseName, includeResolved: false }
Output: lighthouse/docs/guides/KNOWN_ISSUES.md (canonical) + optional lighthouse/docs/guides/<release>.md
```

Procedure:
1. Fetch deferred/known-issue tickets: `project = NDB AND fixVersion = <release> AND (labels in (known-issue, deferred) OR status = Deferred) AND issuetype in (Bug, Task)`
2. For each: key, summary, severity, workaround (from description/comments), JIRA link, introduced-in version
3. Render table per `documentation-consistency.mdc` section order:
   - Frontmatter: `product`, `release`, `lastUpdated`, `source: jira live query @ timestamp`
   - Table columns: `JIRA Key | Summary | Severity | Workaround | Introduced | Link`
4. Preserve existing entries not in current release (carry-over)
5. Cite every row with JIRA link; no uncited claim passes QA

## Output Template

```markdown
---
product: NDB
release: "2.11"
lastUpdated: 2026-05-19
source: jiraConnector.searchByJql @ 2026-05-19T12:00Z
---

# Known Issues — NDB 2.11

| Key | Summary | Severity | Workaround | Introduced | Link |
|---|---|---|---|---|---|
| NDB-12345 | ... | Critical | ... | 2.10 | [NDB-12345](https://jira.nutanix.com/browse/NDB-12345) |

*No known issues* — when empty, state explicitly with timestamp.
```

## KPI contract

- `KPI: all deferred JIRA tickets appear in doc with link` — MISS if any missing
- `KPI: no broken JIRA links` — MISS if 404
- `KPI: workaround present for Critical/Major` — MISS if empty

## Delegation

Owner: `doc-specialist`. Triggered by `ops-assistant` or pipeline stage 8.5.
