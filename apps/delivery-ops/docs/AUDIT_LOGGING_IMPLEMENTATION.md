# Audit Logging Implementation Summary

## Overview
Comprehensive audit logging has been implemented for all email operations to track who sent emails, when, what was sent, and to whom.

## Changes Made

### 1. Email Sender Endpoint (`/api/email/send`)

**Added:**
- JSDoc comment explaining audit logging requirements
- Username extraction from request (JIRA token or userEmail)
- IP address and user agent tracking
- `logger.audit.action()` call for user action tracking
- `logger.email.attempt()` call before sending email
- `logger.email.sent()` call on successful send
- `logger.email.failed()` call on failure

**Logged Information:**
- Username and email of sender
- Recipients (TO and CC)
- Email subject
- JIRA key
- PDF attachment status
- Email content size
- Message ID (on success)
- Error details (on failure)
- IP address and user agent

### 2. Release Versions Email Endpoint (`/api/email/send-release-versions`)

**Added:**
- JSDoc comment explaining audit logging requirements
- Username extraction from request
- IP address and user agent tracking
- `logger.audit.action()` call for user action tracking
- `logger.email.attempt()` call before sending email
- `logger.email.sent()` call on successful send
- `logger.email.failed()` call on failure

**Logged Information:**
- Username and email of sender
- Recipients (TO and CC)
- Email subject
- Release version(s)
- Table HTML size
- Notes presence (highlights, lowlights, call to action)
- Email content size
- Message ID (on success)
- Error details (on failure)
- IP address and user agent

## Log File Locations

All logs are written to the `logs/` directory:
- **Email logs**: `logs/email.log` - All email operations
- **Audit logs**: `logs/audit.log` - User actions and data access
- **Error logs**: `logs/error.log` - Errors and failures

## Log Entry Format

All log entries are in JSON format (NDJSON - newline-delimited JSON):

```json
{
  "timestamp": "2026-01-10T17:30:00.000Z",
  "level": "INFO",
  "category": "EMAIL_SENT",
  "message": "Email sent from user@nutanix.com",
  "from": "user@nutanix.com",
  "to": ["recipient1@nutanix.com"],
  "cc": ["cc@nutanix.com"],
  "subject": "NDB Status Update - FEAT-12345",
  "jiraKey": "FEAT-12345",
  "releaseVersions": null,
  "username": "user",
  "messageId": "smtp-message-id-123",
  "hasPdf": true,
  "contentSize": 45678,
  "ip": "10.0.0.1",
  "userAgent": "Mozilla/5.0..."
}
```

## Audit Trail Capabilities

With this implementation, you can now:

1. **Track who sent emails**: Username and email address logged
2. **Track when emails were sent**: Timestamp in ISO format
3. **Track what was sent**: Subject, JIRA key, release versions, content size
4. **Track recipients**: TO and CC lists logged
5. **Track delivery status**: Message ID from SMTP server
6. **Track failures**: Error messages and codes logged
7. **Track request context**: IP address and user agent logged

## Next Steps for Route Extraction

When extracting email routes to `routes/email.js`:

1. **Preserve all logging calls** - Do not remove any `logger.email.*` or `logger.audit.*` calls
2. **Preserve JSDoc comments** - Keep audit logging documentation
3. **Ensure username extraction** - Maintain username extraction logic
4. **Test logging** - Verify logs are written correctly after extraction

## Example Queries

To query logs for audit purposes:

```bash
# Find all emails sent by a user
grep '"username":"namratha.singh"' logs/email.log

# Find all emails for a specific JIRA key
grep '"jiraKey":"FEAT-12345"' logs/email.log

# Find all failed email sends
grep '"category":"EMAIL_FAILED"' logs/email.log

# Find all release versions emails
grep '"releaseVersions":\[' logs/email.log
```

