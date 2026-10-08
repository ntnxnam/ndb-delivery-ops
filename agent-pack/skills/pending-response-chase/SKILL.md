---
name: pending-response-chase
description: Detect and chase pending responses to dependency or deferral asks. Per D19 — when team X asks team Y for a decision or commitment in a JIRA comment and team Y doesn't reply, surface the stuck request and prompt a chase. Detection is unreplied JIRA comments (D24).
audience: tpm, portfolio_mgr
---

## When to Use This Skill

- User asks "what's stuck waiting for a response?"
- User asks "any pending deferrals I need to chase?"
- Scheduled daily / weekly scan for stuck asks
- The TPM specialist invokes this during weekly status preparation
- Portfolio Manager wants to clear their reactive-load chase queue

## Detection (D24, locked 2026-10-05)

An ask is stuck when a JIRA comment that requests a response has no reply
comment within the stale threshold. Labels, status, custom fields,
Confluence tasks, and Slack are out of scope.

## Quick Start

```
Input: {
  productId: 'ndb',
  signal: 'jira-comment',
  staleThresholdDays: 5,  // ask is considered stuck if no reply comment in N days
  scope: 'active-releases' | 'team:<id>' | 'all'
}

Output: a table of stuck asks with proposed chase actions.

Procedure:
1. Scan JIRA comments for ask comments with no reply within
   staleThresholdDays.
2. Classify ask-type: dependency-ask, deferral-ask, generic-ask.
3. Propose a chase: comment on the same ticket. Escalate to the owner's
   manager only when rule 5 applies.
4. User approves → execute.
5. Audit log.
```

## Core Rules

1. **JIRA comments only (D24).** A stuck ask is an unreplied ask comment.
   Do not infer stuck asks from labels, status, custom fields, Confluence,
   or Slack.
2. **Don't double-chase.** If the agent has already chased an ask in the
   last N days, don't propose another chase unless the ask is now urgent
   (per the underlying ticket's priority).
3. **Chase is a JIRA comment** on the same ticket as the ask.
4. **Owner from the ask context**, not from a generic team lead. If a
   specific person was @mentioned in the original ask, they're the
   chase target.
5. **Escalation policy**: if a P0/P1 ask has been stuck for >2x the
   threshold, propose escalation to the owner's manager.
6. **Citation on every stuck ask** — link to the original ask + the
   detected absence-of-response.
7. **Audit log** including chase channel + recipient + message.

## Output Format

```
Stuck asks (no reply comment in ≥5 days)

| # | Ask                                  | Asker | Owner needed | Ticket   | Age | Proposed chase              |
|---|--------------------------------------|-------|--------------|----------|-----|-----------------------------|
| 1 | "Can storage team commit to FEAT-1?" | alice | storage lead | NDB-123  | 12d | Comment on NDB-123          |
| 2 | "Approve deferral of NDB-200?"       | bob   | rm           | NDB-200  | 8d  | Comment on NDB-200          |

Summary: 2 stuck asks.
[Approve all chases] [Edit] [Cancel]
```

## Quality Validation

- [ ] Every stuck ask cites the original JIRA comment
- [ ] Every stuck ask cites the absence of a reply comment (no reply since X)
- [ ] Chase is a comment on the same ticket
- [ ] No double-chase within the last N days
- [ ] Escalation policy triggered for P0/P1 stuck >2× threshold
- [ ] User approves before any chase is sent
- [ ] Audit log written

## Cross-references

- `.cursor/agents/specialists/triage-specialist.md`
- `.cursor/rules/citation-first-output.mdc`
- `DECISIONS.md` — D19 (4 triage flavours), D24 (unreplied JIRA comments)
