# Weave: hello-loom v2

**Goal:** Extend hello-loom from client-only to full stack (client + server + docs) to prove Loom end-to-end.

**Scope:**
- client: `lighthouse/app/client/src/features/hello-loom/` — add route wiring to App.js, test
- server: `lighthouse/app/server/routes/hello-loom.js` — simple health endpoint
- docs: `features/hello-loom/docs/api.md` — update

**Done when:**
- client route renders at /hello-loom
- server GET /api/hello-loom returns {ok:true}
- docs updated
- shared build + mcp builds pass

**KPIs:**
- Developer: feature colocated, no localhost, minimal-architecture
- QA: route renders, API returns
- Docs: requirements + api complete
