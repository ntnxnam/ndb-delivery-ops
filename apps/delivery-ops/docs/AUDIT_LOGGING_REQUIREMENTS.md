# Audit Logging Requirements for Email Operations

## Overview
All email operations must be comprehensively logged for auditing purposes. This ensures we can track:
- **Who** sent the email (username, email address)
- **When** the email was sent (timestamp)
- **What** was sent (subject, recipients, content metadata)
- **Where** it was sent (TO, CC recipients)
- **Why** it was sent (JIRA key, release versions, context)

## Email Logging Standards

### 1. Email Send Attempt
**When:** Before attempting to send email
**Log Level:** INFO
**Required Fields:**
- Username/email of sender
- Recipients (TO, CC)
- Subject
- JIRA key (if applicable)
- Release versions (if applicable)
- Email content size
- Has attachments (boolean)
- Request metadata (IP, user agent)

### 2. Email Send Success
**When:** After successful email send
**Log Level:** INFO
**Required Fields:**
- All fields from attempt
- Message ID from SMTP server
- Timestamp of successful send
- Delivery status (if available)

### 3. Email Send Failure
**When:** When email send fails
**Log Level:** ERROR
**Required Fields:**
- All fields from attempt
- Error message
- Error code
- Stack trace (for debugging)
- Retry information (if applicable)

## Audit Trail Requirements

### Email Sender Endpoint (`/api/email/send`)
- Log user authentication (username from JIRA token)
- Log email attempt with all metadata
- Log success/failure with message ID
- Include JIRA key in all logs
- Track PDF attachment generation (if applicable)

### Release Versions Email Endpoint (`/api/email/send-release-versions`)
- Log user authorization (username from request)
- Log email attempt with release version(s)
- Log success/failure with message ID
- Include all release versions in logs
- Track table HTML size and content metadata

## Implementation Notes

1. **Use `logger.email.attempt()`** before sending
2. **Use `logger.email.sent()`** on success
3. **Use `logger.email.failed()`** on failure
4. **Use `logger.audit.action()`** for user actions
5. **Replace all `console.log`** with proper logger calls
6. **Include request metadata** (IP, user agent, timestamp)
7. **Sanitize sensitive data** before logging (passwords, tokens)

## Log File Locations
- Email logs: `logs/email.log`
- Audit logs: `logs/audit.log`
- Error logs: `logs/error.log`

## Example Log Entry Format
```json
{
  "timestamp": "2026-01-10T17:30:00.000Z",
  "level": "INFO",
  "category": "EMAIL_SENT",
  "message": "Email sent from user@nutanix.com",
  "from": "user@nutanix.com",
  "to": ["recipient1@nutanix.com", "recipient2@nutanix.com"],
  "cc": ["cc@nutanix.com"],
  "subject": "NDB Status Update - FEAT-12345",
  "jiraKey": "FEAT-12345",
  "releaseVersions": null,
  "messageId": "smtp-message-id-123",
  "hasPdf": true,
  "contentSize": 45678,
  "username": "user",
  "ip": "10.0.0.1",
  "userAgent": "Mozilla/5.0..."
}
```

