# Dependency View — Full Capability Inventory

**Tool**: Dependency View (`/dependency-view`) — **one page only**  
**Whole app inventory**: [`../DeliveryOps-full-capabilities.md`](../DeliveryOps-full-capabilities.md) (every `:8899` tab)  
**Product surface**: NDB Delivery Ops (delivery-ops web app)  
**Mode**: Read-only MVP (no JIRA issue-link / Parent Link writes)  
**Permission**: `release_versions_view`  
**Primary audiences**: TPM, Portfolio Manager, Release Manager, Feature Manager  

Use this file as raw material for an elevator pitch. Capabilities are exhaustive; pitch language should pick 3–5 that match the audience.

---

## One-line job

> Show, for a selected NDB release, **who waits on whom** across partnership links, companion hierarchies, train-label asks, and wishlist/pre-commit work — with every count clickable into the exact JIRA query, and a chase list of what to do next.

---

## Pitch seeds (copy / adapt)

| Angle | Seed line |
|-------|-----------|
| **Time-to-clarity** | “Stop hunting JIRA for cross-team blockers — open one release-scoped map and see upstream, downstream, wishlist, and hygiene in one place.” |
| **Traceability** | “Every number opens the exact JQL that produced it — no unverified dashboard math.” |
| **Train alignment** | “NDB gate dates sit next to the aligned AOS train (Janus / Kronos / Leto) so partner asks stay train-aware.” |
| **Ask vs committed** | “Badges show whether a partner actually committed (fixVersion or Release Commit) — not just that a label exists.” |
| **Actionable** | “Next actions tell you what to chase: open upstream asks, work we owe, uncommitted partners, orphans, label-only rows.” |
| **Safe MVP** | “Read-only by design — inventory and chase without risk of rewriting JIRA links.” |

---

## Capability catalog

### 1. Release & team scoping

| # | Capability |
|---|------------|
| 1.1 | Sidebar team selection (`useTeam`) — NDB-first default |
| 1.2 | Team-required gate when no team is selected |
| 1.3 | Release picker from server-provided release list |
| 1.4 | Default release from `dependencyViewConfig` when unset |
| 1.5 | **Fetch** / **Pull from JIRA** for live reload (no cache in MVP) |
| 1.6 | **As-of** timestamp showing data freshness |
| 1.7 | Team name shown in header with read-only badge |
| 1.8 | Non-NDB team still loads (config may be NDB-centric; team context visible) |
| 1.9 | Fetching banner when switching release; keeps last good load on failure |

---

### 2. Plain-language “Show” filter (what to look at)

No glossary required. One control answers “what do I want to chase?”

| # | Option | What it surfaces |
|---|--------|------------------|
| 2.1 | Everything for this release | Partnership + companion + train labels + wishlist |
| 2.2 | I'm waiting on them | Partnership only — upstream (`is blocked by`) |
| 2.3 | They're waiting on me | Partnership only — downstream (`blocks`) |
| 2.4 | Our labeled asks (train labels) | Labels on our tickets (`ndb-*-dependency` / `-asks`) |
| 2.5 | Wishlist / pre-commit | Wishlist + linked partners + hygiene |
| 2.6 | Work under our epics | Companion / Parent Link hierarchy (external slice) |
| 2.7 | One-line caption under Show explaining the active view |
| 2.8 | Outcome one-liner framing the page as a chase tool |

**Internal concepts kept separate in UI** (never mixed for the user):

- **Structure**: Partnership (JIRA links) vs Companionship (under our epics)
- **Discovery**: Train labels / wishlist on our tickets
- **Partner type**: EW labels only (`*-ew`) — never train-dep / asks

---

### 3. Partner type filter (EW span)

| # | Capability |
|---|------------|
| 3.1 | Filter by EW partner type: Any · Global EW · Nutanix EW · NDB EW · Team (no `*-ew`) |
| 3.2 | Widest-wins classification when multiple EW labels: `global-ew` > `nutanix-ew` > `ndb-ew` |
| 3.3 | Team-internal when no `*-ew` label |
| 3.4 | Client-side filter on already-fetched issues (does not change approved JQL) |
| 3.5 | Explicit rule: train-dep / asks / wishlist labels are **not** Partner type |

