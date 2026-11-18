# JIRA Data Digging — `/api/jira-digging`

Route file: `apps/delivery-ops/server/routes/jiraDigging.js` (Slice 2b — full download + cache + optional enrichment)
Domain service: direct via `shared/src/connectors/jiraConnector.ts` (`searchCount` + `searchAll` + `getIssue({expand:changelog})` + `getComments`)

---

### POST /api/jira-digging/prepare

**Purpose**: Fetch & Index for Custom JQL Digging mode in `/chatbot`. Validates JQL, counts, full paginated `searchAll` (500/page), optional per-ticket `changelog`/`comments` enrichment (concurrency 5), and persists to `shared/.cache/jira-digging/{productId}/{jqlHash}/` (`manifest.json` + `tickets.json.gz`).

**Auth**: Required — JIRA PAT in `Authorization: Bearer <token>` (validated by `validateJiraTokenMiddleware`; PAT is forwarded per-request to `JiraConnector`, never stored).

**Request**
- Method: POST
- Path: `/api/jira-digging/prepare`
- Body (JSON):
  | Field | Type | Required | Description |
  |---|---|---|---|
  | `jql` | string | yes | JQL to execute. Max 4000 chars. |
  | `productId` | string | no | Product namespace for cache key; default `ndb` |
  | `includeHistory` | boolean | no | Enrich each ticket with `changelog` via `getIssue({expand:changelog})`; slower for >500 tickets |
  | `includeComments` | boolean | no | Enrich each ticket with `getComments`; slower for >500 tickets |

**Server flow**
`POST /api/jira-digging/prepare` → validate `jql` → `JiraConnector(env.jiraPat)` → `searchCount(jql)` → cap 10000 → `searchAll(jql, DIGGING_FIELDS:500/page)` → optional `enrichHistoryComments` (concurrency 5) → `writeCache` gzip + manifest → response. Errors via `wrapError`.

**Response shape** (200)
```json
{
  "datasetId": "dig_a1b2c3d4_1718000000000",
  "jql": "project = ERA AND status != Closed",
  "productId": "ndb",
  "ticketCount": 342,
  "sampleKeys": ["ERA-123", "ERA-456"],
  "fetchedAt": "2026-11-12T06:00:00.000Z",
  "fields": "key,summary,issuetype,status,priority,assignee,fixVersions,created,updated,labels,components,resolution",
  "truncated": true,
  "mode": "live-sample"
}
```

**Error responses**
| HTTP | When | Body |
|---|---|---|
| 400 | `jql` missing/empty or >4000 | `{ error: "jql is required" }` |
| 400 | Result > 10000 | `{ error: "Result too large: 12000 > 10000 cap...", total }` |
| 401 | No `Authorization: Bearer` | `{ error: "JIRA PAT required" }` from `validateJiraTokenMiddleware` |
| 403 | Invalid PAT (JIRA 403) | `{ error: "JIRA error message" }` via `wrapError` |
| 500 | JIRA or network failure | `{ error: "JIRA fetch failed", details }` |

**Field set** (`DIGGING_FIELDS`): `key,summary,issuetype,status,priority,assignee,reporter,fixVersions,created,updated,resolution,resolutiondate,duedate,labels,components,parent` + 30 `customfield_*` (checkpoint `11067,35863,35864,13860-13861` etc., people `10860,27764,51460` etc., content `23073,38460` etc.) — scrubbed from `jiraFieldsConfig.json`.

**Caching**: `shared/.cache/jira-digging/{productId}/{jqlHash}/` (`manifest.json` + `tickets.json.gz` gzip) — key is `md5(productId:jql)`. List via `GET /api/jira-digging/datasets?productId=ndb`.

**Client**: `ChatbotPage.js:43` `handleDiggingFetch` → `authenticatedPost('/api/jira-digging/prepare', {jql, includeHistory, includeComments})` → card `Cached dataset · N tickets · history/comments` + `diggingError` on 4xx/5xx.
