# Test Plan Document

## 1. Introduction

### 1.1 Purpose
This document outlines the comprehensive testing strategy for the NDB Status Update Sender application. It covers unit testing, integration testing, and end-to-end (E2E) testing approaches to ensure all functionality works correctly and remains intact after refactoring.

### 1.2 Scope
This test plan covers:
- Email Sender functionality
- Release Versions functionality
- Gantt chart visualization
- JIRA integration
- Email generation and sending
- Authentication and authorization
- API endpoints
- Frontend components

### 1.3 Testing Objectives
- Verify all user-requested functionality works as specified
- Ensure no regressions after refactoring
- Validate data accuracy and formatting
- Test error handling and edge cases
- Verify security measures
- Validate performance requirements

## 2. Test Strategy

### 2.1 Testing Levels

#### 2.1.1 Unit Testing
- **Target**: Individual functions, utilities, and components
- **Framework**: Jest for backend, React Testing Library for frontend
- **Coverage Goal**: 80% code coverage
- **Focus Areas**:
  - Date formatting functions
  - JIRA wiki markup parsing
  - Email content formatting
  - User field extraction
  - Column configuration logic
  - Date delay calculation

#### 2.1.2 Integration Testing
- **Target**: API endpoints, service interactions, external API integration
- **Framework**: Supertest for Express routes, Jest for services
- **Focus Areas**:
  - JIRA API integration
  - Confluence API integration
  - Email sending functionality
  - Authentication flow
  - Data transformation pipelines

#### 2.1.3 End-to-End (E2E) Testing
- **Target**: Complete user workflows
- **Framework**: Cypress or Playwright
- **Focus Areas**:
  - Authentication flow
  - Email composition and sending
  - Release version data fetching
  - Gantt chart rendering
  - Email generation and sending

### 2.2 Testing Approach

#### 2.2.1 Test-Driven Development (TDD)
- Write tests before refactoring critical logic
- Ensure tests pass before and after refactoring
- Use tests to guide refactoring decisions

#### 2.2.2 Regression Testing
- Run full test suite after each refactoring step
- Verify functionality checklist after each change
- Document any test failures or regressions

#### 2.2.3 Manual Testing
- User acceptance testing for UI/UX
- Visual verification of Gantt chart
- Email rendering verification in email clients

## 3. Test Environment Setup

### 3.1 Prerequisites
- Node.js 14+ installed
- npm or yarn package manager
- JIRA test credentials (PAT token)
- Confluence test credentials
- SMTP test server (or mock)
- Test email accounts

### 3.2 Test Data
- **JIRA Test Data**:
  - Test release versions (NDB-2.11, etc.)
  - Test FEAT tickets (Features, X-FEAT)
  - Test ERA tickets (Features, Initiatives, Epics, Capabilities, and other issue types)
  - Test checkpoint dates and history
- **Confluence Test Data**:
  - Test Confluence page URLs
  - Test page content with various formats
- **Email Test Data**:
  - Test email recipients
  - Test email content (HTML, JIRA markup)

### 3.3 Mock Services
- **JIRA API Mock**: Mock JIRA API responses for testing
- **Confluence API Mock**: Mock Confluence API responses
- **SMTP Mock**: Mock email server (Nodemailer test account)

## 4. Unit Test Cases

### 4.1 Date Formatting Tests

#### Test Case: UT-DATE-001
**Function**: `formatDate(dateValue)`
**Description**: Test date formatting to `dd/MMM/yyyy` format
**Test Steps**:
1. Input: `new Date('2026-01-30')`
2. Expected: `"30/Jan/2026"`
3. Input: `new Date('2026-01-05')`
4. Expected: `"05/Jan/2026"` (zero-padded day)

#### Test Case: UT-DATE-002
**Function**: `formatDateWithHistory(dates, currentDate, fieldName)`
**Description**: Test date formatting with historical dates
**Test Steps**:
1. Input: `dates = ['2026-01-15', '2026-01-20', '2026-01-30']`, `currentDate = '2026-01-30'`
2. Expected: `"30/Jan/2026→20/Jan/2026→15/Jan/2026"` with strikethrough for historical

#### Test Case: UT-DATE-003
**Function**: Delay calculation
**Description**: Test delay calculation in days and half-weeks
**Test Steps**:
1. Input: Delay = 2 days
2. Expected: `"2 days late"`
3. Input: Delay = 5 days
4. Expected: `"1.5 weeks late"`

