---
name: ticket-insights
description: Fetch and break down all tickets for a release or feature — 8-clause portfolio-children JQL with bulk IN optimization plus 6-group issue-type breakdown, Dev vs QA split, and per-group status with clickable JIRA links. Use when any project key or release needs ticket data with breakdown and traceability.
audience: tpm, rm, portfolio_mgr, team-exec, feat
---

# Ticket Insights — Unified Fetch + Breakdown (D17, D36)

Single skill for **all** ticket fetch + breakdown needs. Merged from `fetch-project-tickets` (8-clause JQL primitive) + `issue-type-breakdown` (6-group + Dev/QA + status). Every ticket query goes through this skill — no inline JQL.

## When to Use This Skill

- User says "breakdown for NDB-2.11", "show FEAT-1234 tickets", "X of Y done" — any ticket list or breakdown
- Building outstanding-work reports, Team Executive summaries, or chatbot ticket lists
- Weekly status needs per-release or per-FEAT ticket counts with group/status split
- Any time a single project key (`FEAT-1001`) must expand to all related tickets across the Nutanix portfolio hierarchy
- Generating audit-friendly output with clickable JIRA links per metric
- User needs Dev vs QA split or status mix, not just raw counts

If the user wants to *sync* the full release dataset (3-group/6-bucket bundle with cache), use `release-dataset-sync` instead — this skill is for on-demand fetch+breakdown, not the sync pipeline.

## Quick Start

```
Input: {
  target: 'NDB-2.11' | 'FEAT-1234',   // release OR feature key
  productId: 'ndb' | 'datalens' | ...,
  includeStatusBreakdown: true,        // default true
  includeDevQaSplit: true              // default true
}

Route by target:
1. If target matches /^[A-Z]+-\d+$/ → FEAT expansion (8-clause)
2. Else → release payload (5-component)

Fetch → Transform → Render (see Core Rules + JQL Templates)
```

## Core Rules

### Fetch — JQL primitives (from fetch-project-tickets)

