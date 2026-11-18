# Requirements Document

## 1. Introduction

### 1.1 Purpose
This document defines the functional and non-functional requirements for the NDB Status Update Sender application. The application provides two main features:
1. **Email Sender**: Extract Confluence page contents and send status update emails with JIRA integration
2. **Release Versions**: View and manage release version data with Gantt chart visualization and email reporting

### 1.2 Scope
This document covers all features, user interactions, API endpoints, data flows, and system behaviors for both Email Sender and Release Versions functionality.

### 1.3 Definitions and Acronyms
- **JIRA**: Issue tracking and project management tool
- **Confluence**: Documentation and collaboration platform
- **FEAT**: Feature project in JIRA (Project = FEAT, IssueType in (Feature, X-FEAT))
  - Tickets can be parents to any JIRA project ticket (cross-project parent relationships)
- **ERA**: ERA project in JIRA (Project = ERA, any issue type except Feature)
  - Includes Initiative, Epic, Capability, Task, Story, Bug, etc.
- **EC**: Early Commitment date
- **GA**: General Availability date
- **PAT**: Personal Access Token
- **API**: Application Programming Interface
- **UI**: User Interface
- **E2E**: End-to-End

## 2. System Overview

### 2.1 Architecture
The application follows a client-server architecture:
- **Frontend**: React.js single-page application
- **Backend**: Node.js/Express REST API server
- **Authentication**: JIRA token-based authentication
- **Data Source**: JIRA API and Confluence API
- **Email Service**: Nodemailer with SMTP

### 2.2 Deployment Options
The application supports two deployment modes controlled by feature flag `REACT_APP_ENABLE_RELEASE_VERSIONS`:
- **Email Sender Only**: Default for production, includes only Email Sender functionality
- **Full Deployment**: Includes both Email Sender and Release Versions pages

## 3. Functional Requirements

### 3.1 Authentication and Authorization

#### 3.1.1 User Authentication
- **REQ-AUTH-001**: Users must authenticate using JIRA credentials (email/username and Personal Access Token)
- **REQ-AUTH-002**: Authentication credentials are stored in browser localStorage (session-based)
- **REQ-AUTH-003**: System validates JIRA token by calling JIRA API `/rest/api/2/myself` endpoint
- **REQ-AUTH-004**: Username format is normalized (e.g., `namratha.singh` or `namratha.singh@nutanix.com`)
- **REQ-AUTH-005**: Upon successful authentication, user is redirected to the main application

#### 3.1.2 Authorization
- **REQ-AUTH-006**: Email Sender page (`/`) is accessible to all authenticated users
- **REQ-AUTH-007**: Release Versions page (`/all-status`) is accessible only to authorized users (configurable via `allowedUsers.json`)
- **REQ-AUTH-008**: Default authorized user for Release Versions: `namratha.singh`
- **REQ-AUTH-009**: Unauthorized users attempting to access Release Versions are redirected to Email Sender page

### 3.2 Email Sender Feature

#### 3.2.1 Confluence Integration
- **REQ-EMAIL-001**: User can input Confluence page URL (full URL or relative path)
- **REQ-EMAIL-002**: Supported URL formats:
  - Full URL: `https://confluence.eng.nutanix.com:8443/pages/viewpage.action?pageId=123456`
  - Full URL: `https://confluence.eng.nutanix.com:8443/pages/viewinfo.action?pageId=123456`
  - Full URL: `https://confluence.eng.nutanix.com:8443/spaces/SPACE/pages/123456/Page+Title`
  - Relative: `/pages/viewpage.action?pageId=123456`
  - Relative: `/pages/viewinfo.action?pageId=123456`
  - Relative: `/spaces/SPACE/pages/123456/Page+Title`
- **REQ-EMAIL-003**: System uses base Confluence URL from `server/config/confluenceConfig.json` for relative paths
- **REQ-EMAIL-004**: "Extract Content" button fetches Confluence page content via Confluence API
- **REQ-EMAIL-005**: Extracted content displays in a read-only text area
- **REQ-EMAIL-006**: System handles Confluence API errors gracefully with user-friendly error messages

#### 3.2.2 Email Composition
- **REQ-EMAIL-007**: User must provide Executive Summary (required field)
- **REQ-EMAIL-008**: User can provide Additional Details using rich text editor (ReactQuill)
- **REQ-EMAIL-009**: Rich text editor supports:
  - Headers (H1, H2, H3)
  - Bold, italic, underline, strikethrough
  - Ordered and unordered lists
  - Links
  - Clean formatting
