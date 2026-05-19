# NDB Status Update Sender

A web application for Confluence-based status update emails and JIRA release version tracking. Extract Confluence page contents to send status emails, use the Release Versions page to view JIRA issues by fix version and send release-version emails, or use the **Generic Emailer** to run any JQL query and email the results with configurable columns and recipients.

**For developers taking over the codebase**, see **[DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)** for architecture, setup, key files, configuration, and refactored structure.

---

## Latest version: **1.3.0**

### What's new in 1.3.0

**Architecture enforcement:**

- **Layer boundaries**: Components no longer call `axios` directly. Data fetching moved to dedicated hooks (`useTeams`, `useGenericEmailerConfig`) and services (`confluenceService`, `jiraQueryService`). Six components cleaned up: `KPIPage`, `SprintReportPage`, `ReleaseTrendsPage`, `GenericEmailer`, `ConfluenceExtractor`, `JiraQuery`.
- **JIRA field constants**: `client/src/utils/jiraFields.js` is now the single source of truth for all `customfield_NNNNN` IDs on the client. Never write them inline.
- **Status/colour constants**: `client/src/constants/releaseStatus.js` — `JIRA_COLOR_MAP`, `RISK_COLOR_MAP`, status keyword sets extracted from components.
- **Hooks barrel**: `client/src/hooks/index.js` updated to export all hooks including the two new ones.

**AI coding rules** (`.cursor/rules/`):

- **`minimal-architecture.mdc`** — enforces layer boundaries, file size limits (600 line max for components), and the single-source-of-truth field ID rule.
- **`documentation-consistency.mdc`** — enforces report file naming (`{Type}-{Product}-{Release}-{Date}.ext`), required frontmatter in `.md` reports, and canonical section structure for all skill files.

**Documentation cleanup:**

- All 5 skill files (`vp-release-report`, `confluence-width-cleanup`, `fetch-project-tickets`, `sprint-gantt-chart`, `predictive-vp-analytics`) normalised to the same 5-section structure: `When to Use`, `Quick Start`, `Core Rules`, `Output Format`, `Quality Validation`.
- All 10 existing `reports/*.md` files retrofitted with YAML frontmatter (`report_type`, `product`, `release`, `generated`, `data_source`).
- `DEVELOPER_GUIDE.md` updated: directory structure, key files table, and new section 13 (Architecture Rules).

---

## Version 1.2.0

### What's new in 1.2.0

**Authentication and RBAC**:

- **Auth**: Auth middleware and `authService` for role-based access. Roles (Super Admin, Admin, User) are config-driven via `server/config/allowedUsers.json`.
- **Docs**: **[docs/RBAC_GUIDE.md](docs/RBAC_GUIDE.md)** – role hierarchy, config keys (`superAdminUsers`, `adminUsers`), and permissions (generic emailer and release setup restricted to Super Admin).

**Email and testing**:

- **Email service**: Updates to email sending flow and service layer.
- **Docs**: **[docs/EMAIL_SERVICE_TEST_PLAN.md](docs/EMAIL_SERVICE_TEST_PLAN.md)** – test plan for email functionality.
- **Tests**: New `server/__tests__/services/emailService.test.js`; expanded integration tests for email and JIRA.

**Other**:

- Sprint Report page and JIRA route updates; config and deploy script adjustments. See **DEVELOPER_GUIDE.md** and **DEPLOYMENT_GUIDE.md** for setup and deployment.

---

## Version 1.1.0

### What's new in 1.1.0

**Generic Emailer (Reminder)** – new page at `/generic-emailer`:

- **JQL fetch**: Enter any JQL (e.g. `project = ERA AND statusCategory != Done`), click **Fetch** to load up to 500 issues. Only columns that have at least one value in the results are shown.
- **Column selection**: Checkboxes for all fields-with-data in a **3-column layout**. Select which columns to include in the email; **drag-and-drop** to reorder, **×** on each row to remove that column from the email. Up/Down buttons still available.
- **Subject and body**: Optional **Subject** (date is always appended, e.g. `Your subject – 30/Jan/2026`) and **Body** (rich-text editor; content appears above the table in the email).
- **Recipients**: Optional **To** (comma/semicolon separated); **CC** from config (`genericEmailerCCConfig.json`: defaultCC, optionalCCRecipients) and **Project team** (Assignee, QA Contact, PM Owner, etc.) from the fetched issues.
- **Preview**: Paginated table (rows per page 10/20/50/100) of selected columns before sending.
- **Send**: One email to all To/CC with the body and table; empty cells show **N/A**. Subject always includes the send date.