---

### 4. Partnership (formal JIRA issue links)

| # | Capability |
|---|------------|
| 4.1 | **I wait on them** — `linkedIssuesOf(fixVersion, "is blocked by")` (Q3) |
| 4.2 | **They wait on me** — `linkedIssuesOf(fixVersion, "blocks")` (Q4) |
| 4.3 | Clickable metric cards → exact JIRA URL + JQL tooltip |
| 4.4 | Wait-context sentences: “My X is waiting on Y” / “Their Y is waiting on my X” |
| 4.5 | Link type name shown (e.g. blocks / is blocked by) |
| 4.6 | Partnership chips on swimlanes with Ask/Ok and wait direction labels |

---

### 5. Companionship (work under our epics)

| # | Capability |
|---|------------|
| 5.1 | Companion hierarchy under configured root keys (Q1 — Parent Link + epics) |
| 5.2 | External / non-NDB-owned slice (Q2 — project ≠ ERA or assignee outside NDB orgs) |
| 5.3 | Per-root metric cards: “External · {rootKey}” with JIRA click-through |
| 5.4 | Collapsible ticket tables per companion root |
| 5.5 | Distinct from partnership — Parent Link hierarchy, not `blocks` links |

---

### 6. Train-label discovery (asks on our tickets)

| # | Capability |
|---|------------|
| 6.1 | Discover tickets labeled `ndb-{trainSlug}-dependency` and `ndb-{trainSlug}-asks` (Q5) |
| 6.2 | Train slug derived from aligned-train config |
| 6.3 | Metric card + collapsible table for labeled asks |
| 6.4 | Caption clarifies these are **not** Partner type (`*-ew`) |

---

### 7. Wishlist / pre-commit (Q7a–Q7d)

| # | Capability |
|---|------------|
| 7.1 | **Wishlist items** — `ndb-{releaseSlug}-wishlist` (Q7a) |
| 7.2 | **Partners linked from wishlist** — all link types by default (Q7b) |
| 7.3 | **Label-only / unlinked wishlist** — wishlist with no useful links (Q7c + client hygiene) |
| 7.4 | **Partner orphans** — train-dep labels not linked to any wishlist item (Q7d) |
| 7.5 | Separates “linked wishlist” vs “label-only / clone-only” for hygiene |
| 7.6 | Ignores Clone / Duplicate links as dependency edges (configurable patterns) |
| 7.7 | Metric cards for: Wishlist (linked) · Partners · Label-only/Clone-only · Partner orphans |

---

### 8. Ask vs committed classification (Q6 — post-fetch)

| # | Capability |
|---|------------|
| 8.1 | **Ask** = not yet committed |
| 8.2 | **Committed / Ok** when real `fixVersion` (not denylisted) **or** Release Commit field = Commit |
| 8.3 | Shows **which signal applied**: via fixVersion · via Release Commit field · both |
| 8.4 | Commit badges on chips, tables, and legend |
| 8.5 | Classification never changes discovery JQL (runtime only) |

---

### 9. Gates & aligned partner train

| # | Capability |
|---|------------|
| 9.1 | Collapsible **Gates & aligned train** panel |
| 9.2 | NDB gate dates side-by-side (EC, CCM, Commit Gate, Promotion Gate, GA, etc. from release config) |
| 9.3 | Aligned train metadata: name, status (`aligned` / unaligned / reassess), notes |
| 9.4 | Train label slug callout (`ndb-{trainSlug}-dependency` / `-asks`) |
| 9.5 | Partner version list from config |
| 9.6 | Optional Confluence source-of-truth link |
| 9.7 | Unaligned release handling (e.g. NDB-2.12) with explicit status/notes |

---

### 10. Next actions (chase list)

Derived from current filters — severity-ranked, max 5:

| # | Action type | Severity |
|---|-------------|----------|
| 10.1 | Upstream partnership items still Ask / open | High |
| 10.2 | Items where they wait on us (open) | High |
| 10.3 | Linked partner tickets not committed | High |
| 10.4 | Wishlist items still Ask | Medium |
| 10.5 | Partner orphans (train-dep, no wishlist link) | Medium |
| 10.6 | Label-only / clone-only wishlist rows | Low |
| 10.7 | Clean state message when nothing to chase | Low |

---

### 11. Swimlane visual map (primary visual)

| # | Capability |
|---|------------|
| 11.1 | Primary mental model: who waits on whom + hygiene |
| 11.2 | Flow hint: Upstream → NDB asks → Partners → We owe → Hygiene |
| 11.3 | Lane: **I wait on them** (upstream partnership) |
| 11.4 | Lane: **NDB wishlist asks** (linked pre-commit) |
| 11.5 | Lane: **Partner responses** (linked from wishlist) |
| 11.6 | Lane: **They wait on me** (downstream partnership) |
| 11.7 | Lane: **Needs a link** (label-only + orphans) |
| 11.8 | Ticket chips open JIRA browse URL |
| 11.9 | Chip shows key, partner-type badge, wait label, Ask/Ok pill |
| 11.10 | Chip tooltip: summary, mode, partner type, commit state, wait context |
| 11.11 | Lane count links to section JIRA URL |
| 11.12 | Chip cap (+N more → expand tables below) |
| 11.13 | Lanes respect Show / Partner type filters |

---

### 12. Timeline Gantt (optional, collapsed by default)

| # | Capability |
|---|------------|
| 12.1 | Expandable timeline Gantt (bars + link arrows) |
| 12.2 | Bar width = calendar day span (not importance) |
| 12.3 | Bar color by role (wishlist / partner / upstream / downstream) |
| 12.4 | Left column: ticket key + day count |
| 12.5 | Short bars show `KEY · N days` beside stub |
| 12.6 | Diamond markers for single-date milestones |
| 12.7 | Bars / labels open JIRA |
| 12.8 | Clone / Duplicate links not drawn as dependency arrows |
| 12.9 | Dedicated Gantt legend (“How to read the Gantt”) |

---

### 13. Ticket tables (drill-in, collapsed by default)

| # | Capability |
|---|------------|
| 13.1 | Tables do **not** dominate first viewport |
| 13.2 | Collapsible sections expand on demand |
| 13.3 | Sections: I wait · They wait · Train labels · Wishlist linked · Partners · Label-only · Orphans · Companion external |
| 13.4 | Per-row JIRA key links |
| 13.5 | Mode badge (Partnership / Companionship / discovery) |
| 13.6 | Partner-type (span) badge + label |
| 13.7 | Commit cell with Ask/Ok + via signal + link type names |
| 13.8 | Wait-context column with plain-language sentences and linked keys |
| 13.9 | Section header count + JIRA URL + JQL |

---

### 14. Legend & education (in-page)

| # | Capability |
|---|------------|
| 14.1 | Always-visible color key for swimlanes |
| 14.2 | Explains Wishlist · Partner · Label-only · Orphan · Ask · Ok · Partner type |
| 14.3 | Reinforces: Partner type = EW only; use Show for structure/discovery |
| 14.4 | Gantt-specific reading guide when Gantt is open |

---

### 15. Wishlist settings (local config only)

| # | Capability |
|---|------------|
| 15.1 | Top bar: wishlist link-type filter (presets + custom) |
| 15.2 | Editable partner label suffixes (e.g. `dependency`) |
| 15.3 | Editable wishlist label suffix (default `wishlist`) |
| 15.4 | **Save** → `dependencyViewConfig.json` (no JIRA write) |
| 15.5 | Dirty-state awareness; status after save |
| 15.6 | Empty link-type filter = all link types for Q7b |
| 15.7 | Reload overview after save so Q7 reflects new settings |
| 15.8 | APIs: `GET` / `PUT /api/dependency/wishlist-config` |

---

### 16. Authenticity & JIRA traceability

| # | Capability |
|---|------------|
| 16.1 | Every metric count links to the exact JQL that produced it |
| 16.2 | Tooltips expose JQL on hover |
| 16.3 | `aria-label` on clickable metrics for accessibility |
| 16.4 | Opens in new tab (`target="_blank"`) |
| 16.5 | Empty results still return valid JIRA links (zero counts) |
| 16.6 | Approved JQL only: Q1–Q5 + Q7 (Q6 is classification, not discovery) |