- **REQ-EMAIL-010**: User can input email recipients separated by semicolons (`;`) - e.g., `user1@nutanix.com; user2@nutanix.com`
- **REQ-EMAIL-011**: System validates email recipient format (username or email)
- **REQ-EMAIL-012**: System normalizes usernames to email format (`username@nutanix.com`)
- **REQ-EMAIL-013**: User can optionally provide email subject
- **REQ-EMAIL-014**: User can optionally provide JIRA key for ticket integration

#### 3.2.3 JIRA Integration (Email Sender)
- **REQ-EMAIL-015**: User can validate JIRA key before sending email
- **REQ-EMAIL-016**: "Validate JIRA Key" button calls `/api/jira/fetch` endpoint
- **REQ-EMAIL-017**: System displays validation status (valid/invalid)
- **REQ-EMAIL-018**: User can fetch JIRA ticket data using "Fetch JIRA Data" button
- **REQ-EMAIL-019**: Fetched JIRA data includes:
  - Ticket key, summary, status, priority
  - Assignee, reporter
  - Description (with JIRA wiki markup)
  - Custom fields
- **REQ-EMAIL-020**: User can fetch all related JIRA tickets (Features/Initiatives, Epics, and other issues) for Feature/Initiative/X-FEAT/Capability tickets
- **REQ-EMAIL-021**: "Fetch Epics" button calls `/api/jira/fetch-all-jira-tickets` endpoint (endpoint renamed from `/api/jira/fetch-epics`)
- **REQ-EMAIL-022**: Endpoint returns hierarchical structure:
  - **Features/Initiatives**: Based on main ticket type and Parent Link relationships
    - For X-FEAT/Capability: Returns Features/Initiatives where Parent Link = main ticket
    - For Feature/Initiative: Returns all related Features/Initiatives (includes main ticket)
  - **Epics**: Epic issue type tickets (IssueType = Epic) linked to Features/Initiatives via Parent Link (customfield_20363)
  - **Issue Breakdown**: Statistics for other issue types (excluding Feature/Epic/Initiative/X-FEAT/Capability)
    - Grouped by issue type and status
    - Overall completion statistics (Done, In Progress, To Do, Blocked, Other)
  - **Note**: Uses comprehensive JQL queries with `portfolioChildrenOf`, `linkedIssuesOf`, `issuesInEpics`, `subtasksOf` functions to find all related issues
- **REQ-EMAIL-023**: JIRA wiki markup is converted to HTML for display and email

#### 3.2.4 Email Sending
- **REQ-EMAIL-024**: "Send Email" button sends email via `/api/email/send` endpoint
- **REQ-EMAIL-025**: Email includes:
  - Executive Summary
  - Additional Details (formatted HTML)
  - JIRA ticket data (if provided)
  - Epic information (if provided)
  - Issue breakdown (if provided)
- **REQ-EMAIL-026**: Email is sent to recipients specified in "To" field
- **REQ-EMAIL-027**: `namratha.singh@nutanix.com` is automatically added to CC
- **REQ-EMAIL-028**: Default email lists can be configured via `server/config/emailConfig.json`
- **REQ-EMAIL-029**: System displays success message after successful send
- **REQ-EMAIL-030**: System displays error message on send failure
- **REQ-EMAIL-031**: Form is cleared automatically 2 seconds after successful send
- **REQ-EMAIL-032**: User can optionally attach PDF (if JIRA data is fetched)

#### 3.2.5 Form Management
- **REQ-EMAIL-033**: "Clear All" button resets all form fields
- **REQ-EMAIL-034**: Cleared fields include:
  - Executive Summary
  - Additional Details
  - Email Recipients
  - Email Subject
  - JIRA Key
  - JIRA Data
  - Epic Data
  - Issue Breakdown

### 3.3 Release Versions Feature