**Backend and behavior**:

- **APIs**: `POST /api/jira/search-by-jql` (returns issues + fields-with-data), `POST /api/email/send-generic-reminder`, `GET /api/config/generic-emailer`.
- **CC fix**: Default CC and sender-in-CC use normalized Nutanix emails (no duplicate relay vs Nutanix address). Table-breaking HTML in cell content (e.g. `</td>`, `<td`) is escaped so Jira text doesn’t break the email table.
- **Jira rich text in email**: Wiki markup and Atlassian Document Format (ADF) in description/status-update columns are converted to HTML in the email table (same behavior as elsewhere in the app).
- **Email layout**: Tighter cell padding (5px), viewport-friendly max-width and table-wrap so the email fits and wide tables scroll.
- **Sprint/agile fields**: `jiraFieldsConfig.json` includes Sprint and Sprints (customfield_10020, customfield_10021) so they appear in column selection when data exists.
- **Client**: Proxy set to `http://localhost:6001`; **Fetch** and **Send Email** buttons are side-by-side at the top.

**Config**:

- **`server/config/genericEmailerCCConfig.json`**: `defaultCC`, `optionalCCRecipients`, `projectTeamFields` for the Generic Emailer.

**Sprint Report** – page at `/sprint-report`:

- **Report types**: Past sprint report, current sprint report, or trends by team. Team is selected in the header; base filter comes from `teamBoardConfig.json` (e.g. NDB board 2888).
- **Metrics**: Total in sprint, added after sprint started, removed from sprint, completed in sprint, incomplete but resolved, incomplete not resolved. Download report as CSV.
- **Limitation**: "Removed from sprint" counts issues that left the sprint during the timebox; the Jira API does not return those issues, so this value is often 0 unless your Jira supports history JQL (e.g. "Sprint was X"). See in-app note and DEVELOPER_GUIDE.
- **Config**: `allowedUsers.json` → `sprintReportAllowedUsers`; `teamBoardConfig.json` → `boardId` per team.

---

## Repository
- **GitHub Organization**: ntnxnam
- **Repository Name**: ndb-status-sender

## Requirements

### Connection to Confluence
1. Confluence key has been provided in a different project, but **DO NOT store it in this repository**. This is only for testing.
2. For users who log in, take their email ID and the Confluence token input and use that going forward.

### Connection to JIRA (Release Versions)
- JIRA API token is used for release version data, issue changelog, and checkpoint history. Store in environment (e.g. `JIRA_TOKEN`) or server config; do not commit tokens.

### Email Sender
1. Ask user to input the Confluence URL
2. Provide button to extract the contents of page into screen
3. Provide textbox to user to input Executive Summary
4. Provide textbox to add additional details using rich text editor
5. Take input of email IDs to be separated by semi colon
6. Provide Send and Clear button
7. If user clicks Clear, clear all inputs
8. If user clicks Send, send email to namratha.singh@nutanix.com in CC
9. Send email to "To" box
10. Allow developer to edit default email lists by making a separate config file

## Project Structure
```
ndb-status-sender/
├── client/                 # React frontend application
│   ├── public/
│   ├── src/
│   │   ├── components/     # React components
│   │   │   ├── AuthForm.js
│   │   │   ├── EmailSender/           # Email Sender (JIRA ticket, highlights/lowlights)
│   │   │   │   ├── index.js, EmailSender.js, EmailSender.css
│   │   │   ├── shared/                 # e.g. OutlookFallback.js
│   │   │   ├── EmailHistoryTab.js
│   │   │   ├── ExecutiveSummaryEditor.js
│   │   │   ├── ReleaseVersionTab.js, ReleaseVersionSelector.js
│   │   │   ├── ReleaseVersionGantt.js, ReleaseVersionEmailForm.js
│   │   │   ├── ReleaseVersionTable*.js, ReleaseVersionLegend.js
│   │   │   ├── GenericEmailer.js, GenericEmailer.css
│   │   │   ├── SprintReportPage.js    # Sprint Report (past/current/trends)
│   │   │   ├── ReleaseTrendsPage.js, KPIPage.js, ReleaseSetup.js
│   │   │   └── ...
│   │   ├── App.js
│   │   └── index.js
│   └── package.json
├── server/                 # Node.js/Express backend
│   ├── config/
│   │   ├── emailConfig.json, confluenceConfig.json
│   │   ├── releaseVersionsColumnsConfig.json  # Release table columns & checkpoint fields
│   │   ├── genericEmailerCCConfig.json        # Generic Emailer CC, project team fields
│   │   ├── jiraFieldsConfig.json, allowedUsers.json
│   │   ├── kpiConfig.json, teamBoardConfig.json
│   │   └── ...
│   ├── routes/
│   │   ├── email/          # send, send-release-versions, send-generic-reminder, preview, schedules, history
│   │   ├── jira/           # validate, fetch, release-versions, search-by-jql, sprint-report, KPIs, etc.
│   │   ├── config.js, auth.js
│   │   └── ...
│   ├── services/
│   ├── utils/              # ganttChartEmailGenerator, emailHistoryDB, sprintCache, concurrency, etc.
│   └── package.json
├── docs/                    # REQUIREMENTS.md, TECH_DESIGN.md, TEST_PLAN.md
├── package.json
└── README.md
```

