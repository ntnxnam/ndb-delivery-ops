# Dependency audit debt

Updated 2026-11-04 after production-path remediation. Do **not** run
`npm audit fix --force` — it proposes breaking installs (e.g. `react-scripts@0.0.0`).

## Current posture (2026-11-04)

| Workspace | Critical | High | Notes |
|-----------|---------:|-----:|-------|
| Server (`apps/delivery-ops/server`) | 0 | **0** | Remaining = Jest/nodemon moderate/low (dev) |
| MCP (`@portfolio-delivery-ops/mcp-lighthouse` + `@portfolio-delivery-ops/mcp-loom` + `@portfolio-delivery-ops/mcp-shared`) | 0 | **0** | Clean |
| Client (CRA) | 0 | 4 | Dev-toolchain only — see below |
| Monorepo root | 0 | 4 | Same 4 CRA findings |

## Fixed in this pass

| Item | Change |
|------|--------|
| Server `body-parser` | `^1.20.9` (Express 4 line) |
| MCP `body-parser` | override `2.4.0` (Express 5 line) |
| `follow-redirects` | override `1.16.2` |
| `undici` | overrides `6.29.1` / `7.30.1` |
| `zod` (shared + MCP) | `^4.6.7` |
| Client spreadsheet | community `xlsx` → `@e965/xlsx@^0.20.3` |
| `nodemailer` | `^10.3.1` |
| `qs` | override `6.17.1` |
| CRA transitives | overrides: `nth-check`, `node-forge`, `serialize-javascript`, `postcss@8.5.32`, `bfj`, `underscore`, `resolve-url-loader@5` |
| Prior criticals | Root overrides: `proxy-addr@2.0.8`, `tar@7.5.22` |

## Accepted debt (not blockers)

### CRA / `react-scripts` client tree — **4 remaining highs**

- Location: `apps/delivery-ops/client` via `react-scripts@5.0.1`
- Packages: `@svgr/plugin-svgo`, `svgo`, `webpack-dev-middleware`, `webpack-dev-server`
- Why deferred: only fixed by leaving Create React App (Vite or equivalent)
- Impact: **local `npm start` / webpack-dev-server**, not production Nginx static assets
- Do not use `npm audit fix --force` here

### Jest / nodemon (devDependencies)

- Location: `apps/delivery-ops/server`
- Severity often moderate; not shipped in production `node index.js`
- Resolution path: Jest major upgrade when convenient

### Other moderate noise

- Safe `npm audit fix` (no `--force`) may clear some over time
- Re-check with the commands below after dependency bumps

## How to re-verify

```bash
cd ndb-delivery-ops
npm audit --workspace apps/delivery-ops/server
npm audit --workspace @portfolio-delivery-ops/mcp-lighthouse
npm audit --workspace @portfolio-delivery-ops/mcp-loom
npm audit --workspace @portfolio-delivery-ops/mcp-shared
npm audit --workspace apps/delivery-ops/client
npm ls body-parser follow-redirects undici zod --workspace apps/delivery-ops/server
```

Expect: server/MCP **0 high**; client only the four CRA toolchain findings above.
