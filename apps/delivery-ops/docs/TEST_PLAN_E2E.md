---
report_type: Test Plan
scope: E2E & Manual Acceptance Tests
version: "2.0"
generated: 2026-08-04
status: current
---

# Testing Plan: E2E & Manual Acceptance Tests

See `TEST_STRATEGY.md` for philosophy, quality gates, and defect severity definitions.

---

## 1. Scope

This plan covers:
- Complete user workflows in a real (or staging) browser environment
- Manual acceptance testing run before every production deploy
- Post-deploy smoke tests
- Security and rate-limit validation
- Cross-browser compatibility checks

---

## 2. Prerequisites

- Application running locally or on staging (`./scripts/start.sh`)
- Valid JIRA PAT for a user in `allowedUsers.json` (both Super Admin and a regular user for permission tests)
- VPN active (required for SMTP relay and Confluence)
- Test email account / catch-all mailbox for email delivery verification
- Browser: Chrome ≥ 120 (primary); Firefox ≥ 120 (secondary)

---

## 3. Automated E2E Test Cases (Playwright)

### 3.1 Authentication

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| E2E-AUTH-001 | Valid login | Navigate `/login` → enter valid email + PAT → Login | Redirected to main app; sidebar visible; no console error |
| E2E-AUTH-002 | Invalid token | Enter wrong token → Login | Error message shown; stays on `/login`; no redirect |
| E2E-AUTH-003 | Logout | Click logout in header | Redirected to `/login`; `localStorage.jiraToken` cleared |
| E2E-AUTH-004 | Direct navigation to protected route | Navigate `/sprint-report` without auth | Redirected to `/login` |
| E2E-AUTH-005 | Non-admin cannot access admin | Login as regular user → navigate `/admin` | Redirected to `/` |
| E2E-AUTH-006 | Super admin sees all tabs | Login as super admin | Sidebar shows: Admin, Generic Emailer, Release Setup, KPIs, AI Chat |
| E2E-AUTH-007 | Session persists on reload | Login → reload page | Stays authenticated; sidebar still visible |

### 3.2 Email Sender

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| E2E-EMAIL-001 | Extract Confluence content | Enter valid Confluence URL → Extract Content | Text appears in read-only textarea within 10s |
| E2E-EMAIL-002 | Compose and send email | Fill executive summary + recipients → Send Email | Success toast; form clears after 2 seconds |
| E2E-EMAIL-003 | Email with JIRA key | Enter `FEAT-16821` → Validate → Fetch Data → Send | Email includes ticket card; no error |
| E2E-EMAIL-004 | Recipients parsed from semicolons | Enter `a@n.com; b@n.com` → Send | Both addresses in To field; PM address in CC |
| E2E-EMAIL-005 | Clear All button | Fill all fields → Clear All | All fields empty; no page reload |
| E2E-EMAIL-006 | Missing executive summary | Leave summary empty → Send | Validation error shown; no email sent |
| E2E-EMAIL-007 | Email appears in history | Send email → navigate `/email-history` | New entry at top of history list |

### 3.3 Project Status (Release Table)

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| E2E-RVS-001 | Default release auto-loads | Navigate `/project-status` | Table loads automatically; no user action needed |
| E2E-RVS-002 | Release picker change | Refresh Versions → select different release | Table updates; Gantt updates to new release |
| E2E-RVS-003 | Date color coding | Observe Code Complete column | At least one green (on-time) or red (delayed) date visible |
| E2E-RVS-004 | Historical date strikethrough | Find item with multiple CC changes | Historical dates shown with strikethrough in date chain |
| E2E-RVS-005 | Extension label highlighting | Find item with extension label | That row's CC cell has colored background |
| E2E-RVS-006 | JIRA key links | Click any key in table | New tab opens to `https://jira.nutanix.com/browse/{KEY}` |
| E2E-RVS-007 | Gantt chart renders | Load page with valid release | Purple horizontal bar visible from EC date |
| E2E-RVS-008 | Gantt historical markers | Load release with CC history changes | Vertical markers visible on Gantt bar |
| E2E-RVS-009 | Release email send | Fill notes → Send Email | Success message; email delivered to trap mailbox |
| E2E-RVS-010 | Two table sections | Load any active release | Both "Commit" and "Long-term-funded" sections visible |