---

### 17. Safety / permissions / MVP boundaries

| # | Capability / constraint |
|---|-------------------------|
| 17.1 | **Read-only** badge and behavior — no create/edit/delete of JIRA links |
| 17.2 | No Parent Link mutates from this page |
| 17.3 | View gated by `release_versions_view` |
| 17.4 | Wishlist Save uses same permission; writes local JSON only |
| 17.5 | Live JIRA per Pull/Fetch; ~180s client timeout |
| 17.6 | Auth errors → reconnect; JIRA failures → error + retry |
| 17.7 | Future write APIs documented but **not wired** (HITL when added) |

---

### 18. Platform / engineering capabilities (supporting)

| # | Capability |
|---|------------|
| 18.1 | Hook-owned fetch (`useDependencyView`) — page does not call axios/fetch |
| 18.2 | Server orchestration via `dependencyViewService.getOverview` |
| 18.3 | Config SoT: `dependencyViewConfig.json` (trains, spans, wishlist, roots) |
| 18.4 | Gate dates from release versions email config |
| 18.5 | Agent-pack domain brief + `dependency-walk` skill for ticket-level walks |
| 18.6 | Companion to dependency-tracker specialist (agent layer); UI is release-level JQL |

---

## What users can do in a session (job stories)

1. Pick team + release → Fetch live dependency inventory  
2. Choose **Show** to focus (upstream / downstream / labels / wishlist / companion / everything)  
3. Narrow by **Partner type** (EW surface) without touching train labels  
4. Read **Next actions** and chase the top items  
5. Scan **swimlanes** for who waits on whom and hygiene gaps  
6. Expand **Gates & train** to check NDB vs Janus/Kronos/Leto alignment  
7. Optionally expand **Gantt** for calendar timing of dependency bars  
8. Expand **ticket tables** only when drilling into a specific set  
9. Click any count → land in JIRA on the exact filter  
10. Tune wishlist link-type / suffixes and Save for the next Q7 pull  

---

## Value props by audience

| Audience | Strongest capabilities |
|----------|------------------------|
| **TPM / Portfolio Manager** | Full inventory, train alignment, wishlist orphans, next actions, JIRA authenticity |
| **Release Manager** | Gate-adjacent risk, upstream Ask/open counts, we-owe before next gate |
| **Feature Manager** | Companion external drilldown under roots; partnership wait context for a feature area |

---

## Elevator pitch skeleton (fill blanks)

> Dependency View gives **[audience]** a **read-only, release-scoped map** of NDB cross-team dependencies.  
> In one screen you see **[pick 2–3: upstream blockers / what we owe / wishlist asks / companion work]**,  
> with **Ask vs Committed** clarity and **NDB gates next to the aligned train**.  
> Every number is **one click into the exact JIRA query** — and a **Next actions** list tells you what to chase before the next gate.

---

## Explicit non-capabilities (MVP — keep pitches honest)

- Does **not** create, edit, or delete JIRA issue links or Parent Links  
- Does **not** auto-create ask tickets from Confluence/Slack inference  
- Does **not** mix train labels into Partner type (`*-ew`) filters  
- Does **not** cache overview responses (always live Pull)  
- Does **not** mutate JIRA when saving wishlist settings (config file only)  
- Ticket-level graph walk is a separate skill (`dependency-walk`); this page is release-level sections  

---

## Source references

| Doc | Path |
|-----|------|
| Requirements | `docs/pages/DependencyView-requirements.md` |
| Data layer | `docs/pages/DependencyView-data-layer.md` |
| API | `docs/api/dependency.md` |
| Domain brief | `agent-pack/context/domain/cross-team-dependencies.md` |
| Page brief | `agent-pack/context/pages/dependency-view.md` |
| UI | `client/src/components/DependencyViewPage/` |

---

*Generated for elevator-pitch drafting. Update this file when MVP capabilities ship beyond read-only.*
