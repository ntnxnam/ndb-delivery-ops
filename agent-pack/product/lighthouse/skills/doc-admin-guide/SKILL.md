---
name: doc-admin-guide
description: Maintain the administrator guide — install, config, RBAC, env, deploy, troubleshooting. Use when config/deploy/RBAC changes or user asks "update admin guide".
audience: architect, team_mgr, portfolio_mgr
---

## When to Use This Skill

- RBAC / permissions change (`allowedUsers.json`, `permissions.js`, `auth.js`)
- Config / env / deploy change (`teamBoardConfig.json`, `releaseConfig`, SMTP, ports, scripts/start.sh)
- New route, connector, or MCP tool added
- User asks "admin guide for deploy" / "how to configure X?" / "update admin guide"
- Pipeline stage 8.5 when diff touches `server/config/`, `server/routes/`, `mcp-server/`, `shared/connectors/`

## Quick Start

```
Input: { infraArea, releaseName }
Output: Documentation/guides/ADMIN_GUIDE.md
```

Procedure:
1. Inventory infra delta from diff (config keys, routes, connectors, env vars, scripts)
2. For each: purpose, required values, where to set, validation, rollback, security note
3. Sections per `documentation-consistency.mdc`:
   - Frontmatter: `product`, `lastUpdated`, `coversVersion`, `env: prod|dev`
   - Prerequisites → Installation → Configuration (per-connector: JIRA PAT Bearer, Confluence, GitHub, Slack, Email) → RBAC → Deployment (PM2/Nginx) → Troubleshooting → Appendix (env var table)
4. Flag secrets handling (PAT Bearer only per D40, no hardcoded localhost)
5. Cite config file + line for every setting

## Output Template

```markdown
---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
coversVersion: "2.11"
env: prod
---

# Admin Guide

## Prerequisites
...

## Configuration
### JIRA Connector
- `JIRA_PAT` — Bearer PAT, set in `server/config/...` — [config/teamBoardConfig.json:12]

## RBAC
...

## Deployment
...

## Troubleshooting
| Symptom | Cause | Fix |
|---|---|---|
| ... | ... | ... |
```

## KPI contract

- `KPI: every config/connector change in diff documented` — MISS if missing
- `KPI: secrets guidance present, no localhost hardcode` — MISS if violated
- `KPI: rollback / troubleshooting present for deploy changes` — MISS if absent

## Delegation

Owner: `doc-specialist`. Triggered by `ops-assistant` or pipeline stage 8.5.