#### 3.3.1 Version Selection
- **REQ-RELEASE-001**: Default release version is `NDB-2.11` (configurable in `releaseVersionsColumnsConfig.json` as `defaultReleaseVersion`)
- **REQ-RELEASE-002**: Default version displays as read-only input field initially
- **REQ-RELEASE-003**: Read-only input has gray background (`#f8f9fa`) and `cursor: not-allowed`
- **REQ-RELEASE-004**: "Refresh Versions" button fetches release versions from `/api/jira/release-versions`
- **REQ-RELEASE-005**: After fetching versions, input converts to dropdown
- **REQ-RELEASE-006**: Dropdown displays all open/unreleased versions from ERA project (versions are project-level, not issue-level)
- **REQ-RELEASE-007**: Versions are sorted appropriately
- **REQ-RELEASE-008**: On component mount, default release version from config is automatically selected and items are auto-fetched
- **REQ-RELEASE-008A**: User can still manually change version via dropdown (after clicking "Refresh Versions") and fetch items

#### 3.3.2 Data Fetching
- **REQ-RELEASE-009**: "Fetch Items" button triggers three API calls:
  - `/api/jira/release-items-commit` (Section 1: Commit items)
  - `/api/jira/release-items-long-term` (Section 2: Long-term-funded items)
  - `/api/jira/release-items-history` (Checkpoint history)
- **REQ-RELEASE-010**: Section 1 includes items with `fixVersion` matching selected version (items can be from ANY JIRA project, with IssueType in (Feature, Initiative))
  - Not restricted to FEAT or ERA projects
  - Common sources: FEAT (Feature, X-FEAT), ERA (Initiative, Epic, Capability, etc. - but NOT Feature)
- **REQ-RELEASE-011**: Section 2 includes items with `{version}-long-term-funded` label (items can be from ANY JIRA project, with IssueType in (Feature, Initiative))
  - Not restricted to FEAT or ERA projects
  - Common sources: FEAT (Feature, X-FEAT), ERA (Initiative, Epic, Capability, etc. - but NOT Feature)
- **REQ-RELEASE-012**: History endpoint includes items from ANY JIRA project (no project filter restrictions)
- **REQ-RELEASE-013**: Loading states display during API calls
- **REQ-RELEASE-014**: Error messages display on API failures
- **REQ-RELEASE-015**: Items are sorted by key (ascending)

#### 3.3.3 Table Display
- **REQ-RELEASE-016**: Two separate tables display:
  - Section 1: Commit (with item count)
  - Section 2: Long-term-funded (with item count)
- **REQ-RELEASE-017**: Column visibility controlled by `includeInUI` flag in `releaseVersionsColumnsConfig.json`
- **REQ-RELEASE-018**: Column order follows `columnOrder` array in config
- **REQ-RELEASE-019**: Column labels use `label` from config
- **REQ-RELEASE-020**: Column widths use `width` from config
- **REQ-RELEASE-021**: Config fetched from `/api/config/release-versions-columns` on component mount
- **REQ-RELEASE-022**: All header cells (`<th>`) are left-aligned
- **REQ-RELEASE-023**: All body cells (`<td>`) are left-aligned and top-aligned
- **REQ-RELEASE-024**: Table is responsive and scrollable if needed

#### 3.3.4 Table Columns

##### Key Column
- **REQ-RELEASE-025**: JIRA keys display correctly (e.g., FEAT-16821, ERA-31655)
- **REQ-RELEASE-026**: Keys are clickable hyperlinks
- **REQ-RELEASE-027**: Links open in new tab
- **REQ-RELEASE-028**: Links point to correct JIRA ticket URL

##### Summary Column
- **REQ-RELEASE-029**: Summary text displays correctly
- **REQ-RELEASE-030**: Long summaries truncate or wrap appropriately

##### Status Column
- **REQ-RELEASE-031**: Status values display correctly (e.g., "In Progress", "Done")

##### Assignee Column
- **REQ-RELEASE-032**: Assignee displays as string (displayName, name, or emailAddress)
- **REQ-RELEASE-033**: Shows "N/A" when assignee is null/undefined
- **REQ-RELEASE-034**: Handles JIRA user objects correctly (extracts string value)

##### QA Contact Column
- **REQ-RELEASE-035**: QA Contact displays as string (from customfield_10860)
- **REQ-RELEASE-036**: Shows "N/A" when QA Contact is null/undefined
- **REQ-RELEASE-037**: Handles JIRA user objects correctly (extracts string value)
- **REQ-RELEASE-038**: Column visible in UI when `includeInUI: true`

