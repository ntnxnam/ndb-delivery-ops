---
report_type: Test Plan
scope: Unit & Integration Tests
version: "2.0"
generated: 2026-08-04
status: current
---

# Testing Plan: Unit & Integration Tests

See `TEST_STRATEGY.md` for overall philosophy, coverage targets, tooling setup, and quality gates.

---

## 1. Scope

This plan covers:
- All utility functions (`server/utils/`, `client/src/utils/`)
- All server-side services (`server/services/`)
- All Express API routes (`server/routes/`)
- All React hooks (`client/src/hooks/`)
- AI prompt assembly logic (`server/services/naiService.js`)

---

## 2. Unit Test Cases

### 2.1 Date & History Formatting

| ID | Function | Input | Expected Output |
|---|---|---|---|
| UT-DATE-001 | `formatDate` | `'2026-01-30'` | `"30/Jan/2026"` |
| UT-DATE-002 | `formatDate` | `'2026-01-05'` | `"05/Jan/2026"` (zero-padded day) |
| UT-DATE-003 | `formatDate` | `null` | `"N/A"` |
| UT-DATE-004 | `formatDate` | `undefined` | `"N/A"` |
| UT-DATE-005 | `formatDateWithHistory` | dates=`['2026-01-15','2026-01-20','2026-01-30']`, current=`'2026-01-30'` | `"30/Jan/2026→20/Jan/2026→15/Jan/2026"` — current not struck, historical struck |
| UT-DATE-006 | Delay calc | 2 days late | `"2 days late"` |
| UT-DATE-007 | Delay calc | 7 days late | `"2.5 weeks late"` |
| UT-DATE-008 | Delay calc | 3 days late | `"3 days late"` (boundary: ≤3 uses days) |
| UT-DATE-009 | Delay calc | 0 days | `""` (on time; no label) |
| UT-DATE-010 | Extension label detection | label=`"NDB-2.12-10082026-code-complete-extention-recieved"` | Returns `true`; cell styled with colored background |
| UT-DATE-011 | Extension label detection | label=`"NDB-2.12-mustfix"` (non-extension) | Returns `false` |

### 2.2 User Field Extraction

| ID | Input | Expected |
|---|---|---|
| UT-USER-001 | String `"user.name"` | `"user.name"` |
| UT-USER-002 | Object `{ displayName: "User Name", emailAddress: "u@n.com" }` | `"User Name"` |
| UT-USER-003 | Object `{ name: "user.name" }` (no displayName) | `"user.name"` |
| UT-USER-004 | Object `{ emailAddress: "user@nutanix.com" }` (no displayName/name) | `"user@nutanix.com"` |
| UT-USER-005 | `null` | `"N/A"` |
| UT-USER-006 | `undefined` | `"N/A"` |
| UT-USER-007 | Empty object `{}` | `"N/A"` |

### 2.3 JQL Builder Functions

> Note: Any proposed change to these test expectations constitutes a JQL modification and requires prior approval per the `jql-edit-approval` rule.

| ID | Function | Input | Must contain in output |
|---|---|---|---|
| UT-JQL-001 | `buildCommitItemsJQL` | `"NDB-2.12"` | `fixVersion=NDB-2.12`; `issueType in (Feature, Initiative` |
| UT-JQL-002 | `buildLongTermItemsJQL` | `"NDB-2.12"` | `labels = "NDB-2.12-long-term-funded"` |
| UT-JQL-003 | `buildSprintReportJql` | `{ teamId: 'ndb', sprintRange: [1,5] }` | team base filter applied |
| UT-JQL-004 | `buildOptimizedProjectTicketsJQL` | `{ project: 'ERA', issueTypes: ['Bug'] }` | all 6 bucket clauses in union |
| UT-JQL-005 | Any builder | any input | No hardcoded `"NDB"` string — must use input parameter |

### 2.4 RAG Verdict Computation

All test cases drive `computeReleaseHealthVerdict` in `shared/src/services/riskIndicator.ts`. Phase signals come from `shared/src/domain/execSummarySignals.cjs` (`deriveSignals`).

