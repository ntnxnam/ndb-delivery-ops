---
name: dependency-view
route: /dependency-view
audience: tpm, rm, portfolio_mgr, feat
---

# Dependency View

**Route**: `/dependency-view`  
**Audience**: `tpm, rm, portfolio_mgr, feat`  
**Mode**: **read-only** (MVP) — no JIRA mutates from this page

## Job

Surface partnership (`blocks` / `is blocked by`) and companion (external
hierarchy) dependencies for an NDB release, with aligned partner-train context
(Janus / Kronos / Leto), label callouts, and ask-vs-committed badges.

## Prompts

None dedicated. Domain brief: `domain/cross-team-dependencies.md`.  
Skill: `dependency-walk` (ticket walk; UI uses release-level JQL Q1–Q5).

## Engineering docs

`apps/delivery-ops/docs/pages/` → DependencyView-requirements.md, DependencyView-data-layer.md  
`apps/delivery-ops/docs/api/dependency.md`

## Agent notes

- Sidebar team via `useTeam()`; NDB-first.
- Every count must link to the exact JQL that produced it.
- Do not invent JQL — only Q1–Q5 builders from domain context.
- Do not propose write actions from this page until a later slice.
