# 03 — Operations Guide: Run, Env, Data Flow

> Ports, env, and flows as of 2026-11-11. See `apps/delivery-ops/server/index.js:269-291` and `README.md` for canonical start commands.

---

## 1. How to Run Locally

### Single-command start

```bash
./start.sh          # starts delivery-ops (client + server) + mcp-server
./stop.sh           # stops all
./restart.sh        # stop + start (also used inside apps/delivery-ops/)
```

### Manual (per workspace)

| Workspace | Command | Port | Notes |
|-----------|---------|------|-------|
| **delivery-ops client** | `npm --workspace apps/delivery-ops/client start` | `8899` (CRA) | `proxy: http://localhost:8001` in `client/package.json:30` |
| **delivery-ops server** | `npm --workspace apps/delivery-ops/server run dev` | `8001` (via `PORT` env in `scripts/start.sh`; default 7001 in `server/index.js:10`) | `node --watch index.js` |
| **mcp-server** | `npm --workspace mcp-server run build && npm --workspace mcp-server run start` | stdio | `mcp:build` / `mcp:start` at repo root `package.json:13-14` |
| **tpm-confluence-tools** | `streamlit run app.py` in `apps/tpm-confluence-tools/` (own venv) | `8501` | Phase F: will be retired to React |
| **bin-packing** | `npx serve . -l 3847` in `apps/bin-packing/` | `3847` standalone; `/bin-packing/*` when mounted via Express | Mounted at `server/index.js:bin-packing static` |

Single user runtime in prod: **one React app on `:8888`** per `ARCHITECTURE.md:171-174` (dev uses `:8899` → `:8001` proxy).

### MCP registration

- Cursor: `.cursor/mcp.json` auto-registers `node mcp-server/dist/index.js` with env `JIRA_BASE_URL`, `JIRA_PAT`, etc. (`mcp-server/src/config/env.ts:24`).
- Claude Desktop: same `node dist/index.js` via `claude_desktop_config.json`.

---

## 2. Environment Variables

Canonical reference: `apps/delivery-ops/server/.env.example` + `shared/src/connectors/env.ts:88`.

| Var | Required | Default | Purpose |
|-----|----------|---------|---------|
| `JIRA_BASE_URL` | yes (prod) | `https://jira.nutanix.com` | Data Center host (`server/config/jiraConfig.json:1`) |
| `JIRA_PAT` / `JIRA_TOKEN` | yes | — | Data Center PAT — `Authorization: Bearer` only (D40) |
| `CONFLUENCE_BASE_URL` | if date-mover | `https://confluence.nutanix.com` | Confluence host |
| `CONFLUENCE_PAT` | if date-mover | falls back to `JIRA_PAT` | Confluence PAT |
| `GITHUB_TOKEN` | if commit report | — | GitHub PAT for `leadership_commit_report` |
| `AI_API_BASE_URL` | if AI | `tokens.corp.nutanix.com/enterpriseai` | NAI gateway (`server/config/aiConfig.json:1`) |
| `AI_API_KEY` | if AI | — | NuToken |
| `AI_DEFAULT_MODEL` | — | `ntnx-beam` | LLM model |
| `AI_MAX_TOKENS` | — | `8192` | Max tokens |
| `AI_REQUEST_TIMEOUT` | — | `120000` ms | NAI timeout |
| `PORT` | — | `7001` (code) / `8001` (scripts) | Express port |
| `REACT_APP_API_URL` | dev | `""` (proxy) | Client API base (`client/src/utils/api.js:201`) |
| `REACT_APP_BACKEND_PORT` | dev | `6001`/`8001` | Bin-packing URL helper (`layout/utils/sidebarNavConfig.js:239`) |
| `SMTP_HOST` / `PORT` / `USER` / `PASS` | if email | `mailrelay.dyn.nutanix.com:25` | SMTP relay (`server/config/emailConfig.json:1`) |
| `ALLOWED_ORIGINS` | prod | — | CORS allowlist |
| `AGENT_RUNTIME_DIR` | — | `.cache/agent-runtime` or `~/.portfolio-delivery-ops/runtime` | Agent memory/provenance/HITL (`shared/src/agentRuntime/stores.ts:1`) |
| `RELEASE_DATASET_SCHEDULER_ENABLED` | — | `true` in prod, `false` else | Sync scheduler toggle |
| `RELEASE_DATASET_SCHEDULER_INTERVAL_MS` | — | `15m` (min 60s) | Sync interval (`server/jobs/syncScheduler.js:246`) |
| `RELEASE_DATASET_SCHEDULER_PRODUCTS` | — | `ndb` | Products to sync |
| `RELEASE_DATASET_SYNC_PAT` | if scheduler | falls back to `JIRA_PAT` | Scheduler JIRA PAT |
| `JIRA_SCHEDULED_EMAIL_TOKEN` | if email scheduler | — | Generic Emailer cron token |
| `HTTPS_PROXY` | if behind proxy | — | Via `HttpsProxyAgent` in `jiraConnector.ts:473` |

