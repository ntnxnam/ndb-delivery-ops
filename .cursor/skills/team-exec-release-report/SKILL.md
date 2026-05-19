---
name: team-exec-release-report
description: Generate executive team-exec-level release reports with risk escalation rules, dense single-line bullets, and complete project coverage. Use when producing Team Executive/director-level release readouts, processing HTML or JIRA-derived project data into executive summaries, or analyzing release readiness with systematic risk assessment.
audience: team-exec, portfolio_mgr
---

# Team Executive Release Report (project-level reference)

This skill is canonically defined at:

```
~/.cursor/skills/team-exec-release-report/SKILL.md
```

It includes a full set of supporting assets (`scripts/`, `templates/`,
`NUTANIX-FIELDS.md`, `EXAMPLES.md`) that live alongside the canonical
SKILL.md. Do not duplicate them here.

## When to Use This Skill

- Producing the Team Executive-Executive monthly/weekly release report
- Converting HTML release-tracking data into dense executive bullets
- Applying risk-escalation rules systematically across a portfolio
- When the chatbot (`team-exec-specialist`) needs to compose a structured
  release narrative for a Team Executive user

## Why It Matters Here

This is **capability #7** in `CONSOLIDATION.md`. Once the port lands
(`shared/services/vpReportService.ts`), the chatbot's `team-exec-specialist`
sub-agent calls the service rather than re-deriving the risk rules.
The skill remains the human-readable spec of *how* the report is built;
the service is the code that obeys it.

## Core Contract (memorise — do not deviate)

### Risk escalation rules

- Date slips: 0–1 use manual indicator; 2–3 escalate one level;
  4+ → Red; 6+ month delay → critical
- Priority multipliers: P0+any slip → Red, P1+2 slips → Red,
  P2+4 slips → escalate to Red
- Status freshness: status >7 days old → "Latest Status Not Available"

### Dense bullet format (one line per project)

```
• **{Project Name}** ({JIRA-KEY}) - {Priority} - {Assignee} -
  {Test Lead} - CC: {date} ({status}) - CG: {date} ({status}) -
  PG: {date} ({status}) - QI: {%} - Status: {Status} ({Date})
```

### Required sections (only include if items > 0)

1. Executive Summary (2–3 sentences with risk assessment)
2. Project Breakdown (risk distribution table)
3. Section Analysis (Highlights / Lowlights / Visibility Gaps)
4. Systemic Risk Analysis (cross-project patterns)
5. Executive Recommendations (immediate + strategic)
6. Risk Trend Analysis

## Output Conventions for the Consolidated App

- File naming: `TeamExec-{Product}-{Release}-{YYYY-MM-DD}.md`
  (per `documentation-consistency.mdc`)
- Email variant: `-Email.html`, max width 800px, inline CSS, no
  external assets
- All metrics MUST cite their JIRA query (per
  `citation-first-output.mdc`)

## Quality Validation

- [ ] Only sections with items > 0 are included
- [ ] All projects from source data included (count matches header)
- [ ] Each bullet follows the dense format
- [ ] Risk calculations applied systematically (not by gut)
- [ ] Email HTML version is self-contained