### 4.2 JIRA Wiki Markup Parsing Tests

#### Test Case: UT-MARKUP-001
**Function**: `formatJiraWikiMarkupForEmail(text)`
**Description**: Test JIRA wiki markup to HTML conversion
**Test Steps**:
1. Input: `"h1. Heading\n* Bold text\n# List item"`
2. Expected: HTML with `<h1>`, `<strong>`, `<ol>` tags

#### Test Case: UT-MARKUP-002
**Function**: JIRA key linking
**Description**: Test JIRA key detection and linking
**Test Steps**:
1. Input: `"See FEAT-16821 for details"`
2. Expected: `"See <a href='...'>FEAT-16821</a> for details"`

### 4.3 User Field Extraction Tests

#### Test Case: UT-USER-001
**Function**: `extractUserName(userField)`
**Description**: Test user field extraction from various formats
**Test Steps**:
1. Input: String `"user.name"`
2. Expected: `"user.name"`
3. Input: Object `{displayName: "User Name", emailAddress: "user@nutanix.com"}`
4. Expected: `"User Name"`
5. Input: `null`
6. Expected: `"N/A"`

### 4.4 Column Configuration Tests

#### Test Case: UT-CONFIG-001
**Function**: `getUIColumnOrder(columnsConfig)`
**Description**: Test column filtering based on `includeInUI`
**Test Steps**:
1. Input: Config with some columns `includeInUI: false`
2. Expected: Only columns with `includeInUI: true` in order

#### Test Case: UT-CONFIG-002
**Function**: `getEmailColumnOrder(columnsConfig)`
**Description**: Test column filtering for email based on `includeInEmail`
**Test Steps**:
1. Input: Config with some columns `includeInEmail: false`
2. Expected: Only columns with `includeInEmail: true` in order

### 4.5 Email HTML Generation Tests

#### Test Case: UT-EMAIL-001
**Function**: `generateTableHTMLForEmail(items, checkpointHistory, ...)`
**Description**: Test table HTML generation
**Test Steps**:
1. Input: Array of items with all fields
2. Expected: Valid HTML table with all columns
3. Verify: Column visibility respects `includeInEmail` flag
4. Verify: Date formatting matches UI
5. Verify: User fields display as strings

## 5. Integration Test Cases

### 5.1 JIRA API Integration Tests

#### Test Case: IT-JIRA-001
**Endpoint**: `POST /api/jira/release-versions`
**Description**: Test release versions fetching
**Test Steps**:
1. Send POST request with valid JIRA token
2. Verify: Response contains `success: true`
3. Verify: Response contains `versions` array
4. Verify: Versions are filtered to open/unreleased only
5. Verify: Versions are from ERA project

#### Test Case: IT-JIRA-002
**Endpoint**: `POST /api/jira/release-items-commit`
**Description**: Test commit items fetching
**Test Steps**:
1. Send POST request with `fixVersion: "NDB-2.11"`
2. Verify: Response contains `success: true`
3. Verify: Response contains `data.items` array
4. Verify: All items have matching `fixVersion`
5. Verify: User fields extracted as strings

#### Test Case: IT-JIRA-003
**Endpoint**: `POST /api/jira/release-items-history`
**Description**: Test checkpoint history fetching
**Test Steps**:
1. Send POST request with `fixVersion: "NDB-2.11"`
2. Verify: Response contains `success: true`
3. Verify: Response contains `data.history` object
4. Verify: History includes FEAT items (no project filter)
5. Verify: History structure: `{ "FEAT-16821": { codeComplete: [...], ... } }`

#### Test Case: IT-JIRA-004
**Endpoint**: Rate limiting and retry logic
**Description**: Test JIRA API rate limit handling
**Test Steps**:
1. Simulate rate limit response (429 status)
2. Verify: Retry logic triggers with exponential backoff
3. Verify: Maximum retries enforced
4. Verify: Error message returned after max retries

### 5.2 Email API Integration Tests

#### Test Case: IT-EMAIL-001
**Endpoint**: `POST /api/email/send-release-versions`
**Description**: Test release versions email sending
**Test Steps**:
1. Send POST request with:
   - `tableHTML`: Valid HTML table
   - `selectedVersion`: "NDB-2.11"
   - `highlights`, `lowlights`, `callToAction`: HTML content
   - `emailRecipients`: "user1@nutanix.com; user2@nutanix.com"