**Rule:** No hardcoded `localhost` in production code (`agent-pack/rules/no-localhost.mdc:1`).

---

## 3. Auth & Permissions

- **Login:** `POST /api/auth/login` with `jiraToken` → `GET /rest/api/2/myself` validation (`server/routes/auth.js:398`, `server/middleware/auth/jira.js:281`). Caches via `utils/tokenCache.js:163` (TTL) and `simpleCache.jiraCache`.
- **Client:** Stores `username`, `userEmail`, `jiraToken`, `userPermissions`, `userRoles`, `permissionsCacheTime` in localStorage (24h TTL, `auth/services/authService.js:348`).
- **Permission mapping:** `allowedUsers.json` (legacy 9 lists) → `PERMISSIONS` (16) + `TAB_PERMISSIONS` (18 routes) + `ROLES` (8) via `LEGACY_PERMISSION_MAPPING` (`auth/constants/permissions.js:74`, must stay in sync with `server/routes/auth.js`).
- **Sidebar gating:** `layout/components/Sidebar.js:937` — `TAB_PERMISSIONS[path]` → `canAccessTab()`; admin tabs gated, others visible to all (D6). `ProtectedRoute` enforces at route level.
- **Action auth (D26):** Gate-date move = RM/Portfolio Manager; bulk triage/chase = TPM/Portfolio Manager; admin config = Admin/Portfolio Manager; Team Executive+Director = read+draft only. Until D26 gate is coded, `mutate` tools enqueue to HITL and return `blocked_d26`.

---

## 4. Data Flow — Request Path

```
Browser (React :8899 → proxy :8001)
  │  Authorization: Bearer <PAT> + X-Username
  ▼
Express :8001  securityHeaders → compression → cors → bodyParser(sanitize) → generalLimiter
  ├─ GET /api/health (no auth)
  ├─ /api/config/* (mostly public) → reads/writes 18 JSON configs on disk
  ├─ POST /api/auth/login → JIRA /myself → legacy permission map
  ├─ /api/jira/* (validateJiraTokenMiddleware) → jiraClient + jiraSearchByJql → JIRA REST/Agile
  ├─ /api/email/* (validateJiraTokenMiddleware + emailLimiter) → emailService → nodemailer → SMTP
  ├─ /api/ai/* (validateJiraTokenMiddleware) → naiService → NAI (ntnx-beam)
  │    └─ POST /chat → chatService.answerChat → shared/agentRuntime (perceive→tool loop→provenance, HITL)
  ├─ /api/release-dataset/* (validateJiraTokenMiddleware) → live JIRA counts OR ReleaseDatasetCache (shared/.cache)
  │    └─ POST /sync (SSE) → shared.syncReleaseDataset → ReleaseDatasetCache
  └─ /bin-packing (express.static, no auth)
Background:
  ├─ syncScheduler (setInterval 15m, prod) → syncReleaseDataset → ReleaseDatasetCache
  └─ emailScheduler (node-cron * * * * *) → runSearchByJql → sendGenericReminderEmail
```
`server/index.js:105-149` mount table; `server/jobs/syncScheduler.js:246`, `server/services/emailScheduler.js:139`.

---

## 5. Config Files (Server)

`apps/delivery-ops/server/config/` — 18 JSONs, read/written on disk (no DB).

