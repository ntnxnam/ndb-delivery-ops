# Component Report Page — Context & Plan

**Route**: `/component-report`  
**Audience**: Director  
**Purpose**: Component health dashboard — actionable, risk-first, all metrics link to JIRA.

---

## Implementation Status

| Item | Status | Notes |
|---|---|---|
| Route + sidebar + permissions | done | `routeConfig.js`, `Sidebar.js`, `RELEASE_VERSIONS_VIEW` |
| Component list from JIRA (ERA project) | done | `componentReportService.js` — `/rest/api/2/project/ERA/components` |
| Archived/deleted component filter + session cache | done | `c.archived !== true && c.deleted !== true` |
| Manual "Fetch Components" button (no auto-load) | done | `ComponentReport.js` |
| Manual "↓ Fetch" button for report data | done | `ComponentReport.js` |
| Health card (RAG, P0/P1 counts, verdict) | done | `/api/component/health` |
| Release chips multi-select (NDB-X.Y + master only) | done | `availableReleases` from `/data`; ancient versions excluded |
| Widget 1 — P0 Blockers (accordion) | done | `PriorityWidget` + `AccordionWidget` |
| Widget 2 — P1 Criticals (accordion) | done | same |
| Widget 3 — Other Priority (accordion, closed by default) | done | same |
| Widget 4 — Project Level Info (active only, by fixVersion) | done | `W4ReleaseGroup`, unified table, inline assignees |
| Widget 5 — KPI Counts | placeholder | |
| Widget 6 — Deferral Behaviour | placeholder | |
| Cleanup section — real stale projects table | done | `CleanupSection`, `staleProjects` from backend |
| `staleProjects` backend detection | done | closed/cancelled rows with ≥1 outstanding descendant |

---

## Layout & UX Architecture

- **No tabs** — vertically scrolling sections
- **No auto-fetch** — user explicitly clicks "Fetch Components" then "↓ Fetch"
- **Data fetched ONCE per component** — `/health` + `/data` called together; release filter applied client-side via `isInSelected()`
- **All sections and widgets are accordions** — P0/P1 open by default, Others/KPI/Deferrals closed
- **Sections**: Filters → Health Card → Section A (Selected Releases) → Section B (All Other) → Section C (Cleanup)
- **Widgets per section**: W1=P0 Blockers | W2=P1 Criticals | W3=Other Priority | W4=Projects | W5=KPI | W6=Deferrals

---

## fixVersion Classification Rules

From explicit user guidance — applies to all sections and widgets:

| fixVersion value | Meaning |
|---|---|
| `NDB-X.Y` | Committed to that specific release |
| `master` | Active work, funded but not yet committed to a release train |
| `ERA Future` | No commit, not funded |
| `Triage` | No commit, not funded |

**affectedVersion rules**:
- `NDB-X.Y` — valid (issue affects this release)
- `master` — valid
- `ERA Future` — **ANOMALY** (highlight)
- `Triage` — **ANOMALY** (highlight)

**Section A** = fixVersion IN (NDB-CurrentFixVersion results OR master)  
**Section B** = fixVersion NOT IN (current releases OR master)

---

## Widget 4 — Project Level Info (Agreed Design)

### Structure: broken down by fixVersion sub-section

```
fixVersion = NDB-2.11
  ├─ Projects (Features / Initiatives)
  ├─ Standalone Epics
  └─ Standalone Tickets (no epic)

fixVersion = NDB-2.10
  └─ (same)

fixVersion = master
  └─ (same)
```

Each fixVersion group is its own accordion (collapsed by default, except the most recent).

### Columns — same table for Projects, Epics, AND Standalone Tickets

```
Key | Summary | Bugs ↑ | Tasks+UnitTests ↑ | Improvements ↑ | Tests ↑ | Others ↑
```

- **No ticket-detail columns** (Key/Summary/Assignee/Age/Status per issue) — *"show count, not details"*
- **Standalone Tickets** use the same columns — each ticket counts itself in its own type column (e.g. a Bug ticket → Bugs ↑ = 1 outstanding)

### Per work-type cell content

```
12          ← outstanding count (bold)
p0:3 p1:4   ← priority sub-counts (if any)
Alice:3      ← Bug cell only: top 3 assignees, first name, inline
Bob:2
✓ 45        ← done count underneath
```

### Anomaly flags

- `*` suffix on Key if any child ticket has a mismatched fixVersion (e.g. project=NDB-2.11 but child=master)
- Row highlight if `affectedVersion` contains ERA Future or Triage

### Widget 4 — What is "active"

A row appears in Widget 4 (Sections A or B) only if:
1. **Features/Initiatives**: `statusCategory != Done` — not Closed, Cancelled, Resolved, Done
2. **Standalone Epics**: same
3. **Direct tickets**: `statusCategory != Done` AND fixVersion is NDB-X.Y or master (no ancient ERA versions)

A row appears in **Cleanup Section** if: `statusCategory = Done` AND has ≥1 outstanding descendant.

### `availableReleases` filter rule

Only NDB-X.Y and master are offered in the release chip filter. Ancient versions (Era 1.0, ERA Future, Triage, etc.) are excluded at the `/data` endpoint — they are sourced from active-only issues.

### Current gaps vs agreed design (as of last update)

