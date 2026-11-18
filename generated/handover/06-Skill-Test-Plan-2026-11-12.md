# Skill Test Plan — Exhaustive Coverage (19 active + 4 deprecated + 2 unmanifested = 25 dirs)

> Generated 2026-11-12. Covers merges A (release-gate-ops) + B (ticket-insights). Run: `npm test -- skills/` + `node shared/scripts/smoke-skills.mjs`

## 1. Test Pyramid

| Level | What | Where | Count | Status |
|---|---|---|---|---|
| **Unit — contract** | Frontmatter, sections, manifest, routing invariants, deprecated stubs | `apps/delivery-ops/server/__tests__/skills/skill-contract.test.js` | 68 tests | ✅ PASS |
| **Functional** | Route detection, validation, JQL, Dev/QA, MTTR, triage, dependency, sync | `apps/delivery-ops/server/__tests__/skills/skill-functional.test.js` | 56 tests | ✅ PASS |
| **Smoke** | Manifest + filesystem + symlinks + merged-skill smoke | `shared/scripts/smoke-skills.mjs` + `smoke-agent-pack.mjs` | 14 checks | ✅ PASS |
| **Total** | | | **138 checks** | **PASS** |

## 2. Unit Tests (skill-contract.test.js) — 68 tests across 7 suites

### 2.1 Skill filesystem integrity (7 tests)
- [x] all filesystem skills exist (25 dirs + README)
- [x] manifest has 19 active skills
- [x] no duplicate skill names in manifest
- [x] every manifest skill has SKILL.md
- [x] every manifest skill path matches `skills/<name>/SKILL.md`
- [x] deprecated stubs NOT in manifest but on filesystem
- [x] cursor host symlinks exist (4 hosts: .cursor/.claude/.codex/.agents)

### 2.2 Skill frontmatter (40+ tests, parameterized per skill)
- [x] Each of 19 active has `name` + `description` (19 tests)
- [x] Each description has `Use when` or active verb (detect/generate/fetch/etc) (19 tests)
- [x] Each non-builder description has Use when trigger (17 tests)
- [x] Deprecated stubs have DEPRECATED description with correct target (1 test, 4 assertions: move-gate-date→release-gate-ops, update→release-gate-ops, fetch→ticket-insights, issue→ticket-insights)
- [x] Builder skills have `disable-model-invocation: true` (1 test)
- [x] Non-builder skills do NOT have disable-model-invocation (1 test)

### 2.3 Skill required sections (15+ tests)
- [x] 14 regular skills have all 5 required sections (When to Use / Quick Start / Core Rules / Output Format / Quality Validation) — parameterized per skill
- [x] 5 reference/domain-specific skills (team-exec-release-report, predictive-team-exec-analytics, sprint-gantt-chart, confluence-width-cleanup, release-dataset-sync) have When to Use + domain section
- [x] Deprecated stubs have # DEPRECATED header (1 test)

### 2.4 Merged skill invariants (6 tests)
- [x] release-gate-ops has Route J + Route C with 3 field IDs, releaseVersionsEmailConfig.json, dotted/solid, sprintDates, inconsistent_state
- [x] release-gate-ops routes by target (ticketKey vs release vs ambiguous)
- [x] ticket-insights has fetch (8-clause, JQL primitives) + breakdown (6 groups, Dev/QA, QA verification, 0.33, FEAT ID, IN)
- [x] ticket-insights has all 6 group JQL templates
- [x] deprecated fetch-project-tickets → ticket-insights (dates)
- [x] deprecated move-gate-date → release-gate-ops Route J

### 2.5 Manifest consistency (5 tests)
- [x] All 19 have valid capabilityType (agent/agentic/deterministic/generative) + toolClass (read/draft/mutate)
- [x] Only release-gate-ops is mutate (1/19)
- [x] rm-specialist owns release-gate-ops + release-dataset-sync
- [x] tpm-specialist owns ticket-insights + kpi-pulse-analytics + sprint-gantt-chart
- [x] Merged skills have notes with Merged 2026-11-12

