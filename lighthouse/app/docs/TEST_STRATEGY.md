---
report_type: Test Strategy
product: multi-product
version: "2.0"
generated: 2026-08-04
status: current
---

# Test Strategy
## Portfolio Delivery Ops — `delivery-ops`

---

## 1. Purpose

This document defines the overarching testing philosophy, coverage model, tooling, environment strategy, and quality gates for the Portfolio Delivery Ops platform. Individual testing plans (`TEST_PLAN_UNIT_INTEGRATION.md`, `TEST_PLAN_E2E.md`) reference this strategy for shared definitions.

---

## 2. Testing Philosophy

### 2.1 Principles

1. **Test behaviour, not implementation.** Tests validate what the system does, not how it is wired internally. Refactors should not break tests.
2. **Fail fast and loud.** Any regression in email delivery, JIRA data accuracy, or RAG verdict computation must be caught before reaching users.
3. **Ticket key integrity is P0.** AI output containing a hallucinated JIRA key is a critical defect — equal in severity to a crash.
4. **Mocks in CI; live APIs for pre-deploy.** JIRA, Confluence, SMTP, and NAI are mocked in automated runs. Live integration tests run only in a dedicated environment with real credentials.
5. **Coverage is a floor, not a target.** 80% statement coverage is the minimum gate; the true goal is coverage of every PRD requirement.

### 2.2 Test Pyramid

```
          /\
         /E2E\          ~20%  Critical user workflows; slow; live-like environment
        /------\
       / Integr.\       ~40%  API contracts, service interactions, JIRA mock
      /----------\
     / Unit Tests \     ~40%  Pure functions, formatters, validators, RAG rules
    /--------------\
```

---

## 3. Coverage Targets

| Module | Target | Rationale |
|---|---|---|
| Date formatting utils | 100% | Drives Gantt + email; errors are user-visible |
| User field extraction | 100% | Drives table display; `[object Object]` is a known defect class |
| RAG verdict computation (`computeRAGVerdict`) | 100% | Deterministic rule; all 7 conditions must be verified |
| Risk indicator computation (`computeRiskIndicator`) | 100% | JIRA field write; wrong value misleads stakeholders |
| JQL builder functions | 100% | JQL is the data boundary; a wrong clause silently drops tickets |
| Email HTML generation | 90% | Email is user-facing output with no second chance |
| Changelog pagination (3-strategy fallback) | 90% | Silent data loss; known production bug class |
| API routes (server) | 80% | All endpoints documented in `docs/api/` must have coverage |
| React hooks | 75% | Fetch logic; error/loading states |
| React components | 70% | Rendering only; no axios in components (architecture invariant) |
| AI prompt assembly | 90% | Ticket key list building; system prompt structure |

---

## 4. Test Types

### 4.1 Unit Tests

- **Scope:** Pure functions, utilities, data transformers, React components (rendering only)
- **Framework:** Jest + React Testing Library
- **Location:** Co-located `__tests__/` directories; `*.test.js`
- **Run:** `npm test` (watch mode); `npm run test:coverage`
- **CI gate:** Must pass; coverage ≥ 80% on critical modules

### 4.2 Integration Tests

- **Scope:** Express route handlers with mocked external systems; service-to-service contracts
- **Framework:** Jest + Supertest + `nock` (HTTP mocking) + `nodemailer-mock`
- **Location:** `server/__tests__/integration/`
- **Run:** `npm run test:integration`
- **CI gate:** Must pass; no new endpoints without at least one integration test

### 4.3 Live Integration Tests (Manual — Pre-Deploy Only)

- **Scope:** Real JIRA API, real Confluence, real SMTP (to test trap mailbox)
- **Run condition:** Before every production deploy; after any JIRA customfield config change
- **Requires:** `TEST_JIRA_TOKEN` env var; VPN active; test email account
- **Checklist:** See `TEST_PLAN_E2E.md` §6

### 4.4 End-to-End Tests

- **Scope:** Full browser workflow; complete user journeys
- **Framework:** Playwright
- **Location:** `e2e/`
- **Run:** `npm run test:e2e`
- **CI gate:** Runs on PR to `main`; must pass for merge

### 4.5 Security Tests

- **Scope:** Auth bypass attempts; rate limit enforcement; XSS in email HTML; CORS validation
- **Method:** Targeted manual tests + automated rate-limit check in integration suite
- **Run condition:** Before every deploy; after any auth or middleware change