### 3.4 Sprint Report

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| E2E-SPRINT-001 | Load sprint report | Navigate `/sprint-report` → select team | Chart loads with data |
| E2E-SPRINT-002 | Three velocity streams | Observe chart | Three separate series: Dev, QA-Verification, QA-Test Tasks |
| E2E-SPRINT-003 | Sprint numeric ordering | Observe X-axis | S1, S2, S3…S24 (not S1, S10, S11, S2) |
| E2E-SPRINT-004 | JIRA links on metrics | Click a Dev velocity bar/number | Opens JIRA query in new tab with correct JQL |
| E2E-SPRINT-005 | Milestone markers | Observe chart for active release | EC, CG, PG, GA markers shown at correct sprint positions |

### 3.5 Sync Hub

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| E2E-SYNC-001 | Sync status table | Navigate `/sync-hub` | Per-release × per-bucket last-sync timestamps shown |
| E2E-SYNC-002 | Trigger full sync | Click Sync for active release | Progress events stream live; all 6 buckets update; table refreshes |
| E2E-SYNC-003 | Cell-level sync | Click re-sync icon for one specific bucket | Only that bucket updates; other buckets' timestamps unchanged |
| E2E-SYNC-004 | Stale after cache wipe | Wipe cache via API → open Sync Hub | Table shows "never synced" or stale state |

### 3.6 AI Chat

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| E2E-AI-001 | Send a message | Navigate `/chatbot` → type a release question → Send | Response appears within 30s |
| E2E-AI-002 | Ticket key format | Review any cited keys in response | All keys match pattern `[A-Z]+-\d+` (e.g., `ERA-66381`, `FEAT-16821`) |
| E2E-AI-003 | No hallucinated keys (spot check) | Take 2–3 cited keys from response → verify in JIRA | All keys exist as real JIRA tickets |
| E2E-AI-004 | Conversation history | Send second message referencing first | Response acknowledges context from prior turn |
| E2E-AI-005 | Error state | Kill NAI API (dev only) → send message | User-visible error shown; chat panel does not crash |
| E2E-AI-006 | Session memory | Send `remember: X`; Clear; send a new message | New session id; prior session memory not shown |
| E2E-AI-007 | HITL pause | Ask the agent to write a JIRA field | Approve/Reject card; Approve does not change JIRA |

### 3.7 Release Briefing

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| E2E-BRIEF-001 | Generate briefing | Open Release Summary Panel → Generate Briefing | Panel populates with RAG verdict + summary text |
| E2E-BRIEF-002 | Single RAG badge | Observe panel | Exactly one colored RAG badge; inside body, not in header or border |
| E2E-BRIEF-003 | Neutral panel border | Inspect panel CSS | Border color is `#dee2e6`; header background is `#f8f9fa` |
| E2E-BRIEF-004 | RED verdict with P0 open | Use release known to have P0 ticket | Verdict = RED |

### 3.8 Retrospective

| ID | Scenario | Steps | Expected |
|---|---|---|---|
| E2E-RETRO-001 | Naughty list loads | Navigate `/release/retrospective` → select completed release | Table loads with gate-violating projects |
| E2E-RETRO-002 | Per-project drill-down | Click project row | Project violation timeline page shows date change history |

---

## 4. Cross-Browser Compatibility

| Feature | Chrome ≥ 120 | Firefox ≥ 120 | Safari ≥ 17 | Edge ≥ 120 |
|---|---|---|---|---|
| Login flow | Required | Required | Required | Required |
| Release table + date coloring | Required | Required | Required | Required |
| Gantt SVG render | Required | Required | Manual | Manual |
| Email send | Required | Required | Manual | Manual |
| AI chat | Required | Required | Manual | Manual |
| Sprint chart ordering | Required | Required | Manual | Manual |

---

## 5. Performance Validation

| ID | Test | Method | Threshold |
|---|---|---|---|
| PERF-001 | Page first contentful paint | Chrome DevTools Performance → reload | < 3 seconds |
| PERF-002 | Release table render (150+ items) | DevTools → Profile during fetch complete | < 2 seconds |
| PERF-003 | Gantt SVG render | DevTools → paint events | < 1 second |
| PERF-004 | Dataset sync one bucket | Stopwatch from click to "Done" SSE event | < 60 seconds |
| PERF-005 | AI chat first token | Network → time to first byte from `/api/ai/chat` | < 5 seconds |
| PERF-006 | Release bundle read from disk | Network → time for `/api/release-dataset/per-release/NDB-2.12` | < 500ms |

---

## 6. Manual Acceptance Checklist (Run Before Every Production Deploy)

Check each item. A single unchecked P0 item blocks deploy.

