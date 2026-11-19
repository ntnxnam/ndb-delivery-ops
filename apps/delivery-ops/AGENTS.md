# Agent primer — apps/delivery-ops

> **This file is a pointer.** The canonical project instructions are the **repo-root** [`AGENTS.md`](../../AGENTS.md) — read that first. This file only adds workspace-specific notes for `apps/delivery-ops`.

## What this workspace is

The web app — React (port 8899) + Express (port 8001) — for portfolio delivery operations. Product-agnostic per **D1**; NDB is one tenant via `teamBoardConfig.json` + `productService`.

- **Frontend**: `client/src/` — React, persona-aware sidebar (D6), embedded chat panel (D7)
- **Backend**: `server/` — Express routes (thin), services, connectors via `@portfolio-delivery-ops/shared`
- **Data**: JIRA Data Center (PAT Bearer per D40), Confluence, GitHub, TCMS, NAI/AI

## Running locally

```bash
./scripts/start.sh          # backend 8001 + frontend 8899
./scripts/stop.sh
./scripts/restart.sh
```

Logs: `/tmp/server.log` (backend), `/tmp/client.log` (frontend). Hot-reload on both.

## Project structure

```
client/src/
  components/         JSX only — no fetch (see minimal-architecture rule)
  hooks/              data fetching + state
  shared/services/    canonical HTTP wrapper (apiService.js)
  services/           domain services (jiraQueryService, taskBreakdownService)
  utils/              pure functions (no React, no axios)
  auth/               authentication (LoginForm, AuthContext, permissions)
  layout/             chrome (Sidebar, Layout)
  release/ feature/   domain pages (ReleaseBrief, FeatureDashboard, …)

server/
  routes/             thin Express handlers, one file per resource
  services/           orchestration (releaseDataService, kpiService, …)
  utils/              single-purpose helpers
  config/             JSON config (jiraFieldsConfig, teamBoardConfig, allowedUsers)
  middleware/         auth, timeout, security
```

## Permissions model

- Users in `server/config/allowedUsers.json` — mapped via `LEGACY_PERMISSION_MAPPING` in `server/routes/auth.js` + `client/src/auth/constants/permissions.js` (must agree).
- Sidebar items gated on permission; use "Test Connection & Refresh Permissions" after backend auth changes.

## Need the bigger picture?

- `../../AGENTS.md` — workspace table (lighthouse/loom/shared), 5 connectors, AI layer, phase plan
- `../../ARCHITECTURE.md` / `../../docs/technical/ARCHITECTURE.md` — 5-layer model
- `../../DECISIONS.md` — D1…D46, including D44 tenancy (lighthouse/loom/shared)
- `../../docs/guides/DEVELOPER_GUIDE.md` — setup, conventions, ports

## Gotchas

- Ports are fixed: React `8899`, Express `8001` — no fallback, no auto-detect.
- Sprint field is `customfield_10360` (not the default). See `server/config/teamBoardConfig.json` + `productService`.
