---
product: NDB Delivery Ops
lastUpdated: 2026-11-19
coversVersion: "3.0"
env: prod
source: doc-admin-guide @ 2026-11-19
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
| Risk trail | `client/src/utils/riskHistoryDisplay.js` (SoT `RAG_COLORS`) + `server/services/releaseHistoryService.js` (`includeRiskIndicator:true`) | `POST /api/jira/release-items-history` → `checkpointHistory[key].riskIndicator`; out-of-scope: FeatureDashboard/EmailSender (see data-layer dispositions) |
| RBAC | `server/config/allowedUsers.json` + `server/routes/auth.js::LEGACY_PERMISSION_MAPPING` | Keep client mirror in sync |
| SMTP | `mailrelay.dyn.nutanix.com:25` | No auth; see `server/services/emailService.js` (sacred) |
| `jiraFieldsConfig.json` | `server/config` + `client/src/config` | Single SoT for fields+labels JQL taxonomy (fields: 8 cats checkpoint/people/content/links/indicators/classification/relationships/agile; labels: porExclude, lifecycle{deferred,mustfix,wishlist,longTermFunded,extension}, dependency.trainAsk, testType.systemTest) — consumers via `server/utils/jiraFieldsConfig.js` getFieldId/getLabelJql and `client/src/utils/jiraFields` + fieldConfig ensureLoaded() via `GET /api/config/jira-fields` |

## AI / NAI Configuration

All AI surfaces (chat, exec summary, release briefing, bin-packing converter) use the NAI (Nutanix Enterprise AI) gateway. Secrets are never stored in config files.

### Environment variables (canonical `NAI_*`)

Five `NAI_*` variables are canonical. No `AI_*` fallback is read — only `NAI_*` env vars (or `aiConfig.json` defaults for non-secrets) are considered.

| Var | Secret? | Required | Default / fallback | Notes |
|---|---|---|---|---|
| `NAI_API_KEY` | yes | Required for any AI call | *(none)* — must be set in `server/.env` | NuToken from `tokens.corp.nutanix.com`. No fallback file. Server error: `NAI_API_KEY is not set. Retrieve the key from tokens.corp.nutanix.com and set it in server/.env.` |
| `NAI_API_BASE_URL` | no | Yes, if overriding | `aiConfig.json:baseUrl` (`https://tokens.corp.nutanix.com/enterpriseai/gateway/v1`) | Env overrides `aiConfig.json` (no `AI_*` fallback). Server error: `NAI_API_BASE_URL is not set…` |
| `NAI_DEFAULT_MODEL` | no | Yes, if overriding | `aiConfig.json:defaultModel` (`beam-1-501b`) | Also accepts legacy `NAI_MODEL`. Server error: `NAI_DEFAULT_MODEL is not set…` |
| `NAI_MAX_TOKENS` | no | Yes, if overriding | `aiConfig.json:maxTokens` (8192) | Env parsed as int (no `AI_*` fallback). Server error: `NAI_MAX_TOKENS is not set…` |
| `NAI_REQUEST_TIMEOUT` | no | Yes, if overriding | `aiConfig.json:requestTimeoutMs` (120000 ms) | Env parsed as int ms (no `AI_*` fallback). Server error: `NAI_REQUEST_TIMEOUT is not set…` |

Full table + rationale in [AI_API_CONFIGURATION.md](./AI_API_CONFIGURATION.md) and [NAI_API_SETUP.md](./NAI_API_SETUP.md).

### Precedence diagram

```
per-call override (aiConnector options)
        │
        ▼
  NAI_* env var (no AI_* fallback)
        │
        ▼
  aiConfig.json  (server/config/aiConfig.json)
  { baseUrl, defaultModel, maxTokens, requestTimeoutMs }
        │
        ▼
  missing → throw actionable error naming the NAI_* var
```

- **Secrets** (`NAI_API_KEY`): env only — never in `aiConfig.json`.
- **Non-secrets** (`NAI_API_BASE_URL`, `NAI_DEFAULT_MODEL`, `NAI_MAX_TOKENS`, `NAI_REQUEST_TIMEOUT`): `NAI_*` env → `aiConfig.json` → throw `NAI_* is not set` (no `AI_*` fallback).
- Implementation: `shared/src/connectors/aiConnector.ts` and `apps/delivery-ops/server/.env.example`.

### Bin-Packing Converter — server / auth

| Concern | Detail |
|---|---|
| Route | `POST /api/bin-packing/convert` → `apps/delivery-ops/server/routes/binPackingConvert.js` (mounted at `/api/bin-packing` in `server/index.js`) |
| Auth | `apiLimiter` + `validateJiraTokenMiddleware` — same guard as `POST /api/ai/chat` and `/api/jira-digging`. Unauthenticated requests receive 401 before any file processing. |
| Input | Accepts both `multipart/form-data` (primary) and `JSON { filename, contentBase64, mimeType, productId }` (alternate). Max file 10 MB (multipart) / ~13 MB b64 (JSON). |
| Body parser | `bodyParser.json({ limit: '15mb' })` in `server/index.js` — raised from 1 MB to accommodate 10 MB binary (≈13.3 MB b64) via the JSON path. `bodyParser.urlencoded` also `15mb`. |
| Temp files | Per-request `mkdtemp` via `shared/src/services/csvConverterService.ts`; never executes from the upload dir (downloaded files are untrusted — see project `AGENTS.md` environment note). |

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
| `NAI_API_KEY is not set` on AI call | `NAI_API_KEY` missing from `server/.env` | Set `NAI_API_KEY` (NuToken from `tokens.corp.nutanix.com`); see [NAI_API_SETUP.md](./NAI_API_SETUP.md) |
| `NAI_API_BASE_URL is not set` | No `NAI_API_BASE_URL` env and `aiConfig.json` missing/misconfigured | Set `NAI_API_BASE_URL` in env or ensure `server/config/aiConfig.json` has `baseUrl` |
| 401 on `POST /api/bin-packing/convert` | Missing/invalid JIRA Bearer token | Same fix as `POST /api/ai/chat` — supply `Authorization: Bearer <JIRA_PAT>` |
| 413 / 422 on bin-packing upload | File > 10 MB or unsupported type | Reduce file or convert to CSV/XLSX; see [CSV_CONVERTER_GUIDE.md](../product/CSV_CONVERTER_GUIDE.md) |
| TCMS Quality shows "Not Set" | TCMS timeout / no runs in window | Check TCMS reachability; Last 4 weeks shows Not Set when no runs in window (no fallback to Overall). Time-filtered calls use `/api/v1/all_test_cases/aggregate/metrics` (`time_filter=four_weeks`, `target={milestone}-qcow2`). |
| TCMS Functional/System identical | Clone caveat (pending `test_category` filter) | Expected until TCMS ships filter; see `docs/tcms-rows-followup.md` |

## Appendix

Full env var table in `TECH_DESIGN.md`.
