# Component Report Page — Compressed Context

**Status**: In progress. Foundation + component list + Outstanding + Projects tabs implemented.

## Implementation Progress

| Item | Status | Notes |
|---|---|---|
| Route + sidebar + permissions | ✅ Done | `/component-report`, `RELEASE_VERSIONS_VIEW` |
| Component list from JIRA | ✅ Done | `/rest/api/2/project/ERA/components`, archived filter, session cache |
| Health card (RAG + metrics) | ✅ Done | Routes `/api/component/health`, safeJqlSearch wrapper |
| Outstanding tab | ✅ Done | Real JIRA data, sortable, priority filter buttons, age badges, JIRA links |
| Projects tab | ✅ Done | Features/Initiatives + standalone epics tables with JIRA links |
| Trends tab | 🚧 Pending | Placeholder shown |
| Cleanup tab | 🚧 Pending | Placeholder shown |
| Deferral tracking | 🚧 Pending | Changelog queries not yet built |
| AI action items / CTA | 🚧 Pending | `deferralAnalysisService.js` not yet built |

## Key Technical Bugs Fixed

1. **`res.components` → `res.data?.components`** — axios returns full response; `.data` required.
2. **Nested JQL quoting** — `portfolioChildrenOf("... component = \"Name\" ...")` needed escaped inner quotes.
3. **safeJqlSearch wrapper** — catches per-query JQL errors; partial failures return empty instead of 500.
4. **Archived component filter** — `!c.archived` applied before returning component list.
5. **ReleaseOutstanding.js lint error** — fixed dead-code dependency in useEffect.

## What We're Building

New page: `/component-report` — Director-focused component health dashboard. Shows rich actionable data. Every metric links to JIRA, every problem shows owner.

## Architecture (4 Tabs)

1. **Outstanding** (default) — All outstanding issues, sorted by age ↓. P0/P1 summary cards at top. Assignee accountability visible. Non-P0/P1 collapsed by default.

2. **Projects** — Projects sorted by risk (P0 count × age). Expandable rows show work-type breakdown. Health chip (🔴🟡🟢) per project. Standalone epics + data quality issues sections.

3. **Trends** — Burn rate (created vs resolved), deferral trend across releases, chronic deferral index, team velocity breakdown.

4. **Cleanup** — Stale projects, chronic deferrals (3+ kicks), data quality issues, unassigned P0s.

## Persistent Above Tabs

**Health Card**: RAG status + P0/P1 counts + deferral % + aging signal + one-line verdict. All clickable.

**Action Items Panel**: AI-powered top 3 CTAs (oldest unassigned P0 + KPI-blocking chronic deferral + negative trend + specific next steps + links).

---

## Key Decisions

### Routing & UX
- Route: `/component-report` (add to routeConfig.js, RELEASE_VERSIONS_VIEW permission)
- Tabs use URL query params: `?tab=outstanding|projects|trends|cleanup`
- Default: Outstanding tab
- Progressive loading: Health first, tabs on-demand

### Component Dropdown
- Fetched from ERA project (component field)
- Cached in session storage
- Manual refresh button

### Release Filter
- Default: `filter=NDB-CurrentFixVersion OR fixVersion=master`
- Multi-select for custom filtering
- Applies to all tabs

### KPI Detection
- Load `kpiConfig.json` for active team
- For each chronic deferral (3+ kicks), check if ticket's JQL matches any KPI's `baseQuery`
- If match → flag as "blocks KPI" → CRITICAL severity in action items
- See `kpiConfig.json` (existing file) for structure

### Deferral = 3+ distinct fixVersion values in changelog
- Query JIRA changelog per ticket
- Track kicks across releases (NDB-2.8 → 2.9 → 2.10 → 2.11 = 4 kicks = chronic)
- Chronic + KPI-blocking = priority alert

### Health Score
```
🔴 Red: any P0 > 30d OR P0 count > 3 OR deferral% > 25% OR P0 age > 20d avg
🟡 Yellow: 2-3 P0s OR some P0 20d-30d
🟢 Green: 0-1 P0 AND all < 20d
```

### Outstanding Tab Sorting
- **Default**: Age ↓ (oldest first)
- Columns: Key (link to JIRA) | Summary | Type | Priority | Age | Assignee | fixVersion | Action (🔴🟡→)
- Filters: Type [All/Bug/Improvement/Test] | Age threshold

### Projects Tab
- **Sort**: Risk score ↓ (P0 count × avg age)
- **Health chip** per project row
- **Expandable rows**: Work-type breakdown (Bugs outstanding/done with P0/P1 counts + top assignees)
- **Standalone Epics** section
- **Data Quality Issues** section (fixVersion anomalies, affectedVersion invalid)

### Trends Tab
- Burn rate (created vs resolved, last 3 weeks) + verdict
- Deferral trend (per release + comparative context)
- Chronic deferral index (reliability score)
- Team velocity (Dev + QA breakdown)
- Every metric has: current value + trend + verdict + action

