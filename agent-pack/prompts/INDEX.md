# Prompt registry

| Id | Status | Area | Runtime |
|---|---|---|---|
| `feature-exec-summary` | production | project-status, sos, feature-dashboard | `naiService#EXEC_SUMMARY_SYSTEM_PROMPT` |
| `release-health-briefing` | production | release-brief | `naiService#RELEASE_SUMMARY_SYSTEM_PROMPT` |
| `sos-tier-briefing` | production | sos-summary | `naiService#SOS_TIER_SYSTEM_PROMPT` |
| `sprint-leadership-asks` | production | sprint-performance | `naiService#SPRINT_LEADERSHIP_ASKS_SYSTEM_PROMPT` |
| `team-exec-report` | production | reports / email | `aiReportService` |
| `sos-leader-coaching` | draft | sos-leader | not wired |
| `component-report-narrative` | draft | component-report | not wired |

Chat uses `identity/ops-assistant.md` + tool loop — not a one-shot system
prompt file in this folder.
