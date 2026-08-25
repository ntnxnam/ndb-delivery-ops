---
name: pending-response-chase
description: Detect and chase pending responses to dependency or deferral asks. Per D19 (4th triage flavour) — when team X asks team Y for a decision or commitment and team Y doesn't reply, surface the stuck request and prompt a chase. Open detail in D24.
audience: tpm, portfolio_mgr
---

## When to Use This Skill

- User asks "what's stuck waiting for a response?"
- User asks "any pending deferrals I need to chase?"
- Scheduled daily / weekly scan for stuck asks
- The TPM specialist invokes this during weekly status preparation
- Portfolio Manager wants to clear their reactive-load chase queue

## ⚠ Open Detail (D24)

The exact mechanism for detecting "did someone respond?" is **not yet
locked**. Candidate signals (to validate with the Portfolio Manager
before building):

- **JIRA comment threads** — an ask comment with no reply comment in N days
- **JIRA label changes** — a `needs-response` label that hasn't been removed
- **JIRA status transitions** — a status like `Pending Response` that
  hasn't moved
- **JIRA custom field** — a "Response Due Date" field that's past due
  without a "Response Received" timestamp
- **Confluence task list items** — `<ac:task-list>` items that haven't
  been checked off
- **Slack threads** — a question/ask posted that no one acked

This skill's implementation depends on which signal(s) the Portfolio
Manager confirms. Until D24 is resolved, the skill produces a
**best-effort** scan with explicit "confirmed signals" vs "inferred"
in its output.

## Quick Start (provisional pending D24)

```
Input: {
  productId: 'ndb',
  signals: ('jira-comment' | 'jira-label' | 'jira-status' | 'jira-custom-field' | 'confluence-task' | 'slack')[],
  staleThresholdDays: 5,  // ask is considered stuck if no response in N days
  scope: 'active-releases' | 'team:<id>' | 'all'
}

Output: a table of stuck asks with proposed chase actions.

Procedure:
1. For each enabled signal, scan the corpus:
     - jiraConnector.searchComments(...) for unreplied comments
     - jiraConnector.search labels="needs-response" with no recent activity
     - confluenceConnector for unchecked task items past their due date
     - slackConnector for unacked questions in tracked channels (Phase D)
2. Aggregate by ask (multiple signals on one item count once).
3. Classify ask-type: dependency-ask, deferral-ask, generic-ask.
4. Propose a chase action: DM the owner, comment on the ticket, escalate
   to manager.
5. User approves → execute.
6. Audit log.
```

## Core Rules

1. **Best-effort until D24 is resolved.** Output explicitly distinguishes
   "high-confidence stuck ask" (matched a confirmed signal) from
   "inferred stuck ask" (matched an unconfirmed signal).
2. **Don't double-chase.** If the agent has already chased an ask in the
   last N days, don't propose another chase unless the ask is now urgent
   (per the underlying ticket's priority).
3. **Chase channel respects the original ask channel** — JIRA-comment
   asks get JIRA-comment chases; Slack asks get Slack chases.
4. **Owner from the ask context**, not from a generic team lead. If a
   specific person was @mentioned in the original ask, they're the
   chase target.
5. **Escalation policy**: if a P0/P1 ask has been stuck for >2x the
   threshold, propose escalation to the owner's manager.
6. **Citation on every stuck ask** — link to the original ask + the
   detected absence-of-response.
7. **Audit log** including chase channel + recipient + message.

## Output Format (provisional)

```
Stuck asks (no response in ≥5 days)

| # | Ask                                  | Asker      | Owner needed | Channel     | Age | Confidence | Proposed chase                    |
|---|--------------------------------------|------------|--------------|-------------|-----|------------|-----------------------------------|
| 1 | "Can storage team commit to FEAT-1?" | alice      | storage lead | jira-comment| 12d | high       | Comment on NDB-123 + DM jane.doe  |
| 2 | "Approve deferral of NDB-200?"       | bob        | rm           | jira-label  | 8d  | high       | Slack #ndb-rm + DM ralph          |
| 3 | "API contract feedback?"             | dave       | api team     | slack-thread| 6d  | inferred   | Slack thread bump                  |

Summary: 3 stuck asks. 2 high-confidence, 1 inferred.
Estimated reactive load saved (you don't have to remember these): ~30 min/week.

[Approve all chases] [Edit] [Skip inferred] [Cancel]
```

## Quality Validation

- [ ] Every stuck ask cites the original ask source (ticket / page / Slack message)
- [ ] Every stuck ask cites the *absence* of response (no reply since X)
- [ ] Confidence is labelled per ask: high (matched a signal) vs inferred
- [ ] Chase channel matches the ask channel
- [ ] No double-chase within the last N days
- [ ] Escalation policy triggered for P0/P1 stuck >2× threshold
- [ ] User approves before any chase is sent
- [ ] Audit log written

## Open Questions to Resolve (D24)

Before this skill is production-ready, lock with the Portfolio Manager:

1. Which signal(s) does NDB actually use today? (JIRA comments / labels /
   status / Confluence tasks / Slack?)
2. Is there a custom field like "Response Required By" we should use?
3. Do dependency-asks live in JIRA `issuelinks` of a specific type?
4. Do deferral-asks have a specific JIRA workflow status?

These map to **D24** in `DECISIONS.md`.

## Cross-references

- `.cursor/agents/specialists/triage-specialist.md`
- `.cursor/rules/citation-first-output.mdc`
- `DECISIONS.md` — D19 (4 triage flavours), D24 (pending-response mechanism — OPEN)
