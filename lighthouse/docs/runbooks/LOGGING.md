
# 📝 Logging Guide

## Overview

Complete logging system for NDB Status Sender that captures all errors, warnings, and info messages to log files.

---

## 📁 Log Files Location

All logs are stored in the `./logs/` directory:

```
logs/
├── out.log          # Standard output (info, general messages)
├── err.log          # Errors and warnings
├── archive/         # Rotated/archived logs
│   └── logs_*.tar.gz
└── README.md
```

---

## 🚀 Quick Start

### ⚡ Automatic Setup

**Logging is automatically configured** when you use the production scripts:

```bash
./start-production.sh      # Logging auto-configured on start
./restart-production.sh    # Logging verified on restart
./deploy-rhel8-complete.sh # Logging set up during deployment
```

### 1. Manual Setup (Optional - if not using production scripts)

```bash
chmod +x setup-logging.sh
./setup-logging.sh
```

This sets up:
- ✅ Log directory structure
- ✅ PM2 logging configuration
- ✅ Automatic log rotation
- ✅ Log compression

### 2. View Logs

```bash
chmod +x view-logs.sh
./view-logs.sh
```

**Interactive menu to view:**
- Application logs (combined)
- Error logs only
- Output logs only
- Nginx logs
- PM2 live logs
- Summary of all logs

### 3. Manage Logs

```bash
chmod +x manage-logs.sh
./manage-logs.sh
```

**Interactive menu to:**
- View log sizes
- Rotate logs manually
- Clear all logs
- Setup automatic rotation
- View archived logs
- Clean old archives

---

## 📊 What Gets Logged

### Application Logs (`logs/out.log`)
- ✅ Server startup messages
- ✅ API requests and responses
- ✅ Database operations
- ✅ General information
- ✅ Debug messages (if enabled)

### Error Logs (`logs/err.log`)
- ❌ Application errors
- ⚠️ Warnings
- ❌ Stack traces
- ❌ Unhandled exceptions
- ❌ PM2 process errors

### Nginx Logs
- **Access:** `/var/log/nginx/access.log` - All HTTP requests
- **Error:** `/var/log/nginx/error.log` - Web server errors

---

## 🔄 Automatic Log Rotation

Logs are automatically rotated when:
- **Size:** File exceeds 10MB
- **Time:** Daily at midnight
- **Retention:** Keeps last 10 rotated files
- **Compression:** Old logs are compressed (.gz)

### Configuration

```bash
# Rotation settings (already configured by setup-logging.sh)
Max size:        10MB
Retained files:  10
Compression:     Enabled
Rotation time:   Daily at midnight (00:00)
Check interval:  Every 30 seconds
```

---

## 📖 Using the Scripts

### view-logs.sh - Interactive Log Viewer

```bash
./view-logs.sh
```

**Menu options:**
1. Application logs (combined)
2. Error logs only
3. Output logs only
4. Nginx access logs
5. Nginx error logs
6. PM2 logs (live tail)
7. All logs summary

**Features:**
- Color-coded output
- Shows last 50 lines by default
- Live tailing option
- Summary view with sizes

---

### manage-logs.sh - Log Management

```bash
./manage-logs.sh
```

**Menu options:**
1. **View log sizes** - Check current log file sizes
2. **Rotate logs** - Archive current logs and start fresh
3. **Clear all logs** - Permanently delete all logs (with confirmation)
4. **Setup automatic rotation** - Configure PM2 log rotation
5. **View archived logs** - List all archived log files
6. **Clean old archives** - Delete archives older than 30 days

**Features:**
- Safe deletion (requires confirmation)
- Automatic archiving before clearing
- Archive management
- Size tracking

---

## 🛠️ Manual Log Commands

### PM2 Commands

```bash
# View live logs
pm2 logs ndb-status-sender

# View last 100 lines
pm2 logs ndb-status-sender --lines 100

# View only errors
pm2 logs ndb-status-sender --err

# View only output
pm2 logs ndb-status-sender --out

# Clear logs
pm2 flush ndb-status-sender

# Show log paths
pm2 show ndb-status-sender
```

### Direct File Access

```bash
# View application output
tail -f logs/out.log

# View application errors
tail -f logs/err.log

# View last 100 lines
tail -n 100 logs/out.log

# Search for errors
grep -i error logs/err.log

# Search all logs
grep -r "search term" logs/

# Count errors
grep -c ERROR logs/err.log
```

### Nginx Logs

```bash
# View access logs
sudo tail -f /var/log/nginx/access.log

# View error logs
sudo tail -f /var/log/nginx/error.log

# Search for specific IP
sudo grep "1.2.3.4" /var/log/nginx/access.log

# Count 404 errors
sudo grep " 404 " /var/log/nginx/access.log | wc -l
```

---

## 🔍 Troubleshooting

### Logs Not Being Written

**Check 1: Permissions**
```bash
ls -la logs/
# Should be writable by your user
```

**Fix:**
```bash
chmod 755 logs
chmod 644 logs/*.log
```

**Check 2: PM2 Configuration**
```bash
pm2 show ndb-status-sender
# Look for error_file and out_file paths
```