2. Verify: Response contains `success: true`
3. Verify: Email sent to all recipients
4. Verify: Email contains table, notes, and legend
5. Verify: Email formatting matches UI

#### Test Case: IT-EMAIL-002
**Endpoint**: `POST /api/email/send`
**Description**: Test general email sending
**Test Steps**:
1. Send POST request with:
   - `executiveSummary`: "Test summary"
   - `additionalDetails`: "HTML content"
   - `emailRecipients`: "user1@nutanix.com; user2@nutanix.com"
2. Verify: Response contains `success: true`
3. Verify: Email sent to all recipients
4. Verify: `namratha.singh@nutanix.com` in CC
5. Verify: Email content formatted correctly

### 5.3 Authentication Integration Tests

#### Test Case: IT-AUTH-001
**Endpoint**: `POST /api/auth/validate-token`
**Description**: Test JIRA token validation
**Test Steps**:
1. Send POST request with valid JIRA token
2. Verify: Response contains `success: true`
3. Verify: Response contains `username` and `email`
4. Verify: Token validated via JIRA API

#### Test Case: IT-AUTH-002
**Endpoint**: Authorization middleware
**Description**: Test authorization for Release Versions
**Test Steps**:
1. Send request to `/api/jira/release-versions` with unauthorized user
2. Verify: Request rejected with appropriate error
3. Send request with authorized user
4. Verify: Request succeeds

## 6. End-to-End Test Cases

### 6.1 Authentication Flow

#### Test Case: E2E-AUTH-001
**Description**: Complete authentication flow
**Test Steps**:
1. Navigate to application root
2. Enter JIRA credentials (email/username and token)
3. Click "Login"
4. Verify: Redirected to main application
5. Verify: Credentials stored in localStorage
6. Verify: User can access Email Sender page

#### Test Case: E2E-AUTH-002
**Description**: Authorization for Release Versions
**Test Steps**:
1. Login as authorized user (`namratha.singh`)
2. Navigate to `/all-status`
3. Verify: Release Versions page loads
4. Login as unauthorized user
5. Navigate to `/all-status`
6. Verify: Redirected to Email Sender page

### 6.2 Email Sender Workflow

#### Test Case: E2E-EMAIL-001
**Description**: Complete email composition and sending
**Test Steps**:
1. Navigate to Email Sender page
2. Enter Confluence URL
3. Click "Extract Content"
4. Verify: Content extracted and displayed
5. Enter Executive Summary
6. Enter Additional Details using rich text editor
7. Enter email recipients (semicolon-separated)
8. Optionally: Enter JIRA key and fetch data
9. Click "Send Email"
10. Verify: Success message displayed
11. Verify: Form cleared after 2 seconds
12. Verify: Email received by recipients

### 6.3 Release Versions Workflow

#### Test Case: E2E-RELEASE-001
**Description**: Complete release version data fetching and display
**Test Steps**:
1. Navigate to Release Versions page
2. Verify: Default version (NDB-2.11) displayed as read-only input
3. Click "Refresh Versions"
4. Verify: Input converts to dropdown
5. Verify: Versions list populated
6. Select a version
7. Click "Fetch Items"
8. Verify: Loading states display
9. Verify: Section 1: Commit table displays with items
10. Verify: Section 2: Long-term-funded table displays with items
11. Verify: All columns render correctly
12. Verify: Dates formatted correctly (green/red/strikethrough)
13. Verify: Extension labels highlighted with colors
14. Verify: Gantt chart displays with timeline bar and Code Complete bar
15. Verify: Historical markers display on timeline

#### Test Case: E2E-RELEASE-002
**Description**: Email generation and sending from Release Versions
**Test Steps**:
1. Complete E2E-RELEASE-001 to load data
2. Enter email recipients (semicolon-separated)
3. Enter Highlights in rich text editor
4. Enter Lowlights in rich text editor
5. Enter Call to Action in rich text editor
6. Click "Send Email"
7. Verify: Success message displayed
8. Verify: Email received by recipients
9. Verify: Email contains:
   - Version header
   - Table with all columns (matching UI)
   - Highlights section
   - Lowlights section
   - Call to Action section
   - Legend
