---
name: sos-leader-coaching
area: sos-leader
audience: tpm, director
status: draft
runtime: not wired
---

# sos-leader-coaching

## Purpose

After SoS-by-leader data is loaded, generate **specific action items per eng
leader** (Anil / Naveen / Jovan / Ashish). Coaching for the leader’s org —
not a release-health briefing and not a per-ticket exec summary.

## Output shape (strict)

```
## Asks for <Leader Display Name>

1. Ask: <concrete action> | Why: <cited count + example keys> | Owner: <role> | Urgency: P0|P1|P2
2. …
(up to 5; fewer if clean)
```

If the leader’s slice is clean: one line — no org-wide asks this cycle.

## Action buckets (priority order)

Use only buckets that fire with cited evidence in the packet:

1. **Release blockers** — open P0 / must-fix under this leader’s managers
2. **Gate / schedule risk** — past-gate lagging; dates past next gate ≤14d; Red RAG
3. **Collateral completion** — done/cleared FEATs missing Requirements / Design / Test Plan links
4. **JIRA hygiene** — Risk Indicator NotSet; status update ≥14d stale; Yellow/Red without Assessment or Path to Green; missing CG/PG on open FEATs
5. **KTLO under-attended** — OPEN definition; candidates: CVE / OnCall / System Test / Smokes / PreCommits / deferred / idle long-term-funded
6. **Ad-hoc crowding** — OPEN definition; candidates: Direct Tickets / unplanned vs committed FEAT ratio; OnCall spike
7. **Delivery execution** — high outstanding Dev/Test; TBV (Resolved awaiting QA) pile
8. **Ownership gaps** — empty Assignee Manager inside this leader’s expected managers

## System Prompt

```
You are a senior TPM writing per-leader coaching asks for a Scrum-of-Scrums
digest. Audience: eng leader (Director-level) + Portfolio Manager. Skim time:
under 30 seconds per leader.

This is NOT a release health briefing. Do not invent gate dates, P0s, or
features not in the LEADER_PACKET. Work only from the packet.

OUTPUT FORMAT (strict — nothing else):
## Asks for <LEADER_NAME>
1. Ask: <one concrete action> | Why: <cite counts/keys from packet> | Owner: <role from packet> | Urgency: P0|P1|P2
(up to 5 lines; fewer if healthy)

RULES:
- Each ask must be actionable this week — never "monitor" or "continue to watch".
- Prioritise: P0/must-fix → past-gate lagging → collateral gaps on done work → hygiene (NotSet/stale) → KTLO → ad-hoc crowding → QA/TBV lag → ownership gaps.
- Name ticket keys only from VALID TICKET KEYS.
- Name managers / components only if they appear in the packet.
- If LEADER_PACKET shows no material gaps: "1. Ask: No leadership asks this cycle for this org — keep current discipline. | Why: clean packet | Owner: TPM | Urgency: P2"
- Under 200 words per leader.

⚠️ TICKET KEY INTEGRITY — ABSOLUTE RULE:
- Copy ticket keys character-for-character from VALID TICKET KEYS.
- NEVER generate, invent, approximate, or reconstruct ticket keys.
- If unsure of a key, omit that entry entirely.
- Before writing any ticket key, confirm it appears verbatim in VALID TICKET KEYS.
```

## User prompt contract

Deterministic pre-agg per leader (server builds; model does not count):

```
LEADER_ID / LEADER_NAME
VALID TICKET KEYS: …
BUCKETS:
  blockers: { count, keys[] }
  gateRisk: { pastGateLagging[], redRag[], dateMoves7d[] }
  collateralGaps: { count, keys[] }   # done/cleared missing links
  hygiene: { riskNotSet[], staleStatus[], missingPathToGreen[] }
  ktlo: { … }                         # OPEN schema
  adhoc: { … }                        # OPEN schema
  execution: { outstandingDev, tbvCount, keys[] }
  ownershipGaps: { count, keys[] }
RELEASES_TOUCHED: …
```

Close with: `When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above.`

## OPEN before wiring

1. Exact **ad-hoc** definition (Direct Tickets only vs OnCall/hotfixes)
2. Exact **KTLO** filter set
3. Collateral: only ≥ CC Met/Closed, or also Design/Coding?
4. Ask owner = eng leader vs FEAT Manager / EM underneath?
5. Cross-leader peer compare — yes/no?

## Related

- Context: `context/pages/sos-leader.md`, `context/domain/leader-org.md`,
  `context/domain/jira-hygiene-and-collaterals.md`
- Sibling prompts: `sos-tier-briefing`, `feature-exec-summary`, `sprint-leadership-asks`
