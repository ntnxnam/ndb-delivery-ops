# ERA JIRA Workflows & Resolutions — Context Reference

> Source: ERA JIRA workflow designer screenshots, Sep 2026.
> Use this file as the single source of truth for status and resolution
> classification across all ERA project issue types.

---

## 1. Workflow Status Sets by Issue Type

### Portfolio Hierarchy (Feature, X-FEAT, Initiative)
| Status | Terminal? | Notes |
|---|:---:|---|
| Backlog | | |
| Concept Commit | | |
| Ready to Commit | | Active working state |
| Code Complete Met | | |
| Commit Gate Met | | |
| Promotion Gate Met | | |
| Cancelled | ✅ | Negative terminal |
| Closed | ✅ | Positive terminal |

### Epic
| Status | Terminal? | Notes |
|---|:---:|---|
| Open | | Initial |
| In Progress | | |
| Blocked | | |
| Need Info | | |
| Reopened | | |
| Closed | ✅ | |

### Bug / Improvement / Story
| Status | Terminal? | Notes |
|---|:---:|---|
| Untriaged | | Initial |
| Open | | |
| In Progress | | |
| Pending Merge | | |
| Blocked | | |
| Need Info | | |
| Pending Review | | |
| Resolved | | **TBV** — dev done, QA not yet verified. `resolution is not EMPTY`. Never treat as shipped. |
| Closed | ✅ | True completion. Requires `resolution in (Fixed, ...)` to be positive. |
| Reopened | | |

### Task / Test / Unit Test / Sub-Task
| Status | Terminal? | Notes |
|---|:---:|---|
| Open | | Initial |
| In Progress | | |
| Pending Merge | | |
| Blocked | | |
| Need Info | | |
| Pending Review | | |
| Reopened | | |
| Closed | ✅ | |

### PRD / Design Doc / Test Plan
| Status | Terminal? | Notes |
|---|:---:|---|
| Open | | Initial |
| In Progress | | |
| In Review | | |
| Closed | ✅ | |

### NDBQUAL Task Review
| Status | Terminal? | Notes |
|---|:---:|---|
| Open | | Initial |
| In Progress | | |
| In Review | | |
| Waiting on Engineering | | |
| Closed | ✅ | |

### ERA UX
| Status | Terminal? | Notes |
|---|:---:|---|
| Open | | Initial |
| Visual Design Content | | |
| Wireframe-In-Progress | | |
| Wireframe In Review | | |
| Wireframe Approved | | |
| VD-In-Progress | | |
| VD-In-Review | | |
| Closed | ✅ | |

### SDL: Standard Security Review
| Status | Terminal? | Notes |
|---|:---:|---|
| Open | | Initial |
| To Do | | |
| Backlog | | |
| In Progress | | |
| Draft In Progress | | |
| Waiting | | |
| Under Review | | |
| Done | ✅ | Terminal for this workflow only |

### DOPS
| Status | Terminal? | Notes |
|---|:---:|---|
| Ready to Start | | Initial |
| Backlog | | |
| In Progress | | |
| In Review | | |
| Pending On | | |
| On Hold | | |
| Deep In Progress | | |
| Peer Review | | |
| Review Done | | |
| Closed | ✅ | |

---

## 2. Terminal Status Set — Code Classification

```javascript
// All statuses where a ticket is definitively done/gone.
// Use this set to exclude tickets from "risk not set", "outstanding", etc.
const TERMINAL_STATUSES = new Set([
  // Universal terminal
  'closed',
  'cancelled',
  // SDL workflow only
  'done',
  // Portfolio hierarchy terminal
  'promotion gate met', // functionally shipped for Feature/Initiative
]);
```

> **Never add `resolved` here.** `status = Resolved` in ERA is TBV
> (To Be Verified) — dev finished, QA hasn't signed off. It is NOT closed.

---

## 3. Resolutions

### NDB-relevant resolutions (show in UI / use in logic)

| Resolution | Category | Counts as shipped? |
|---|---|:---:|
| Fixed | Positive | ✅ |
| Approved | Positive | ✅ | Reviewed and accepted |
| Won't Do | Negative | ❌ | Nutanix rename of "Won't Fix" — treat as identical |
| Won't Fix | Negative | ❌ | Standard JIRA label — same as "Won't Do" |
| Cannot Reproduce | Negative | ❌ |
| Duplicate | Negative | ❌ |
| Incomplete | Deferred | ❌ |
| No Response | Deferred | ❌ |
| Invalid | Negative | ❌ |

> **Fixed = Done = Resolved (resolution field) = Complete.**
> We normalise to **"Fixed"** everywhere. Do not add aliases in code.

### Hidden / not relevant in NDB context
All other resolutions in the ERA list (≥40 options) are operational/support
resolutions used by field/support teams. NDB engineering does not use them.
They should be hidden from NDB delivery-ops UI filters and not appear in
velocity or KPI calculations.

### Resolution buckets for velocity (per `velocity-resolution-categories.mdc`)

```javascript
const POSITIVE_RESOLUTIONS = new Set(['fixed', 'done', 'resolved', 'complete', 'approved']);

const NEGATIVE_RESOLUTIONS = new Set([
  'won\'t do',    // Nutanix rename of "Won't Fix" — treat as identical
  'won\'t fix',   // standard JIRA label — same intent as "Won't Do"
  'cannot reproduce',
  'not a bug',
  'duplicate',
  'duplicate with similar rca',
  'declined',
  'disqualified',
  'false alarm',
  'invalid',
  'user error',
  'withdrawn',
  'expired',
  'already supported',
  'no response',
  'incomplete',
]);
```

---

## 4. "Is this ticket done?" Decision Tree

```
status = Cancelled                          → DONE (excluded from all counts)
status = Closed AND resolution in POSITIVE  → DONE (shipped)
status = Closed AND resolution in NEGATIVE  → DONE (not shipped, negative)
status = Closed AND resolution is EMPTY     → treat as DONE (data gap)
status = Resolved AND resolution not EMPTY  → TBV (awaiting QA)
status = Resolved AND resolution is EMPTY   → OPEN (data gap)
anything else                               → OPEN
```

---

## 5. "Risk Indicator not set" Exclusion Rule

A ticket must be **excluded** from `riskNotSet` counts when its status is
terminal — there is no point chasing a risk indicator on a closed or
cancelled ticket.

```javascript
// Exclude from riskNotSet
const RISK_NOT_SET_EXCLUDE_STATUSES = new Set([
  'closed',
  'cancelled',
  'done',           // SDL
  'resolved',       // only when resolution is also set (TBV heading to closed)
  'promotion gate met', // Feature/Initiative — effectively shipped
]);
```