### 2.6 Filesystem-only skills (2 tests)
- [x] era-csv-jira-import exists but not in manifest (documented anomaly, not DEPRECATED)
- [x] ndb-delivery-ops-deploy exists but not in manifest (infra skill)

## 3. Functional Tests (skill-functional.test.js) — 56 tests across 9 suites

### 3.1 release-gate-ops (7 tests)
| Test | Validates |
|---|---|
| Route detection: ticketKey→J, release→C, both→ambiguous, none→ask (6 cases) | Quick Start routing |
| Route J validates 3 allowed fields only (cc11067/cc35863/cc35864) | Core Rules #5 |
| Route J reason mandatory (whitespace/n/a rejected) | Core Rules #2, D30 |
| Route J date format YYYY-MM-DD | Tool Contract validation |
| Route C slip pattern: dotted previous + solid new with next number | Core Rules #8 |
| Route C gate prefix→color mapping (ga/ccm/commitGate/promotionGate) | Core Rules #8 table |
| Sprint extension: date after last sprint triggers 21-day Wed extension | Core Rules #9 |

### 3.2 ticket-insights (10 tests)
| Test | Validates |
|---|---|
| Route: FEAT-1234→feature, NDB-2.11→release, invalid→invalid (6 cases) | Quick Start routing |
| Project key format /^[A-Z]+-\d+$/ | Core Rules #1 |
| 6 groups cover all types without gap (hierarchy/bug/improvement/devCode/test/everythingElse) | Core Rules #10 |
| Dev vs QA split: != Test vs = Test (4 dev, 1 qa) | Core Rules #13 |
| QA verification: closed Bug+Improvement * 0.33 = 29.7→30 | Core Rules #13 |
| JQL uses ~ for FEAT ID never = | Core Rules #3, D40 |
| Bulk IN: single→key= OR ~, multi→IN (...) (93% faster) | Core Rules #2 |
| Group percentages sum to 100% (660 total, 6 groups) | Quality Validation |
| Zero-count groups included (6 groups, 2 zero) | Core Rules #10 |
| Every metric has JIRA link from exact JQL (encodeURIComponent) | Output Format |

### 3.3 Triage skills (4 tests)
| Test | Validates |
|---|---|
| bug-triage: proposes never auto-applies (propose vs assign) | D19 draft-only |
| crisis-triage: escalation when P0/sev1 (priority/severity check) | D19 P0→crisis |
| stale-ticket-sweep: idle > N days (21 vs 7 days, now=2026-11-12) | Sweep definition |
| pending-response-chase: unreplied JIRA comment D24 (no reply + threshold) | D24 detection |

### 3.4 dependency-walk (2 tests)
| Test | Validates |
|---|---|
| Upstream walk: what blocks FEAT-3 → [FEAT-2, FEAT-1] (depth 3) | D18 upstreamOf |
| Critical path: longest chain [A,B,E,F] length 4 | Downstream/criticalPath |

### 3.5 kpi-pulse-analytics (3 tests)
| Test | Validates |
|---|---|
| Last 2 Nutanix Qs window (FY25-Q3/Q4) | Pulse band |
| MTTR: (4+2+7)/3=4.33 days | MTTR tile |
| Created vs resolved: cumulative (30/33) vs point-in-time (8/15) | Toggle |

### 3.6 sprint-gantt-chart (1 test)
| Test | Validates |
|---|---|
| Date hierarchy: FEAT gate > Epic duedate > sprint-end | jira-date-hierarchy.mdc |

### 3.7 release-dataset-sync (5 tests)
| Test | Validates |
|---|---|
| 3 groups: committed + moved_out + long_term | Fetch Model |
| 6 buckets in Group 1 (top_level/epics/work/standalone/etc) | Group 1 |
| No project=ERA scope on any bucket (cross-project D36) | Core Rules #4 |
| Hierarchy field IDs: Parent 20363, Epic 10361, Sprint 10360 (not 10017/10020) | Field List |
| In-memory hierarchy: epicsByFeature + tasksByEpic from flatDump | Reconstruction |

