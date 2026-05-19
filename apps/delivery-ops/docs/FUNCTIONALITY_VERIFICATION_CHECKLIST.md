# Functionality Verification Checklist

This document serves as a comprehensive checklist to verify all user-requested functionality remains intact after refactoring. Each item must be tested and verified after each refactoring step.

## Release Versions Tab Features

### Version Selection
- [ ] Default version (NDB-2.11) displays as read-only input field initially
- [ ] Default version is styled with gray background (`#f8f9fa`) and `cursor: not-allowed`
- [ ] After clicking "Refresh Versions" button, input converts to dropdown
- [ ] Dropdown shows all fetched release versions
- [ ] Selected version persists when switching between versions
- [ ] Version selection triggers item fetching automatically

### Data Fetching
- [ ] "Refresh Versions" button fetches release versions from `/api/jira/release-versions`
- [ ] "Fetch Items" button triggers three API calls:
  - `/api/jira/release-items-commit` (Section 1: Commit)
  - `/api/jira/release-items-long-term` (Section 2: Long-term-funded)
  - `/api/jira/release-items-history` (Checkpoint history)
- [ ] Loading states display correctly during fetching
- [ ] Error messages display correctly on API failures
- [ ] History endpoint includes FEAT items (no project filter)

### Table Display - Section 1: Commit
- [ ] Table displays items with fixVersion matching selected version
- [ ] Section header shows "Section 1: Commit" with item count
- [ ] All columns render correctly based on `includeInUI` flag in config
- [ ] Table is sortable and maintains sort state

### Table Display - Section 2: Long-term-funded
- [ ] Table displays items with `{version}-long-term-funded` label
- [ ] Section header shows "Section 2: Long-term-funded" with item count
- [ ] All columns render correctly based on `includeInUI` flag in config
- [ ] Table is sortable and maintains sort state

### Column Configuration
- [ ] Column visibility controlled by `includeInUI` flag in `releaseVersionsColumnsConfig.json`
- [ ] Column order follows `columnOrder` array in config
- [ ] Column labels use `label` from config
- [ ] Column widths use `width` from config
- [ ] Config fetched from `/api/config/release-versions-columns` on component mount

### Table Columns - Individual Column Verification

#### Key Column
- [ ] JIRA keys display correctly (e.g., FEAT-16821, ERA-31655)
- [ ] Keys are clickable hyperlinks
- [ ] Links open in new tab
- [ ] Links point to correct JIRA ticket URL

#### Summary Column
- [ ] Summary text displays correctly
- [ ] Long summaries truncate or wrap appropriately

#### Status Column
- [ ] Status values display correctly (e.g., "In Progress", "Done")

#### Assignee Column
- [ ] Assignee displays as string (displayName, name, or emailAddress)
- [ ] Shows "N/A" when assignee is null/undefined
- [ ] Handles JIRA user objects correctly (extracts string value)

#### QA Contact Column
- [ ] QA Contact displays as string (from customfield_10860)
- [ ] Shows "N/A" when QA Contact is null/undefined
- [ ] Handles JIRA user objects correctly (extracts string value)
- [ ] Column visible in UI when `includeInUI: true`

#### Checkpoint Dates Column
- [ ] All five checkpoint dates display:
  - FS/DS Done (customfield_13861)
  - Test Plan (customfield_11068)
  - Code Complete (customfield_11067)
  - Commit Gate (customfield_35863)
  - Promotion Gate (customfield_35864)
- [ ] Dates formatted as `dd/MMM/yyyy` (e.g., 29/Jan/2026)
- [ ] Day is zero-padded (e.g., 01/Jan/2026, not 1/Jan/2026)
- [ ] Current dates (on time) display in green color
- [ ] Current dates (delayed) display in red color
- [ ] Historical dates display with strikethrough
- [ ] Historical dates shown as: `30/Jan/2026→20/Jan/2026→15/Jan/2026`
- [ ] Delay calculation displays correctly:
  - Days format (≤3 days): "2 days late"
  - Half-weeks format (>3 days): "1.5 weeks late"