| Agreed | Current state |
|---|---|
| Broken down by fixVersion sub-section | ✅ Done — `W4ReleaseGroup` accordion per fixVersion |
| `Tasks+UnitTests` as one combined column | ✅ Done — `TaskUnit` bucket |
| Assignees inline in Bug cell | ✅ Done — `W4Cell` inline chips |
| Done count per work-type column | ✅ Done — `✓N` below outstanding |
| Standalone Tickets same columns as Projects/Epics | ✅ Done — unified `W4Row` |
| `*` anomaly flag for fixVersion mismatch | ✅ Done — `cr-mismatch-flag` |
| affectedVersion anomaly highlight | ✅ Done — `cr-row-av-anomaly` |
| Active projects only (not closed/cancelled) | ✅ Done — `statusCategory != Done` in JQL |
| Cleanup section with real stale data | ✅ Done — `staleProjects` from `/data` |
| Ancient fixVersions excluded from chips | ✅ Done — NDB-X.Y + master only |

---

## Widget 6 — Deferral Behaviour (pending)

- Deferral = ticket's `fixVersion` moved from one `NDB-X.Y` to another (via JIRA changelog)
- Also flagged: `NDB-X.Y` → `master` (slip back to funded-not-committed)
- **Chronic** = 3+ kicks across releases
- Show: counts + trends per release, chronic offenders table
  - Columns: Key | Summary | Kick count | Original target | Current target | Last moved
- Chronic + KPI-blocking = highest severity CTA

---

## Widget 5 — KPI Counts (pending)

- Load `kpiConfig.json` for active team
- Count matches per active KPI filter across component payload
- KPI-blocking chronic deferrals → CRITICAL severity in action items

---

## Health Score Logic

```
Red:    any P0 > 30d  OR  P0 count > 3  OR  deferral% > 25%  OR  avg P0 age > 20d
Yellow: 2–3 P0s  OR  some P0 between 20d–30d
Green:  0–1 P0 AND all < 20d
```

Currently: basic heuristic. Needs real P0 counts from payload.

---

## Actionability Rules (CTA Panel)

| Condition | Severity | Recommended Action |
|---|---|---|
| Chronic deferral (3+ kicks) + KPI-blocking | CRITICAL | Escalate to EM immediately |
| Chronic deferral (3+ kicks) | HIGH | Root cause analysis |
| fixVersion mismatch parent↔child | MEDIUM | Data cleanup |
| affectedVersion = ERA Future or Triage | LOW | Remove or correct |
| P0 > 60d, unassigned | CRITICAL | Assign or escalate to EM |
| P0 > 30d, assigned | HIGH | Monitor or escalate |
| Burn rate negative | HIGH | Review intake + capacity planning |

---

## Data Fetching

### 6-part component payload

```
1. topLevelProjects      — Features/Initiatives matching component
2. portfolioChildren     — portfolioChildrenOf(topLevelProjects)
3. epicChildren          — issuesInEpics(portfolioChildren where type=Epic)
4. standaloneEpics       — Epics with component, no parent link
5. standaloneEpicChildren — children of standaloneEpics
6. directTickets         — non-portfolio tickets with component, no epic link
```

### `/data` response shape

```json
{
  "outstanding": [...],        // all non-done issues, normalised, sorted by priority+age
  "projectBreakdown": {        // grouped by fixVersion
    "NDB-2.11": {
      "features": [...],
      "epics": [...],
      "directTickets": [...]
    },
    "master": { ... }
  },
  "availableReleases": [...]   // sorted: NDB-X.Y desc, master, others
}
```

---

## Implementation Files

| File | Purpose |
|---|---|
| `apps/delivery-ops/client/src/components/ComponentReport.js` | All UI — 679 lines |
| `apps/delivery-ops/client/src/components/ComponentReport.css` | Styles — accordion, widget, chip |
| `apps/delivery-ops/server/routes/component.js` | `/list`, `/health`, `/data` endpoints — 402 lines |
| `apps/delivery-ops/server/services/componentReportService.js` | `fetchComponentsFromERA`, `fetchComponentPayload` |

---

## Key Technical Notes

1. `runSearchByJql` flattens JIRA `fields` directly onto issue — use `issue.summary` not `issue.fields.summary`
2. Component filter: `c.archived !== true && c.deleted !== true` — JIRA API does not return `active` field
3. `parent` field added to `STANDARD_FIELD_NAMES` in `jiraSearchByJql.js` for 2-hop traversal
4. `safeJqlSearch` wrapper — catches per-query JQL errors; partial failures return empty instead of 500
5. JQL nested quoting: `portfolioChildrenOf("... component = \"Name\" ...")` needs escaped inner quotes

---

## Pending Work (priority order)

1. **Widget 4 backend** — `buildProjectBreakdown` grouped by fixVersion, Task+UnitTest combined, mismatch detection
2. **Widget 4 frontend** — fixVersion accordions, unified table, inline assignees, per-type done, anomaly flags
3. **Widget 6** — JIRA changelog queries, kick count, chronic offenders, trend
4. **Widget 5** — kpiConfig.json integration
5. **Cleanup section** — stale projects, data quality, unassigned P0s
6. **CTA panel** — top 3 actionable insights from anomaly rules
7. **Health score** — use real P0 counts + age from payload