### 3.8 Builder skills (2 tests)
| Test | Validates |
|---|---|
| multi-model-review: intent→model_selection→parallel_reviewers→synthesis | Pipeline stage 2 |
| exec-perspective: high-level RAG then drill-down ERA-123 | Pipeline stage 5 |

### 3.9 Exhaustive coverage (3 tests)
| Test | Validates |
|---|---|
| All 19 active have coverage (12 functional + 7 contract-only) | No skill left untested |
| All 4 deprecated redirect correctly with 2026-12-12 | Merge integrity |
| Total distinct = 25 dirs (19 active + 4 deprecated + 2 unmanifested) | Filesystem vs manifest |

## 4. Smoke Tests (shared/scripts/smoke-skills.mjs + smoke-agent-pack.mjs)

| Check | Expected | Result |
|---|---|---|
| manifest: 19 skills | 19 | ✅ |
| filesystem: 25 skill dirs | 25 | ✅ |
| no duplicate names | 19 unique | ✅ |
| all manifest skills have SKILL.md | 19 files | ✅ |
| deprecated stubs: 4 correct (DEPRECATED marker) | 4 | ✅ |
| release-gate-ops: Route J/C + 3 fields + slip | 6 needles | ✅ |
| ticket-insights: 8-clause + 6 groups + Dev/QA | 6 needles | ✅ |
| frontmatter: all 19 valid (name+description) | 19 | ✅ |
| required sections: 14 regular have all 5 (5 exempt) | 14 | ✅ |
| builder: disable-model-invocation | 2 | ✅ |
| toolClass mutate: only release-gate-ops | 1 | ✅ |
| symlinks: 4 hosts | 4 | ✅ |
| rm-specialist owns release-gate-ops + release-dataset-sync | 2 | ✅ |
| tpm-specialist owns ticket-insights + others | 6 | ✅ |
| agent-pack identities: 7, skills 19, workflows 3, rules 12 | — | ✅ |

## 5. Manual / Integration (out of scope for unit, covered by existing suites)

| Skill | Existing integration test | Status |
|---|---|---|
| release-gate-ops Route J (DateMoverService) | `shared/src/services/dateMoverService.ts` + `mcp-server/src/tools/moveJiraDates.ts` dryRun | HITL-queued (D26) — manual verify with PAT |
| ticket-insights via ticketFetchService | `shared/src/services/ticketFetchService.ts` 28 base + 11 D1 tests | ✅ wired in routes/jira/index.js#/issue-breakdown |
| release-dataset-sync | `POST /api/release-sync` + `smoke-wave3.mjs` + 57 e2e | ✅ Phase 3 ported (134 unit + 57 e2e) |
| weekly-status-email | `pageAiBriefingService.test.js`, `emailService.test.js` | ✅ |
| kpi-pulse-analytics | `kpiPulseService.test.js`, `kpis/*.test.js` | ✅ |
| dependency-walk | `dependencyViewService` + `GET /api/dependency/*` | ✅ |
| triage (4 flavours) | SPEC-ONLY — no runtime service; agent prompt only (HITL) | — |
| confluence-width-cleanup | `confluence-width-cleanup/SKILL.md` transform (DOM pass) | manual Confluence preview |
| ndb-delivery-ops-deploy | `apps/delivery-ops/scripts/deploy-to-production.sh --dry-run` | manual |
| era-csv-jira-import | `~/Downloads/authz-import/internal_import.py --dry-run` | manual + idempotent log |

## 6. How to Run

```bash
# Unit + functional (124 tests)
npm --workspace apps/delivery-ops/server test -- --testPathPattern="skills/" --no-coverage

# Smoke (14 checks)
node shared/scripts/smoke-skills.mjs
node shared/scripts/smoke-agent-pack.mjs

# Full suite (optional, ~200+ tests)
npm --workspace apps/delivery-ops/server test -- --no-coverage
npm --workspace apps/delivery-ops/client test -- --watchAll=false
npm --workspace shared run smoke:wave3
```