| ID | Scenario | Input signals | Expected verdict |
|---|---|---|---|
| UT-RAG-001 | P0 blockers present | `openP0Blockers: 1` | `RED` |
| UT-RAG-002 | Mustfix + ≤14 days to gate | `openMustFixTickets: 2, daysToNextGate: 10` | `RED` |
| UT-RAG-003 | Mustfix + exactly 14 days | `openMustFixTickets: 1, daysToNextGate: 14` | `RED` (boundary inclusive) |
| UT-RAG-004 | >2 gate-lagging features | `gateLaggingCount: 3` | `RED` |
| UT-RAG-005 | Mustfix open, >14 days to gate | `openMustFixTickets: 1, daysToNextGate: 20` | `YELLOW` |
| UT-RAG-006 | 1 gate-lagging feature | `gateLaggingCount: 1` | `YELLOW` |
| UT-RAG-007 | Exactly 2 gate-lagging features | `gateLaggingCount: 2` | `YELLOW` (boundary: >2 is RED) |
| UT-RAG-008 | Dark features > 20% | `darkFeaturePercent: 25` | `YELLOW` |
| UT-RAG-009 | Compliance at risk | `complianceAtRiskCount: 1` | `YELLOW` |
| UT-RAG-010 | Everything clean | all zeros | `GREEN` |
| UT-RAG-011 | P0=0, mustfix=0, lagging=0 | all zeros | `GREEN` (confirm not YELLOW) |

### 2.5 Risk Indicator Computation

| ID | Scenario | Input | Expected |
|---|---|---|---|
| UT-RISK-001 | `pgAtRisk: true` | any dates | `Red` |
| UT-RISK-002 | Today past PG date | `pg: yesterday` | `Red` |
| UT-RISK-003 | CG slipped, PG still reachable, QA absorbs | `cgDate: yesterday, qaCanAbsorb: true, pgAtRisk: false` | `Yellow` |
| UT-RISK-004 | CC slipped, ≤14 days to PG, QA absorbs | `ccDate: yesterday, daysUntilPG: 10, qaCanAbsorb: true` | `Yellow` |
| UT-RISK-005 | CG slipped, QA cannot absorb | `cgDate: yesterday, qaCanAbsorb: false` | `Red` |
| UT-RISK-006 | All dates in future, no slippage | all future dates | `Green` |
| UT-RISK-007 | Gate dates null/missing | `cgDate: null, pgDate: null` | `Yellow` (unknown = watch; never Green) |

### 2.6 Changelog Pagination

| ID | Scenario | Expected |
|---|---|---|
| UT-PAGI-001 | `changelog.total > histories.length`, Strategy 1 succeeds | All histories returned; single API call |
| UT-PAGI-002 | Strategy 1 returns partial; Strategy 2 paginates | All histories returned via issue ID endpoint |
| UT-PAGI-003 | Strategies 1+2 fail; Strategy 3 succeeds | All histories returned; `warnings[]` populated |
| UT-PAGI-004 | All 3 strategies fail | Partial data returned; `warnings[]` populated; no throw |
| UT-PAGI-005 | `changelog.total <= histories.length` | Returns early; no extra API calls |
| UT-PAGI-006 | Null/missing changelog | Returns empty array; no error |
| UT-PAGI-007 | 500ms delay between pagination calls | Mock timer verification confirms delay enforced |

### 2.7 Sprint Velocity Calculation

| ID | Scenario | Expected |
|---|---|---|
| UT-VEL-001 | Dev items (Bug, Task, Improvement) in sprint | Count/SP summed; portfolio types excluded |
| UT-VEL-002 | QA-Verification: Bug closed during sprint | `count × 0.33` adjusted count returned; NOT story points |
| UT-VEL-003 | QA-Test Tasks (`issueType=Test`) | SP or count; separate from Dev stream |
| UT-VEL-004 | Mixed sprint with all three streams | Three separate totals; no collapse |
| UT-VEL-005 | Portfolio item (Feature) in sprint | Excluded from all three velocity streams |
| UT-VEL-006 | Sprint ordering: names S1…S25 | Sorted by `parseInt(S(\d+))` extraction; not alphabetically |
| UT-VEL-007 | Sprint ordering regression check | `["S1","S10","S11","S2"]` sorted → `["S1","S2","S10","S11"]` |

### 2.8 Email HTML Generation

| ID | Scenario | Expected |
|---|---|---|
| UT-EMAIL-001 | All columns with `includeInEmail: true` | Valid `<table>` with `<th>` and `<td>` for each column |
| UT-EMAIL-002 | Column with `includeInEmail: false` | Column absent from email table |
| UT-EMAIL-003 | Date column with history | Historical dates struck-through; current date not struck |
| UT-EMAIL-004 | User field (object input) in email table | Renders as string; no `[object Object]` |
| UT-EMAIL-005 | Extension label on Code Complete | Cell has colored background style |
| UT-EMAIL-006 | JIRA key in email | Rendered as `<a href="..." target="_blank">KEY</a>` |
| UT-EMAIL-007 | Delay ≤ 3 days | Delay text: `"2 days late"` |
| UT-EMAIL-008 | Delay > 3 days | Delay text: `"1.5 weeks late"` |