##### Checkpoint Dates Column
- **REQ-RELEASE-039**: All five checkpoint dates display:
  - FS/DS Done (customfield_13861)
  - Test Plan (customfield_11068)
  - Code Complete (customfield_11067)
  - Commit Gate (customfield_35863)
  - Promotion Gate (customfield_35864)
- **REQ-RELEASE-040**: Dates formatted as `dd/MMM/yyyy` (e.g., 29/Jan/2026)
- **REQ-RELEASE-041**: Day is zero-padded (e.g., 01/Jan/2026, not 1/Jan/2026)
- **REQ-RELEASE-042**: Current dates (on time) display in green color
- **REQ-RELEASE-043**: Current dates (delayed) display in red color
- **REQ-RELEASE-044**: Historical dates display with strikethrough
- **REQ-RELEASE-045**: Historical dates shown as: `30/Jan/2026→20/Jan/2026→15/Jan/2026`
- **REQ-RELEASE-046**: Delay calculation displays correctly:
  - Days format (≤3 days): "2 days late"
  - Half-weeks format (>3 days): "1.5 weeks late"
- **REQ-RELEASE-047**: Extension label highlighting:
  - Code Complete dates with extension labels have colored background (single color for all)
  - Pattern: `<release>-<ddmmyyyy>-code-complete-extention-recieved`
  - Visual indicator shows when project has taken multiple exceptions
- **REQ-RELEASE-048**: Extension color takes precedence over other highlight styles

##### Status Update Column
- **REQ-RELEASE-049**: Direct fetch from JIRA customfield_23073 displays correctly (formatType: "full")
- **REQ-RELEASE-050**: JIRA wiki markup renders as HTML
- **REQ-RELEASE-051**: Links and formatting preserved
- **Note**: Status Update shows the raw, unmodified content directly fetched from JIRA customfield_23073

##### Risk Indicator Column
- **REQ-RELEASE-052**: Risk indicator displays correctly (from customfield_23560)
- **REQ-RELEASE-053**: Center-aligned in cell
- **REQ-RELEASE-054**: Shows "N/A" when risk indicator is null/undefined

##### Executive Summary Column
- **REQ-RELEASE-055**: Inferred/extracted content from customfield_23073 displays correctly (formatType: "extracted")
- **REQ-RELEASE-056**: No background color difference from other columns
- **REQ-RELEASE-057**: JIRA wiki markup renders as HTML
- **Note**: Executive Summary shows processed/inferred content extracted by the system from the same customfield_23073 field. This is an inference made by the system to present a summary to the user, not a direct JIRA field value.

##### Status Update Date Column
- **REQ-RELEASE-058**: Date from customfield_45660 displays correctly
- **REQ-RELEASE-059**: Formatted as `dd/MMM/yyyy`
- **REQ-RELEASE-060**: Shows "N/A" when date is null/undefined
- **REQ-RELEASE-060A**: Always shows current JIRA field value (NOT from history)

#### 3.3.5 Gantt Chart
- **REQ-RELEASE-061**: Gantt config fetched from `/api/config/release-versions` on version selection
- **REQ-RELEASE-062**: Sprint dates loaded from static config (not calculated dynamically)
- **REQ-RELEASE-063**: EC date (Early Commitment) used as timeline start
- **REQ-RELEASE-064**: Last GA date used as timeline end
- **REQ-RELEASE-065**: Timeline width calculated correctly
- **REQ-RELEASE-066**: Timeline bar starts at EC date (left: 0%)
- **REQ-RELEASE-067**: Timeline bar has no black border
- **REQ-RELEASE-068**: Timeline bar has no vertical date markers
- **REQ-RELEASE-069**: Timeline bar has no sprint interval markers
- **REQ-RELEASE-070**: Timeline bar has no gate date markers
- **REQ-RELEASE-071**: Timeline bar has no monthly date labels
- **REQ-RELEASE-072**: Purple horizontal bar (`#9370DB`) displays from EC to current Code Complete date
- **REQ-RELEASE-073**: Bar only displays if Code Complete date exists
- **REQ-RELEASE-074**: Bar width calculated correctly based on date position
- **REQ-RELEASE-075**: Bar does not exceed timeline window (EC to last GA)
- **REQ-RELEASE-076**: Small vertical purple bars (`#9370DB`) display on main bar for historical Code Complete dates
- **REQ-RELEASE-077**: Historical markers are slightly higher in height than main bar
- **REQ-RELEASE-078**: Historical markers positioned correctly on timeline
- **REQ-RELEASE-079**: Historical dates fetched from checkpoint history endpoint. ALL historical dates must be fetched, including paginated changelog entries (when `changelog.total > changelog.histories.length`)
- **REQ-RELEASE-080**: Historical dates exclude current date for each checkpoint field
- **REQ-RELEASE-081**: Historical markers show for all 5 checkpoint date fields:
  - FS/DS Done (customfield_13861)
  - Test Plan (customfield_11068)
  - Code Complete (customfield_11067)
  - Commit Gate (customfield_35863)
  - Promotion Gate (customfield_35864)
