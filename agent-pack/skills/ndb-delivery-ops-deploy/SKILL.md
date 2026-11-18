---
name: ndb-delivery-ops-deploy
description: Deploy the NDB Delivery Ops (portfolio-delivery-ops) monorepo to the production Rocky/Nginx+PM2 server. Use when the user says deploy delivery-ops, ship OnCalls/KPI changes to production, run the ndb deployment agent, redeploy, or push to santhosh-s / production box.
---

## When to Use This Skill

- User asks to **deploy** / **redeploy** Delivery Ops / NDB Ops Tools web app
- User says **ndb deployment agent**, ship to production, or push OnCalls / KPI UI live
- After merging or finishing local features that must land on the production server

## Quick Start

From the monorepo root (`…/NDB-Ops-Tools/ndb-delivery-ops`):

```bash
./apps/delivery-ops/scripts/deploy-to-production.sh --yes
```

Defaults (override with flags or env):

| Setting | Default |
|---------|---------|
| Server | `santhosh.s@santhosh-s-1.umsvm.nutanix.com` |
| Path | `/var/www/html/ndb-delivery-ops` |
| Nginx port | `8899` |
| PM2 app | `delivery-ops` |

```bash
./apps/delivery-ops/scripts/deploy-to-production.sh \
  --server user@host \
  --path /var/www/html/ndb-delivery-ops \
  --http-port 8899 \
  --yes
```

## Core Rules

1. **Always use `--yes`** when the agent runs the script (non-interactive). Ask the user before deploying if they did not clearly request a production ship.
2. **Run from monorepo root** so `REPO_ROOT` resolves to `ndb-delivery-ops` (script walks up from `apps/delivery-ops/scripts/`).
3. **Do not commit or overwrite `server/.env` on the server** — the deploy rsync excludes it; preserve production secrets.
4. **No-localhost guard runs first** — if `npm run check:no-localhost` fails, fix app code before retrying; do not bypass.
5. **Verify after deploy** (required by verify-before-claiming-success):
   - `ssh <server> 'pm2 status delivery-ops'`
   - HTTP probe to `http://<server-host>:8899` (or report URL from script output)
   - On failure, show `pm2 logs delivery-ops --lines 40` rather than claiming success
6. **This is not** `restart.sh` (local only) and not NDB product `ndb_deployment_tool`.

## What the script does

1. Localhost guard on `apps/delivery-ops`
2. Zip monorepo (excludes `node_modules`, `.git`, `build`, logs, `server/.env`)
3. SCP to server → extract → rsync into `SERVER_PATH`
4. Run `apps/delivery-ops/scripts/server-deploy.sh` (Node/Nginx/PM2, client build, restart)

Docs: `apps/delivery-ops/DEPLOYMENT_GUIDE.md`, `apps/delivery-ops/HOW_TO_RUN.md`.

## Output Format

After running, report in short form:

```
Deploy: <success|failed>
Server: <user@host>:<path>
URL: http://<host>:<port>
PM2: <status line or log excerpt on failure>
```

## Quality Validation

- [ ] Deploy script exited 0
- [ ] PM2 process `delivery-ops` is online
- [ ] HTTP probe to public port returns 200 or 401 (not connection refused)
- [ ] Did not claim success from zip/SCP alone