10. Verify: Email contains Gantt chart as SVG visualization
11. Verify: Date formatting matches UI
12. Verify: Extension label highlighting works in email

### 6.4 Error Handling Workflow

#### Test Case: E2E-ERROR-001
**Description**: Error handling for invalid JIRA token
**Test Steps**:
1. Enter invalid JIRA token
2. Click "Login"
3. Verify: Error message displayed
4. Verify: User not redirected

#### Test Case: E2E-ERROR-002
**Description**: Error handling for API failures
**Test Steps**:
1. Simulate JIRA API failure
2. Attempt to fetch release versions
3. Verify: Error message displayed
4. Verify: Application does not crash
5. Verify: User can retry

## 7. Regression Test Cases

### 7.1 Functionality Verification Checklist

After each refactoring step, run through the complete functionality verification checklist (see `docs/FUNCTIONALITY_VERIFICATION_CHECKLIST.md`):

#### Test Case: REG-001
**Description**: Verify all Release Versions Tab features
**Test Steps**:
1. Run through all items in Functionality Verification Checklist
2. Verify: All items pass
3. Document: Any failures or regressions

#### Test Case: REG-002
**Description**: Verify all Email Sender features
**Test Steps**:
1. Run through all Email Sender test cases
2. Verify: All features work as before refactoring
3. Document: Any failures or regressions

#### Test Case: REG-003
**Description**: Verify all Gantt Chart features
**Test Steps**:
1. Run through all Gantt Chart test cases
2. Verify: All features work as before refactoring
3. Document: Any failures or regressions

#### Test Case: REG-004
**Description**: Verify all Email Generation features
**Test Steps**:
1. Run through all Email Generation test cases
2. Verify: All features work as before refactoring
3. Document: Any failures or regressions

## 8. Performance Test Cases

### 8.1 Frontend Performance

#### Test Case: PERF-001
**Description**: Page load time
**Test Steps**:
1. Measure time to first paint
2. Measure time to interactive
3. Verify: < 3 seconds

#### Test Case: PERF-002
**Description**: Table rendering with large dataset
**Test Steps**:
1. Load release version with 100+ items
2. Measure table render time
3. Verify: < 2 seconds
4. Verify: No lag during scrolling

#### Test Case: PERF-003
**Description**: Gantt chart rendering
**Test Steps**:
1. Load release version with Gantt chart
2. Measure Gantt render time
3. Verify: < 1 second
4. Verify: No lag during interaction

### 8.2 Backend Performance

#### Test Case: PERF-004
**Description**: API endpoint response time
**Test Steps**:
1. Measure response time for each API endpoint
2. Verify: < 5 seconds for all endpoints
3. Document: Slow endpoints for optimization

#### Test Case: PERF-005
**Description**: Concurrent request handling
**Test Steps**:
1. Send 10 concurrent requests to same endpoint
2. Verify: All requests handled correctly
3. Verify: No errors or timeouts
4. Verify: Response times acceptable

## 9. Security Test Cases

### 9.1 Authentication Security

#### Test Case: SEC-001
**Description**: Token validation
**Test Steps**:
1. Send request with invalid token
2. Verify: Request rejected
3. Verify: Appropriate error message

#### Test Case: SEC-002
**Description**: Authorization checks
**Test Steps**:
1. Attempt to access Release Versions as unauthorized user
2. Verify: Access denied
3. Verify: Redirected appropriately

### 9.2 Input Validation

#### Test Case: SEC-003
**Description**: XSS prevention
**Test Steps**:
1. Input malicious script in text fields
2. Verify: Script not executed
3. Verify: Content sanitized

#### Test Case: SEC-004
**Description**: SQL injection prevention (if applicable)
**Test Steps**:
1. Input SQL injection attempts
2. Verify: No database queries executed
3. Verify: Input sanitized

### 9.3 Rate Limiting

#### Test Case: SEC-005
**Description**: Rate limit enforcement
**Test Steps**:
1. Send rapid requests to API endpoint
2. Verify: Rate limit triggered
3. Verify: Appropriate error message
4. Verify: Service not overwhelmed

## 10. Test Execution Plan

### 10.1 Pre-Refactoring Testing
1. Run full test suite on current codebase
2. Document baseline test results
3. Create test data fixtures
4. Set up test environment

