---
name: backlog-triage
description: Triage backlog health — new defects, stale idle tickets, and pending unreplied asks — propose owner/priority/component/severity, fix-or-defer/close/reassign, and chase actions. Always proposes; never auto-applies. Use for weekly backlog hygiene, batch new-bug triage, or chasing stuck dependencies.
audience: tpm, portfolio_mgr
---

# Backlog Triage — Unified Backlog Health (D19, D24)

Single skill for **all** non-crisis backlog triage. Merged from `bug-triage` (new defects) + `stale-ticket-sweep` (idle N weeks) + `pending-response-chase` (unreplied JIRA comments D24). Every backlog hygiene query goes through this skill — routing by mode. P0 fires stay in `crisis-triage`.

## When to Use This Skill

- User says "triage new bugs", "what's stale?", "what's stuck waiting for response?" — any backlog health question
- Weekly scheduled hygiene pass: new defects since last week + stale tickets + pending asks in one sweep
- Portfolio Manager asks "what new bugs need triaging?" or "show me old tickets that won't make the cut"
- TPM needs to chase dependency/deferral asks that haven't received replies
- Before a release boundary — sweep open tickets that are idle or unowned
- After a team change — sweep tickets owned by departed engineers
- Any request that previously went to `bug-triage`, `stale-ticket-sweep`, or `pending-response-chase` — this skill replaces all three

If the ticket is P0 / sev1 / customer-escalated fire, use `crisis-triage` instead — it has immediate ownership + response plan + broadcast.

## Quick Start

```
Input: {
  productId: 'ndb',
  mode: 'new' | 'stale' | 'pending' | 'all',  // default 'all' for weekly sweep
  // mode=new
  query?: 'project = NDB AND issuetype = Bug AND created >= -7d AND priority is EMPTY',
  ticketKeys?: string[],
  // mode=stale
  staleThresholdDays?: 21,  // default 21
  scope?: 'all' | 'active-release' | 'team:<id>',
  // mode=pending
  pendingThresholdDays?: 5, // default 5, D24
  signal?: 'jira-comment',  // only JIRA comments per D24
}

Route by mode:
- new → classify new defects (owner/priority/component/severity/fix-or-defer)
- stale → classify stale reason + propose re-prioritise/reassign/close/defer
- pending → detect unreplied ask comments + propose chase comment
- all → run all three sequentially, render 3-section output

Output: merged proposal table per mode, user approval gate, audit log on apply.
```

## Core Rules

### Universal (all modes)

1. **Always propose, never auto-apply.** Every proposal requires user approval (bulk or per-ticket). No ticket is updated, assigned, or closed without explicit approval. Audit log after every apply.
2. **Cite the rule that fired** for every proposal. E.g. "Priority=P1 because R3 (Customer-reported + Severity=High)" or "Stalled-owner (45d idle, last update=comment by jane.doe)".
3. **Confidence per proposal** — high / medium / low, based on rule match strength. Never hide low-confidence proposals; surface them with lower confidence.
4. **Audit log every apply** to `reports/audit/triage-<mode>-<timestamp>.json` with who/what/when.

### Mode: new — Incoming defects (from bug-triage R1–R7)

5. **Severity from reporter + symptoms**, not arbitrary defaults:
   - Customer-reported → sev2 minimum
   - Customer-reported + production-impact wording → sev1 → escalate to `crisis-triage`
   - Internal report → sev3 default
   - Test escape → sev2
6. **Priority = severity + release proximity**:
   - sev1 → P0 (escalate to `crisis-triage`, do not handle here)
   - sev2 + active release → P1
   - sev3 + active release → P2
   - any sev + planning release → P3 (deferrable)
   - Customer-impact + any priority → override to fix this release
7. **Owner from component** via `productService.getOwnerForComponent(productId, component)`. If no component assigned → propose component first (separate proposal) from title/description keywords (storage, networking, UI, API…).
8. **Fix-in-this-release vs defer** (R7):
   - P0/P1 + active + close to RTM → fix this release (high)
   - P2 + active + plenty of time → fix this release (medium)
   - P3 or planning → defer to next release
9. **Escalate P0/sev1 to crisis-triage** — do not propose fix-or-defer for sev1; hand off with full context.

### Mode: stale — Idle tickets (from stale-ticket-sweep R1–R7)

10. **Stale = no updates in N days** where update = comments, status changes, field changes. Default N=21, configurable. Never use last-viewed or last-searched.
11. **Classify staleness reason before proposing** (5 types):
    - **Stalled-owner** — assignee hasn't worked in N days, may be overloaded → re-prioritise or reassign
    - **No-assignee** — never picked up → assign or close
    - **Departed-owner** — assignee no longer on team → reassign via `productService` successor lookup
    - **Superseded** — newer ticket addresses same issue → close with link to newer
    - **Out-of-scope** — release moved on, ticket no longer fits → defer or close
