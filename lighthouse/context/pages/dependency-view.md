---
name: dependency-view
route: /dependency-view
audience: tpm, rm, portfolio_mgr, feat
---

# Post EC dependency view

**Route**: `/dependency-view`  
**Audience**: `tpm, rm, portfolio_mgr, feat`  
**Mode**: **read-only** (MVP) — no JIRA mutates from this page

**Rules SoT:** `domain/dependency_rule.md`  
**JQL / discovery:** `domain/cross-team-dependencies.md`

## Job

For a selected NDB release (aligned train), show the **3-axis** dependency
matrix and hygiene chase:

1. **Project type** — wait columns subdivided into `global-ew` / `nutanix-ew` / `ndb-ew` (team-internal = FYI only). Unlabeled tickets are parked via links / epic-parent / project key (see `dependency_rule.md`).
2. **Mode** — **Dependency** (JIRA links) or **Partnership** (FEAT → Epic → work)
3. **Aligned release** — e.g. NDB-3.1 ↔ Leto

Directions **I wait on them** vs **They wait on me** must be clearly demarcated.
Primary visual: **swimlane matrix** (rows = project type, columns = direction).
Full ticket lists are drill-in under the swimlanes. Include NDB↔NDB (`ndb-ew`).

## Filters (UX target after rebuild)

| Control | Question | Options |
|---|---|---|
| **Sub-tabs** | What do I want to look at? | We wait on them · They wait on us · What to fix · Wishlist · Train asks · Early calls · Partnership |
| **EW scope** (under wait tabs) | Which partner surface? | Outside NDB (`global-ew`+`nutanix-ew`) · Peer NDB (`ndb-ew`) · FYI / unparked |

**Early calls:** While viewing a current release (e.g. NDB-3.0), also surfaces planned trains from `alignedTrains` with `status: planned` (e.g. NDB-3.1 → Leto) via existing Q5 train labels + Q7 wishlist — for pre-CC/EC label-based asks before fixVersion partnership fills in. UI shows direction explicitly: **our wishlist → waits on → partner asks**, plus “Missing arrows” for unlinked wishlist / orphan asks.

**Previously linked:** Under wait tabs, flat pairs for Mode Dependency links that were **removed** (JIRA Link changelog on home + live-chain partner seeds). Muted connector — **no** wait arrow. Distinct from **Missing arrows** (never linked). Not a new Q*; Q1–Q7 unchanged. See `dependency_rule.md` §6b.

Never mix train ask/wishlist labels with Project type (`*-ew`).

## Prompts

None dedicated. Skill: `dependency-walk` (ticket walk; UI uses release-level Q1–Q5 + Q7).

## Engineering docs

`Documentation/pages/` → DependencyView-requirements.md, DependencyView-data-layer.md  
`Documentation/api/dependency.md`

## Agent notes

- Sidebar team via `useTeam()`; NDB-first.
- Every count must link to the exact JQL that produced it.
- Do not invent JQL — only Q1–Q5 / Q7 from `cross-team-dependencies.md`.
- Classification (project type / commitment) is post-fetch only — never change Q1–Q7 without approval.
- Hygiene: see `dependency_rule.md` §6 (NDB: Dependency without wishlist; them: Commit/Stretch/fixVersion gaps; missing labels on they-wait-on-me).
- Do not propose JIRA link/parent write actions from this page until a later slice.
- UI rebuild in progress — ignore stale component names that still say companionship/partnership-for-links.
