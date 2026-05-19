---
name: bug-triage
description: Triage incoming defect tickets — propose owner, priority, component, severity, and fix-in-this-release-or-defer for each. Always proposes; never auto-applies. Use when new bugs need categorisation, typically batched weekly or on-demand.
audience: tpm, portfolio_mgr
---

## When to Use This Skill

- New defects detected via a JIRA query (e.g. "created in last 7 days,
  no priority set")
- Weekly batch triage session: "review all incoming bugs since last week"
- A single P0 / customer-escalated bug needs immediate categorisation
  (delegate to `crisis-triage` if truly P0)
- The Portfolio Manager asks "what new bugs need triaging?"

## Quick Start

```
Input: {
  productId: 'ndb',
  query: 'project = NDB AND issuetype = Bug AND created >= -7d AND priority is EMPTY',
  // OR a list of explicit ticket keys
  ticketKeys?: string[]
}

Output: a triage proposal table for user review + approval.

Procedure:
1. Fetch matching bugs via jiraConnector.search
2. For each bug, classify using rules R1–R7 (see Core Rules)
3. Compute proposed values: priority, owner, component, severity, fix-or-defer
4. Render as a table with rationale + confidence per ticket
5. User approves in bulk OR per-ticket
6. On approval: jiraConnector.bulkUpdate(...) with audit log
```

## Core Rules

1. **Always propose, never auto-apply.** Even with high confidence, the
   user must approve. (Mutating-action policy from `triage-specialist`.)
2. **Cite the rule that fired** for every proposal. "Priority=P1 because
   rule R3 (Customer-reported + Severity=High)".
3. **Severity inferred from reporter + symptoms**, not from arbitrary
   defaults:
   - Customer-reported → sev2 minimum
   - Customer-reported + production-impact wording → sev1
   - Internal report → sev3 default
   - Test escape → sev2
4. **Priority follows severity + release proximity**:
   - sev1 → P0 (route to `crisis-triage`)
   - sev2 + active release → P1
   - sev3 + active release → P2
   - any sev + planning release → P3 (deferrable)
5. **Owner from component**: use `productService.getOwnerForComponent(productId, component)`.
   If no component assigned → propose component first (separate proposal).
6. **Component from keywords**: scan title + description for known
   component keywords (storage, networking, UI, API, …) and propose.
   Confidence: high if multiple matches, medium if one, low if inferred
   from description only.
7. **Fix-in-this-release decision**:
   - P0/P1 + active release + close to RTM → fix this release (high confidence)
   - P2 + active release + plenty of time to RTM → fix this release (medium)
   - P3 or far from RTM → defer to next release
   - Customer-impact + any priority → fix this release (override)

## Output Format

```
| Ticket  | Title (truncated)       | Curr Pri | → Proposed | Component | Owner    | Fix vs Defer | Confidence | Rationale            |
|---------|-------------------------|----------|-----------|-----------|----------|--------------|------------|----------------------|
| NDB-1234| Write throughput regr…  | (none)   | P1        | storage   | jane.doe | fix          | high       | R3, R5, R7           |
| NDB-1235| Typo on UI login        | (none)   | P3        | ui        | bob      | defer        | medium     | R4 (sev3 internal)   |
| NDB-1236| API returns 500 on...   | (none)   | P0        | api       | (none)   | escalate     | high       | R4 → crisis-triage   |

Summary: 3 bugs proposed. 2 fix-now, 1 defer, 1 escalation.
Time saved: ~15 min vs manual triage.

[Approve all] [Approve selection] [Edit proposals] [Cancel]
```

After approval:

```
✓ NDB-1234 updated: priority=P1, component=storage, assignee=jane.doe, label=fix-in-2.11
✓ NDB-1235 updated: priority=P3, component=ui, assignee=bob, label=defer-to-2.12
→ NDB-1236 escalated to crisis-triage skill (P0 + no owner)

Audit log: reports/audit/triage-bug-2026-05-19T13-22Z.json
```

## Quality Validation

- [ ] Every proposed value has a rule citation
- [ ] Every proposal includes a confidence level
- [ ] No bug is silently skipped — every input ticket appears in the output table
- [ ] P0 / sev1 bugs are escalated to `crisis-triage` (not handled here)
- [ ] User-approval gate is present and explicit
- [ ] Audit log written after apply
- [ ] No bug is updated without explicit approval

## Common Mistakes to Avoid

- Defaulting priority without a rule citation
- Auto-applying changes without approval
- Skipping the audit log step
- Assigning owner=null (without proposing component first)
- Treating an internal report the same as a customer-reported one

## Cross-references

- `.cursor/agents/specialists/triage-specialist.md`
- `.cursor/skills/crisis-triage/SKILL.md` (for P0 escalations)
- `.cursor/rules/citation-first-output.mdc`
- `DECISIONS.md` — D19