### 10.2 During Refactoring Testing
1. Run unit tests after each function refactoring
2. Run integration tests after each module extraction
3. Run E2E tests after each major component split
4. Run functionality verification checklist after each step
5. Document any test failures immediately

### 10.3 Post-Refactoring Testing
1. Run complete test suite
2. Run functionality verification checklist
3. Run performance tests
4. Run security tests
5. Document all test results
6. Fix any failures before proceeding

## 11. Test Coverage Goals

### 11.1 Code Coverage Targets
- **Unit Tests**: 80% code coverage
- **Integration Tests**: 70% API endpoint coverage
- **E2E Tests**: 100% critical user workflows

### 11.2 Coverage Areas
- Date formatting functions: 100%
- User field extraction: 100%
- JIRA wiki markup parsing: 90%
- Email HTML generation: 90%
- Column configuration logic: 100%
- API endpoints: 80%
- React components: 70%

## 12. Test Data Management

### 12.1 Test Data Requirements
- **JIRA Test Data**: 
  - At least 2 release versions
  - At least 10 FEAT tickets
  - At least 10 ERA tickets
  - Various checkpoint dates and history
- **Confluence Test Data**:
  - At least 3 test pages with different formats
- **Email Test Data**:
  - At least 5 test email addresses

### 12.2 Test Data Cleanup
- Reset test data after each test run
- Use isolated test accounts
- Clean up test emails

## 13. Defect Management

### 13.1 Defect Tracking
- Document all test failures
- Categorize by severity (Critical, High, Medium, Low)
- Assign to appropriate developer
- Track resolution status

### 13.2 Defect Severity
- **Critical**: Application crash, data loss, security breach
- **High**: Major functionality broken, incorrect data display
- **Medium**: Minor functionality issue, UI glitch
- **Low**: Cosmetic issue, minor improvement

## 14. Test Reporting

### 14.1 Test Reports
- Daily test execution reports during refactoring
- Final test report after refactoring complete
- Include: Test results, coverage metrics, defects found, defects fixed

### 14.2 Test Metrics
- Test execution time
- Test pass/fail rate
- Code coverage percentage
- Defect density
- Defect resolution time

## 15. Test Maintenance

### 15.1 Test Updates
- Update tests when requirements change
- Update tests when code changes
- Remove obsolete tests
- Add tests for new features

### 15.2 Test Review
- Review test cases regularly
- Ensure tests cover all requirements
- Ensure tests are maintainable
- Ensure tests run efficiently

## 16. Changelog Pagination Tests

### 16.1 Test Objectives

Verify that changelog pagination correctly fetches all historical dates for JIRA issues, including when changelog data is paginated across multiple API responses.

### 16.2 Test Cases

#### TC-001: Issue with Paginated Changelog
- **Description**: Test issue with `changelog.total > changelog.histories.length`
- **Test Data**: Use `FEAT-18452` (known to have paginated changelog)
- **Steps**:
  1. Call `/api/jira/release-items-history` with `fixVersion` containing `FEAT-18452`
  2. Verify all historical dates are returned
  3. Check server logs for pagination metrics
  4. Verify no data loss (all expected dates present)
- **Expected Results**: All historical dates captured, pagination strategies logged, no warnings about missing data

#### TC-002: Issue with Non-Paginated Changelog
- **Description**: Test issue where `changelog.total <= changelog.histories.length`
- **Test Data**: Use any issue with small changelog
- **Steps**:
  1. Call history endpoint
  2. Verify single API call is made
  3. Verify all dates returned correctly
- **Expected Results**: Single call succeeds, all dates returned, no pagination needed

#### TC-003: Issue with No Changelog
- **Description**: Test issue with no changelog history
- **Test Data**: Use issue with no date changes
- **Steps**:
  1. Call history endpoint
  2. Verify graceful handling
  3. Verify empty history array returned
- **Expected Results**: No errors, empty history array, no pagination attempted

#### TC-004: Issue with Very Large Changelog
- **Description**: Test issue with >1000 changelog entries
- **Test Data**: Use issue with extensive history
- **Steps**:
  1. Call history endpoint
  2. Monitor performance (time to fetch)
  3. Verify all entries fetched
  4. Check rate limiting behavior
- **Expected Results**: All entries fetched within acceptable time (<5 minutes), rate limiting respected

