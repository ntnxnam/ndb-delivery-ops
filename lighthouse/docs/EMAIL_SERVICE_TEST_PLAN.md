# Email Service Test Plan

This document defines the test strategy for the email service: unit tests (mocked SMTP), negative scenarios, integration tests (CI with mocks), and post-deployment verification so production deployment works reliably.

## 1. Goals

- **Unit tests**: Email service logic (`getDefaultFromAddress`, `parseEmailRecipients`, `sendEmailDirect` with mocked nodemailer) so CI runs without real SMTP.
- **Negative scenarios**: Missing/invalid SMTP config, relay denied, validation errors, auth failures, timeouts, malformed input.
- **Integration tests**: API email endpoints with mocked nodemailer so they run in CI; optional real-SMTP run in staging/production.
- **Deployment**: Optional post-deploy email smoke test (e.g. `node server/test-smtp.js`) and clear docs so production works reliably.

## 2. Unit Tests (run in CI, no real SMTP)

| ID | Scenario | Steps | Expected |
|----|----------|--------|----------|
| UT-EMAIL-001 | getDefaultFromAddress | With no SMTP_FROM env: call getDefaultFromAddress() | Returns emailConfig.smtp.from or 'smtp.ndb.team@nutanix.com'. With SMTP_FROM set: returns env value. |
| UT-EMAIL-002 | sendEmailDirect From | Call sendEmailDirect with mailOptions without from | mailOptions.from is set to getDefaultFromAddress() before sendMail. |
| UT-EMAIL-003 | sendEmailDirect success | Mock transporter.sendMail to resolve with messageId, accepted, rejected | sendEmailDirect returns { messageId, accepted, rejected }; sendMail called with correct from/to. |
| UT-EMAIL-004 | sendEmailDirect relay error | Mock sendMail to reject with "554 5.7.1: Relay access denied" | Error propagated; sendEmailDirect rejects. |
| UT-EMAIL-005 | sendEmailDirect timeout | Mock sendMail to reject with connection timeout | Error propagated; sendEmailDirect rejects. |
| UT-EMAIL-006 | parseEmailRecipients | Empty, null, comma list, usernames, emails, @nutanix.com, blanks | Empty/null → []. Comma list normalized; usernames get @nutanix.com; blanks filtered. |
| UT-EMAIL-007 | parseEmailRecipients invalid | Malformed input (e.g. "@", "a@b@c") | No throw; normalize where possible (e.g. "@" → filtered out; "a@b@c" → username "a" → a@nutanix.com). |

Implementation: `server/__tests__/services/emailService.test.js` with `jest.mock('nodemailer')` so `createTransport` returns a stub with `sendMail` and `verify`.

## 3. Negative Scenarios (API / handler level)

| ID | Scenario | Endpoint / layer | Expected |
|----|----------|------------------|----------|
| NEG-EMAIL-001 | No JIRA user / token | POST /api/email/send, /send-release-versions, /send-generic-reminder | 400 "JIRA user email is required" (or 401/403 from auth middleware). |
| NEG-EMAIL-002 | Missing required body | POST /api/email/send without additionalDetails | 400 "Highlights and Lowlights is required". |
| NEG-EMAIL-003 | Missing required sections | additionalDetails without "Highlights" / "Lowlights" | 400 "must include all sections". |
| NEG-EMAIL-004 | Release versions disabled | RELEASE_VERSIONS_EMAIL_ACCESS=none | 403 "currently disabled". |
| NEG-EMAIL-005 | Release versions no version/table | No selectedVersion or tableHTML | 400. |
| NEG-EMAIL-006 | Generic reminder missing payload | No selectedFieldIdsInOrder or issuesPayload | 400. |
| NEG-EMAIL-007 | SMTP credentials missing | sendEmailDirect when SMTP_USER/SMTP_PASS unset | sendMail fails; handler returns 500 with safe message. |
| NEG-EMAIL-008 | Relay access denied | Mock sendMail to reject with 554 5.7.1 | 500 with safe message; no stack trace to client. |

Covered by unit tests (handlers with mocked sendEmailDirect) or integration tests with mocked nodemailer.

## 4. Integration Tests (CI with mocked SMTP)

- Mock nodemailer in integration tests so:
  - `createTransport` returns a transporter whose `sendMail` resolves with `{ messageId, accepted: [to], rejected: [] }`.
  - No real SMTP is used; tests are deterministic.
- Scenarios:
  - POST /api/email/send and POST /api/email/send-release-versions with valid payload and valid mock JIRA auth → expect 200 and success body when mock sendMail succeeds.
  - Optionally one test where mock sendMail rejects → expect 500.

Integration tests run in CI (jest config includes integration folder when mocks are in place).

## 5. Post-Deployment Verification (production)

### Pre-deploy checklist

Before first deploy or after config change:

- `server/.env` has SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (and optionally SMTP_FROM).
- `server/config/emailConfig.json` has smtp.from (e.g. smtp.ndb.team@nutanix.com) and, for Email Sender page, defaultTo if desired.

### Optional email smoke test in deploy script

After verify_deployment (Step 13 in deploy_rhel8.sh):

- Run: `cd $APP_DIR/server && node test-smtp.js`.
- If SMTP credentials are not set, test-smtp.js exits with a clear error; script logs "Email smoke test skipped (no SMTP credentials)" and continues.
- If RUN_EMAIL_SMOKE_TEST=true is set and test fails, deployment can fail (optional strict mode).

### Health endpoint

- `/api/health` remains as-is (no email send).
- Optionally a read-only check can verify config (getDefaultFromAddress set, SMTP_* env present) without sending mail for monitoring.

## 6. Test IDs Reference

- **UT-EMAIL-001** … **UT-EMAIL-007**: Unit tests (emailService.test.js).
- **NEG-EMAIL-001** … **NEG-EMAIL-008**: Negative scenarios (unit or integration with mocks).
- Integration: IT-EMAIL-001, IT-EMAIL-002 (existing); add deterministic expectations with mock.

## 7. Running Tests

- **Unit (includes email service tests)**: `npm run test:unit`
- **Integration (with mocks)**: `npm run test:integration` or `npm test` when integration is not ignored.
- **Post-deploy smoke**: `cd server && node test-smtp.js` (requires SMTP_* in .env).
