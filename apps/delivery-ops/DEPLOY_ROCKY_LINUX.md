# Deploy to Rocky Linux / RHEL

## Prerequisites

1. **Open firewall ports**:
```bash
sudo firewall-cmd --permanent --add-port=6100/tcp
sudo firewall-cmd --permanent --add-port=6001/tcp
sudo firewall-cmd --reload
```

2. **Configure SELinux** (if enabled):
```bash
sudo semanage port -a -t http_port_t -p tcp 6100
sudo semanage port -a -t http_port_t -p tcp 6001
# If semanage not found: sudo dnf install -y policycoreutils-python-utils
```

## Installation

1. **Copy files to server**:
```bash
scp -r /path/to/ndb-status-sender user@server:/var/www/html/
```

2. **Run installation script**:
```bash
cd /var/www/html/ndb-status-sender
bash install.sh
```

3. **Create client/.env file** (for FQDN access):
```bash
echo "DANGEROUSLY_DISABLE_HOST_CHECK=true" > client/.env
```

## Running the App

### Development Mode (Recommended for QA):
```bash
npm run dev
```
Access at: http://ndb-qa.dev.nutanix.com:6100/

### Production Mode with PM2:
```bash
pm2 start ecosystem.dev.config.js
pm2 save
pm2 startup
```

## Troubleshooting

**Port already in use**:
```bash
sudo fuser -k 6100/tcp
sudo fuser -k 6001/tcp
```

**Cannot access via FQDN**:
- Ensure client/.env has `DANGEROUSLY_DISABLE_HOST_CHECK=true`
- Check firewall: `sudo firewall-cmd --list-ports`
- Verify binding: `sudo netstat -tlnp | grep -E '6100|6001'`

**Dependency errors**:
```bash
bash install.sh
```

