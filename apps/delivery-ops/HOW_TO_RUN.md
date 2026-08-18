# How to Run the Application

## Port reference

| Service | Dev port | Notes |
|---|---|---|
| Backend (Express) | `8001` | Set in `server/.env` as `PORT=8001` |
| Frontend (React dev server) | `8899` | Set in `client/package.json` `start` script |
| Production (Nginx) | `8899` | Public port; Nginx proxies `/api/*` to backend `8001` |

---

## Local development

### 1. Install dependencies

Run once from the repo root (workspace install covers all workspaces):

```bash
npm install
```

### 2. Configure the backend environment

```bash
cp apps/delivery-ops/server/.env.example apps/delivery-ops/server/.env
# Then edit server/.env — SMTP_*, AI_*, JIRA_TOKEN are the key fields.
# PORT is already set to 8001; do not change it without also updating client/package.json proxy.
```

### 3. Start both servers

```bash
# From repo root — starts backend on :8001 and React dev server on :8899
./scripts/start.sh
```

Or start them separately (from `apps/delivery-ops/`):

```bash
# Terminal 1 — backend
npm run server          # Express on http://localhost:8001

# Terminal 2 — frontend
npm run client          # React dev server on http://localhost:8899
```

Or use the `dev` script (both in one terminal via concurrently):

```bash
cd apps/delivery-ops && npm run dev
```

### 4. Open the app

- **Frontend**: http://localhost:8899
- **Backend API**: http://localhost:8001/api/health

### 5. Stop servers

```bash
./scripts/stop.sh
```

### 6. Restart servers

```bash
./scripts/restart.sh
```

---

## Pre-deploy localhost guard

Before shipping to production, verify no hardcoded `localhost` or `127.0.0.1` has crept into app code:

```bash
cd apps/delivery-ops && npm run check:no-localhost
```

This is also run automatically by `deploy-to-production.sh` before packaging.

---

## Production deployment

Production runs on a Rocky Linux 9 server behind Nginx + PM2. Two scripts handle the full lifecycle:

| Script | Where it runs | Purpose |
|---|---|---|
| `apps/delivery-ops/scripts/deploy-to-production.sh` | Your Mac | Runs the localhost guard, zips the repo, SCPs it to the server, SSHes in and runs the server-side script |
| `apps/delivery-ops/scripts/server-deploy.sh` | Production server | Idempotent: installs Node/Nginx/PM2 if missing, builds the client, writes PM2 + Nginx config, starts the backend |

### Quick deploy

```bash
# From anywhere in the repo
./apps/delivery-ops/scripts/deploy-to-production.sh
```

Both scripts are idempotent — the same command works for the first deploy and every subsequent redeploy.

See `DEPLOYMENT_GUIDE.md` for full production setup instructions.

---

## Troubleshooting

### Port already in use

```bash
# Find what's on port 8001 (backend)
lsof -i :8001

# Find what's on port 8899 (frontend)
lsof -i :8899

# Or just run stop.sh which clears both
./scripts/stop.sh
```

### Backend crashes on startup

```bash
tail -50 /tmp/server.log
```

Common causes: missing `server/.env`, wrong `PORT`, missing SMTP credentials.

### Dependencies not installed

```bash
# From repo root
npm install
```

### SMTP / email not working

1. Check `server/.env` has `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`.
2. Check `server/config/emailConfig.json` has `smtp.from` set.
3. From the server, run: `cd apps/delivery-ops/server && node test-smtp.js`

---

## Production build only (no server)

```bash
cd apps/delivery-ops/client && npm run build
# Output: apps/delivery-ops/client/build/
```
