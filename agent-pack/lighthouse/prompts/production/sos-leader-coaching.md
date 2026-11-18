---
name: sos-leader-coaching
area: sos-leader
audience: tpm, director
status: production
runtime: naiService#SOS_LEADER_COACHING_SYSTEM_PROMPT
---

# sos-leader-coaching

## Purpose

After SoS-by-leader data is loaded, generate **specific action items per eng
leader** (Anil / Naveen / Jovan / Ashish). Coaching for the leader’s org —
not a release-health briefing and not a per-ticket exec summary.

## Output shape (strict)

```
## Asks for <Leader Display Name>

1. Ask: <concrete action> | Why: <cited count + short summaries> | Owner: <role> | Urgency: P0|P1|P2
2. …
(up to 5; fewer if clean)
```

Cite tickets as `"short summary" (KEY)` — leaders skim summaries, not bare keys.

If the leader’s slice is clean: one line — no org-wide asks this cycle.

## Action buckets (priority order)

1. **Release blockers** — open P0 / must-fix under this leader’s managers
2. **Gate / schedule risk** — past-gate lagging; dates past next gate ≤14d; Red RAG
3. **Collateral completion** — Closed / CG Met / PG Met / Shipped missing Requirements / Design / Test Plan links
4. **JIRA hygiene** — Risk Indicator NotSet; status update ≥14d stale; Yellow/Red without Assessment or Path to Green; missing CG/PG on open FEATs
5. **KTLO under-attended** — open items with CVE / OnCall / System Test / Smokes / PreCommits / `*-deferred` / `*-long-term-funded`
6. **Ad-hoc crowding** — Direct Tickets / unplanned pressure (packet `adhoc` bucket)
7. **Delivery execution** — high outstanding Dev/Test; TBV pile; sprint mix (active vs closed)
8. **Ownership gaps** — empty Assignee Manager inside this leader’s expected managers

## Locked definitions

- Ad-hoc = Direct Tickets tier / unplanned pressure signals in packet only
- KTLO = label/component match set above when status still open
- Collateral = done-family statuses only (Closed, CG Met, PG Met, Shipped)
- Ask Owner = eng leader by default; cite FEAT Manager when present on the item
- No cross-leader peer compare

## System Prompt

See `SOS_LEADER_COACHING_SYSTEM_PROMPT` in `apps/delivery-ops/server/services/naiService.js`.

## User prompt contract

Deterministic pre-agg per leader (server builds; model does not count):

```
LEADER_ID / LEADER_NAME
VALID TICKET KEYS: KEY — short summary …
BUCKETS: … examples=["summary" (KEY); …]
SPRINT: byName / activeCount / closedCount / noSprintCount
RELEASES_TOUCHED: …
```

Close with: cite as `"short summary" (KEY)`; keys only from VALID TICKET KEYS.
