---
name: issue-type-breakdown
description: Fetch and break down all related tickets for a release or feature by issue type group, Dev vs QA split, and per-group status. Use when the user asks for "breakdown" views with clickable JIRA traceability.
audience: tpm, rm, team-exec, feat
---

## When to Use This Skill

- The user asks for issue type group breakdown for a release (for example `NDB-2.11`)
- The user asks for the same breakdown for a feature or FEAT key (for example `FEAT-1234`)
- The user needs Dev vs QA split and status mix, not only a raw ticket count
- The output must be audit-friendly with clickable JIRA links per metric

## Quick Start

```
Input: {
  target: 'NDB-2.11' | 'FEAT-1234',
  productId: 'ndb' | 'datalens' | 'ncm' | ...,
  includeStatusBreakdown: true,   // required by default
  includeDevQaSplit: true         // required by default
}

Route:
1. If target matches /^[A-Z]+-\d+$/ -> treat as feature ticket input
2. Else -> treat as release input

Fetch:
- Release input -> build base payload JQL from the 5-component release query pattern
- Feature input -> build base payload JQL from the 8-clause FEAT expansion pattern

Transform:
1. Compute total tickets from base payload
2. Compute 6 issue type groups
3. Compute Dev vs QA split
4. Compute status breakdown within each group
5. Generate a JIRA URL for every count using the exact JQL used
```

## Core Rules

1. **Always output all six issue type groups** exactly as defined:
   - Project Hierarchy: `Feature, Initiative, Epic, X-FEAT, Capability`
   - Bug: `Bug`
   - Improvement: `Improvement`
   - Dev Code: `Task, "Unit Test"`
   - Test: `Test`
   - Everything Else: any type not included above
2. **Always make every metric clickable** using JIRA links built from the exact JQL that produced the count.
3. **Always preserve source traceability** by showing either the JQL or a source tag next to each claim.
4. **Use release vs feature routing correctly**:
   - Release target -> 5-component release payload base query
   - Feature target -> FEAT expansion base query
5. **Use product-agnostic configuration**; do not hardcode product-specific assumptions in output wording.
6. **Dev vs QA split definition is fixed**:
   - Dev = issue type not equal to `Test`
   - QA = issue type equal to `Test`
   - QA verification adjusted count = closed `Bug` and `Improvement` issues multiplied by `0.33`
7. **Status breakdown is required for each group** and should include the same status buckets in a stable order (for example Open, In Progress, Done, Closed, Cancelled).
8. **Do not silently drop empty groups**; include zero counts so the breakdown remains comparable over time.

### JQL Templates

Base release payload template (5-component model):

```
project in (<projects from productService>) AND (
  (<top-level release payload clause>)
  OR (<portfolio-children clause>)
  OR (<issues-in-epics clause>)
  OR (<standalone-epics clause>)
  OR (<direct-release-tickets clause>)
)
```

Base feature payload template (FEAT expansion model):

```
(
  key = <featureKey>
  OR "FEAT ID" ~ <featureKey>
  OR issueFunction in portfolioChildrenOf("key = <featureKey>")
  OR issueFunction in issuesInEpics("issueFunction in portfolioChildrenOf(\"key = <featureKey>\")")
  OR <remaining clauses from canonical FEAT expansion pattern>
)
```

Group filters to append as:
`(<basePayloadJql>) AND (<groupFilter>)`

```
ProjectHierarchy: issueType in (Feature, Initiative, Epic, X-FEAT, Capability)
Bug: issueType = Bug
Improvement: issueType = Improvement
DevCode: issueType in (Task, "Unit Test")
Test: issueType = Test
EverythingElse: issueType not in (Feature, Initiative, Epic, X-FEAT, Capability, Bug, Improvement, Task, "Unit Test", Test)
```

Status breakdown template per group:

```
(<basePayloadJql>) AND (<groupFilter>) AND status = "<statusName>"
```

Dev vs QA split templates:

```
Dev: (<basePayloadJql>) AND issueType != Test
QA:  (<basePayloadJql>) AND issueType = Test
QA verification count:
  (<basePayloadJql>) AND issueType in (Bug, Improvement) AND status = Closed
  adjusted_count = count * 0.33
```

## Output Format

```
Target: <release or feature>
Scope: <release-payload | feature-expansion>
Total Tickets: <N> [JIRA Link]

Section 1: Issue Type Group Breakdown
| Group             | Count | % of Total | JIRA Link |
|-------------------|------:|-----------:|-----------|
| Project Hierarchy |   120 |      18.2% | <url>     |
| Bug               |   210 |      31.8% | <url>     |
| Improvement       |    95 |      14.4% | <url>     |
| Dev Code          |   140 |      21.2% | <url>     |
| Test              |    65 |       9.8% | <url>     |
| Everything Else   |    30 |       4.5% | <url>     |

Section 2: Dev vs QA Work Split
- Dev: <count> (<percent>%) [JIRA Link]
- QA (Test): <count> (<percent>%) [JIRA Link]
- QA verification (Bug+Improvement closed): <count>
- QA verification adjusted count (x0.33): <adjustedCount>

Section 3: Status Breakdown per Group
For each group, render:
| Status      | Count | JIRA Link |
|-------------|------:|-----------|
| Open        |   ... | <url>     |
| In Progress |   ... | <url>     |
| Done        |   ... | <url>     |
| Closed      |   ... | <url>     |
| Cancelled   |   ... | <url>     |
```

## Quality Validation

- [ ] Target type routed correctly (release vs feature key)
- [ ] All 6 issue type groups are present (including zero-count rows)
- [ ] Group percentages sum to ~100% (rounding drift only)
- [ ] Every numeric metric has a clickable JIRA link with matching JQL
- [ ] Dev and QA split is included and consistent with group totals
- [ ] QA verification adjusted count uses `count * 0.33`
- [ ] Status breakdown is included for each group
- [ ] Output includes source traceability (JQL or source citation tags)
