# Production SMTP Setup Guide

## Issue: Relay Access Denied in Production

The error `554 5.7.1 Relay access denied` occurs when the production server's IP address is not authorized to relay emails through the corporate SMTP server.

## Quick Diagnosis

Run these diagnostic scripts on your production server:

```bash
cd /var/www/html/ndb-status-sender/server

# 1. Run comprehensive SMTP diagnostics
node diagnose-smtp-production.js

# 2. Test alternative SMTP configurations
node test-smtp-alternatives.js
```

## Solution Options

### Option 1: Contact IT Support (Recommended)
Request IT to whitelist your production server's IP address for SMTP relay access:
- **Server**: `santhosh-s-1.umsvm.nutanix.com`
- **SMTP Server**: `secure-mailrelay.corp.nutanix.com:587`
- **Service Account**: `svc.ndb.team@nutanix.com`

### Option 2: Use Internal SMTP Server
Try these alternative SMTP servers in production `.env`:

```bash
# Option 2A: Internal mail server (no relay restrictions)
SMTP_HOST=mail.corp.nutanix.com
SMTP_PORT=587

# Option 2B: Alternative internal SMTP
SMTP_HOST=smtp.corp.nutanix.com
SMTP_PORT=587

# Option 2C: Port 25 (often works without authentication)
SMTP_HOST=secure-mailrelay.corp.nutanix.com
SMTP_PORT=25
# Comment out SMTP_USER and SMTP_PASS for port 25
```

### Option 3: Automatic Fallback (Already Implemented)
The email service now includes automatic fallback logic that:
1. Tries the primary SMTP configuration
2. If "Relay access denied" occurs, automatically tries:
   - Port 25 without authentication
   - Common internal mail servers
3. Logs successful configurations for permanent fix

## Testing in Production

1. **Deploy the updated code** with fallback logic
2. **Test email functionality** - it should now work automatically
3. **Check server logs** for successful fallback configuration
4. **Update .env permanently** with the working configuration

## Production .env Template

Based on diagnostic results, update your production `.env`:

```bash
# SMTP Configuration - Update based on diagnostic results
SMTP_HOST=secure-mailrelay.corp.nutanix.com  # or working alternative
SMTP_PORT=587                                 # or 25 if that works
SMTP_USER=svc.ndb.team@nutanix.com          # comment out for port 25
SMTP_PASS=26@t3Mb4rwy1%#cO                  # comment out for port 25
SMTP_FROM=svc.ndb.team@nutanix.com

# Server Configuration
PORT=6001
NODE_ENV=production

# Other settings...
RELEASE_VERSIONS_PAGE_ACCESS=all
RELEASE_VERSIONS_EMAIL_ACCESS=allowlist
```

## Monitoring

After deployment, monitor the application logs:

```bash
# Check PM2 logs for SMTP success/failure
ssh santhosh.s@santhosh-s-1.umsvm.nutanix.com 'cd /var/www/html/ndb-status-sender && pm2 logs'

# Look for these log messages:
# ✓ Success: "[EmailService] Email sent: <message-id>"
# ✓ Fallback: "[EmailService] Fallback success with <host>:<port>"
# ✗ Failure: "[EmailService] All fallback SMTP configurations failed"
```

## Permanent Fix

Once you identify the working SMTP configuration:
1. Update production `.env` with the working settings
2. Remove the fallback logic (optional, but keeps it as safety net)
3. Document the working configuration for future deployments

## Files Modified

- `server/services/emailService.js` - Added automatic fallback logic
- `server/diagnose-smtp-production.js` - Diagnostic script
- `server/test-smtp-alternatives.js` - Alternative configuration tester