## Local Development

### Quick Start

**Both pages are enabled by default for local testing** - no configuration needed!

```bash
# Install all dependencies
npm run install-all

# Start both servers (backend + frontend)
npm run dev
```

This will start:
- Backend server on `http://localhost:6001`
- Frontend on `http://localhost:6100`

Email Sender (`/`), Release Versions (`/all-status`), Generic Emailer (`/generic-emailer`), and Sprint Report (`/sprint-report`) will be available.

### No hardcoded localhost in production

App code must not use hardcoded `localhost` or `127.0.0.1` so production builds work on any host. Before pushing to prod or deploying, run:

```bash
npm run check:no-localhost
```

Use relative paths or env (e.g. `REACT_APP_API_URL`, `ALLOWED_ORIGINS`). See `~/.cursor/rules/no-localhost.mdc` (user-level rule) for the full rules and allowed exceptions.

### Testing Email-Only Mode Locally

If you want to test with only the Email Sender page locally, create a `.env` file in the `client/` directory:

```bash
cd client
echo "REACT_APP_ENABLE_RELEASE_VERSIONS=false" > .env
npm start
```

## Setup Instructions

### Prerequisites
- Node.js (v14 or higher)
- npm or yarn
- Confluence API token (for Email Sender)
- JIRA API token (for Release Versions; e.g. set `JIRA_TOKEN` in server env)
- SMTP credentials for email sending

### Installation

1. **Clone the repository** (after creating it on GitHub):
   ```bash
   git clone https://github.com/ntnxnam/ndb-status-sender.git
   cd ndb-status-sender
   ```

2. **Install dependencies**:
   ```bash
   npm run install-all
   ```
   Or install separately:
   ```bash
   npm install
   cd server && npm install
   cd ../client && npm install
   ```

3. **Configure environment variables**:
   - Copy `server/.env.example` to `server/.env`
   - Update SMTP settings in `server/.env`:
     ```
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     SMTP_USER=your-email@nutanix.com
     SMTP_PASS=your-app-password
     PORT=6001
     ```
   - For Release Versions: set `JIRA_TOKEN` (or your JIRA auth) in server environment.

4. **Configure default email lists** (optional):
   - Edit `server/config/emailConfig.json` to add default CC or To email addresses
   - Note: `namratha.singh@nutanix.com` is automatically added to CC

### Running the Application

**Development mode** (runs both frontend and backend):
```bash
npm run dev
```

