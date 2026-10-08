---
name: app-surface-map
area: platform
---

# App surface map

Delivery-ops React routes → job → AI prompts / skills. Product-agnostic; NDB
is the primary live tenant today.

| Route | Page | Job | Prompt(s) | Skill / specialist |
|---|---|---|---|---|
| `/` | Email Sender | Compose release status email + AI draft | `feature-exec-summary` (cells), chart narrative | tpm / team-exec |
| `/project-status` | Project Status | FEAT table, Gantt, exec summary cells | `feature-exec-summary` | tpm-specialist |
| `/feature-dashboard` | Feature Dashboard | Payload gates + reconciliation | `feature-exec-summary` | tpm-specialist |
| `/release/retrospective` | Retrospective | Gate compliance / naughty ranking | (derive in shared; generative polish TBD) | `release-retrospective` |
| `/release-setup` | Release Setup | Create / rename / cleanup | none (deterministic) | `release-cascade-rename`, rm |
| `/generic-emailer` | JIRA Emailer | Ad-hoc JQL → email | none | tpm |
| `/email-history` | Email History | Sent audit | none | — |
| `/sprint-report` | Sprint Report | Sprint metrics | none (HTML/report) | sprint skills |
| `/sprint-performance` | Sprint Performance | Say/do by team/leader/manager | `sprint-leadership-asks` | tpm-specialist |
| `/component-report` | Component Report | Component health + deferrals | (context-driven; no dedicated NAI prompt yet) | tpm |
| `/chatbot` | AI Chatbot | Conversational Q&A | orchestrator pack + tools | ops-assistant |
| `/kpis` | KPIs | Configured KPI chips | none | — |
| `/system-test-scale` | System-Test Scale | System-test bug scale / trends | none (charts) | — |
| `/sos-summary` | SoS Summary | Cross-release FEAT SoS + tier AI | `feature-exec-summary`, `sos-tier-briefing` | tpm |
| `/sos-leader-summary` | SoS by Leader | Same SoS regrouped by eng leader | **draft** `sos-leader-coaching` | tpm |
| `/release/brief` | Release Brief | Release RAG + blockers + 7-day asks | `release-health-briefing` | `release-ai-briefing` |
| `/release-config` | Release Config | Gate date config | none | rm |
| `/team-management` | Admin | Teams / RBAC | none | admin |

## Non-UI surfaces

| Surface | Prompt / skill |
|---|---|
| MCP tools | same Layer-3 services; no parallel prompts |
| Friday leader email (planned) | `sos-leader-coaching` + SoS HTML snapshot |
| Monday weekly status | skill `weekly-status-email` |
| Agent runtime chat | `identity/ops-assistant.md` + tools |
