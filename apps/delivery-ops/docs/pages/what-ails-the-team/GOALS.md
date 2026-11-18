# Goals — What ails the team

```
GOAL: On KPI, release, and feature pages, exec login auto-shows a succinct
      VP/exec NAI summary built by multi-facet calls → stitch → optional compress.
SCOPE: delivery-ops client pages + /api/ai/page-briefing + auth execAudienceUsers
DONE WHEN (pipeline exit):
  1. Exec users see a top-of-page executive summary on all three surface families
  2. Server path makes ≥2 facet NAI calls, stitches, and compresses when over budget
  3. Non-exec users do not auto-load the band (manual paths unchanged)
  4. Ticket-key integrity + no silent JQL edits + API/page docs present
  5. Tests (or equivalent evidence) prove gate + orchestration + render
```

## Primary goals

| ID | Goal | Done when | Baseline | Evidence source |
|----|------|-----------|----------|-----------------|
| G1 | Exec top band on KPI pages | `/kpis`, `/oncalls`, `/cfdcfi`, `/system-test-scale` render `ExecPageBriefing` for `exec_audience` | No auto exec band (OnCalls manual/auto briefing only) | Component tests + STATUS |
| G2 | Exec top band on release page | `/project-status` auto-fetches briefing for exec | Manual ✦ AI Briefing only | Hook/page test + STATUS |
| G3 | Exec top band on feature page | `/feature-dashboard` shows stitched summary for exec | No NAI on Feature Dashboard | Component test + STATUS |
| G4 | Multi-call NAI stitch | `pageAiBriefingService` runs facet calls in parallel, stitch call, compress when `chars > budget` | Single-shot release/oncall summaries | Unit tests on orchestration |
| G5 | Persona gate | Only `execAudienceUsers` → `exec_audience` auto-loads | All users get `ai_insights_view` by default | Auth mapping test |
| G6 | Performance / reliability | Facet calls parallel; timeout + graceful error; no request storm on empty context | N/A | Service code + QA |
| G7 | Security / compliance | NAI key server-only; auth required; no ticket-key hallucination; no localhost | Existing naiService | Security stage |

## Goal KPI Card (pipeline)

```
AGENT KPIs:
  Developer:
    - D1 Surfaces wired for exec auto-band (KPI family + release + feature)
    - D2 pageAiBriefingService: facets → parallel NAI → stitch → optional compress
    - D3 execAudienceUsers → exec_audience permission + useIsExecAudience
    - D4 docs: Feature/GOALS/PLAN/STATUS + api/ai.md page-briefing entry
    - D5 No JQL builder edits; ticket-key integrity in prompts
  Code Review:
    - CR1 Layering (hook/service/component); file-size limits
    - CR2 No useEffect storms; no secrets in client
  QA:
    - Q1 Exec gate: without permission band does not auto-fetch
    - Q2 With permission + context, band renders summary markdown
    - Q3 Orchestration test: ≥2 facet + 1 stitch (+ compress path)
  UX:
    - U1 Top-of-page band, story-first, ui-density, neutral chrome
    - U2 Empty/loading/error states readable for exec skim
  PM:
    - P1 Outcome matches GOAL (exec succinct summary on three surface families)
    - P2 Non-goals respected; AC testable
  Exec:
    - E1 VP density: verdict + what ails + chase in ≤10s skim
    - E2 Citations / ticket keys only from VALID list
  JIRA Query Check:
    - J1 No silent JQL edits; any counts in intel keep existing authenticity
  Security:
    - S1 Auth on route; AI key server-side; no localhost; no unsafe HTML injection
```

## Verification artifacts

- Unit tests: `pageAiBriefingService` (orchestration), auth mapping, `ExecPageBriefing` / hook gate
- API doc: `docs/api/ai.md` → `POST /api/ai/page-briefing`
- STATUS.md KPI scorecard with MET evidence