- [ ] Extension label highlighting:
  - Code Complete dates with extension labels have colored background (single color for all)
  - Pattern: `<release>-<ddmmyyyy>-code-complete-extention-recieved`
  - Visual indicator shows when project has taken multiple exceptions
- [ ] Extension color takes precedence over other highlight styles

#### Status Update Column
- [ ] Full content from customfield_23073 displays correctly
- [ ] JIRA wiki markup renders as HTML
- [ ] Links and formatting preserved

#### Risk Indicator Column
- [ ] Risk indicator displays correctly (from customfield_23560)
- [ ] Center-aligned in cell
- [ ] Shows "N/A" when risk indicator is null/undefined

#### Executive Summary Column
- [ ] Extracted content from customfield_23073 displays correctly
- [ ] No background color difference from other columns
- [ ] JIRA wiki markup renders as HTML

#### Status Update Date Column
- [ ] Date from customfield_45660 displays correctly
- [ ] Formatted as `dd/MMM/yyyy`
- [ ] Shows "N/A" when date is null/undefined
- [ ] Always shows current JIRA field value (NOT from history)

### Table Styling
- [ ] All header cells (`<th>`) are left-aligned (`textAlign: 'left'`)
- [ ] All body cells (`<td>`) are left-aligned (`textAlign: 'left'`)
- [ ] All body cells are top-aligned (`verticalAlign: 'top'`)
- [ ] Table has consistent spacing and borders
- [ ] Table is responsive and scrollable if needed

## Gantt Chart Features

### Timeline Configuration
- [ ] Gantt config fetched from `/api/config/release-versions` on version selection
- [ ] Sprint dates loaded from static config (not calculated dynamically)
- [ ] EC date (Early Commitment) used as timeline start
- [ ] Last GA date used as timeline end
- [ ] Timeline width calculated correctly

### Timeline Bar
- [ ] Timeline bar starts at EC date (left: 0%)
- [ ] Timeline bar has no black border
- [ ] Timeline bar has no vertical date markers
- [ ] Timeline bar has no sprint interval markers
- [ ] Timeline bar has no gate date markers
- [ ] Timeline bar has no monthly date labels

### Code Complete Bar
- [ ] Purple horizontal bar (`#9370DB`) displays from EC to current Code Complete date
- [ ] Bar only displays if Code Complete date exists
- [ ] Bar width calculated correctly based on date position
- [ ] Bar does not exceed timeline window (EC to last GA)

### Historical Code Complete Markers
- [ ] Small vertical purple bars (`#9370DB`) display on main bar for historical Code Complete dates
- [ ] Historical markers are slightly higher in height than main bar
- [ ] Historical markers positioned correctly on timeline
- [ ] Historical dates fetched from checkpoint history endpoint
- [ ] Historical dates exclude current date for each checkpoint field
- [ ] Historical markers show for all 5 checkpoint date fields:
  - FS/DS Done (customfield_13861)
  - Test Plan (customfield_11068)
  - Code Complete (customfield_11067)
  - Commit Gate (customfield_35863)
  - Promotion Gate (customfield_35864)

### JIRA Key Links in Gantt
- [ ] JIRA keys in Gantt chart are clickable hyperlinks
- [ ] Links open in new tab
- [ ] Links point to correct JIRA ticket URL

## Email Generation Features

### Email Form UI
- [ ] Email recipients input field accepts semicolon-separated values
- [ ] Email recipients field styled consistently with other inputs
- [ ] Rich text editor (ReactQuill) used for:
  - Highlights
  - Lowlights
  - Call to Action
- [ ] Rich text editor toolbar includes: headers, bold, italic, lists, links, clean
- [ ] Notes sections order: Highlights first, then Lowlights, then Call to Action
- [ ] "Send Email" button styled consistently (`#28a745` background)
- [ ] Loading state displays during email sending
- [ ] Success message displays after successful send
- [ ] Error message displays on send failure

