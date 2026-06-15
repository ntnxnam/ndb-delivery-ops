# Component Report — Requirements

**Route**: `/component-report`  
**Component**: `ComponentReport`  
**Permission**: `RELEASE_VERSIONS_VIEW`  
**Audience**: director, RM — component-level bug health

---

## Purpose

The Component Report is a director-focused dashboard showing the health of each JIRA component (e.g., Storage, Networking, UI). For each component it shows open P0/P1 blockers, other open bugs by priority, deferral trends, and KPI metrics — enabling a director to identify which components are most at risk without opening JIRA.

---

## User Stories

| ID | Story |
|----|-------|
| CR-01 | As a director, I can see a health status (green/amber/red) for each component at a glance. |
| CR-02 | As a director, I can filter the view by release to scope to only current-release issues. |
| CR-03 | As an RM, I can see P0 blockers per component with age badges (how many days open). |
| CR-04 | As an RM, I can see P1 criticals per component. |
| CR-05 | As an RM, I can see other-priority issues bucketed by component. |
| CR-06 | As an RM, I can see KPI metrics (e.g., total open, closed %) per component. |
| CR-07 | As an RM, I can see deferral trends — how many issues per component were deferred in recent releases. |
| CR-08 | As a user, every issue count links to the JIRA query producing that result. |

---

## UI Layout

The page follows a three-section layout per component:

```
[Filters] → [Component Health Card (overall RAG)]
  → Section A (Current release issues)
      Widget 1: P0 Blockers | Widget 2: P1 Criticals | Widget 3: Other Priority
      Widget 4: Projects     | Widget 5: KPI          | Widget 6: Deferrals
  → Section B (Other release issues — same widgets)
  → Section C (Cleanup — stale/old issues not in any active release)
```

---

## Permissions

- Requires `RELEASE_VERSIONS_VIEW`
- No write actions — read-only

---

## Data Fetch Strategy

**Fetch once per component, filter client-side** — the server returns all open issues for a component regardless of release; the client applies the release filter at render time.

This is the intentional architecture: avoids per-release server round-trips when the user switches releases in the filter bar.

---

## Edge Cases

| Case | Expected behaviour |
|------|--------------------|
| Component with 0 open issues | Show green health dot; "All clear" body |
| Component data fetch fails | Show per-component error state; other components still render |
| Release filter shows no issues for a component | Section A empty state: "No current-release issues for this component" |
| Age badge ≥ 60 days | Red badge |
| Age badge 30–59 days | Orange badge |
| Age badge < 30 days | Green badge |

---

## Acceptance Criteria

- [ ] Component list loads from bundle within 2 seconds
- [ ] Switching the release filter applies instantly (no server call)
- [ ] Health dot accurately reflects worst-severity open issue (P0 → red, P1 → amber, else green)
- [ ] Every count in every widget links to JIRA
- [ ] Age badges compute from `created` date to today (not `updated`)