1. **Validate project key format** `/^[A-Z]+-\d+$/` before building JQL — reject malformed keys.
2. **Single project → `key = FEAT-NNNN OR ...`** form; **multiple projects → bulk `key IN (...) OR ...`** form (93% faster). Never loop single-key queries.
3. **Always use `"FEAT ID" ~ key`** (contains) — never `=` (field doesn't support equality).
4. **No `project = ERA` prefix** — tickets can live in any project and still relate to a FEAT.
5. **Fall back to OR-conditions** if `IN` clauses fail on the JIRA instance.
6. **Executive view → all issue types; team view → exclude** `Feature, Initiative, X-FEAT, Capability, Epic`.

### Release vs feature routing

7. **Release target (`NDB-2.11`)** → 5-component release payload base query (see JQL Templates).
8. **Feature target (`FEAT-1234`)** → 8-clause FEAT expansion base query (see JQL Templates).
9. **Product-agnostic** — resolve `projectIds` via `productService`, do not hardcode product assumptions.

### Breakdown — 6 groups + Dev/QA + status (from issue-type-breakdown)

10. **Always output all 6 groups** exactly as defined, including zero-count rows for comparability:
    - Project Hierarchy: `Feature, Initiative, Epic, X-FEAT, Capability`
    - Bug: `Bug`
    - Improvement: `Improvement`
    - Dev Code: `Task, "Unit Test"`
    - Test: `Test`
    - Everything Else: any type not above
11. **Every metric is clickable** — JIRA link from exact JQL that produced the count. Dual-click where UI has in-app drill: **count → panel**, **Open in JIRA → JQL** (`metric-click-dual-action.mdc`).
12. **Preserve source traceability** — show JQL or source tag next to each claim (D10).
13. **Dev vs QA split is fixed:**
    - Dev = `issueType != Test`
    - QA = `issueType = Test`
    - QA verification adjusted = closed `Bug` + `Improvement` × `0.33`
14. **Status breakdown required per group** — stable order (Open, In Progress, Done, Closed, Cancelled). Never drop empty groups.

### JQL Templates

**Base release payload (5-component, D36 Release Payload — no project filter):**

```
project in (<projects from productService>) AND (
  (<top-level release payload clause>)
  OR (<portfolio-children clause>)
  OR (<issues-in-epics clause>)
  OR (<standalone-epics clause>)
  OR (<direct-release-tickets clause>)
)
```

**Base feature payload (8-clause FEAT expansion):**

```
(
  key = <featureKey>
  OR "FEAT ID" ~ <featureKey>
  OR issueFunction in portfolioChildrenOf("key = <featureKey>")
  OR issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf(\"key = <featureKey>\")")
  OR <remaining clauses from canonical 8-clause pattern>
)
```

**Group filters (append as `(<basePayloadJql>) AND (<groupFilter>)`):**

```
ProjectHierarchy: issueType in (Feature, Initiative, Epic, X-FEAT, Capability)
Bug:              issueType = Bug
Improvement:      issueType = Improvement
DevCode:          issueType in (Task, "Unit Test")
Test:             issueType = Test
EverythingElse:   issueType not in (Feature, Initiative, Epic, X-FEAT, Capability, Bug, Improvement, Task, "Unit Test", Test)
```

**Status per group:**

```
(<basePayloadJql>) AND (<groupFilter>) AND status = "<statusName>"
```

**Dev vs QA:**

```
Dev: (<basePayloadJql>) AND issueType != Test
QA:  (<basePayloadJql>) AND issueType = Test
QA verification (closed): (<basePayloadJql>) AND issueType in (Bug, Improvement) AND status = Closed → adjusted = count * 0.33
```

## Output Format

```markdown
Target: <release or feature> | Scope: <release-payload | feature-expansion> | Total: <N> [JIRA Link]

### 1. Issue Type Group Breakdown
| Group             | Count | % of Total | JIRA Link |
|-------------------|------:|-----------:|-----------|
| Project Hierarchy |   120 |      18.2% | <url>     |
| Bug               |   210 |      31.8% | <url>     |
| Improvement       |    95 |      14.4% | <url>     |
| Dev Code          |   140 |      21.2% | <url>     |
| Test              |    65 |       9.8% | <url>     |
| Everything Else   |    30 |       4.5% | <url>     |

### 2. Dev vs QA Split
- Dev: <count> (<percent>%) [JIRA Link]
- QA (Test): <count> (<percent>%) [JIRA Link]
- QA verification (Bug+Improvement closed): <count> → adjusted x0.33: <adjusted>

### 3. Status Breakdown per Group
For each group:
| Status      | Count | JIRA Link |
|-------------|------:|-----------|
| Open        |   ... | <url>     |
| In Progress |   ... | <url>     |
| Done        |   ... | <url>     |
| Closed      |   ... | <url>     |
| Cancelled   |   ... | <url>     |

Source: <basePayloadJql or source tag>
```

For exec surfaces, render the 6-group table as the hero; status detail collapses or pages.

## Quality Validation

- [ ] Target routed correctly (release → 5-component, feature → 8-clause)
- [ ] All 6 groups present including zero-count rows; percentages sum ~100% (rounding only)
- [ ] Every numeric metric has clickable JIRA link with matching JQL
- [ ] JQL uses `~` for "FEAT ID", bulk `IN (...)` for multi-key, validated key format, fallback path
- [ ] Dev/QA split included and consistent with group totals; QA verification uses `* 0.33`
- [ ] Status breakdown per group in stable order; no silent drops
- [ ] Source traceability (JQL/tag) present; product-agnostic wording (D1)
- [ ] No `project = ERA` scoping; no hardcoded host (D40, no-localhost)

## Delegation

Owner: `tpm-specialist`. Triggered by `ops-assistant` via `loadAgentPack('lighthouse')`.
