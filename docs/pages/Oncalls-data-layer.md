# Oncalls — Data Layer

**Route**: `/oncalls`  
**Component**: `OncallsPage`  
**Hook**: `useOncalls`

---

## API endpoints called

| Method | Path | When |
|--------|------|------|
| GET | `/api/jira/oncalls?teamId=` | Initial load / team change |
| POST | `/api/jira/oncalls/refresh` | Pull from JIRA |
| POST | `/api/ai/oncall-summary` | Generate AI Briefing |
| POST | `/api/ai/oncall-blurbs` | Path / escalation drill About + comments |

---

## Server flow

```
GET/POST /api/jira/oncalls
  → checkKpiViewAuthorization
  → oncallService.getDashboard({ token, teamId })  [orchestrator]
       → oncallConfigResolve (OnCalls KPI baseQuery from kpiConfig)
       → buildPulse({ baseJql: baseScopeJql, optionalHeroes: p0/p1 })  [soft-fail]
         Current: pulse/path = OnCall seeds; path chips may be sample-capped (key in (...))
         Portfolio: gap chips sample-scoped; linked footprint = linkedIssuesOf(KPI baseQuery), all statuses
         Past: closed seeds in pastLookbackDays + path chips + tickets table
       → oncallStacksService (open/past classify)
       → oncallEscalationService (CFD/CFI KPIs + days-to-clear)
       → deterministic RAG

POST /api/ai/oncall-summary  Body: { teamId, dashboard? }
  → oncallAiSummaryService.buildIntelligence
  → naiService.generateOncallSummary

POST /api/ai/oncall-blurbs  Body: { teamId, keys }
  → oncallBlurbService.buildOncallBlurbs
       → narrative bundles + NAI About (20s batch timeout)
       → about (NAI) or pathHint (structured); UI shows one drawer banner when about missing
```

Modules: `oncallService.js` (orchestrator) · `oncallConfigResolve.js` · `oncallStacksService.js` · `oncallEscalationService.js` · `kpiPulseService.js` · `oncallBlurbService.js`

---

## Domain classification

| Role | Rule |
|------|------|
| `oncall` | Seed issue in OnCall project |
| `techhelp` | Linked issue whose project is in `oncallConfig.techHelpProjects` |
| `knowledge` | Linked SR / knowledge projects |
| `techpubs` | Linked TECHPUBS |
| `eng_fix` | Linked issue that is neither OnCall nor TechHelp (optional allowlist `engFixProjects`; empty = any) |

### Escalation to CFD/CFI (or other KPIs)

Config: `oncallConfig.escalation.kpiNamePattern` (default `CFD|CFI`).

1. Fetch OnCalls in window: open OR `resolved >= -{lookbackDays}d`
2. Collect linked non-OnCall/non-TechHelp keys
3. For each matched KPI, resolve filter JQL and intersect `key in (linkedKeys) AND (kpiJql)`
4. Days clock: `OnCall.created → linked.resolutiondate` (still-open rows show days so far)
5. UI: `EscalationDrill` pairs; **status chip = real JIRA `status`** (Closed stays Closed). Modes: `stillOpen` / `resolved` (done bucket) / `withEscalation`.
6. **Open in JIRA proof** (filter-style, not `key in (...)`):
   - Reached: `(OnCall window) AND issueFunction in linkedIssuesOf("<CFD|CFI KPI union>")`
   - Still open: same with KPI union ∧ `statusCategory != Done`
   - Cleared: linked to done KPI tickets and `issueFunction not in linkedIssuesOf(open KPI union)`
   Tile counts use `searchCount` on those JQLs so Open in JIRA matches the number.

---

## Caching

- Ticket narrative / blurbs: short-lived per key
- Dashboard counts + pulse: live on load / Pull (no durable cache)

---

## Error handling

| Case | Client |
|------|--------|
| 403 | Show access denied |
| JIRA timeout / partial count errors | Surface `errors` map; show zeros with warning |
| `errors.pulse` | KpiPulseBand error; rest of page loads |
| NAI missing key | 400 `NAI_API_KEY is not set` |
| NAI / About timeout | Drawer banner once; pathHint on rows; AI panel error for briefing |