**Or run separately**:
- Backend: `npm run server` (runs on http://localhost:6001)
- Frontend: `npm run client` (runs on http://localhost:6100)

### Usage

**Email Sender (`/`)**
1. **Authenticate**: Enter your email and Confluence API token
2. **Extract Content**:
   - Enter a Confluence page URL (full URL or relative path)
   - Supported URL formats:
     - Full URL: `https://confluence.eng.nutanix.com:8443/pages/viewpage.action?pageId=123456`
     - Full URL: `https://confluence.eng.nutanix.com:8443/pages/viewinfo.action?pageId=123456`
     - Full URL: `https://confluence.eng.nutanix.com:8443/spaces/SPACE/pages/123456/Page+Title`
     - Relative: `/pages/viewpage.action?pageId=123456`
     - Relative: `/pages/viewinfo.action?pageId=123456`
     - Relative: `/spaces/SPACE/pages/123456/Page+Title`
   - Click "Extract Content" to fetch the page content
   - Note: Base Confluence URL is stored in `server/config/confluenceConfig.json`
3. **Compose Email**: Enter Executive Summary (required), add Additional Details (rich text), enter recipients (semicolon-separated)
4. **Send Email**: Click "Send Email"; `namratha.singh@nutanix.com` is added to CC
5. **Clear**: Click "Clear All" to reset all inputs

**Release Versions (`/all-status`)**
1. **Authenticate** with JIRA (token used by backend).
2. **Select release version** (e.g. NDB-2.11) and fetch items; table shows key, summary, checkpoint dates, etc.
3. **View history**: Checkpoint date columns can show history where configured.
4. **Gantt & email**: Use Gantt chart and release-version email form to send status emails; email history is available via Email History tab.

**Generic Emailer (`/generic-emailer`)**
1. **Authenticate** with JIRA (same token as Release Versions).
2. **Enter JQL** (e.g. `project = ERA AND statusCategory != Done`) and click **Fetch** to load issues (up to 500).
3. **Subject and body**: Optionally enter subject (date is appended) and body (rich text; appears above the table in the email).
4. **Columns**: Checkboxes show only fields that have data. Select columns and reorder via **drag-and-drop** or Up/Down; click **×** on a row to remove that column from the email.
5. **Recipients**: Optional To; select optional CC and project team (Assignee, QA Contact, etc.) from config.
6. **Preview**: Paginated table of selected columns; then click **Send Email** (next to Fetch) to send one email to all To/CC with body + table. Empty cells show N/A.

### Configuration Files

- **`server/config/emailConfig.json`**: Default email lists (CC/To)
  ```json
  {
    "defaultCC": ["namratha.singh@nutanix.com"],
    "defaultTo": []
  }
  ```

- **`server/config/confluenceConfig.json`**: Default Confluence base URL. Used when users provide relative Confluence paths.

- **`server/config/releaseVersionsColumnsConfig.json`**: Release table columns, column order, and checkpoint fields (e.g. Code Complete, Commit Gate) including which show history.

- **`server/config/jiraFieldsConfig.json`**: JIRA field mappings used by release-versions, history, and Generic Emailer (includes checkpoint, people, agile/sprint fields).

- **`server/config/genericEmailerCCConfig.json`**: Generic Emailer CC: `defaultCC` (usernames normalized to @nutanix.com), `optionalCCRecipients`, `projectTeamFields` (e.g. assignee, QA Contact, PM Owner).

- **`server/config/allowedUsers.json`**: Allowed users for the application (edit to control access).

### Security Notes

- **DO NOT** commit Confluence or JIRA tokens or API keys to the repository
- User credentials are stored in session only (in-memory)
- For production, implement proper session management and authentication
- Use environment variables for all sensitive configuration

## Changelog

### Initial Release
- ✅ Confluence authentication with user email and token
- ✅ Confluence page content extraction
- ✅ Executive Summary input field
- ✅ Rich text editor for additional details
- ✅ Email recipient input (semicolon-separated)
- ✅ Send and Clear functionality
- ✅ Automatic CC to namratha.singh@nutanix.com
- ✅ Configurable default email lists via `emailConfig.json`

### JIRA & Release Versions
- ✅ JIRA integration: release version selector, issue list by fix version
- ✅ Release Versions table with configurable columns and checkpoint dates
- ✅ Checkpoint and release-items history APIs (changelog-based)
- ✅ Gantt chart and release-version email generation
- ✅ Email history tab and stored email history
- ✅ Executive summary editor and AI-assisted summary generation
- ✅ Config-driven columns and JIRA fields: `releaseVersionsColumnsConfig.json`, `jiraFieldsConfig.json`, `allowedUsers.json`

### 1.1.0 – Generic Emailer
- ✅ **Generic Emailer** page (`/generic-emailer`): JQL fetch (up to 500 issues), column selection (only fields with data), 3-column layout, drag-and-drop reorder, × to remove column, subject + body (rich text), optional To/CC and project team from config
- ✅ APIs: `POST /api/jira/search-by-jql`, `POST /api/email/send-generic-reminder`, `GET /api/config/generic-emailer`
- ✅ CC: normalized defaultCC and sender CC (Nutanix email); escape table-breaking HTML in email cells so Jira text doesn’t break the table
- ✅ Jira rich text in email: wiki markup and ADF converted to HTML in table cells
- ✅ Email: subject always appended with date; tighter spacing, viewport max-width, table-wrap; empty cells show N/A
- ✅ Sprint/agile fields in `jiraFieldsConfig.json`; `genericEmailerCCConfig.json` for Generic Emailer CC
- ✅ Fetch and Send Email buttons side-by-side; client proxy to port 6001
- ✅ **Refactored structure**: Email routes under `server/routes/email/`, JIRA routes under `server/routes/jira/`; EmailSender component in `client/src/components/EmailSender/`; shared `OutlookFallback.js`. See [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md).