### Email Content - Table
- [ ] Email table matches UI table (same columns, same data)
- [ ] Column visibility respects `includeInEmail` flag from config
- [ ] Table includes Section 1: Commit with item count
- [ ] Table includes Section 2: Long-term-funded with item count
- [ ] All columns from config render correctly:
  - Key (with hyperlinks)
  - Summary
  - Status
  - Priority (if `includeInEmail: true`)
  - Fix Version (if `includeInEmail: true`)
  - Assignee (as string)
  - QA Contact (as string, if `includeInEmail: true`)
  - TPM Owner (as string, if `includeInEmail: true`)
  - Checkpoint Dates (with formatting)
  - Status Update (full content)
  - Risk Indicator
  - Executive Summary (extracted content)
  - Status Update Date

### Email Content - Date Formatting
- [ ] Dates formatted as `dd/MMM/yyyy` (e.g., 29/Jan/2026)
- [ ] Day is zero-padded
- [ ] Current dates (on time) display in green color
- [ ] Current dates (delayed) display in red color
- [ ] Historical dates display with strikethrough
- [ ] Historical dates shown as: `30/Jan/2026→20/Jan/2026→15/Jan/2026`
- [ ] Delay calculation displays correctly (days or half-weeks)
- [ ] Extension label highlighting works (colored backgrounds)

### Email Content - User Fields
- [ ] Assignee displays as string in email
- [ ] QA Contact displays as string in email
- [ ] TPM Owner displays as string in email
- [ ] All user fields show "N/A" when null/undefined

### Email Content - Notes
- [ ] Highlights section included in email body
- [ ] Lowlights section included in email body
- [ ] Call to Action section included in email body
- [ ] Notes order: Highlights first, then Lowlights, then Call to Action
- [ ] Notes formatted correctly (handles Quill HTML)
- [ ] Notes formatted correctly (handles JIRA wiki markup)
- [ ] Notes styled consistently (monochrome look)

### Email Content - Legend
- [ ] Legend section included in email
- [ ] Legend explains date colors (green = on time, red = delayed, strikethrough = historical)
- [ ] Legend explains delay calculation format
- [ ] Legend explains extension label highlighting

### Email Content - Exclusions
- [ ] Gantt chart included in email as SVG
- [ ] Gantt chart shows timeline from EC to last GA date
- [ ] Gantt chart displays Code Complete bars for committed projects
- [ ] Gantt chart includes EC, GA, and gate markers
- [ ] Only table, notes, and legend included

### Email Generation - Backend
- [ ] `/api/email/send-release-versions` endpoint accepts:
  - `tableHTML` (generated by frontend)
  - `selectedVersion`
  - `highlights`
  - `lowlights`
  - `callToAction`
  - `emailRecipients` (semicolon-separated)
- [ ] Backend wraps `tableHTML` with:
  - Version header
  - Notes sections
  - Legend
- [ ] Email sent successfully via Nodemailer
- [ ] Email recipients parsed correctly (semicolon-separated to array)
- [ ] Email subject includes version name

## Backend API Features

### Release Versions Endpoint
- [ ] `/api/jira/release-versions` returns array of version objects
- [ ] Response includes `success: true` and `versions: [...]`
- [ ] Versions filtered to open/unreleased only
- [ ] Versions sorted correctly

### Release Items Endpoints
- [ ] `/api/jira/release-items-commit` returns items with matching fixVersion
- [ ] `/api/jira/release-items-long-term` returns items with long-term-funded label
- [ ] Both endpoints return:
  - `success: true`
  - `data: { items: [...] }`
- [ ] Items include all required fields:
  - key, summary, status, priority, fixVersion
  - assignee (as string)
  - customfield_10860 (QA Contact, as string)
  - customfield_27764 (TPM Owner, as string)
  - customfield_11067 (Code Complete)
  - customfield_13861 (FS/DS Done)
  - customfield_11068 (Test Plan)
  - customfield_35863 (Commit Gate)
  - customfield_35864 (Promotion Gate)
  - customfield_23073 (Status Update)
  - customfield_23560 (Risk Indicator)
  - customfield_45660 (Status Update Date)
  - labels (as array)

