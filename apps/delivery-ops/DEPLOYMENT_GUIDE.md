# 🚀 Complete Deployment Guide for RHEL8

## Overview

This guide covers the complete deployment of the NDB Status Sender application on RHEL8 using the automated deployment script.

## 📋 Prerequisites

- **RHEL8 server** with internet connectivity
- **User account** with sudo privileges (DO NOT use root)
- **Application files** on the server
- **SSH access** to the server

## 📧 Pre-deploy checklist (email)

Before first deploy or after changing email config:

- **server/.env**: Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS (service account for Nutanix relay). Optionally SMTP_FROM (must be the service account for relay to accept).
- **server/config/emailConfig.json**: Ensure smtp.from is set (e.g. svc.ndb.team@nutanix.com). For the Email Sender page default To list, set defaultTo (e.g. ["ndb-projects-status@nutanix.com"]) if desired.
- **Post-deploy**: The deploy script runs an optional email smoke test (node server/test-smtp.js). If SMTP credentials are missing, it logs a warning and continues. Set RUN_EMAIL_SMOKE_TEST=true to fail deployment when the smoke test fails.

## 🎯 Quick Start (One Command Deployment)

### Step 1: Transfer Application to Server

**On your local machine:**
```bash
# Navigate to your project directory
cd /Users/sakthivel.subburaja/gitclone

# Create tarball (excluding unnecessary files)
tar --exclude='node_modules' \
    --exclude='client/node_modules' \
    --exclude='server/node_modules' \
    --exclude='client/build' \
    --exclude='.git' \
    -czf ndb-status-sender.tar.gz ndb-status-sender/

# Transfer to server
scp ndb-status-sender.tar.gz your-user@your-server:/var/www/html/ndb-status-sender/

# Clean up
rm ndb-status-sender.tar.gz
```

### Step 2: Extract and Deploy

**On your RHEL8 server:**
```bash
# SSH to server
ssh your-user@your-server

# Navigate to deployment location
cd /var/www/html/ndb-status-sender

# Extract the application
tar -xzf ndb-status-sender.tar.gz
cd ndb-status-sender

# Make deployment script executable
chmod +x deploy-rhel8-complete.sh

# Run the deployment script
./deploy-rhel8-complete.sh
```

That's it! The script will handle everything automatically.

## ⚙️ Configuration

Before running the script, you can customize these settings by editing the script:

```bash
nano deploy-rhel8-complete.sh
```

Key configuration variables:
```bash
APP_DIR="/var/www/html/ndb-status-sender"  # App location
APP_NAME="ndb-status-sender"                                  # PM2 process name
BACKEND_PORT=6001                                             # Node.js API port
NGINX_PORT=6100                                               # Frontend port
NODE_VERSION="18"                                             # Node.js version
```

## 📊 What the Script Does

The `deploy-rhel8-complete.sh` script performs these steps automatically:

### System Setup
1. ✅ Installs Node.js 18.x
2. ✅ Installs build tools (gcc, make, python3)
3. ✅ Installs Puppeteer dependencies

### Application Setup
4. ✅ Verifies application directory structure
5. ✅ Installs npm dependencies (root, server, client)
6. ✅ Builds React frontend for production

### Web Server Setup
7. ✅ Installs and configures Nginx
8. ✅ Creates Nginx configuration for the app
9. ✅ Handles port conflicts (stops Apache if needed)
10. ✅ Sets up SELinux contexts (if enabled)

### Process Management
11. ✅ Installs PM2 globally
12. ✅ Starts/restarts backend application
13. ✅ Configures PM2 to start on boot

### Security
14. ✅ Configures firewall rules
15. ✅ Sets proper file permissions

### Verification
16. ✅ Tests backend health endpoint
17. ✅ Tests frontend accessibility
18. ✅ Displays access URLs and helpful commands

## 🌐 Accessing Your Application

After successful deployment:

### Frontend (Web UI)
```
http://your-server-ip:6100
```

### Backend API (Direct - for testing only)
```
http://your-server-ip:6001/api/health
```

**Note:** Users should always access via the frontend URL. The backend port is for API calls only.

## 🔄 Deploying Updates

When you have new changes:

### On Local Machine:
```bash
cd /Users/sakthivel.subburaja/gitclone
tar --exclude='node_modules' \
    --exclude='client/node_modules' \
    --exclude='server/node_modules' \
    --exclude='client/build' \
    --exclude='.git' \
    -czf ndb-status-sender.tar.gz ndb-status-sender/
scp ndb-status-sender.tar.gz your-user@your-server:/tmp/
```

### On Server:
```bash
cd /var/www/html/ndb-status-sender

# Optional: Backup current version
cd ..
cp -r ndb-status-sender ndb-status-sender.backup.$(date +%Y%m%d_%H%M%S)
cd ndb-status-sender

# Extract new version
tar -xzf /tmp/ndb-status-sender.tar.gz --strip-components=1
rm /tmp/ndb-status-sender.tar.gz

# Re-run deployment script (full) or restart with rebuild only
./deploy-rhel8-complete.sh
# Or, if you only pulled new code: ./restart-production-with-build.sh --rebuild-client
```

## 📝 Manual Operations

