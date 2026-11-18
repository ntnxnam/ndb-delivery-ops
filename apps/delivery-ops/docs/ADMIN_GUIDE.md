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
| Quality column | `server/config/releaseVersionsColumnsConfig.json` (`columns.quality`) | Description documents 2 rows (Functional/System) × 2 cols (Manual/Automation); TCMS service `server/services/tcmsService.js` (time-filtered metrics via `/api/v1/all_test_cases/aggregate/metrics`, `time_filter=all|four_weeks`, `target={milestone}-qcow2`) |
| RBAC | `server/config/allowedUsers.json` + `server/routes/auth.js::LEGACY_PERMISSION_MAPPING` | Keep client mirror in sync |
| SMTP | `mailrelay.dyn.nutanix.com:25` | No auth; see `server/services/emailService.js` (sacred) |
| `REACT_APP_ENABLE_JIRA_DIGGING` | env (build-time, `client/src/config/featureFlags.js`) | Default `true`. Set `false` to kill-switch Custom JQL Digging drawer + `/api/jira-digging/prepare` UI. See [ChatbotPage — Requirements](./pages/ChatbotPage-requirements.md) (CH-10/CH-11) |
| `REACT_APP_ENABLE_JQL_AUTOCOMPLETE` | env (build-time) | Default `true`. Disables ghost + dropdown autocomplete (local scrub of `jiraFieldsConfig.json` + ScriptRunner templates via `jqlAutocompleteLogic.js`). Flag off → "Autocomplete off" hint |
| Ports | `client/package.json` `PORT`, `server/.env` `PORT` | **Fixed: React `8899`, Express `8001`** — no fallback. Do not use `8888` (removed per `863dac3`). Nginx proxies `8899` |

## RBAC

See `RBAC_GUIDE.md` and `docs/api/` per `api-docs-required.mdc`.

## Feature Flags

| Flag | Default | Effect |
|---|---|---|
| `REACT_APP_ENABLE_JIRA_DIGGING` | `true` | Enables `/chatbot` Custom JQL Digging (Fetch & Index → Ask via `POST /api/jira-digging/prepare` + `POST /api/ai/chat` digging branch `shared.answerDiggingAsk` with beam `muse-spark`). `false` greys out the toggle and blocks fetch with "disabled by feature flag". |
| `REACT_APP_ENABLE_JQL_AUTOCOMPLETE` | `true` | Ghost + dropdown JQL autocomplete. `false` hides it and shows "Autocomplete off — set …=true and rebuild". |
| `REACT_APP_ENABLE_JQL_VALUE_SUGGEST` | `false` | Value suggestions (off by default). |

All flags are **build-time** (`process.env.REACT_APP_*` in `client/src/config/featureFlags.js`); rebuild the client after changing.

## Deployment

- PM2: `pm2 start ecosystem.config.js`
- Nginx: proxy **8899** → delivery-ops; backend **8001** (fixed ports, no fallback — `8888` is stale and must not be reintroduced)

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Missing sidebar tab | Permission not mapped | Sync `LEGACY_PERMISSION_MAPPING` both sides, re-test permissions |
| 401 from JIRA | PAT expired | Rotate `JIRA_PAT`, Bearer header |
| TCMS Quality shows "Not Set" | TCMS timeout / no runs in window | Check TCMS reachability; Last 4 weeks shows Not Set when no runs in window (no fallback to Overall). Time-filtered calls use `/api/v1/all_test_cases/aggregate/metrics` (`time_filter=four_weeks`, `target={milestone}-qcow2`). |
| TCMS Functional/System identical | Clone caveat (pending `test_category` filter) | Expected until TCMS ships filter; see `docs/tcms-rows-followup.md` |

## Appendix

Full env var table in `TECH_DESIGN.md`.
