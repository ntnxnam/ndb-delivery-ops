---
name: crisis-triage
description: Coordinate P0 / blocker / executive-escalation triage. Establish immediate ownership, propose a response plan, surface dependencies, and broadcast notifications. Used for fires, not routine bug triage.
audience: tpm, portfolio_mgr, rm
---

## When to Use This Skill

- A P0 ticket is opened or escalated
- An exec ping arrives: "[release] is at risk" / "this customer is blocked"
- A production incident maps to a JIRA ticket needing immediate response
- The user invokes `crisis-triage` for a specific ticket
- Escalated from `bug-triage` when severity=sev1 / priority=P0 is detected

## Quick Start

```
Input: {
  ticketKey: 'NDB-12345',
  source: 'exec-escalation' | 'customer-report' | 'production-incident' | 'sev1-bug',
  context?: string  // additional info from the escalation
}

Output: a crisis response proposal — immediate owner, ETA, communications plan.

Procedure:
1. Fetch the ticket + recent comments + linked tickets via jiraConnector.
2. Run dependency-walk skill upstream (is the ticket blocked by anyone?)
3. Identify the on-call / component owner via productService.
4. Compute the impact: which release? which customers? what's the deadline?
5. Draft a response plan: ownership, ETA, comms, follow-up cadence.
6. Present for approval. On approve:
     a. Assign ticket (jiraConnector.update)
     b. Set priority/severity if not already set
     c. Post a kickoff comment to the ticket
     d. Notify the on-call team (slackConnector if configured)
     e. Schedule a follow-up status check
7. Audit log every step.
```

## Core Rules

1. **Speed matters but never skip approval.** Even crisis triage shows the
   proposed ownership / plan before applying. The user approves once;
   subsequent applies are batched.
2. **Run upstream-dep walk first** — a P0 ticket may be blocked by another
   ticket that's the actual root. Triage the chain, not just the leaf.
3. **Component owner from `productService`** — never assign a generic
   "team lead" without naming the actual person.
4. **Communications plan is part of triage.** Identify who needs to know
   (Team Executive? Customer success? Sales?) and propose the comm channel.
5. **Set up follow-up cadence.** P0s should have a 15-min / 1-hour / 4-hour
   check-in schedule, configurable per crisis.
6. **Citation on every claim** (D10). Why is this P0? Cite the source
   (customer report, exec message, sev1 detection rule).
7. **Audit log per step** — crises will be post-mortem'd; the chain of
   actions matters.

## Output Format

```
🔴 CRISIS TRIAGE — [NDB-12345]

Title: Write throughput regression in storage subsystem
Source: exec-escalation (Slack thread: ...)
Severity (inferred): sev1
Affected: NDB-2.11 release (target RTM 2026-06-15, currently amber per
  [source: statusService.releaseRag(NDB-2.11)])
Customer impact: 3 customers reporting via support tickets (cited)

Upstream chain (via dependency-walk):
  [NDB-12345] (this)  ← root, no upstream blockers

Proposed response plan:
  Owner: jane.doe (storage team lead, per productService)
  Priority: P0
  ETA target: 24 hours for root cause, 72 hours for hotfix
  Comms:
    - Post kickoff comment to [NDB-12345]
    - Notify #storage-oncall Slack channel
    - Notify Team Executive via Email digest (high-priority flag)
  Follow-up cadence:
    - 1-hour status check via Slack thread
    - 4-hour written update via Slack
    - End-of-day summary via Email to broad leadership

[Approve plan and execute] [Edit plan] [Cancel]
```

After approval:

```
✓ NDB-12345 assigned to jane.doe, priority=P0
✓ Kickoff comment posted to NDB-12345
✓ Slack notification sent to #storage-oncall
✓ Slack notification sent to Team Executive (high-priority DM)
✓ Follow-up scheduled: 1-hour check at 2026-05-19 15:30 UTC

Audit log: reports/audit/triage-crisis-NDB-12345-2026-05-19T14-30Z.json
```

## Quality Validation

- [ ] Upstream-dep walk was executed (even if no upstream blockers found)
- [ ] Component owner is a named person, not a generic team
- [ ] ETA is specific (date+time), not vague ("ASAP")
- [ ] Comms plan names channels + recipients
- [ ] Follow-up cadence is scheduled with concrete timestamps
- [ ] Citations on impact claims (customer count, release status)
- [ ] User approved the full plan before any apply
- [ ] Audit log written for every action

## Common Mistakes to Avoid

- Skipping the upstream-dep walk (root cause might be elsewhere)
- Assigning to "team lead" without naming the person
- ETAs like "ASAP" instead of concrete times
- Forgetting comms — the bug being assigned doesn't mean people know
- Forgetting to schedule follow-up — crises drift without check-ins
- Auto-broadcasting without approval (Slack to Team Executive without confirmation)

## Cross-references

- `.cursor/skills/dependency-walk/SKILL.md` (used for upstream check)
- `.cursor/agents/specialists/triage-specialist.md`
- `.cursor/agents/specialists/dependency-tracker-specialist.md`
- `DECISIONS.md` — D19 (4 triage flavours), D3 (Slack connector)
