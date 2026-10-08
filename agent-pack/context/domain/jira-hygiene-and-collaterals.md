---
name: jira-hygiene-and-collaterals
area: domain
---

# JIRA hygiene & collaterals

Signals used by feature exec summary, SoS callouts, and (draft) leader coaching.

## Hygiene fields (feature-level)

Emit as hygiene **only when literally null / empty / "Not Set"** and phase-relevant:

| Signal | Meaning |
|---|---|
| Commit Gate date | missing on open FEAT |
| Promotion Gate date | missing on open FEAT |
| Test Plan Link | collateral |
| Design Doc Link | collateral |
| Requirements Link | collateral |
| Risk Assessment | required when Risk Indicator Yellow/Red |
| Path to Green | required when Risk Indicator Yellow/Red |
| Risk Indicator NotSet | SoS callout — matters even on closed tickets for retros |
| Status update age ≥ 14d | stale attestation |

Respect `TEAM_NA` — never flag team-declared N/A as hygiene.

## Collateral completion (leader coaching)

**Intent**: Features that are done / gate-cleared should have completion links
to collaterals (requirements, design, test plan).

| When to flag | Status / phase in Closed, CG Met, PG Met, Shipped (or equivalent) **and** one of Requirements / Design / Test Plan link empty |
| OPEN: | Also flag mid-flight Design/Coding? Default **no** until product confirms |

## SoS callouts (tier briefing)

- Past gate lagging (FEAT Work)
- Not done by CG (Standalone Epics / Direct Tickets)
- Risk Indicator not set
- Stale status updates (≥14d)
- Date field moved (last 7d)

## Ad-hoc vs KTLO (OPEN definitions for leader coaching)

| Term | Working definition (pending confirm) | Signal candidates |
|---|---|---|
| Ad-hoc | Unplanned / Direct Tickets crowding committed FEAT work | Direct Ticket tier counts, OnCall spike, mid-sprint scope add |
| KTLO | Keep-the-lights-on / run work under-attended | CVE, OnCall, System Test, Smokes, PreCommits, deferred, long-term-funded idle |

Mark claims `OPEN:` until definitions are locked in
`prompts/draft/sos-leader-coaching.md`.

## Related

- `shared/src/domain/execSummarySignals.cjs`
- `prompts/production/feature-exec-summary.md`
- `prompts/draft/sos-leader-coaching.md`
