# Retrospective — Data Layer & Middleware Contract

**Route**: `/release/retrospective`  
**Server routes used**: `server/routes/releaseDataset.js` (retrospective sub-routes), `server/routes/jira/kpi.js` (`release-kpi-breakdown-batch`)  
**Hooks**: `useRetrospective` (`release/hooks/useRetrospective.js`), `useRetroComparison` (`release/hooks/useRetroComparison.js`)  
**Services**: `release/services/retrospectiveService.js`, `release/services/retroComparisonService.js`  
**Components**: `ProjectGateHealthTable`, `ReleaseComparisonTable`, `ComparisonTrendChart`  
**Utils**: `release/utils/releaseCompareSet.js` (release-set picker)  
**Bundle utility**: `release/utils/bundleUtils.js` (CRA copy of `shared/src/domain/bundleDerive.js`, D41)  
**Contexts consumed**: `SelectedReleaseContext`, `ReleaseDataContext`

---

## API Calls (client → server) — 4-step waterfall

The hook loads live JIRA for the selected release (`ReleaseDataContext` → `GET /per-release`). `productId` is the selected team id.

### Step 1 — Bootstrap (gate dates + summary counts)

```
GET /api/release-dataset/retrospective/bootstrap?release=<fixVersion>&productId=<teamId>
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → retroService.getBootstrap(release, productId)`  
**Source**: live tickets from `ReleaseDataContext` / `GET /api/release-dataset/per-release/:release` (team `baseFilter`). No Sync Hub disk bundle. 
**Returns**:
```json
{
  "gateDates": { "ccm": "...", "cg": "...", "pg": "...", "ga": "..." },
  "gateChecks": {
    "ccm": { "openAtGate": 12, "closedPct": 88, "rag": "amber", "links": { "openAtGate": "<jql>", "total": "<jql>" } },
    "cg":  { "p0p1OpenAtGate": 3, "p0p1FoundAfter": 1, "ragOpen": "red", "ragAfter": "amber", "links": { ... } },
    "pg":  { "openAtGate": 5, "deferredCount": 8, "rag": "green", "links": { ... } },
    "ga":  { "p0p1OpenAtGa": 0, "rag": "green", "links": { ... } }
  }
}
```

---

### Step 2 — Projects list (naughty list source)

```
GET /api/release-dataset/retrospective/projects?release=NDB-2.11&productId=ndb&page=1&limit=10
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → retroService.getProjects(release, productId, page, limit)`  
**Source**: bundle if available; otherwise live JIRA aggregation  
**Returns**:
```json
{
  "projects": [
    {
      "key": "ERA-100",
      "name": "Storage",
      "ccmViolations": 4,
      "cgViolations": 2,
      "pgViolations": 0,
      "totalViolations": 6,
      "rag": "red"
    }
  ],
  "total": 42,
  "page": 1
}
```

---

### Step 3 — Project detail (expanded naughty list row)

```
GET /api/release-dataset/retrospective/project/:parentKey?release=NDB-2.11&productId=ndb&parentType=Feature&parentSummary=...
Headers: x-jira-token, x-username
```

**Server flow**: `releaseDataset.js → retroService.getProjectDetail(release, productId, parentKey)`  
**Triggered**: on-demand when user expands a project row  
**Returns**: array of specific ticket keys + violation type per ticket

---

### Step 4 — Full retro fallback (if bundle missing)

```
GET /api/release-dataset/retrospective?release=NDB-2.11&productId=ndb&topN=10
Headers: x-jira-token, x-username
```

**Used only when**: `retroFallback` state is set (bootstrap fails or returns empty)  
**Server flow**: fires all gate-check JQL queries live against JIRA  
**Returns**: full retro shape (same as bootstrap + projects combined)

---

## Cross-Release Comparison (in `useRetroComparison`)

Loaded only after the user presses Fetch (`enabled = hasFetched`). Request-storm
safe: keyed by `(teamId, releaseSet)`; no auto-refetch on empty results.