### 2.9 AI Prompt Assembly & Ticket Key Integrity

| ID | Test | Expected |
|---|---|---|
| UT-AI-001 | `buildValidTicketKeysList(tickets)` | Returns numbered list; keys verbatim from ticket data |
| UT-AI-002 | System prompt for exec summary | Contains full TICKET KEY INTEGRITY block verbatim |
| UT-AI-003 | System prompt for release summary | Contains full TICKET KEY INTEGRITY block verbatim |
| UT-AI-004 | User prompt for exec summary | Closes with: "…use ONLY the keys listed in VALID TICKET KEYS above." |
| UT-AI-005 | User prompt for release summary | Closes with same line |
| UT-AI-006 | `buildValidTicketKeysList([])` | Returns empty list string; no crash |
| UT-AI-007 | RAG verdict in release summary prompt | Verdict string matches `computeRAGVerdict` output; not re-derived by LLM |

### 2.10 Recipient Normalization

| ID | Input | Expected |
|---|---|---|
| UT-RECIP-001 | `"a@nutanix.com; b@nutanix.com"` | `["a@nutanix.com", "b@nutanix.com"]` |
| UT-RECIP-002 | `"user.name"` (no domain) | `["user.name@nutanix.com"]` |
| UT-RECIP-003 | `"a@nutanix.com;b@nutanix.com"` (no spaces) | `["a@nutanix.com", "b@nutanix.com"]` |
| UT-RECIP-004 | Empty string | `[]` (no recipients; validation catches before send) |
| UT-RECIP-005 | Single recipient | `["a@nutanix.com"]` |

---

## 3. Integration Test Cases

### 3.1 Auth Routes

| ID | Request | Mock | Expected |
|---|---|---|---|
| IT-AUTH-001 | `POST /api/auth/login` with valid token | JIRA mock 200 `/myself` | 200; `permissions[]` array; `success: true` |
| IT-AUTH-002 | `POST /api/auth/login` with invalid token | JIRA mock 401 | 401; `success: false` |
| IT-AUTH-003 | `POST /api/auth/login` 6× in 15 min | — | 6th request: 429 |
| IT-AUTH-004 | `GET /api/auth/status` with token | — | 200; `{ authenticated: true, username }` |
| IT-AUTH-005 | Any `/api/jira/*` with no token | — | 401 |
| IT-AUTH-006 | `/api/admin/*` as non-admin user | JIRA mock; non-admin mapping | 403 |
| IT-AUTH-007 | Super admin permissions | JIRA mock; superAdminUsers mapping | Returns `admin_panel_access` in array |

### 3.2 JIRA Routes

| ID | Request | Mock | Expected |
|---|---|---|---|
| IT-JIRA-001 | `POST /api/jira/release-versions` | JIRA mock: 3 unreleased versions | 200; `versions[]` with 3 items |
| IT-JIRA-002 | `POST /api/jira/release-items-commit { fixVersion: "NDB-2.12" }` | JIRA mock: 5 features | 200; 5 items; user fields as strings (not objects) |
| IT-JIRA-003 | `POST /api/jira/release-items-history` with paginated changelog | Mock: `changelog.total=250, histories.length=50` | Pagination triggered; `paginationInfo.fetched=250` in response |
| IT-JIRA-004 | `POST /api/jira/search-by-jql` → JIRA 429 | Mock 429 → then 200 on retry | Retry triggered; eventual 200 |
| IT-JIRA-005 | `POST /api/jira/search-by-jql` → JIRA 429 × 3 | Mock 429 three times | 503 with error after max retries |
| IT-JIRA-006 | `POST /api/jira/sprint-report` | Mock sprint data | 200; three velocity streams in response |
| IT-JIRA-007 | `POST /api/jira/generate-exec-summary` | NAI mock returns summary | 200; summary present; no `[object Object]` |

### 3.3 Email Routes

| ID | Request | Mock | Expected |
|---|---|---|---|
| IT-EMAIL-001 | `POST /api/email/send` with all fields | SMTP mock | 200; mock records outbound email; CC includes `namratha.singh@nutanix.com` |
| IT-EMAIL-002 | `POST /api/email/send` missing `executiveSummary` | — | 400; `error` message mentions field name |
| IT-EMAIL-003 | `POST /api/email/send-release-versions` | SMTP mock | 200; email HTML contains `<table>`, legend section, Gantt SVG |
| IT-EMAIL-004 | `GET /api/email/history` | — | 200; array; sorted newest-first |
| IT-EMAIL-005 | `POST /api/email/send` 21× in 15 min | — | 21st: 429 |
| IT-EMAIL-006 | `POST /api/email/send` with SMTP error | Mock SMTP failure | 503; user-visible error message; form not cleared |

