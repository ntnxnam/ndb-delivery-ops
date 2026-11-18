---
name: sprint-gantt-chart
description: Build sprint-based Gantt charts that follow the Nutanix JIRA date hierarchy (gate dates for FEAT-tier, dueDate for Epic, sprint-end for everything else). Use when visualizing ticket timelines, rendering sprint progress, building React Gantt components, or generating email-compatible HTML Gantt tables.
audience: tpm, rm, portfolio_mgr
---

# Sprint Gantt Chart (project-level reference)

This skill is canonically defined at:

```
~/.cursor/skills/sprint-gantt-chart/SKILL.md
```

## When to Use This Skill

- Rendering ticket timelines on a release page or sprint analysis page
- Visualising "Everything Else" issue types (Stories, Tasks, Bugs)
  against sprint windows
- Building the email-compatible HTML Gantt for weekly status reports
- Embedding a mini-Gantt in chatbot replies via the
  `[chart:<id>]` token mechanism (after chart catalog, capability #5,
  is ported)

## Why It Matters Here

This is **capability #18** in `CONSOLIDATION.md`. Once ported,
`apps/delivery-ops/client/src/components/SprintGantt/` provides:

1. An interactive React Gantt for in-app use
2. A static HTML Gantt for email reports

Both obey the Nutanix JIRA date hierarchy rule
(`.cursor/rules/jira-date-hierarchy.mdc`).

## Core Rules (memorise — these come from the date-hierarchy rule)

1. Follow date hierarchy: gate dates for X-FEAT/Feature/Initiative,
   `duedate` for Epic, sprint end for everything else
2. Start date: use the ticket's own start date; fall back to release
   EC date if missing
3. Make a Sprint API call for "Everything Else" tickets — never guess
   sprint end dates
4. Cache sprint data by sprint ID to avoid redundant calls
5. Show blank/empty bar for tickets with no sprint assigned — never
   hide them
6. Only "Everything Else" tickets appear in the sprint Gantt; FEAT-tier
   and Epic tickets use their own views (gate dates and `duedate`
   respectively)
7. Support daily / weekly / monthly zoom; include today marker

## Output Shape (two deliverables)

1. **React component** — interactive Gantt rendered inside the app
   (scrollable, zoom controls, today marker, hover details)
2. **Email HTML** — static table-based Gantt, inline CSS, max 800px
   wide, no external assets

Both surface: ticket key, summary, sprint name, bar spanning sprint
start → end, blank row for unassigned tickets.

## Quality Validation

- [ ] Only "Everything Else" issue types appear (no FEAT/Epic)
- [ ] Sprint bars span correct start → end dates from the Sprint API
- [ ] Unassigned tickets show a blank bar, not hidden
- [ ] Today marker at correct position
- [ ] Daily/weekly/monthly zoom works
- [ ] Email HTML is self-contained
- [ ] Sprint data cached (no duplicate Sprint API calls)
