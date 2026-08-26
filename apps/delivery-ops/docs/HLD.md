---
report_type: HLD
product: multi-product
version: "2.0"
generated: 2026-08-04
status: current
audience: tpm, director
---

# High-Level Design
## Portfolio Delivery Ops — `delivery-ops`

**Version:** 2.0
**Date:** 2026-08-04

---

## 1. System Overview

```
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 5: UI & AI Surfaces                                            │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐    │
│  │ delivery-ops React app   │    │ Cursor agents & workflows    │    │
│  │ :8899 (Nginx → PM2)      │    │ (ops-assistant orchestrator) │    │
│  └──────────────────────────┘    └──────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
                       ▲ HTTP                        ▲ MCP/stdio
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 4: API + MCP                                                   │
│  ┌──────────────────────────┐    ┌──────────────────────────────┐    │
│  │ Express (server/routes/) │    │ mcp-server/src/tools/        │    │
│  │ thin handlers ≤150 lines │    │ one tool per feature          │    │
│  └──────────────────────────┘    └──────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┘
                               ▲
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 3: Services (business logic; shared across surfaces)           │
│  releaseDatasetService  releaseDataService  releaseItemsDataService  │
│  naiService  kpiService  execSummaryService  sprintService           │
│  ganttService  chatService  aiReportService  emailService            │
│  releaseAiSummaryService  fieldHistoryUtils  execSummarySignals      │
└──────────────────────────────────────────────────────────────────────┘
                               ▲
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 2: Domain Models + Shared Types (TypeScript)                   │
│  Release, Ticket, Sprint, Team, RAG, IssueGroup, WorkType,           │
│  ResolutionCategory, ReleaseType, Persona/Audience                   │
└──────────────────────────────────────────────────────────────────────┘
                               ▲
┌──────────────────────────────────────────────────────────────────────┐
│ Layer 1: Connectors (one per external system)                        │
│  jiraConnector.ts    confluenceConnector.ts    aiConnector (NAI)     │
│  (githubConnector, slackConnector, emailConnector — planned D3)      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Component Architecture

### 2.1 Frontend

```
client/src/
├── App.js                       Router + context providers
├── layout/
│   ├── components/Header.js     Top bar (auth status, team picker)
│   ├── components/Sidebar.js    Nav links; permission-gated visibility
│   └── utils/routeConfig.js     Route → component → permission mapping
├── auth/                        AuthContext, LoginForm, ProtectedRoute, permissions
├── contexts/
│   ├── AuthContext.js            Auth state; permissions array
│   ├── TeamContext.js            Selected team; team list
│   ├── SelectedReleaseContext.js Selected release; gate timeline; 10-min TTL
│   └── ReleaseDataContext.js     Full ticket payload; 5-min TTL
├── hooks/
│   ├── useReleaseVersions.js     Fetch available versions
│   ├── useReleaseItems.js        Fetch release payload
│   └── useChat.js                Chat panel state
├── components/                   Presentation components (no axios)
│   ├── ReleaseVersionTab.js
│   ├── ReleaseVersionTableRow.js
│   ├── ExecSummaryCell.js
│   ├── TaskBreakdownCell.js
│   ├── ReleaseGantt.js
│   ├── ReleaseSummaryPanel.js
│   └── ReleaseVersionSelector.js
├── release/
│   ├── ChatbotPage.js            /chatbot route
│   ├── RetrospectivePage.js      /release/retrospective
│   └── SyncHubPage.js            /sync-hub
├── feature/
│   └── FeatureDashboardPage.js   /feature-dashboard
└── services/
    └── taskBreakdownService.js   Client-side data shaping