**Release set** — `pickComparisonReleases(versions, selectedRelease, 3)` picks the
latest 3 major/minor ("big", one-dot) releases plus the selected release, sorted
oldest → newest. Maintenance (two-dot) and patch (three-dot) are excluded.

**Per release, in parallel:**

1. `GET /api/release-dataset/per-release/:release?productId=<teamId>` — flat ticket
   bundle (offline source). Derives:
   - `deriveReleaseScorecardFromBundle(tickets, release)` → task closure, bugs
     (total/done/open + resolution split), P0/P1 open, reopen rate.
   - `deriveBugVerificationAtPG(tickets, release, pgDate)` → bug/improvement
     unverified-at-PG, verification lag (`Closed Date − Last Resolved Date`:
     median/avg/p90 + `≤7 / 8–30 / 31–90 / >90` buckets), reopen rate.
2. `GET /api/release-dataset/gates?release=<release>` — supplies the PG date
   (latest solid PG) for the unverified-at-PG time-travel semantics.
3. `POST /api/jira/release-kpi-breakdown-batch` body `{ releaseVersion, teamId }`
   — live per-KPI total/done/open counts by resolution (see `docs/api/jira.md`).

KPI definitions (row order) come from `GET /api/config/kpi?teamId=<teamId>`.

Failures are isolated: a missing bundle blanks one column; a KPI-breakdown failure
blanks only the KPI rows for that release; delivery/PG rows still render.

**Verification lag semantics**: "verified" = the Resolved → Closed transition
(dev-fixed → QA-verified). `unverifiedAtPg` = resolved on/before PG but not Closed
by PG. JQL for the unverified cell uses
`... AND status = Resolved AND status was not Closed ON "<pgDate>"`.

---

## Bundle-to-Live Fallback Logic (in `useRetrospective`)

```
1. Try bootstrap from bundle   → success: use it, skip live
2. Try projects from bundle    → success: use it
3. Either fails or is empty    → trigger fallback live fetch
4. Fallback also fails         → show error state with retry
```

---

## RAG Thresholds (server-computed, not client)

| Gate | Metric | Green | Amber | Red |
|------|--------|-------|-------|-----|
| CCM | closed % | ≥ 95% | 80–94% | < 80% |
| CG | P0/P1 open | 0 | 1–2 | ≥ 3 |
| CG | P0/P1 found after | 0 | 1 | ≥ 2 |
| PG | open at gate | 0 | 1–5 | ≥ 6 |
| GA | P0/P1 open | 0 | — | ≥ 1 |

---

## JIRA Queries Underlying Gate Checks

All JQL strings are constructed server-side by `retroService` using `productService.getCustomFields(productId)` — never hardcoded field IDs.

| Check | JQL pattern |
|-------|------------|
| CCM open | `project=ERA AND fixVersion={release} AND issueType in (Task,"Unit Test") AND status != Done AND resolutiondate > "{ccmDate}"` |
| CG P0/P1 open | `project=ERA AND fixVersion={release} AND issueType=Bug AND priority in ("Blocker - P0","Critical - P1") AND status != Done AND resolutiondate > "{cgDate}"` |
| PG open | `project=ERA AND fixVersion={release} AND status not in (Done,Closed) AND resolutiondate > "{pgDate}"` |

---

## Caching

| Data | Cache | TTL |
|------|-------|-----|
| Bootstrap gate checks | Live per-release fetch | 5 min in-memory TTL |
| Projects list | Derived from live per-release tickets | 5 min in-memory TTL |
| Project detail | No cache — on-demand live | — |
| Full retro fallback | No cache | — |
| Cross-release scorecards / PG verification | Per-release bundle (offline) | inherits per-release cache |
| Cross-release KPI breakdown | Live count-only queries | `useRetroComparison` key `(teamId, releaseSet)` |
