# Goal KPI Card — Fix HAR API failing (oncall-concern 404/400)

GOAL: Fix oncalls HAR API failing — POST /api/ai/oncall-concern returns 404/400 when NAI key missing, and GET /oncalls 7d is slow (4525ms).

SCOPE: apps/delivery-ops/server/routes/ai.js (oncall-concern fallback), server/services/naiService.js (deterministic fallback), server/services/oncallDashboardV2.js (hero cache already), client/src/components/OncallsV2/OncallsV2Page.js (graceful AI error UI)

DONE WHEN:
1. POST /api/ai/oncall-concern with missing NAI_API_KEY returns 200 with deterministic fallback summary (no 404/400), UI shows concern via pulse story + hotspot
2. GET /api/jira/oncalls?teamId=ndb&timeframe=7d&v2=1 stays <3s warm (5m hero cache hit) — HAR 4525ms is ok cold, but warm must be <1s
3. No regression to existing oncalls V2 pills/dual-click/print/7d

AGENT KPIs:
  Developer: [oncall-concern returns 200 fallback when NAI missing; hero cache verified; no hardcoded localhost]
  QA: [oncall-concern returns 200 with fallback summary when NAI missing; oncalls 7d returns 200 with hero counts]
  UX: [AI Concern error banner shows retry, not red Not Found; skeleton persists]
  PM: [VP still gets concern even without NAI; no silent AI failure]
  Exec: [Story still present via fallback, not blank]
  JIRA: [hero JQL still baseScopeJql + statusCategory, no invented wrapper]
  Compile: [0 errors]