```

### 2.2 Backend

```
server/
├── index.js                     Express bootstrap; middleware; mount routes
├── routes/
│   ├── auth.js                  /api/auth/*
│   ├── config.js                /api/config/*
│   ├── feature.js               /api/feature/*
│   ├── releaseDataset.js        /api/release-dataset/*
│   ├── ai.js                    /api/ai/*
│   └── jira/
│       ├── index.js             Route mounting
│       ├── admin.js             User/team management
│       ├── component-report.js
│       ├── exec-summary.js
│       ├── feature-dashboard.js
│       ├── gantt.js
│       ├── kpi.js
│       ├── misc.js
│       ├── project-status.js
│       ├── release-setup.js
│       ├── retrospective.js
│       ├── shared.js            /fetch, /search-by-jql, /proxy
│       ├── sprint-report.js
│       └── versions.js
├── services/
│   ├── naiService.js            NAI LLM calls (exec summary, release briefing, chat)
│   ├── releaseDataService.js    Release items (JIRA) → processed payload
│   ├── releaseDatasetService.js Bundle cache read/write
│   ├── releaseItemsDataService.js 6-bucket JIRA fetch
│   ├── kpiService.js
│   ├── execSummaryService.js
│   ├── ganttService.js
│   ├── sprintService.js
│   ├── chatService.js
│   └── aiReportService.js
└── utils/
    ├── jiraQueryUtils.js        JQL builders (all JQL lives here)
    ├── jiraRouteHelpers.js      Shared route helpers
    ├── execSummarySignals.js    shim → shared/src/domain/execSummarySignals.cjs (D41)
    ├── fieldHistoryUtils.js     Changelog parsing
    ├── chatIntentRouter.js      Chat → tool routing
    └── chatSnapshotBuilder.js   Dataset → chat context
```

### 2.3 Shared (TypeScript)

```
shared/
├── src/
│   ├── connectors/
│   │   ├── jiraConnector.ts
│   │   └── confluenceConnector.ts
│   ├── services/
│   │   └── releaseDatasetService.ts   (main sync pipeline)
│   └── types/
│       ├── Release.ts
│       ├── Ticket.ts
│       ├── Sprint.ts
│       └── ...
└── .cache/
    └── release-dataset/
        └── {productId}/
            ├── bundle.json
            ├── bundle.meta.json
            └── per_release/
                ├── {release}.json
                └── {release}.meta.json
```

---

## 3. Page Inventory

| Route | Component | Permission Required |
|---|---|---|
| `/login` | `LoginPage` | none |
| `/` | `EmailSender` | authenticated |
| `/project-status` | `ReleaseVersionTab` | `release_versions_view` |
| `/feature-dashboard` | `FeatureDashboardPage` | `release_versions_view` |
| `/release/brief` | `ReleaseBriefPage` | `release_versions_view` |
| `/release/retrospective` | `RetrospectivePage` | `release_versions_view` |
| `/release-setup` | `ReleaseSetup` | `release_setup_manage` |
| `/release-config` | `ReleaseConfigPage` | `release_config_manage` |
| `/generic-emailer` | `GenericEmailer` | `email_send_generic` |
| `/email-history` | `EmailHistoryTab` | `email_history_view` |
| `/sprint-report` | `SprintReportPage` | `sprint_reports_view` |
| `/component-report` | `ComponentReport` | `release_versions_view` |
| `/chatbot` | `ChatbotPage` | `ai_insights_view` |
| `/sync-hub` | `SyncHubPage` | `release_versions_view` |
| `/kpis` | `KPIPage` | `kpi_view` |
| `/admin` | `AdminPanel` | `admin_panel_access` |
| `/bin-packing` | static HTML | none (static mount per D37) |

---

## 4. Data Flow

### 4.1 Authentication

```
Browser → POST /api/auth/login {email, token}
  → Server validates via JIRA GET /rest/api/2/myself
  → Maps user to RBAC tier via allowedUsers.json
  → Returns permissions[] array
  → Client stores token + permissions in localStorage
  → ProtectedRoute reads permissions on each render
```

### 4.2 Release Status Page (Project Status)

```
Page mount
  → SelectedReleaseContext: GET /api/jira/release-versions (versions list)
  → SelectedReleaseContext: GET /api/config/release-versions (gate dates)
  → ReleaseDataContext: GET /api/release-dataset/per-release/{release} (bundle from disk)

User selects different release
  → ReleaseDataContext: fetch bundle for new release (cache hit if within 5 min)
  → ReleaseVersionTab renders: table rows + Gantt from bundle data
```

### 4.3 Release Dataset Sync

```
User clicks "Sync" in SyncHub
  → POST /api/release-dataset/sync {productId}
  → Server: releaseDatasetService.syncBundle()
    → For each release × 6 buckets:
      → jiraConnector.runJQL(bucket JQL)
      → Paginate until all results fetched
      → Write per_release/{release}.json
    → Write bundle.json (union of all releases)
    → Write bundle.meta.json
  → SSE stream: progress events back to client
  → Sync Hub table re-fetches GET /api/release-dataset/sync-status
```

### 4.4 AI Chat

```
User sends message in ChatbotPage
  → POST /api/ai/chat {message, history, release, productId}
  → Server: chatService.processMessage()
    → chatIntentRouter classifies intent
    → chatSnapshotBuilder builds context from bundle.json
    → naiService.chatCompletion(systemPrompt, context, history, message)
    → NAI API returns completion
  → Response streamed back to ChatbotPage
```

### 4.5 AI Release Briefing

```
User clicks "Generate Briefing" on ReleaseSummaryPanel
  → POST /api/ai/release-summary {release, productId}
  → Server: naiService.generateReleaseSummary()
    → Fetch: P0 blockers, must-fix tickets, gate signals, committed features
    → Compute deterministic RAG verdict (execSummarySignals.js)
    → Build intelligence package (VALID TICKET KEYS list)
    → LLM call with RELEASE_SUMMARY_SYSTEM_PROMPT
    → Return {verdict, summary, blockers, actionList}
  → Client renders in ReleaseSummaryPanel (neutral border, one RAG badge)
```

---

## 5. Deployment Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                Rocky Linux 9 Production Server              │
│                                                             │
│  ┌────────────────┐     ┌───────────────────────────────┐   │
│  │   Nginx :8899  │────▶│    PM2 → Node.js :8001       │   │
│  │  static build  │     │    apps/delivery-ops/server   │   │
│  │  + reverse     │     │                               │   │
│  │    proxy /api  │     │  shared/.cache/ (disk bundles)│   │
│  └────────────────┘     └───────────────────────────────┘   │
│                                      │                      │
│                          ┌───────────┼──────────┐           │
│                          ▼           ▼          ▼           │
│                     JIRA API   Confluence   NAI API         │
│                     (HTTPS)    (port 8443)  (internal)      │
└─────────────────────────────────────────────────────────────┘

Developer deploy:
  ./apps/delivery-ops/scripts/deploy-to-production.sh
  (Mac → SCP → server-side idempotent restart script)
```

**Dev environment:**
- Frontend: `:8899` (CRA dev server; proxies `/api` to `:8001`)
- Backend: `:8001`
- Hot-reload: both frontend and backend

---

## 6. External Integrations

| System | Protocol | Auth | Rate Limit Strategy |
|---|---|---|---|
| JIRA REST API v2 | HTTPS | Bearer PAT | Exponential backoff (3 retries); 500ms delay on pagination |
| Confluence REST API (port 8443) | HTTPS | Basic (email + Confluence token) | Per-request |
| NAI (LLM) | HTTPS | `AI_API_KEY` env var | Per request; timeout 30s |
| SMTP (`mailrelay.dyn.nutanix.com:25`) | SMTP/plaintext | None (internal relay) | One send per user action |
| TCMS | HTTPS | Internal token | Parallel batch |

---

## 7. State Management (Frontend)

| Store | Scope | TTL | Invalidation |
|---|---|---|---|
| `AuthContext` | App-wide | Session (localStorage) | Logout; token refresh |
| `TeamContext` | App-wide | Session | Team picker change |
| `SelectedReleaseContext` | App-wide | 10 minutes | Release picker change; manual refresh |
| `ReleaseDataContext` | App-wide | 5 minutes | Release change; sync completion |
| Component `useState` | Per-component | Component lifetime | Unmount |

---

## 8. Security Architecture

```
Request lifecycle:
  1. Browser sends Bearer token in Authorization header
  2. Express auth middleware validates token → JIRA /myself
  3. LEGACY_PERMISSION_MAPPING maps username → permissions[]
  4. Route handler checks required permission
  5. If unauthorized: 403 JSON response
  6. Helmet.js adds security headers on all responses
  7. CORS enforced from ALLOWED_ORIGINS env var
  8. Rate limiter (express-rate-limit) applied per route class
```

**Rate limit tiers:**

| Class | Window | Max requests |
|---|---|---|
| Auth endpoints | 15 min | 5 |
| Email send | 15 min | 20 |
| Release dataset sync | 15 min | 10 |
| Checkpoint history | 15 min | 30 |
| General API | 15 min | 200 |

---

## 9. Error Handling

| Layer | Strategy |
|---|---|
| JIRA connector | Exponential backoff on 429/5xx; structured error response `{success: false, error, message}` |
| Services | Try/catch; propagate structured error to route |
| Route handlers | Catch all; `res.status(500).json({success: false, error})` |
| Frontend hooks | `loading` / `error` state pair; error displayed via toast/inline message |
| AI calls | LLM error surfaced in UI; no silent failure |
| Email send | SMTP error returned; form remains populated for retry |

---

## 10. Key Architectural Decisions

| Decision ID | Statement | Impact |
|---|---|---|
| D1 | Platform is product-agnostic | No NDB strings in code; all via `productService` config |
| D3 | 5 connectors are first-class | One JIRA module; one Confluence module; no ad-hoc axios in routes |
| D6 | Role lens ≠ data filter | All tabs visible; only admin tab requires permission |
| D7 | Chat panel in web app | AI surface is embedded, not a separate product |
| D10 | Citation-first output | Every AI claim cites a JIRA key or query |
| D11 | Cache-first data serving | Pages load from disk; user explicitly refreshes for live data |
| D30 | Gate date audit trail | Confluence audit required before any JIRA mutation |
| D36 | Two payload concepts | Engineering Payload (`project=ERA`) vs Release Payload (all projects) |
| D37 | Bin-packing static mount | `/bin-packing/*` served as static HTML; not ported to React yet |
