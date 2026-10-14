---
name: dependency-rule
area: domain
status: confirmed-with-owner-2026-10-15
---

# Dependency rules (NDB)

Canonical rules for Dependency View and cross-team dependency hygiene.
Companionship is **retired**. Do not use that term.

Related: `cross-team-dependencies.md` (JQL / discovery), `pages/dependency-view.md` (UI page).

---

## 1. Three-axis matrix

Every dependency cell is defined by three axes:

| Axis | Question | Values |
|------|----------|--------|
| **1. Project type** | What kind of EW is the other side? | `global-ew` · `nutanix-ew` · `ndb-ew` · team-internal (FYI only) |
| **2. Mode of operation** | How is the relationship structured? | **Dependency** · **Partnership** |
| **3. Aligned release** | Which NDB release ↔ partner train? | e.g. NDB-3.1 ↔ Leto |

### 1.1 Project type (EW labels)

| # | Type | JIRA label | In the matrix? |
|---|------|------------|----------------|
| 1 | Global EW | `global-ew` | Yes |
| 2 | Nutanix EW | `nutanix-ew` | Yes |
| 3 | Peer NDB | `ndb-ew` | Yes — still NDB; peer teams within NDB depending on each other (not “outside NDB”) |
| 4 | Team internal | *(none of the above)* | **FYI only** — not counted as Dependency / Mode surface |

**Hard rule:** Mode (Dependency / Partnership) and dependency matrix counts apply **only to types 1 / 2 / 3**. Type 4 may be shown as awareness (“team-internal”) but is outside matrix cells.

Widest-wins if multiple EW labels: `global-ew` > `nutanix-ew` > `ndb-ew`.

**Parking without a label:**

1. **Own project wins for NDB home** — ticket in `ERA` / `FEAT` / `NDB*` → always **Peer NDB**. Sibling `ENG`/`NCN` blockers on the same FEAT must **not** recolor that ERA/FEAT ticket as Nutanix EW (e.g. FEAT-19454 blocked by ENG-* and ERA-67814 → ERA stays Peer NDB; ENG stays Nutanix EW).
2. For **non-home** tickets only: EW labels on links → epic/children mix (`ENG`/`NCN`/non-home → `nutanix-ew`) → parent project → own project.
3. Still unknown → team-internal FYI.

### 1.2 Mode of operation (types 1–3 only)

| Mode | Meaning | Signal |
|------|---------|--------|
| **Dependency** | Cross-team wait via JIRA **issue links** | `blocks` / `blocked by` (inward or outward) |
| **Partnership** | Multiple teams deliver as **one project** | Hierarchy: FEAT / Initiative → Epic → tasks / improvements / … |

**Rename vs legacy docs/code:**

| Legacy (wrong) | Correct |
|----------------|---------|
| Partnership = JIRA links | **Dependency** = JIRA links |
| Companionship = hierarchy | **Partnership** = hierarchy |
| Companionship | **Dropped** |

### 1.3 Aligned releases (train)

| NDB release | Aligned train |
|-------------|---------------|
| NDB-2.12 | Kronos |
| NDB-3.0 | Kronos.1 |
| NDB-3.1 | Leto |

Config SoT: `apps/delivery-ops/server/config/dependencyViewConfig.json` → `alignedTrains`.

---

## 2. Discovery labels (not Mode, not Project type)

### 2.1 Wishlist (NDB side)

| | |
|--|--|
| **Pattern** | `ndb-{releaseSlug}-wishlist` (e.g. `ndb-3.1-wishlist`) |
| **Meaning** | NDB planning: “I wish this project into this **NDB release**.” |
| **Sits on** | **NDB** projects / NDB-side tickets only |

### 2.2 Ask / dependency (partner side)

| | |
|--|--|
| **Patterns** | `ndb-{trainSlug}-ask`, `ndb-{trainSlug}-asks`, `ndb-{trainSlug}-dependency` (e.g. `ndb-leto-ask`) |
| **Meaning** | “I ask another team to do this in **{train}**.” |
| **Sits on** | **Their** (partner / other team) ticket |
| **Scope** | Train-scoped (Leto / Kronos / …), not NDB version slug |
| **Variants** | `-ask` / `-asks` / `-dependency` are the **same concept** (naming variants) until further split |