**Check 3: Disk Space**
```bash
df -h
# Ensure you have free space
```

**Check 4: Restart Application**
```bash
pm2 restart ndb-status-sender
```

### Logs Growing Too Large

**Option 1: Manual Rotation**
```bash
./manage-logs.sh
# Choose option 2: Rotate logs
```

**Option 2: Setup Auto-Rotation**
```bash
./manage-logs.sh
# Choose option 4: Setup automatic rotation
```

**Option 3: Clear Old Logs**
```bash
./manage-logs.sh
# Choose option 6: Clean old archives
```

### Can't Find Specific Error

**Search all logs:**
```bash
# Search application logs
grep -i "error message" logs/*.log

# Search with context (show 5 lines before/after)
grep -i -C 5 "error message" logs/*.log

# Search by date
grep "2026-01-14" logs/*.log
```

**View specific time range:**
```bash
# Show logs from specific hour
sed -n '/2026-01-14 14:/,/2026-01-14 15:/p' logs/out.log
```

---

## 📊 Log Analysis

### View Error Summary

```bash
# Count errors by type
grep ERROR logs/err.log | cut -d' ' -f4- | sort | uniq -c | sort -rn

# Most recent errors
tail -20 logs/err.log
```

### View Access Statistics

```bash
# Most accessed endpoints
sudo cat /var/log/nginx/access.log | awk '{print $7}' | sort | uniq -c | sort -rn | head -10

# Status code distribution
sudo cat /var/log/nginx/access.log | awk '{print $9}' | sort | uniq -c | sort -rn
```

### Find Performance Issues

```bash
# Slow requests (if timing is logged)
grep "took" logs/out.log | awk '$NF > 1000'

# Memory warnings
grep -i "memory" logs/err.log
```

---

## ⚙️ Advanced Configuration

### Change Log Rotation Settings

```bash
# Edit PM2 log rotation config
pm2 set pm2-logrotate:max_size 20M      # Increase max size
pm2 set pm2-logrotate:retain 20         # Keep more files
pm2 set pm2-logrotate:compress false    # Disable compression
```

### Custom Log Location

Edit `ecosystem.config.js`:
```javascript
{
  error_file: '/custom/path/err.log',
  out_file: '/custom/path/out.log'
}
```

Then restart:
```bash
pm2 restart ndb-status-sender --update-env
```

---

## 📋 Log Format

### Application Logs Format

```
YYYY-MM-DD HH:mm:ss Z | LEVEL | Message
2026-01-14 10:30:45 +0000 | INFO | Server started on port 6001
2026-01-14 10:31:12 +0000 | ERROR | Database connection failed
```

### Nginx Access Log Format

```
IP - - [Date] "METHOD /path HTTP/1.1" STATUS SIZE "Referer" "User-Agent"
```

---

## 🔐 Security Considerations

1. **Sensitive Data** - Ensure logs don't contain:
   - Passwords
   - API keys
   - Personal information
   - Credit card numbers

2. **Permissions** - Restrict log access:
   ```bash
   chmod 600 logs/err.log  # Only owner can read
   ```

3. **Retention** - Don't keep logs forever:
   ```bash
   # Clean logs older than 90 days
   find logs/archive -name "*.tar.gz" -mtime +90 -delete
   ```

---

## 📝 Best Practices

1. **Regular Monitoring** - Check logs daily:
   ```bash
   ./view-logs.sh  # Option 7 for summary
   ```

2. **Error Alerts** - Set up monitoring for critical errors

3. **Disk Space** - Monitor disk usage:
   ```bash
   du -sh logs/
   ```

4. **Rotation** - Let automatic rotation handle large files

5. **Archiving** - Keep archives for compliance but clean old ones

6. **Search** - Use grep/awk for log analysis

7. **Backup** - Include logs in backup strategy

---

## 🆘 Common Issues

### Issue: "No space left on device"
**Solution:** Clear old logs
```bash
./manage-logs.sh
# Choose option 3 (clear) or 6 (clean old archives)
```

### Issue: "Permission denied" when viewing logs
**Solution:** Fix permissions
```bash
sudo chown -R $USER:$USER logs/
chmod 755 logs/
```

### Issue: Logs not rotating
**Solution:** Reinstall log rotation
```bash
pm2 uninstall pm2-logrotate
./setup-logging.sh
```

### Issue: Too many log files
**Solution:** Reduce retention
```bash
pm2 set pm2-logrotate:retain 5
```

---

## 📞 Quick Reference

| Task | Command |
|------|---------|
| View logs interactively | `./view-logs.sh` |
| Manage logs | `./manage-logs.sh` |
| Live tail | `pm2 logs ndb-status-sender` |
| Check log sizes | `du -sh logs/` |
| Search errors | `grep ERROR logs/err.log` |
| Rotate logs | `./manage-logs.sh` → Option 2 |
| Clear logs | `pm2 flush ndb-status-sender` |
| Archive location | `logs/archive/` |

---

**TL;DR:** Run `./setup-logging.sh` once, then use `./view-logs.sh` to view logs and `./manage-logs.sh` to manage them. All errors, warnings, and info are automatically saved to `./logs/` 📝

