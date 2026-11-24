# Weave Smoke Checklist

> Run this on every weave before Code Review. Block merge if any check fails.

## 1. Server smoke
- [ ] `node -e "require('./apps/delivery-ops/server/services/<newService>')"` — no throw
- [ ] `node --check apps/delivery-ops/server/routes/<newRoute>.js` — syntax OK

## 2. Route smoke (supertest)
- [ ] New `server/routes/*.js` has a test under `server/__tests__/**` referencing the route basename (e.g. `configAdmin` in `configAdmin.test.js`)
- [ ] Test hits the route via `supertest(app)` and asserts `200` + payload shape; or PR body contains `smoke-tested` with evidence

## 3. Client smoke (@testing-library)
- [ ] New `client/src/components/**/*.js` page has a test under `client/src/__tests__/**` referencing it
- [ ] Test renders the page and asserts key heading/CTA; no `localhost` in JSX

## 4. Config validity
- [ ] Any new `server/config/*.json` is valid JSON (`JSON.parse` passes)
- [ ] Config key is read via `configService` / `fieldConfig`, not hardcoded

## 5. Sidebar / nav wiring
- [ ] Every new `path="/..."` in `client/src/App.js` appears in `layout/utils/sidebarNavConfig.js`
- [ ] Or the route line has an explicit opt-out comment: `// smoke:ignore-nav`

## Run
```bash
node scripts/loom/checks/check-weave-smoke.js   # TAP PASS/FAIL, exit 1 on FAIL
npm --workspace apps/delivery-ops test -- --testPathPattern=<newRoutes>
```