**Never** treat train ask/dependency/wishlist labels as Project type (`*-ew`).

---

## 3. Happy-path workflow (I depend on them)

1. Put **ask** label on **their** ticket (`ndb-{train}-ask` / `-dependency`).
2. Create **Mode Dependency** on **my** ticket — JIRA link (`blocks` / `blocked by`) to their work.
3. Mark **wishlist** on the **NDB** project for the target NDB release when planning that project into the release.

Label = signal on their side · Mode Dependency = formal link from my side · Wishlist = NDB planning intent.

---

## 4. Direction (bidirectional)

| Direction | Meaning | Other side |
|-----------|---------|------------|
| **I wait on them** | We depend on another team | Outside NDB (`global-ew` / `nutanix-ew`) **or** within NDB (`ndb-ew`, teams depending on each other) |
| **They wait on me** | Another team depends on us | Same |

- UI must **demarcate** directions clearly (separate columns or equivalent) — never one mixed list.
- NDB↔NDB cross-team deps are first-class, not hidden.

### 4.1 They wait on me — no label standard yet

Today other teams **often only create a Mode Dependency** (JIRA link / dependent ticket). There is **no agreed standard** for ask/wishlist labels on that path.

**UI rule:** Still **highlight missing-label hygiene** when a Dependency link exists without the expected labels (treat as incomplete process — chase until labeled). Do not assume their labels are correct just because a link exists.

---

## 5. Commitment nature (Release Commit + fixVersion)

**Release Commit** field = **nature of their commitment** (e.g. Commit, Stretch, blank).

Partner commitment is clean only when **both**:

1. Release Commit ∈ {**Commit**, **Stretch**}, and  
2. `fixVersion` is a **real** version (not denylisted).

Denylist examples: `master`, `ERA Future` (and equivalents).

---

## 6. Hygiene faults (must highlight in UI)

| Who at fault | Condition |
|--------------|-----------|
| **NDB** | Mode Dependency link to another team **without** wishlist label on NDB side |
| **Them** (or process gap) | Mode Dependency exists (**they wait on me** or otherwise) **without** the expected ask/train label — common today because there is no standard; **still highlight missing-label hygiene** |
| **Them** | Release Commit is Commit or Stretch, **but** no real `fixVersion` (missing or only denylist) |
| **Them** | Valid (non-denylist) `fixVersion`, **but** Release Commit left **blank** (not Commit / Stretch) |

UI must surface these as chase / needs-attention, with owner clear (us vs them).

---

## 7. What these terms are *not*

| Term | Not the same as |
|------|-----------------|
| Mode **Dependency** | The `-dependency` **label** |
| **Ask** label | Ask vs Ok commit badge alone |
| **Wishlist** | Ask label or Mode Dependency |
| Project type `*-ew` | Train labels (`ndb-leto-*`, wishlist) |
| Team internal | A matrix Dependency cell |

---

## 8. Resolved implications (from rules — no separate owner answers needed)

| Topic | Implication |
|-------|-------------|
| They wait on me — labels | No standard today; link-only common → **highlight missing-label hygiene** |
| Wishlist without Dependency link | **Not** NDB hygiene — only Dependency **without** wishlist is (planning may precede linking) |
| Ask without Dependency link | Incomplete happy path → **highlight missing-link hygiene** (formalize with Mode Dependency) |
| Partnership vs labels | Ask / wishlist workflow is for **Mode Dependency**; Partnership = hierarchy path (FEAT → Epic → work) |
| Stretch vs Commit in UI | Show Release Commit **nature as-is** (Commit / Stretch / blank) |
| fixVersion denylist | `master`, `ERA Future`, and equivalents (exact list lives in config) |
| Ask suffix variants | Keep `-ask` / `-asks` / `-dependency` as **one concept** |
| Aligned train UI | Axis 3 of the matrix — show with NDB release; optional filter later |

---

## Changelog

- 2026-10-15 — Initial rules from owner walkthrough; Companionship dropped; Partnership/Dependency renamed.
- 2026-10-15 — They-wait-on-me: no label standard; highlight missing-label hygiene when Dependency link exists.
- 2026-10-15 — Closed open questions as implications of confirmed rules.