- **REQ-RELEASE-082**: JIRA keys in Gantt chart are clickable hyperlinks
- **REQ-RELEASE-083**: Links open in new tab
- **REQ-RELEASE-084**: Links point to correct JIRA ticket URL

#### 3.3.6 Email Generation (Release Versions)
- **REQ-RELEASE-085**: Email recipients input field accepts semicolon-separated values (`;`) - e.g., `user1@nutanix.com; user2@nutanix.com`
- **Note**: Both Email Sender and Release Versions use the same semicolon-separated format for consistency
- **REQ-RELEASE-086**: Rich text editor (ReactQuill) used for:
  - Highlights
  - Lowlights
  - Call to Action
- **REQ-RELEASE-087**: Rich text editor toolbar includes: headers, bold, italic, lists, links, clean
- **REQ-RELEASE-088**: Notes sections order: Highlights first, then Lowlights, then Call to Action
- **REQ-RELEASE-089**: "Send Email" button sends email via `/api/email/send-release-versions` endpoint
- **REQ-RELEASE-090**: Frontend generates table HTML using `generateTableHTMLForEmail` function
- **REQ-RELEASE-091**: Backend wraps table HTML with version header, notes, and legend
- **REQ-RELEASE-092**: Email table matches UI table (same columns, same data)
- **REQ-RELEASE-093**: Column visibility respects `includeInEmail` flag from config
- **REQ-RELEASE-094**: Email includes Section 1: Commit with item count
- **REQ-RELEASE-095**: Email includes Section 2: Long-term-funded with item count
- **REQ-RELEASE-096**: All columns from config render correctly in email
- **REQ-RELEASE-097**: Dates formatted identically in email (green/red/strikethrough, delay calculation)
- **REQ-RELEASE-098**: Extension label highlighting works in email (colored backgrounds)
- **REQ-RELEASE-099**: User fields display as strings in email
- **REQ-RELEASE-100**: Highlights section included in email body
- **REQ-RELEASE-101**: Lowlights section included in email body
- **REQ-RELEASE-102**: Call to Action section included in email body
- **REQ-RELEASE-103**: Notes formatted correctly (handles Quill HTML and JIRA wiki markup)
- **REQ-RELEASE-104**: Legend section included in email
- **REQ-RELEASE-105**: Legend explains date colors, delay calculation, and extension highlighting
- **REQ-RELEASE-106**: Gantt chart included in email as SVG visualization
- **REQ-RELEASE-106A**: Gantt chart shows timeline from EC to last GA date
- **REQ-RELEASE-106B**: Gantt chart displays Code Complete bars for committed projects
- **REQ-RELEASE-106C**: Gantt chart includes EC, GA, and gate markers (CCM, Commit Gate, Promotion Gate)
- **REQ-RELEASE-107**: Email sent successfully via Nodemailer
- **REQ-RELEASE-108**: Email recipients parsed correctly (semicolon-separated to array)
- **REQ-RELEASE-109**: Email subject includes version name
- **REQ-RELEASE-110**: Success message displays after successful send
- **REQ-RELEASE-111**: Error message displays on send failure

### 3.4 Backend API Requirements

#### 3.4.1 JIRA Endpoints
- **REQ-API-001**: `/api/jira/release-versions` returns array of open/unreleased versions from ERA project
- **REQ-API-002**: `/api/jira/release-items-commit` returns items with matching fixVersion from ANY JIRA project
  - Not restricted to FEAT or ERA projects
  - Common sources: FEAT (Feature, X-FEAT), ERA (Initiative, Epic, Capability, etc. - but NOT Feature)
- **REQ-API-003**: `/api/jira/release-items-long-term` returns items with long-term-funded label from ANY JIRA project
  - Not restricted to FEAT or ERA projects
  - Common sources: FEAT (Feature, X-FEAT), ERA (Initiative, Epic, Capability, etc. - but NOT Feature)
