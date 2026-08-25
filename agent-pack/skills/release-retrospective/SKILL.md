---
name: release-retrospective
description: Analyze actual team behavior against gate contracts (CCM, CG, PG, GA) for any release, including project-level naughty ranking and companion-discipline readiness. Use when a TPM, RM, Director, or Team Executive asks how a release behaved versus gates.
audience: tpm, rm, director, team-exec
---

## When to Use This Skill

- The user asks for release retrospective behavior versus gate dates
- The user asks what slipped past CCM, CG, PG, or GA
- The user asks where P0/P1 bugs were discovered after commit gate
- The user asks for project-level "naughty" contributors to gate risk
- The user wants companion-discipline visibility (TECHPUBS, SDL, LEG, SR, NDBQUAL)

## Quick Start

```text
Input:
  release: "NDB-2.11" (required)
  productId: "ndb" (defaults to active product)

Flow:
1) Resolve release gate timeline from /api/release-dataset/gates
2) Resolve product config from productService:
   - core projects: ERA + FEAT(feature roots)
   - companion disciplines: TECHPUBS, SDL, LEG, SR, NDBQUAL
3) Run gate checks:
   - CCM coding slip (Task + Unit Test)
   - CG P0/P1 open + late-found
   - PG test debt + bug debt(excluding deferred label)
   - companion checkpoint@PG + hard gate@GA
4) Run naughty ranking:
   - pre-rank top parents (Feature + Initiative)
   - deep-score top N with weighted dimensions
5) Return UI-ready payload with JIRA clickthrough links for every metric
```

## Core Rules

1. Use two tracks, never mix scores:
   - Engineering track: hard checks at CCM/CG/PG/GA
   - Companion track: checkpoint at PG, hard check at GA
2. For NDB roots:
   - Feature roots come from `project = FEAT AND issueType = Feature`
   - Initiative roots come from `project = ERA AND issueType = Initiative`
3. Engineering work queries use `project in (ERA, FEAT)` when type-appropriate.
4. Companion work queries use configured companion project keys from productService.
5. Gate date selection:
   - Latest solid event per kind wins
   - Fallback to latest dotted
   - Future gates are skipped (`not yet reached`)
6. Every number in output must have a JIRA URL from the exact JQL used.
7. Deferred-label pattern uses normalized release:
   - `NDB-2.11` -> `2-11` -> `ndb-2-11-deferred`
8. Naughty list scores only engineering-parent rows; companion projects are shown separately.

## Output Format

```text
Release: <release>
GateTimeline:
  - [EC, CCM, CG, PG, GA events with date/style/past]

GateCompliance:
  ccm: { total, openAtGate, closedPct, rag, jqlOpen, jqlTotal }
  cg:  { p0p1OpenAtGate, p0p1FoundAfter, ragOpen, ragAfter, jqlOpen, jqlAfter }
  pg:  { testsOpenAtGate, bugsOpenAtGate, ragTests, ragBugs, jqlTests, jqlBugs }
  ga:  { openAtGa, rag, jqlOpen }

NaughtyList:
  rows: [
    {
      parentKey, parentType, parentSummary,
      ccmSlip, cgOpenAtGate, cgFoundAfter, pgTests, pgBugs, deferredCount,
      score, rag,
      links: { ccmSlip, cgOpenAtGate, cgFoundAfter, pgTests, pgBugs, deferredCount }
    }
  ]

CompanionReadiness:
  rows: [
    {
      projectKey, label,
      openAtPg, openAtGa,
      pgMode: "checkpoint",
      gaMode: "hard_gate",
      statusLabel,
      links: { openAtPg, openAtGa }
    }
  ]

PgToGaWindow:
  { closedInWindow, deferredInWindow, links: { closedInWindow, deferredInWindow } }
```

## Quality Validation

- [ ] Feature roots from FEAT + Initiative roots from ERA are both included
- [ ] Companion disciplines are config-driven (no hardcoded project names in logic)
- [ ] Gate date resolver uses solid-first and skips future gates
- [ ] CG includes both open-at-gate and found-after metrics
- [ ] PG bug metric excludes deferred-labeled tickets
- [ ] Every numeric metric has a clickable JIRA URL
- [ ] Naughty score weights are visible in API response or UI legend
- [ ] Companion rows are rendered in separate section (not merged into naughty scoring)
