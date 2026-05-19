---
name: dependency-walk
description: Walk the JIRA dependency graph upstream or downstream from a ticket or release. Used to answer "what blocks this?" and to compute critical paths for landing predictions. Per D18.
audience: tpm, rm, portfolio_mgr, feat
---

## When to Use This Skill

- User asks "what's blocking [ticket]?" or "what's [feature] waiting on?"
- The VP specialist needs upstream-risk context for the risk register
- The TPM specialist needs cross-team dep callouts for the weekly status
- The crisis-triage skill needs to find the root of a P0 chain
- Computing critical path for a release's landing prediction

## Quick Start

```
Input: {
  startKey: 'NDB-12345',
  direction: 'upstream' | 'downstream' | 'both',
  maxDepth: 5,             // configurable; default 5
  includeInferred?: boolean // whether to scan Confluence/Slack for soft deps
}

Output: a directed graph (nodes = tickets, edges = links) with team labels.

Procedure:
1. Fetch start ticket via jiraConnector.getIssue.
2. Read its issuelinks of type 'blocks' / 'is blocked by'.
3. For each linked ticket, recursively walk (cap depth at maxDepth).
4. Resolve team per ticket via productService.getTeamForTicket.
5. (Optional) scan Confluence/Slack for inferred deps if requested.
6. Return graph object.
```

## Core Rules

1. **Cap depth at maxDepth** (default 5). Set `truncated: true` if hit.
2. **Cache walks** per `(startKey, direction, maxDepth, refreshTimestamp)`
   per D11 (Sync Hub freshness pattern).
3. **Visit each ticket once** to avoid cycles. Maintain a `visited` set.
4. **Cycle detection** — if a cycle is found, return the cycle edges
   marked as `cyclical: true` and emit a warning.
5. **Citation on every edge**:
   - JIRA link: `[issuelink#54321]`
   - Inferred (from Confluence/Slack): the source URL + matched phrase
6. **Visually distinguish JIRA-link edges from inferred edges** in any
   rendered output — never blend them.
7. **Cross-release flag**: edges where source and target are in different
   releases get `crossRelease: true` (high signal for VP risk register).
8. **Don't auto-create JIRA links** for inferred dependencies. Surface as
   suggestions; require user approval per D18.

## Output Format

```typescript
{
  startKey: 'NDB-12345',
  direction: 'upstream',
  graph: {
    nodes: [
      { key: 'NDB-12345', summary: '...', team: 'storage', release: 'NDB-2.11', status: 'In Progress', assignee: 'jane.doe' },
      { key: 'NDB-12340', summary: '...', team: 'storage', release: 'NDB-2.11', status: 'Done',        assignee: 'bob' },
      { key: 'NDB-11000', summary: '...', team: 'api',     release: 'NDB-2.10', status: 'In Progress', assignee: 'alice', crossRelease: true },
    ],
    edges: [
      { from: 'NDB-12345', to: 'NDB-12340', linkType: 'is blocked by', inferred: false, sourceLink: 'issuelink#54321' },
      { from: 'NDB-12340', to: 'NDB-11000', linkType: 'is blocked by', inferred: false, sourceLink: 'issuelink#54400', crossRelease: true },
    ],
  },
  teams: new Set(['storage', 'api']),
  maxDepth: 5,
  actualDepth: 2,
  truncated: false,
  cycles: [],
  inferredCount: 0,
  refreshedAt: '2026-05-19T12:30Z'
}
```

When rendered for `vp` audience (compact):

```
[NDB-12345] (storage, in progress) is blocked by:
  └─ [NDB-12340] (storage, done) — was blocked by [NDB-11000] (api, in progress, cross-release ⚠)
```

When rendered for `tpm` audience (full):

```
Dependency chain upstream of [NDB-12345]:

Depth 0: [NDB-12345] (jane.doe @ storage) — In Progress
   ↑ blocked by [issuelink#54321]
Depth 1: [NDB-12340] (bob @ storage) — Done
   ↑ blocked by [issuelink#54400] ⚠ cross-release
Depth 2: [NDB-11000] (alice @ api) — In Progress, release NDB-2.10

Teams touched: storage, api
Cross-release edges: 1
Truncated: no (actualDepth=2, maxDepth=5)
```

## Quality Validation

- [ ] Every edge has a citation (sourceLink or matched phrase)
- [ ] `truncated` flag is set correctly if maxDepth hit
- [ ] Cycle detection ran (`cycles` array is present, even if empty)
- [ ] Cross-release edges are flagged
- [ ] Inferred edges (if any) are visually distinct from JIRA-link edges
- [ ] Cache key includes refreshTimestamp
- [ ] Audience-appropriate render: VP compact, TPM full, RM team-aggregated

## Common Mistakes to Avoid

- Forgetting cycle detection (infinite recursion)
- Mixing JIRA-link and inferred edges in the same render without
  distinguishing them
- Truncating silently — always set `truncated: true` with a warning
- Walking past `maxDepth` "just this once" for one ticket — breaks
  caching contract
- Auto-creating JIRA links for inferred deps (forbidden, D18)

## Cross-references

- `.cursor/agents/specialists/dependency-tracker-specialist.md`
- `.cursor/rules/citation-first-output.mdc`
- `DECISIONS.md` — D18
