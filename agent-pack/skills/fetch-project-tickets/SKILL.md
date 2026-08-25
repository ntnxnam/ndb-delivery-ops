---
name: fetch-project-tickets
description: Fetch all tickets related to JIRA projects/features using the 8-clause portfolio-children JQL pattern with bulk IN-clause optimization. Use when fetching outstanding work, building "X of Y done" breakdowns, generating executive summaries with ticket links, or anywhere a single project key must expand to all related tickets across the Nutanix portfolio hierarchy.
audience: tpm, rm, portfolio_mgr, team-exec
---

# Fetch Project Tickets (project-level reference)

This skill is canonically defined at:

```
~/.cursor/skills/fetch-project-tickets/SKILL.md
```

The project-level entry exists so any agent or specialist working in
`ndb-delivery-ops` (the orchestrator, the tpm-specialist, the
team-exec-specialist) can discover it in the local `.cursor/skills/` directory
and apply it to the consolidated app.

## When to Use This Skill

- Building "X out of Y done" hyperlinks anywhere in the consolidated app
- Generating outstanding-work reports for Team Executives or TPMs
- Producing per-FEAT or per-release ticket lists for the chatbot
- Any time a single project key (e.g. `FEAT-1001`) must expand to all
  related tickets across the Nutanix portfolio hierarchy

## Why It Matters Here

This is the JQL primitive that the **canonical release dataset**
(`CONSOLIDATION.md` #1) is built on top of. When the trunk ships, it
will internalise the 8-clause pattern; until then, any service that
needs cross-portfolio fetches should call this skill's contract
directly via `shared/services/ticketFetchService.ts` (capability #17 in
`CONSOLIDATION.md`).

## Core Contract (memorise — do not reinvent inline)

1. Single project → individual `key = FEAT-NNNN OR ...` form
2. Multiple projects → bulk `key IN (...) OR ...` form (93% faster)
3. `"FEAT ID" ~ key` (contains) — **never** `=` (the field doesn't
   support equality)
4. No `project = ERA` prefix — tickets can live in any project and
   still relate to a FEAT
5. Executive view → all issue types; team view → exclude
   `Feature, Initiative, X-FEAT, Capability, Epic`
6. Always validate project key format (`/^[A-Z]+-\d+$/`) before
   building JQL
7. Fall back to OR-conditions if `IN` clauses fail on the JIRA instance

Read the canonical SKILL.md for the full templates, the smart JQL
builder, and the API endpoint pattern.

## Quality Validation

- [ ] JQL uses `~` for "FEAT ID", not `=`
- [ ] Bulk queries use `IN (...)` not looped calls
- [ ] Executive URL includes all issue types; team URL excludes
      Feature/Initiative/Epic
- [ ] Project keys validated before building JQL
- [ ] Fallback path exercised when `IN`-clause fails