- **REQ-API-004**: `/api/jira/release-items-history` returns checkpoint history for all items from ANY JIRA project
- **REQ-API-004A**: `/api/jira/release-items-history` must fetch all paginated changelog entries when `changelog.total > changelog.histories.length`
- **REQ-API-004B**: Pagination must use multiple strategies: `maxResults=total`, issue ID endpoint, or multiple expand calls
- **REQ-API-004C**: Pagination failures must be logged but not block data return (graceful degradation)
- **REQ-API-005**: History endpoint includes items from ANY JIRA project (no project filter restrictions)
- **REQ-API-006**: `/api/jira/fetch` returns JIRA ticket data
- **REQ-API-007**: `/api/jira/fetch-all-jira-tickets` (renamed from `/api/jira/fetch-epics`) returns hierarchical structure for Feature/Initiative/X-FEAT/Capability tickets:
  - Features/Initiatives with their linked Epics (Epic issue type)
  - Issue breakdown statistics for other issue types
  - Uses comprehensive JQL queries to find all related issues across projects
- **REQ-API-008**: All JIRA endpoints use Bearer token authentication
- **REQ-API-009**: All JIRA endpoints handle rate limiting with retry logic
- **REQ-API-010**: All JIRA endpoints return consistent error format

#### 3.4.2 Email Endpoints
- **REQ-API-011**: `/api/email/send` sends email with Confluence/JIRA content
- **REQ-API-012**: `/api/email/send-release-versions` sends email with release version table
- **REQ-API-013**: Email endpoints validate required fields
- **REQ-API-014**: Email endpoints return success/error response

#### 3.4.3 Config Endpoints
- **REQ-API-015**: `/api/config/release-versions-columns` returns column configuration
- **REQ-API-016**: `/api/config/release-versions` returns Gantt chart configuration
- **REQ-API-017**: Config endpoints return JSON from config files

#### 3.4.4 User Field Extraction
- **REQ-API-018**: `extractUserName()` function handles:
  - String values (returns as-is)
  - JIRA user objects (extracts displayName, name, or emailAddress)
  - Null/undefined (returns "N/A")
- **REQ-API-019**: All user fields extracted consistently:
  - `assignee` → string
  - `customfield_10860` (QA Contact) → string
  - `customfield_27764` (TPM Owner) → string

### 3.5 Configuration Requirements

#### 3.5.1 Column Configuration
- **REQ-CONFIG-001**: `releaseVersionsColumnsConfig.json` defines all column properties
- **REQ-CONFIG-002**: Each column has: `label`, `includeInUI`, `includeInEmail`, `order`, `width`
- **REQ-CONFIG-003**: Config includes `columnOrder` array
- **REQ-CONFIG-004**: Config includes `defaultReleaseVersion: "NDB-2.11"`

#### 3.5.2 Email Configuration
- **REQ-CONFIG-005**: `releaseVersionsEmailConfig.json` contains sprint dates array
- **REQ-CONFIG-006**: Config contains `emailNotes` configuration with correct order

#### 3.5.3 Email Lists Configuration
- **REQ-CONFIG-007**: `emailConfig.json` defines default CC and To email lists
- **REQ-CONFIG-008**: `namratha.singh@nutanix.com` automatically added to CC

## 4. Non-Functional Requirements

### 4.1 Performance
- **REQ-NFR-001**: Page loads in reasonable time (<3 seconds)
- **REQ-NFR-002**: Table renders efficiently with large datasets
- **REQ-NFR-003**: Gantt chart renders without lag
- **REQ-NFR-004**: API endpoints respond in reasonable time (<5 seconds)
- **REQ-NFR-005**: No unnecessary re-renders in React components

### 4.2 Security
- **REQ-NFR-006**: JIRA tokens stored securely in localStorage (not in code)
- **REQ-NFR-007**: API endpoints validate JIRA tokens
- **REQ-NFR-008**: Rate limiting implemented for API endpoints
- **REQ-NFR-009**: Input validation on all user inputs
- **REQ-NFR-010**: XSS prevention in HTML rendering

### 4.3 Usability
- **REQ-NFR-011**: User-friendly error messages
- **REQ-NFR-012**: Loading states during API calls
- **REQ-NFR-013**: Consistent UI styling across pages
- **REQ-NFR-014**: Responsive design for different screen sizes

