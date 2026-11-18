# Deployment Guide

## Architecture

```
Browser ──:8899──> Nginx ──┬─ /       → React build (static files)
                           ├─ /api/*  → Node backend (PM2) :8001
                           └─ /bin-packing → Node backend (PM2) :8001
```

| Service | Port | Notes |
|---|---|---|
| Nginx (public) | `8899` | HTTP_PORT in deploy scripts |
| Node backend (PM2) | `8001` | BACKEND_PORT in deploy scripts |

---

## Quick deploy (from your Mac)

```bash
./apps/delivery-ops/scripts/deploy-to-production.sh
```

That's it. The script:
1. Runs the localhost guard (`npm run check:no-localhost`) — fails early if violated
2. Zips the repo (excludes `node_modules`, `.git`, `build`, `server/.env`)
3. SCPs the archive to the production server
4. SSHes in, extracts the archive, and runs `server-deploy.sh`

Both scripts are **idempotent** — the same command works for first deploy and every redeploy.

### Options

```
./deploy-to-production.sh --server user@host   # override SSH target
                          --path /var/www/...  # override remote path
                          --http-port 8899     # override Nginx port
                          --app-name NAME      # override PM2 app name
                          --yes                # skip confirmation prompt
```

Defaults are set at the top of `deploy-to-production.sh`. Edit `PRODUCTION_SERVER` and `SERVER_PATH` there (or pass `--server` / `--path` each time).

---

## What happens on the server (`server-deploy.sh`)

The server-side script runs on **Rocky Linux 9**. Steps (all idempotent):

1. Installs Node 20.x, build tools, Nginx, PM2 — only if missing
2. Seeds `server/.env` from `server/.env.example` if absent; writes `PORT=8001`
3. Runs `npm install` from repo root
4. Builds the React client (`CI= npm run build`)
5. Writes Nginx config to `/etc/nginx/conf.d/delivery-ops.conf`
6. Configures SELinux (`httpd_can_network_connect`) and firewall if active
7. Writes PM2 `ecosystem.config.js` and starts/reloads the backend
8. Health-checks both backend (`:8001/api/health`) and Nginx (`:8899/api/health`)

### Overridable environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PRODUCTION_SERVER` | set in script | SSH target (`user@host`) |
| `SERVER_PATH` | `/var/www/html/ndb-delivery-ops` | Remote deploy path |
| `HTTP_PORT` | `8899` | Public Nginx port |
| `BACKEND_PORT` | `8001` | Internal Node port |
| `PM2_APP_NAME` | `delivery-ops` | PM2 process name |
| `NODE_MAJOR` | `20` | Node major version to install |

---

## Pre-deploy checklist

- [ ] `server/.env` on the production server has correct `SMTP_*` and `AI_*` values
- [ ] `server/config/emailConfig.json` has `smtp.from` set to the service account
- [ ] `PRODUCTION_SERVER` in `deploy-to-production.sh` points to the right box
- [ ] `npm run check:no-localhost` passes locally (also run automatically by deploy script)

---

## Post-deploy verification

```bash
# Backend health (direct)
curl http://<server-ip>:8001/api/health

# Backend health via Nginx
curl http://<server-ip>:8899/api/health

# PM2 status
ssh user@host 'pm2 status'

# Live backend logs
ssh user@host 'pm2 logs delivery-ops'

# Nginx error log
ssh user@host 'sudo tail -f /var/log/nginx/error.log'
```

---

## Common operations on the server

```bash
# Restart backend only
pm2 restart delivery-ops

# Restart Nginx
sudo systemctl restart nginx

# Rebuild frontend only (after client code change)
cd /var/www/html/ndb-delivery-ops/apps/delivery-ops/client
npm run build
sudo systemctl reload nginx

# View all logs
pm2 logs

# Check listening ports
sudo ss -tulnp | grep -E ':(8001|8899)'
```

---

## Rollback

Each deploy backs up the current `server/.env` and Nginx config to `<SERVER_PATH>_backups/backup_<timestamp>/`. To roll back code, redeploy an earlier archive. The `.env` is never overwritten by the deploy script — it is always preserved.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `502 Bad Gateway` | `pm2 status` — backend not running; `pm2 logs delivery-ops` |
| Frontend loads but API calls fail | Nginx proxy config: `sudo nginx -t` |
| PM2 in `errored` state | Port conflict: `sudo lsof -ti :8001 | xargs kill -9` then `pm2 restart delivery-ops` |
| SELinux blocking Nginx | `sudo setsebool -P httpd_can_network_connect 1` |
| Build fails (`Maximum call stack`) | Corrupt node_modules: `rm -rf node_modules && npm install` from repo root |