### History Endpoint
- [ ] `/api/jira/release-items-history` returns checkpoint history
- [ ] Response includes `success: true` and `data: { history: {...} }`
- [ ] History includes items from ANY JIRA project (no project filter restrictions)
- [ ] History structure: `{ "FEAT-16821": { codeComplete: [...], ... }, ... }`
- [ ] History includes all 5 checkpoint fields

### Column Config Endpoint
- [ ] `/api/config/release-versions-columns` returns column configuration
- [ ] Response includes:
  - `columns: {...}` (column definitions)
  - `columnOrder: [...]` (column order array)
  - `defaultReleaseVersion: "NDB-2.11"`
- [ ] Config loaded from `server/config/releaseVersionsColumnsConfig.json`

### Email Endpoint
- [ ] `/api/email/send-release-versions` accepts POST request
- [ ] Endpoint validates required fields
- [ ] Endpoint wraps `tableHTML` with notes and legend
- [ ] Endpoint sends email via Nodemailer
- [ ] Endpoint returns success/error response

### User Field Extraction
- [ ] `extractUserName()` function handles:
  - String values (returns as-is)
  - JIRA user objects (extracts displayName, name, or emailAddress)
  - Null/undefined (returns "N/A")
- [ ] All user fields extracted consistently:
  - `assignee` → string
  - `customfield_10860` (QA Contact) → string
  - `customfield_27764` (TPM Owner) → string

## Configuration Files

### releaseVersionsColumnsConfig.json
- [ ] File exists at `server/config/releaseVersionsColumnsConfig.json`
- [ ] Contains `columns` object with all column definitions
- [ ] Each column has: `label`, `includeInUI`, `includeInEmail`, `order`, `width`
- [ ] Contains `columnOrder` array
- [ ] Contains `defaultReleaseVersion: "NDB-2.11"`

### releaseVersionsEmailConfig.json
- [ ] File exists at `server/config/releaseVersionsEmailConfig.json`
- [ ] Contains `sprintDates` array with static dates
- [ ] Contains `emailNotes` configuration with correct order

## Error Handling

### Frontend Errors
- [ ] API errors display user-friendly error messages
- [ ] Network errors handled gracefully
- [ ] Loading states prevent duplicate requests
- [ ] Error boundaries catch React errors

### Backend Errors
- [ ] API endpoints return consistent error format: `{ success: false, error: "..." }`
- [ ] JIRA API errors handled gracefully
- [ ] Rate limiting errors return appropriate messages
- [ ] Validation errors return 400 status with clear messages

## Performance

### Frontend Performance
- [ ] Page loads in reasonable time (<3 seconds)
- [ ] Table renders efficiently with large datasets
- [ ] Gantt chart renders without lag
- [ ] No unnecessary re-renders

### Backend Performance
- [ ] API endpoints respond in reasonable time (<5 seconds)
- [ ] JIRA API calls use retry logic for rate limiting
- [ ] Concurrent requests handled correctly
- [ ] No memory leaks

## Browser Compatibility

- [ ] Works in Chrome (latest)
- [ ] Works in Firefox (latest)
- [ ] Works in Safari (latest)
- [ ] Works in Edge (latest)

## Accessibility

- [ ] All interactive elements keyboard accessible
- [ ] Form labels associated with inputs
- [ ] Error messages announced to screen readers
- [ ] Color contrast meets WCAG standards

---

## Verification Process

After each refactoring step:
1. Run through this checklist
2. Mark items as verified or note any issues
3. Document any discrepancies
4. Fix issues before proceeding to next refactoring step

## Notes

- All functionality must work identically after refactoring
- Any logic rewrites must maintain external behavior
- Performance should not degrade
- Code should follow best practices (SRP, DRY, Separation of Concerns)