### 4.4 Maintainability
- **REQ-NFR-015**: Code follows best practices (SRP, DRY, Separation of Concerns)
- **REQ-NFR-016**: Functions are well-documented with JSDoc
- **REQ-NFR-017**: Configuration externalized to JSON files
- **REQ-NFR-018**: Modular code structure

### 4.5 Reliability
- **REQ-NFR-019**: Graceful error handling
- **REQ-NFR-020**: Retry logic for JIRA API rate limiting
- **REQ-NFR-021**: Fallback values for missing data
- **REQ-NFR-022**: No memory leaks

### 4.6 Browser Compatibility
- **REQ-NFR-023**: Works in Chrome (latest)
- **REQ-NFR-024**: Works in Firefox (latest)
- **REQ-NFR-025**: Works in Safari (latest)
- **REQ-NFR-026**: Works in Edge (latest)

### 4.7 Accessibility
- **REQ-NFR-027**: All interactive elements keyboard accessible
- **REQ-NFR-028**: Form labels associated with inputs
- **REQ-NFR-029**: Error messages announced to screen readers
- **REQ-NFR-030**: Color contrast meets WCAG standards

## 5. User Stories

### 5.1 Email Sender User Stories

**US-EMAIL-001**: As a user, I want to extract Confluence page content so that I can include it in my status update email.

**US-EMAIL-002**: As a user, I want to compose an email with Executive Summary and Additional Details so that I can send comprehensive status updates.

**US-EMAIL-003**: As a user, I want to integrate JIRA ticket data into my email so that recipients have context about the work item.

**US-EMAIL-004**: As a user, I want to send emails to multiple recipients so that I can keep stakeholders informed.

**US-EMAIL-005**: As a user, I want to clear all form fields so that I can start a new email composition.

### 5.2 Release Versions User Stories

**US-RELEASE-001**: As a release manager, I want to view all items in a release version so that I can track progress.

**US-RELEASE-002**: As a release manager, I want to see checkpoint dates with historical changes so that I can identify delays.

**US-RELEASE-003**: As a release manager, I want to visualize timeline progress in a Gantt chart so that I can see at-a-glance status.

**US-RELEASE-004**: As a release manager, I want to send release status emails so that I can communicate progress to stakeholders.

**US-RELEASE-005**: As a release manager, I want to see extension dates highlighted so that I can quickly identify items that have been extended.

## 6. Acceptance Criteria

### 6.1 Email Sender Acceptance Criteria
- User can successfully authenticate with JIRA credentials
- User can extract Confluence page content
- User can compose and send email with all required fields
- Email is delivered to all recipients with correct content
- Form clears after successful send

### 6.2 Release Versions Acceptance Criteria
- User can select a release version and fetch items
- Table displays all items with correct column visibility
- Dates are formatted correctly with color coding
- Gantt chart displays timeline and Code Complete bar
- Email generation produces identical table to UI
- All user-requested functionality works as specified

## 7. Out of Scope

The following items are explicitly out of scope for this version:
- Real-time collaboration features
- Mobile app version
- Offline functionality
- Multi-language support
- Advanced analytics and reporting
- Integration with other tools beyond JIRA and Confluence

## 8. Dependencies

### 8.1 External Dependencies
- JIRA API (v2)
- Confluence API
- SMTP server for email delivery
- Node.js runtime environment
- React.js framework

### 8.2 Internal Dependencies
- Configuration files (JSON)
- Environment variables
- Browser localStorage

## 9. Assumptions

1. Users have valid JIRA Personal Access Tokens
2. Users have access to Confluence pages they want to extract
3. SMTP server is configured and accessible
4. JIRA and Confluence APIs are accessible from the server
5. Users are familiar with JIRA and Confluence concepts

## 10. Constraints

1. Application must work within browser security constraints
2. JIRA API rate limits must be respected
3. Email size limits must be considered
4. Browser compatibility requirements must be met
5. Configuration changes require server restart (for some configs)

## 11. Future Enhancements

Potential future enhancements (not in current scope):
- Real-time updates via WebSockets
- Advanced filtering and sorting options
- Export to PDF/Excel
- Customizable email templates
- Integration with Slack/Teams
- Automated scheduling of status emails
- Dashboard with metrics and charts