| File | Purpose |
|------|---------|
| `jiraConfig.json` | JIRA baseUrl |
| `jiraFieldsConfig.json` | customfield ID map (sprint `10360`, exec summary `38460`, risk `23560`, gate dates `11067/35863/35864`) |
| `confluenceConfig.json` | Confluence baseUrl |
| `allowedUsers.json` | Legacy allowlists → permissions |
| `teamBoardConfig.json` | **ProductService source** — per-team `projectKey`, `baseFilter`, `productPrefix`, `labelPrefix`, `sprintCalendar`, `boardId` (D43 multi-team registry) |
| `kpiConfig.json` | Per-team KPI defs |
| `releaseVersionsEmailConfig.json` | Release gate dates `releaseGateDates:{[version]:{ecDate,gaDate,…}}` |
| `aiConfig.json` | `AI_API_BASE_URL`, `AI_DEFAULT_MODEL=ntnx-beam` |
| `oncallConfig.json`, `cfdcfiConfig.json`, `systemTestScaleConfig.json`, `sprintPerformanceConfig.json`, `dependencyViewConfig.json` | Feature-specific configs |
| `emailConfig.json`, `sosEmailConfig.json`, `releaseVersionsCCConfig.json` | Email configs |
| `ndbLeaderOrgConfig.json` | Leader org for SoS coaching |

**Team onboarding (D43):** Admin `POST /api/config/teams` → `teamAdminService` writes `teamBoardConfig.json`; `ProductService` reloads on mtime change. Do NOT revert to NDB-only template.

---

## 6. Release Dataset Cache

`shared/src/services/releaseDatasetCache.ts:668`, `shared/src/services/releaseDatasetSync.ts:928`:

- **Location:** `shared/.cache/release-dataset/<productId>/` — `bundle.json` + `bundle.meta.json` + `per-release/<release>.json` + `.sync-lock`
- **Schema:** `CACHE_SCHEMA='v2-node-2026-06'`; mismatch → 404 so client falls back to live JIRA.
- **Fetch:** 6-bucket JQL union (Group 1) + `moved_out` (Group 2) + long-term funded (Group 3, 3 buckets) — `payloadJqlService.ts:578` — dedup within release (`fetchReleaseData`, 56 columns in `ProcessedTicket`).
- **Sync:** On-demand `POST /api/release-dataset/sync?productId=&forceReleases=&skipChangelog=` (SSE, lock TTL 10m via `utils/syncLocking.js`) + scheduler every 15m. Changelog enrichment for Closed Date + gate history (`DEFAULT_CHANGELOG_CONCURRENCY=1`).
- **Endpoints:** `GET /sync-status`, `POST /sync` (SSE), `GET /bundle`, `DELETE /cache?mode=bundle|full`, `GET /per-release/:release`, `GET /velocity`, `GET /forecast`, `GET /gates`, `GET /burndown`, `GET /retrospective/*` (`server/routes/releaseDataset.js:2498`, `server/routes/releaseSync.js:450`).

---

## 7. Key Invariants for Maintainers

- **Product-agnostic (D1/D34):** Never hardcode `projectKey`/`labelPrefix`/`releasePrefix`/`sprintCalendar` in routes/services — resolve via `getProductService().getXxx(productId)`.
- **JIRA auth (D40):** Always `Authorization: Bearer <PAT>` (Data Center). No Basic/OAuth/`cloudId`.
- **Thin routes, fat services:** Routes validate + call service + return JSON (max 150 lines per `minimal-architecture.mdc`). Heavy lifting in `shared/services/` or `server/services/`.
- **No parallel connectors:** One `jiraConnector` in `shared/connectors/`; MCP and Express both use it.
- **Citation-first (D10):** Every numerical/status claim needs a JIRA key/query/source link.
- **Persona-aware (D6):** Declare audience, use presenter; lens re-renders same data, never hides it.
- **Release Payload is default** (D36) — `fetchReleaseData` has no project filter; pass `projectKey` to `fetchBucket` for Engineering Payload.
- **Date mover (D30):** Mandatory reason, Confluence audit row, JIRA rollback on audit failure.

---

*For what the app does, see `01-Platform-Overview.md`. For the full feature table, see `02-Capability-Map.md`.*
