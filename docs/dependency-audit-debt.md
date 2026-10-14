# Dependency audit debt

Tracked after the focused server remediation (2026-10-15). Do **not** run `npm audit fix --force` to chase these — it can propose breaking installs (e.g. `react-scripts@0.0.0`).

## Fixed in that pass

| Item | Change |
|------|--------|
| Server / shared `axios` | `^1.20.0` |
| Server `compression` | `^1.8.2` |
| Server `express` | `^4.22.3` (Express 4 only) |
| Server / shared `nodemailer` | `^10.1.1` (requires Node `>=20`) |
| Transitive criticals | Root `overrides`: `proxy-addr@2.0.8`, `tar@7.5.22`, `node-gyp.undici@6.29.0` |

Post-fix server audit target: **0 critical** (remaining findings are mostly Jest/dev tooling).

## Accepted debt (not blockers)

### CRA / `react-scripts` client tree

- Location: `apps/delivery-ops/client`
- Includes: `webpack-dev-server`, `webpack-dev-middleware`, `sockjs` / `uuid`, related high findings
- Why deferred: only fixed by leaving Create React App or a major toolchain upgrade
- Do not use `npm audit fix --force` here

### `xlsx` (SheetJS community)

- Location: client (and any workspace that pulls community `xlsx`)
- Advisories: prototype pollution / ReDoS — **no fix available** on the community package
- Resolution path: replace with a maintained fork or alternate library when spreadsheet export is next touched

### Jest / nodemon (devDependencies)

- Location: `apps/delivery-ops/server` (and workspace Jest trees)
- Severity often reports as high; not shipped in production `node index.js`
- Resolution path: planned Jest major upgrade (audit may suggest Jest 30) when convenient

### Other transitive / moderate noise

- Safe `npm audit fix` (no `--force`) may clear some of these over time
- Re-check with `npm audit` in `apps/delivery-ops/server` after dependency bumps

## How to re-verify

```bash
cd ndb-delivery-ops
npm audit --workspace ndb-status-sender-server
npm ls proxy-addr tar undici --workspace ndb-status-sender-server
```

Expect patched versions: `proxy-addr@2.0.8`, `tar@7.5.22`, `node-gyp` → `undici@6.29.0`.
