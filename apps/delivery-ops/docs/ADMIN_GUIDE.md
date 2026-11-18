---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
coversVersion: "2.11"
env: prod
source: doc-admin-guide @ 2026-05-19
---

# Admin Guide

> For architects / admins. Maintained by `doc-specialist` via `doc-admin-guide`.

## Prerequisites

- Node 20+, PM2, Nginx
- JIRA PAT (Bearer per D40) — `JIRA_PAT` env

## Installation

```bash
./scripts/start.sh   # backend 8001, frontend 8899
./scripts/stop.sh
```

## Configuration

| Setting | File | Notes |
|---|---|---|
| `JIRA_PAT` | env | Bearer only, no Basic |
| Team boards | `server/config/teamBoardConfig.json` | customfield_10360 for sprints |
| RBAC | `server/config/allowedUsers.json` + `server/routes/auth.js::LEGACY_PERMISSION_MAPPING` | Keep client mirror in sync |
| SMTP | `mailrelay.dyn.nutanix.com:25` | No auth; see `server/services/emailService.js` (sacred) |

## RBAC

See `RBAC_GUIDE.md` and `docs/api/` per `api-docs-required.mdc`.

## Deployment

- PM2: `pm2 start ecosystem.config.js`
- Nginx: proxy 8899 → delivery-ops

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Missing sidebar tab | Permission not mapped | Sync `LEGACY_PERMISSION_MAPPING` both sides, re-test permissions |
| 401 from JIRA | PAT expired | Rotate `JIRA_PAT`, Bearer header |

## Appendix

Full env var table in `TECH_DESIGN.md`.