### 4.6 Performance Tests

- **Scope:** Page load time; API response time; table render with large datasets
- **Method:** Browser DevTools profiling + Lighthouse; manual timing of key API calls
- **Thresholds:** Page paint < 3s; API < 5s; table render (150 items) < 2s

---

## 5. Test Environment Strategy

| Environment | JIRA | Confluence | SMTP | NAI | When used |
|---|---|---|---|---|---|
| Unit/Integration CI | `nock` mock | `nock` mock | `nodemailer-mock` | `nock` mock | Every push |
| Local dev | Live (developer's PAT) | Live | Internal relay | Live (if `AI_API_KEY` set) | During development |
| Pre-deploy manual | Live (test PAT) | Live | Internal relay → trap mailbox | Live | Before each production deploy |
| Post-deploy smoke | Live (production) | Live | Live relay | Live | Immediately after deploy |

---

## 6. Quality Gates

### 6.1 Pre-Merge (PR)

| Check | Requirement |
|---|---|
| Unit tests | All pass |
| Integration tests | All pass |
| Statement coverage on modified modules | ≥ 80% |
| ESLint | Zero errors; `react-hooks/exhaustive-deps` enabled |
| No `localhost` in production code | `scripts/check-no-localhost.js` passes |
| API doc | New endpoints documented in `docs/api/{resource}.md` |
| No new inline `customfield_NNNNN` | grep check passes |
| No JQL string modified without approval | `jql-edit-approval` rule |

### 6.2 Pre-Deploy (Production)

| Check | Requirement |
|---|---|
| E2E smoke test | Auth, release table load, email send, AI chat all pass |
| Email delivery | Test email received in trap mailbox within 60s |
| JIRA connectivity | `GET /api/jira/jira-diagnostic` returns 200 |
| Dataset cache | At least one release bundle present and < 24h old |
| Rate limit | Sending > 5 login requests in 15 min returns 429 |
| PM2 process | `pm2 list` shows `delivery-ops` as "online" |

### 6.3 Regression (Post-Deploy + Ongoing)

| Check | Frequency | Owner |
|---|---|---|
| Full E2E suite | Weekly | Portfolio Manager (manual) |
| Changelog pagination (`FEAT-18452`) | After any JIRA API change | Dev |
| AI briefing ticket key spot-check | After any NAI model change | Portfolio Manager (review) |
| RAG verdict correctness (unit) | After any gate-signal logic change | Dev |

---

## 7. Defect Severity

| Severity | Definition | SLA |
|---|---|---|
| **P0 — Critical** | Email not delivered; data loss; auth bypass; hallucinated ticket key in AI output forwarded to executive | Hotfix immediately; revert if needed |
| **P1 — High** | Release table missing items; Gantt shows wrong dates; RAG verdict wrong; sync fails silently | Fix in next deploy |
| **P2 — Medium** | UI glitch; slow API (>5s); minor formatting error; rate limit not enforced | Fix in next sprint |
| **P3 — Low** | Cosmetic; typo; non-critical label | Backlog |

---

## 8. Tooling

| Purpose | Tool |
|---|---|
| Unit test runner | Jest 29 |
| React component tests | React Testing Library |
| API integration tests | Supertest + nock |
| E2E browser tests | Playwright |
| HTTP mocking | nock |
| SMTP mocking | nodemailer-mock |
| Coverage reporting | Jest `--coverage` → lcov |
| Linter | ESLint (`react-hooks/exhaustive-deps` enforced) |
| Pre-commit check | `scripts/check-no-localhost.js` |

---

## 9. Risk Areas and Mitigations

| Risk | Mitigation |
|---|---|
| JIRA changelog pagination drops historical dates | 100% unit coverage on all 3 strategies; integration test with `FEAT-18452` |
| AI hallucinates ticket keys | Ticket key integrity unit tests; manual review of every AI output before forwarding to executive |
| RAG verdict logic regression | 100% unit coverage; table-driven test for all 6 verdict conditions |
| Email SMTP misconfiguration post-deploy | Pre-deploy live send to trap mailbox |
| React `useEffect` infinite loop | ESLint `react-hooks/exhaustive-deps`; PR reviewer checklist; emergency stop protocol |
| CORS misconfiguration after deploy | Post-deploy smoke test includes cross-origin request validation |
| Sprint chart alphabetical ordering regression | Unit test on sprint number extraction and sorting |