### View Application Logs
```bash
# PM2 logs (backend)
pm2 logs ndb-status-sender

# Nginx logs
sudo tail -f /var/log/nginx/error.log
sudo tail -f /var/log/nginx/access.log
```

### Check Status
```bash
# PM2 status
pm2 status

# Nginx status
sudo systemctl status nginx

# Check if ports are listening
sudo ss -tulnp | grep -E ":(6001|6100)"
```

### Restart Services
```bash
# Restart backend
pm2 restart ndb-status-sender

# Restart Nginx
sudo systemctl restart nginx

# Restart both
pm2 restart ndb-status-sender && sudo systemctl restart nginx
```

### Rebuild Frontend Only
```bash
cd /var/www/html/ndb-status-sender/client
npm run build
sudo systemctl reload nginx
```

## 🔧 Troubleshooting

### Issue: Script fails at "Application directory not found"
**Solution:** Update `APP_DIR` in the script to match your actual path
```bash
nano deploy-rhel8-complete.sh
# Change APP_DIR to your actual path
```

### Issue: Port already in use
**Solution:** The script automatically handles Apache conflicts. For other services:
```bash
# Find what's using the port
sudo ss -tulnp | grep :6100

# Stop the conflicting service
sudo systemctl stop <service-name>

# Re-run script
./deploy-rhel8-complete.sh
```

### Issue: Nginx won't start
**Solution:**
```bash
# Check detailed logs
sudo journalctl -xeu nginx.service -n 50

# Check Nginx configuration
sudo nginx -t

# Check for port conflicts
sudo ss -tulnp | grep :6100
```

### Issue: Frontend shows 502 Bad Gateway
**Solution:** Backend is not running
```bash
# Check PM2
pm2 status

# View backend logs
pm2 logs ndb-status-sender

# Restart backend
pm2 restart ndb-status-sender
```

### Issue: Permission denied errors
**Solution:**
```bash
# Fix ownership
sudo chown -R $USER:$USER /var/www/html/ndb-status-sender

# Fix permissions for Nginx
sudo chmod -R 755 /var/www/html/ndb-status-sender/client/build
```

### Issue: SELinux blocking
**Solution:** The script handles this automatically, but if issues persist:
```bash
# Temporarily disable SELinux for testing
sudo setenforce 0

# Re-run script
./deploy-rhel8-complete.sh

# Re-enable SELinux
sudo setenforce 1
```

### Issue: Build fails due to corrupted node_modules
**Solution:**
```bash
cd /var/www/html/ndb-status-sender

# Clean all node_modules
rm -rf node_modules server/node_modules client/node_modules
rm -rf client/build

# Re-run deployment
./deploy-rhel8-complete.sh
```

## 🔒 Security Considerations

1. **Firewall:** Script opens only necessary ports (6001, 6100, 80, 443)
2. **SELinux:** Automatically configured if enabled
3. **User permissions:** Script refuses to run as root
4. **File permissions:** Sets proper permissions for web files
5. **CORS:** Configure `ALLOWED_ORIGINS` in `.env` for production

## 📦 Installed Components

After running the script, these components will be installed:

- **Node.js 18.x** - JavaScript runtime
- **NPM** - Package manager (comes with Node.js)
- **PM2** - Process manager for Node.js applications
- **Nginx** - Web server and reverse proxy
- **Build tools** - gcc, make, python3 (for native modules)
- **Puppeteer deps** - For PDF generation functionality

## 🎯 Architecture

```
┌─────────────┐
│   Browser   │
└──────┬──────┘
       │ Port 6100
       ▼
┌─────────────┐
│    Nginx    │ (Reverse Proxy)
└──────┬──────┘
       │
       ├─► /          → Static files (React build)
       │                  /var/www/.../client/build/
       │
       └─► /api/*     → Proxy to backend
                         http://localhost:6001
                         
┌─────────────┐
│   Node.js   │ (Backend API)
│    (PM2)    │ Port 6001
└─────────────┘
```

## 📞 Support

### Common Commands Reference

```bash
# View all logs
pm2 logs

# Restart everything
pm2 restart all && sudo systemctl restart nginx

# Check all services
pm2 status && sudo systemctl status nginx

# Monitor resources
pm2 monit

# Clear PM2 logs
pm2 flush

# Save PM2 state
pm2 save
```

## ✅ Success Indicators

Deployment is successful when you see:
- ✅ All green checkmarks in script output
- ✅ PM2 shows process as "online"
- ✅ Backend health check passes
- ✅ Frontend accessible in browser
- ✅ No errors in browser console
- ✅ Application functions correctly

## 🔄 Rollback Procedure

If deployment fails and you need to rollback:

```bash
# Stop current version
pm2 stop ndb-status-sender

# Restore backup
cd /var/www/html/ndb-status-sender
rm -rf ndb-status-sender
mv ndb-status-sender.backup.YYYYMMDD_HHMMSS ndb-status-sender
cd ndb-status-sender

# Restart
pm2 restart ndb-status-sender
```

---

**Remember:** This script is idempotent - you can run it multiple times safely. It will update existing installations without breaking anything.

For questions or issues, check the logs first:
- `pm2 logs ndb-status-sender` - Backend logs
- `sudo tail -f /var/log/nginx/error.log` - Nginx errors
- Script output - Shows each step's status