#### TC-005: Pagination Failure Scenarios
- **Description**: Test error handling when pagination fails
- **Test Scenarios**:
  - Strategy 1 fails (maxResults not supported)
  - Strategy 2 fails (issue ID endpoint returns 404)
  - Strategy 3 fails (multiple expand calls fail)
- **Steps**:
  1. Mock API failures for each strategy
  2. Verify graceful degradation
  3. Verify warnings logged
  4. Verify partial data returned
- **Expected Results**: Partial data returned with warnings, no crashes, errors logged

#### TC-006: Strategy Fallback
- **Description**: Test that strategies fall back correctly
- **Test Scenarios**:
  - Strategy 1 fails, Strategy 2 succeeds
  - Strategies 1 and 2 fail, Strategy 3 succeeds
  - All strategies fail, partial data returned
- **Steps**:
  1. Mock API responses to simulate strategy failures
  2. Verify fallback logic
  3. Verify correct strategy used
- **Expected Results**: Correct fallback behavior, best available data returned

### 16.3 Test Data

- **Primary Test Case**: `FEAT-18452` (known to have paginated changelog with multiple date changes)
- **Secondary Test Cases**: Various issues with different changelog sizes

### 16.4 Expected Results

- All historical dates captured for paginated changelogs
- No data loss when pagination is required
- Performance remains acceptable (<5 minutes for large batches)
- Error handling is robust (graceful degradation)
- Comprehensive logging for debugging

### 16.5 Test Results

**Test Execution Date**: 2026-01-11

#### Unit Tests (server/__tests__/utils/changelogPagination.test.js)

All unit tests passed successfully:

- ✅ **TC-001**: Issue with Paginated Changelog - PASSED
  - Successfully fetches all 250 histories when pagination is required
  - Strategy 1 (maxResults=total) works correctly
  - All histories returned, no data loss

- ✅ **TC-002**: Issue with Non-Paginated Changelog - PASSED
  - Returns early when no pagination needed
  - Single API call made as expected
  - All dates returned correctly

- ✅ **TC-003**: Issue with No Changelog - PASSED
  - Handles null changelog gracefully
  - Returns empty history array
  - No errors or warnings

- ✅ **TC-005**: Pagination Failure Scenarios - PASSED (2 tests)
  - Strategy 1 failure with Strategy 2 fallback works correctly
  - Partial data returned with warnings when all strategies fail
  - Graceful degradation functioning as expected

- ✅ **TC-006**: Strategy Fallback - PASSED
  - Correctly falls back through strategies
  - Multiple strategies can be used together
  - Best available data returned

- ✅ **Error Handling** - PASSED
  - Initial fetch errors handled gracefully
  - Warnings logged appropriately
  - No crashes on errors

**Unit Test Summary**: 7/7 tests passed

#### Integration Tests

Integration tests added to `server/__tests__/integration/jira.test.js`:
- IT-JIRA-005: Pagination test for `/api/jira/release-items-history`
- IT-JIRA-006: Pagination test for `/api/jira/checkpoint-history` with FEAT-18452
- IT-JIRA-007: Non-paginated changelog handling test

**Note**: Integration tests require valid JIRA token and should be run with `TEST_JIRA_TOKEN` environment variable.

#### Manual Testing Checklist

- [ ] Test with `FEAT-18452` (known paginated issue) - **Pending UI verification**
- [ ] Verify all historical dates appear in UI - **Pending UI verification**
- [ ] Check server logs for pagination metrics - **Pending UI verification**
- [ ] Test with non-paginated issue (should work as before) - **Pending UI verification**
- [ ] Test with issue that has no changelog - **Pending UI verification**
- [ ] Verify rate limiting doesn't cause issues - **Pending UI verification**

#### Code Quality

- ✅ Syntax check passed
- ✅ No linter errors
- ✅ JSDoc comments added to pagination utility
- ✅ Error handling implemented
- ✅ Logging comprehensive

#### Performance Notes

- Rate limiting: 500ms delay between pagination requests implemented
- Timeout: 30 seconds per API call
- Expected performance: <5 minutes for large batches with pagination

#### Known Issues

None identified during unit testing. Manual testing with real JIRA data will validate:
- Actual pagination behavior with real JIRA API
- Performance with large changelogs
- UI display of all historical dates

