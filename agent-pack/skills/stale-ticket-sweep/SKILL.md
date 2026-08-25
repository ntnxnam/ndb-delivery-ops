---
name: stale-ticket-sweep
description: Periodic review of tickets idle for N weeks. Proposes re-prioritise / reassign / close decisions for each. Use weekly to keep the backlog healthy.
audience: tpm, portfolio_mgr
---

## When to Use This Skill

- Weekly scheduled backlog hygiene pass
- User asks "what's stale?" or "show me old tickets"
- Before a release boundary — sweep open tickets that won't make the cut
- After a team change — sweep tickets owned by departed engineers

## Quick Start

```
Input: {
  productId: 'ndb',
  staleThresholdDays: 21,  // configurable; default 3 weeks
  scope: 'all' | 'active-release' | 'team:<teamId>'
}

Output: a table of stale tickets with proposed actions.

Procedure:
1. Query: tickets with no updates in N days, not Done/Closed.
2. For each, classify the staleness reason (see R1-R5).
3. Propose action: re-prioritise / reassign / close / ask-owner.
4. Render proposal table.
5. User approves in bulk or per-ticket.
6. Apply with audit log.
```

## Core Rules

1. **Stale = no updates in N days** where "update" includes comments,
   status changes, field changes. Default N=21. Configurable.
2. **Classify the stale-reason** before proposing action:
   - **Stalled-owner** — assignee hasn't worked on it in N days, may be
     overloaded → re-prioritise or reassign
   - **No-assignee** — never picked up → propose assignment or close
   - **Departed-owner** — assignee no longer on the team → reassign
     (look up successor via `productService`)
   - **Superseded** — a newer ticket addresses the same issue → close
     with link to the newer
   - **Out-of-scope** — release moved on, this ticket no longer fits →
     defer or close
3. **Never auto-close.** Close proposals require user approval (the
   ticket might still be valid; the user has context the agent lacks).
4. **Cite the staleness** — when was the last update? what kind of update?
5. **Reassignment respects component ownership** via `productService`.
6. **Don't sweep planning-release tickets** unless explicitly scoped —
   they're meant to be stale until planning kicks off.
7. **Audit log every apply.**

## Output Format

```
Stale tickets (no updates in ≥21 days) — scope: NDB active releases

| Ticket  | Title         | Assignee   | Days idle | Reason            | Proposed action          | Confidence |
|---------|---------------|------------|-----------|-------------------|--------------------------|------------|
| NDB-100 | Fix API timeo…| jane.doe   | 45        | Stalled-owner     | Reassign to bob (suc.)   | medium     |
| NDB-105 | Add metric...  | (unassigned)| 30       | No-assignee       | Assign to storage team   | medium     |
| NDB-110 | Old migration | alice (gone)| 60       | Departed-owner    | Reassign to charlie      | high       |
| NDB-115 | Old typo fix  | bob        | 90        | Superseded        | Close, link to NDB-200   | high       |
| NDB-120 | Edge case     | dave       | 35        | Out-of-scope (2.10)| Defer to 2.12             | medium     |

Summary: 5 tickets. 2 reassign, 1 assign, 1 close, 1 defer.

[Approve all] [Approve selection] [Edit proposals] [Cancel]
```

## Quality Validation

- [ ] Every stale ticket has a classified reason
- [ ] Every proposed action has a confidence
- [ ] Close proposals include a link to the superseding ticket
- [ ] Reassignment uses component-owner lookup, not generic team lead
- [ ] User approval gate is present
- [ ] Audit log written for every approved action
- [ ] Planning-release tickets are NOT swept by default

## Common Mistakes to Avoid

- Auto-closing tickets (forbidden — close requires user approval)
- Reassigning to a departed owner's manager without checking productService
- Treating tickets in planning releases as stale (they're meant to be idle)
- Forgetting the "days idle" metric in output

## Cross-references

- `.cursor/agents/specialists/triage-specialist.md`
- `.cursor/rules/citation-first-output.mdc`
- `DECISIONS.md` — D19
