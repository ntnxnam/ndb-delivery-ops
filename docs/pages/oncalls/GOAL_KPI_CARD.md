# Goal KPI Card — fix/oncall-chase-call-to-action

GOAL: 2-line chase refers to open tickets needing action (Need Info / Waiting / Aged) with real assignee owner and correct deadline, not closed tickets with generic owners.

SCOPE: apps/delivery-ops/server/routes/ai.js (validKeys source), server/services/naiService.js (ONCALL_CONCERN_SYSTEM_PROMPT + buildOncallConcernPrompt validKeys + assignee), mcp/shared/tools/buildOncallPrompt.ts (same), docs if needed
BASE: origin/main @ bd72548

DONE WHEN:
  1. Chase cites only open tickets (from openTickets prioritized by aged/needInfo/waiting), never closed gap taxonomy keys (duds/ndbGaps)
  2. Owner is real assignee from stack (e.g. "Ask Alice to…") not generic "NDB owner" / "on-call owner"; when unassigned, use assignee field or "owner"
  3. Deadline derived from workflow SLA (Need Info 3d, Waiting Customer 5d, Aged 7d) not arbitrary 7d/3d swap

AGENT KPIs:
  Developer: validKeys built from openTickets filtered/sorted by aged/needInfo/waiting (not gapMeta closed), stack blurbs include assignee, system prompt says chase open tickets with assignee deadline rules
  Impact Scout: grep validKeys consumers (routes/ai.js, naiService.js, buildOncallPrompt.ts) all patched
  Code Review: no generic owners, minimal-arch kept, no hardcoded product strings
  QA: chase keys are subset of openTickets, not gapMeta; assignee present
  Compile Gate: node --check PASS
  Merge: fix/oncall-chase-call-to-action → origin/main via --no-ff