### 3.4 Release Dataset Routes

| ID | Request | State | Expected |
|---|---|---|---|
| IT-DS-001 | `GET /api/release-dataset/per-release/NDB-2.12` | Bundle file on disk | 200; ticket array |
| IT-DS-002 | `GET /api/release-dataset/per-release/NDB-2.12` | No file on disk | 404 with `{ success: false }` |
| IT-DS-003 | `GET /api/release-dataset/sync-status` | Any | 200; `{ releases: { ... } }` with per-release metadata |
| IT-DS-004 | `POST /api/release-dataset/sync` | JIRA mock per bucket | SSE events emitted; bundle file written to disk |
| IT-DS-005 | `DELETE /api/release-dataset/cache` | Bundle files exist | 200; files deleted |
| IT-DS-006 | `POST /api/release-dataset/sync/bucket` | JIRA mock for one bucket | Only that bucket updated; other releases unmodified |

### 3.5 AI Routes

| ID | Request | Mock | Expected |
|---|---|---|---|
| IT-AI-001 | `POST /api/ai/chat` with message | NAI mock; bundle on disk | 200; `reply`, `runtime: "agent"`, `trace` array |
| IT-AI-002 | `POST /api/ai/release-summary` | NAI mock + JIRA mock | 200; `{ verdict, summary, blockers, actionList }` |
| IT-AI-003 | `POST /api/ai/release-summary` with P0 open | JIRA mock returns P0 ticket | `verdict = "RED"` regardless of NAI response |
| IT-AI-004 | `POST /api/ai/chat` → NAI timeout | Mock 30s timeout | 503; meaningful error; no hang |
| IT-AI-005 | `PUT /api/ai/exec-summary/:key` | JIRA mock update | 200; JIRA update call made with correct field ID |

---

## 4. Running Tests

```bash
# Unit tests (watch mode)
cd apps/delivery-ops
npm test

# Coverage report
npm run test:coverage

# Integration tests only
npm run test:integration

# Live JIRA integration (pre-deploy; requires VPN + credentials)
TEST_JIRA_TOKEN=xxx npm run test:live

# Single test file
npx jest server/__tests__/utils/changelogPagination.test.js

# Enforce coverage threshold
npx jest --coverageThreshold='{"global":{"statements":80}}'
```

---

## 5. Mock Patterns

### 5.1 JIRA API Mock (nock)

```javascript
const nock = require('nock');
const JIRA_URL = process.env.JIRA_URL || 'https://jira.nutanix.com';

// Auth validation
nock(JIRA_URL)
  .get('/rest/api/2/myself')
  .reply(200, { name: 'namratha.singh', emailAddress: 'namratha.singh@nutanix.com' });

// JQL search
nock(JIRA_URL)
  .post('/rest/api/2/search')
  .reply(200, { issues: mockIssues, total: mockIssues.length, startAt: 0, maxResults: 50 });

// Rate limit scenario
nock(JIRA_URL)
  .post('/rest/api/2/search')
  .reply(429, { errorMessages: ['Too Many Requests'] })
  .post('/rest/api/2/search')   // second attempt
  .reply(200, { issues: mockIssues, total: mockIssues.length });
```

### 5.2 SMTP Mock (nodemailer-mock)

```javascript
const nodemailerMock = require('nodemailer-mock');
jest.mock('nodemailer', () => nodemailerMock);

// After the test:
const sentMail = nodemailerMock.mock.getSentMail();
expect(sentMail).toHaveLength(1);
expect(sentMail[0].cc).toContain('namratha.singh@nutanix.com');
expect(sentMail[0].html).toContain('<table');
```

### 5.3 NAI Mock (nock)

```javascript
nock(process.env.NAI_API_URL)
  .post('/chat/completions')
  .reply(200, {
    choices: [{
      message: { content: 'Mock AI response. Release ERA-66381 is blocked.' }
    }]
  });
```

### 5.4 Fixture Data

Keep fixture files in `server/__tests__/fixtures/`:

```
fixtures/
├── jira-release-versions.json     3 mock fixVersions
├── jira-release-items.json        10 mock feature tickets
├── jira-changelog-paginated.json  Mock issue with changelog.total=250
├── jira-sprint-data.json          Mock sprint + velocity data
└── email-history.json             3 historical email records
```
