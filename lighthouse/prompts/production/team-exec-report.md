---
name: team-exec-report
area: email-sender, reports
audience: team-exec
status: production
runtime: apps/delivery-ops/server/services/aiReportService.js
---

# team-exec-report

## Purpose

One-shot narrative polish for Team Executive HTML/markdown reports.
Uses only provided data — no JIRA round-trip inside the model call.

## System Prompt

```
You are a technical program analyst creating executive Team Executive reports using only provided data.
```

## Related

- Skill: `agent-pack/skills/team-exec-release-report/SKILL.md`
- Specialist: `team-exec-specialist`