12. **Never auto-close.** Close proposals require user approval even with high confidence (ticket might still be valid).
13. **Don't sweep planning-release tickets by default** — they're meant to be stale until planning kicks off. Only include when `scope` explicitly includes planning releases.
14. **Reassignment respects component ownership** via `productService`, not generic team lead.

### Mode: pending — Stuck asks (from pending-response-chase D24)

15. **JIRA comments only (D24).** A stuck ask is an unreplied ask comment (no reply comment within `pendingThresholdDays`). Labels, status, custom fields, Confluence, Slack are out of scope.
16. **Don't double-chase.** If already chased within last N days, don't propose another unless now urgent (ticket is P0/P1).
17. **Chase is a JIRA comment** on the same ticket as the ask. Owner from ask context: @mentioned person, else asker's target team via `productService`.
18. **Escalation policy**: if P0/P1 ask stuck for >2× threshold (e.g. 5d → 10d), propose escalation to owner's manager.
19. **Citation on every stuck ask** — link to original ask comment + detected absence-of-reply (e.g. "Ask [link], no reply since 2026-11-01 (12d)").

## Output Format

### Mode: all (weekly sweep) — 3 sections in one report

```markdown
## Backlog Triage (all) — NDB, 2026-11-12, scope: active releases

### 1. New defects (mode=new) — 3 tickets since 2026-11-05
| Ticket  | Title              | Curr Pri | → Proposed | Component | Owner    | Fix vs Defer | Confidence | Rationale |
|---------|--------------------|----------|-----------|-----------|----------|--------------|------------|-----------|
| NDB-1234| Write throughput…  | (none)   | P1        | storage   | jane.doe | fix          | high       | R3,R5,R7  |
| NDB-1235| Typo on UI login   | (none)   | P3        | ui        | bob      | defer        | medium     | R4 sev3   |
| NDB-1236| API 500 on…        | (none)   | P0        | api       | (none)   | escalate     | high       | sev1→crisis |

### 2. Stale tickets (mode=stale) — ≥21d idle, 5 tickets
| Ticket  | Title         | Assignee   | Days idle | Reason         | Proposed action        | Confidence |
|---------|---------------|------------|-----------|----------------|------------------------|------------|
| NDB-100 | Fix API timeo…| jane.doe   | 45        | Stalled-owner  | Reassign to bob        | medium     |
| NDB-105 | Add metric... | (none)     | 30        | No-assignee    | Assign to storage team | medium     |
| NDB-110 | Old migration | alice(gone)| 60        | Departed-owner | Reassign to charlie    | high       |

### 3. Pending asks (mode=pending) — ≥5d no reply, 2 stuck
| # | Ask                                  | Asker | Owner needed | Ticket | Age | Proposed chase |
|---|--------------------------------------|-------|--------------|--------|-----|----------------|
| 1 | "Can storage commit to FEAT-1?"      | alice | storage lead | NDB-123| 12d | Comment on NDB-123 |
| 2 | "Approve deferral of NDB-200?"       | bob   | rm           | NDB-200| 8d  | Comment on NDB-200 |

Summary: 3 new (1 escalate), 5 stale (2 reassign, 1 assign), 2 pending chases.
[Approve all] [Approve by section] [Edit] [Cancel]
```

### After approval (per mode)

```
✓ NDB-1234 updated: priority=P1, component=storage, assignee=jane.doe, label=fix-in-2.11
→ NDB-1236 escalated to crisis-triage (P0 + no owner)
✓ NDB-100 reassigned: jane.doe → bob
✓ Chase comment posted to NDB-123: "Hi storage lead, gentle ping on FEAT-1 commitment (asked 12d ago by alice [link])"
Audit: reports/audit/triage-all-2026-11-12T14-30Z.json
```

## Quality Validation

- [ ] Every proposal has a rule/reason citation + confidence
- [ ] No ticket silently skipped — every input appears in output table (or explicitly escalated)
- [ ] P0/sev1 from mode=new escalated to `crisis-triage` (not handled here)
- [ ] Mode=stale: every ticket has classified reason + days-idle + no auto-close
- [ ] Mode=stale: planning-release tickets NOT swept unless explicitly scoped
- [ ] Mode=pending: every stuck ask cites ask link + absence-of-reply age
- [ ] Mode=pending: no double-chase within N days (unless now urgent)
- [ ] User approval gate present (bulk + per-section + per-ticket)
- [ ] Audit log written after apply with who/what/when
- [ ] No ticket updated/closed/chased without explicit approval
- [ ] Mode=all produces 3-section report with summary counts
