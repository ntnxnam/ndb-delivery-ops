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

Surface cross-team dependencies for an NDB release: Partnership (JIRA
links), Companionship (under our epics), train-label asks, and wishlist.

## Filters (UX)

Two controls — no glossary required:

| Control | Question | Options |
|---|---|---|
| **Show** | What do I want to look at? | Everything · I'm waiting on them · They're waiting on me · Our labeled asks · Wishlist · Work under our epics |
| **Partner type** | Which EW surface? | Any · Global / Nutanix / NDB EW · Team (no `*-ew`) |

Internally still three concepts (never mix in the UI):

| Concept | Meaning | Signals |
|---|---|---|
| Structure | Partnership vs Companionship | JIRA link vs Parent Link under epic |
| Discovery | Callouts on **our** tickets | `ndb-*-dependency` / `-asks` / `-wishlist` |
| Partner type | EW project type | `global-ew` / `nutanix-ew` / `ndb-ew` / team |

**Never mix** train labels with Partner type — train-dep/asks are not `*-ew`.

## Prompts

None dedicated. Domain brief: `domain/cross-team-dependencies.md`.  
Skill: `dependency-walk` (ticket walk; UI uses release-level JQL Q1–Q5 + Q7).

## Engineering docs

`apps/delivery-ops/docs/pages/` → DependencyView-requirements.md, DependencyView-data-layer.md  
`apps/delivery-ops/docs/api/dependency.md`

## Agent notes

- Sidebar team via `useTeam()`; NDB-first.
- Every count must link to the exact JQL that produced it.
- Do not invent JQL — only Q1–Q5 / Q7 builders from domain context.
- Wishlist Q7b defaults to all link types; UI Save persists `wishlist.linkTypeFilter` (and suffixes) to `dependencyViewConfig.json`.
- Classification (partner type / commit) is post-fetch only — never change Q1–Q7 without approval.
- Do not propose JIRA link/parent write actions from this page until a later slice.