### Authentication & Navigation
- [ ] Login with valid PAT → redirects to app
- [ ] Login with invalid PAT → error message; stays on login page
- [ ] Logout → localStorage cleared; redirects to login
- [ ] Non-admin user: Admin tab not visible in sidebar
- [ ] Super admin user: All tabs visible including Admin, Generic Emailer, Release Setup

### Email Sender
- [ ] Confluence URL extraction returns page content
- [ ] Compose email with all fields → Send → received in trap mailbox
- [ ] CC field in received email contains `namratha.singh@nutanix.com`
- [ ] Form auto-clears 2 seconds after successful send
- [ ] Clear All button resets all fields
- [ ] JIRA key validation shows "valid" for a real key; "invalid" for a fake key
- [ ] Sending email without executive summary shows validation error

### Project Status
- [ ] Default release loads automatically on page mount (no click needed)
- [ ] "Refresh Versions" populates dropdown with JIRA release list
- [ ] Switching release: table and Gantt update to new release data
- [ ] At least one date column shows green (on-time) formatting
- [ ] At least one JIRA key link opens correct JIRA page in new tab
- [ ] Gantt chart visible: purple bar present; starts at EC date
- [ ] Historical Gantt markers visible (if release has CC history)
- [ ] Release email sends successfully; received email has table + Gantt SVG + legend
- [ ] Extension-labeled items have colored cell background

### Sprint Report
- [ ] Select NDB team → chart loads with 3 velocity series
- [ ] X-axis sprint order is numeric: S1, S2, S3… (not alphabetical)
- [ ] Milestone markers visible on chart (at least EC or GA)
- [ ] Clicking a velocity number opens JIRA in new tab

### Sync Hub
- [ ] All active releases listed with per-bucket sync timestamps
- [ ] Trigger sync for one release → progress stream shows → table updates
- [ ] Cell-level sync (one bucket) works without affecting others

### AI Features
- [ ] Chat panel loads at `/chatbot`; initial greeting or empty state shown
- [ ] Send a release-status message → response appears with content
- [ ] Spot-check: take 2 cited JIRA keys from response → verify both exist in JIRA
- [ ] Release briefing generates → RAG badge appears exactly once (in body, not border)
- [ ] Panel border is neutral gray (not green, yellow, or red)

### Release Config & Setup (Super Admin)
- [ ] Release Config page loads milestone dates for active release
- [ ] Release Setup: create a test version → appears in JIRA versions list

### Security Checks
- [ ] Send > 5 login attempts in 15 minutes → 6th returns 429
- [ ] API call with expired/invalid token → 401 response; user redirected to login
- [ ] Attempt XSS in email additional details field → HTML sanitized in received email

### Post-Deploy Smoke (on production host)
- [ ] `GET /api/health` → 200
- [ ] `GET /api/jira/jira-diagnostic` → 200
- [ ] Login → project status page loads with data
- [ ] `pm2 list` shows `delivery-ops` process as "online"
- [ ] Nginx access log shows requests being proxied correctly

---

## 7. Regression Scenarios

Run these when the corresponding trigger condition occurs.

| Trigger Condition | Regression Scenario | Verification Steps |
|---|---|---|
| JIRA API version update | Changelog pagination regression | Fetch history for `FEAT-18452`; verify all historical dates present in Gantt markers |
| Any change to `execSummarySignals.cjs` / `riskIndicator.ts` | RAG verdict regression | Run UT-RAG-001 through UT-RAG-011; confirm P0 → RED is immediate |
| Any change to `ReleaseGantt.js` | Gantt bar regression | Verify bar starts at EC, ends at current CC; historical markers at correct positions |
| Any change to email service | Email template regression | Send test email; verify: CC present, table present, legend present, no `[object Object]` |
| Any sprint chart change | Sprint ordering regression | Confirm S1, S2, S3 numeric order; not S1, S10, S11, S2 |
| Any NAI model change | AI ticket key integrity | Generate briefing; spot-check all cited keys against JIRA; zero hallucinated keys |

---

## 8. Known Limitations

| Limitation | Impact | Workaround |
|---|---|---|
| SMTP only on internal network | Email delivery tests fail outside VPN | Use VPN or run on staging server |
| JIRA rate limits during sync | Sync may slow during high-traffic windows | Schedule syncs outside business hours (before 9am or after 6pm) |
| NAI response is non-deterministic | AI briefing text varies per generation | Review ticket keys and RAG verdict only; narrative text is non-deterministic by design |
| Very large changelogs (>1000 entries) | Sync may take > 2 minutes for that ticket | Expected behavior; documented in UI with progress indicator |
| Confluence API on port 8443 | Only accessible from server host | Confluence extraction must be tested on staging or production server, not from developer laptop |