### Cleanup Tab
- Stale projects (closed/cancelled status, children open) + fix link
- Chronic deferrals (3+ kicks) table with details
- Data quality issues (fixVersion anomalies, affectedVersion invalid, missing components)
- Unassigned items

---

## Data Fetching

### 6-Part Component Payload (per component + release filter)

```jql
1. Component-level Projects: 
   filter=ndb-all-base-filter AND type in (Feature, Initiative) 
   AND (component = X OR "Primary Component" = X) 
   AND status not in (Closed, Cancelled)

2-6. Epic children, ticket children, standalone epics, epic children, direct tickets
     (same as existing release-level queries, scoped to component)
```

**Section filter (Outstanding/Projects tabs)**:
```
(fixVersion in current releases OR fixVersion=master) 
AND statusCategory != Done
```

**Cleanup section (old releases)**: Replace with `(fixVersion NOT IN current releases AND fixVersion != master)`

### JQL Composition Notes
- Resolve `filter=NDB-CurrentFixVersion` to actual JQL before composing OR condition
- Use `getReleaseBaseFilter()` from `server/utils/teamConfig.js`
- Use `getTeamBaseFilter()` for the base filter
- "Primary Component" is a real JIRA field (valid in JQL as-is)

---

## AI Layer (deferralAnalysisService.js)

**Detection Rules**:
1. Chronic deferral (3+ kicks) + KPI-blocking → CRITICAL
2. Chronic deferral (3+ kicks) → HIGH
3. fixVersion anomaly (parent ≠ child) → MEDIUM
4. affectedVersion in (ERA Future, Triage) → LOW

**Pattern Analysis**:
- If all chronic bugs in same subsystem → suggest "design/architecture issue"
- If deferral spike correlates with velocity drop → suggest "capacity exhaustion"
- If negative burn rate + deferral ↑ → suggest "intake exceeds capacity"

**CTA Generation**: Use rules above to pick top 3 alerts for action panel.

---

## Implementation Files

### New Component
- `apps/delivery-ops/client/src/components/ComponentReport.js`
- State: `selectedComponent`, `releaseFilter`, `activeTab` (from query param), `cachedComponentList`

### New Hook
- `apps/delivery-ops/client/src/hooks/useComponentData.js`
- Fetch 6-part payload, compute health score, detect action items

### New Services
- `apps/delivery-ops/server/services/componentReportService.js` — orchestrate JQL, aggregate, sort projects by risk, compute metrics
- `apps/delivery-ops/server/services/deferralAnalysisService.js` — changelog queries, chronic detection, KPI matching, AI insights

### New Route
- `apps/delivery-ops/server/routes/component.js` — endpoints: `/component/list`, `/component/data`, `/component/health`, `/component/actions`

### Update
- `apps/delivery-ops/client/src/layout/utils/routeConfig.js` — add `/component-report` entry

---

## Actionability Rules

Every metric must have **Recommended Action**:

| What | Action |
|---|---|
| P0 > 60d, unassigned | Assign to team or escalate to EM |
| P0 > 30d, assigned | Monitor (if trending toward resolution) or escalate |
| Kick count ≥ 3 | Root cause analysis (not another deferral) |
| Chronic + KPI blocking | Escalate to EM immediately |
| Burn rate negative | Review intake + capacity planning |
| Deferral ↑ | Investigate root (quality? scope? capacity?) |
| fixVersion anomaly | Data cleanup (use corrective form) |
| affectedVersion invalid | Remove or correct |
| Unassigned P0/P1 | Batch triage |

---

## Existing Utilities to Reuse

- `server/utils/teamConfig.js`: `getReleaseBaseFilter()`, `getTeamBaseFilter()`, `getTeamConfig()`
- `server/utils/jiraRouteHelpers.js`: `getDefaultReleaseBaseFilter()`, `getReleaseBaseFilter()`
- `kpiConfig.json`: for KPI detection
- `kpiPage.js`: reference for KPI UI patterns

---

## Integration Points

- Reuse release/sprint base filter logic
- Use existing JIRA API wrappers
- Follow minimal-architecture: component renders, hook fetches, service transforms
- All JIRA links per jira-authenticity-links.mdc (clickable metrics, drill-down queries)
- Cache component list; lazy-load tabs for performance
- Progressive rendering (health first, then tab content)

---

## Testing Checklist

- [ ] Health card updates on component/release change
- [ ] Tabs switch via URL params (browser back works)
- [ ] All counts are clickable (verify JQL is correct)
- [ ] Chronic deferrals (3+ kicks) detected correctly
- [ ] KPI-blocking logic matches kpiConfig.json
- [ ] Assignee accountability visible
- [ ] Age distribution computed correctly
- [ ] Risk sorting (Projects tab) works
- [ ] Aging is primary sort (Outstanding tab)
- [ ] Progressive loading (health visible before tab content)
