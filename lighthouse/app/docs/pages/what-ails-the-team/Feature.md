# Feature — What ails the team

## Outcome

When an **exec-audience** user logs in, KPI, release, and feature pages show a **top-of-page executive summary** produced by NAI: multi-facet breakdown → stitch into one story → optional further compress. Density matches VP / team-exec persona (`persona-aware-output`).

## Scope

| In | Out |
|----|-----|
| `/kpis`, `/oncalls`, `/cfdcfi`, `/system-test-scale` | Sprint Report / Sprint Performance (unless later asked) |
| `/project-status` (release view) | Silent JQL edits |
| `/feature-dashboard` | New standalone route (band only) |
| Auth gate via `execAudienceUsers` → `exec_audience` | Inventing ticket keys |
| Multi-call NAI orchestration in `pageAiBriefingService` | Replacing existing manual ✦ AI Briefing for non-exec |

## Constraints (preserve)

- `ai-ticket-key-integrity` — VALID TICKET KEYS on every NAI call; no hallucinated keys
- `citation-first-output` / `jira-authenticity-links` — counts in intelligence remain linkable
- `jql-edit-approval` — compose onto existing queries only; no builder rewrites
- `minimal-architecture` — hook fetches; component renders; service orchestrates
- `no-localhost` / secrets — NAI key server-side only
- `visual-storyteller-ui` — plain-English story first; not a raw dump
- `ai-ticket-key-integrity` RAG panel chrome stays neutral (no triple RAG colouring)

## Architecture (target)

```
Client: usePermissions().isExecAudience → useExecPageBriefing → ExecPageBriefing (top band)
Server: POST /api/ai/page-briefing
  → pageAiBriefingService.buildPageBriefing
      1. Facet packages (deterministic)
      2. Parallel NAI facet briefs
      3. NAI stitch → single story
      4. If over budget → NAI compress
  → naiService (facet / stitch / compress prompts)
```

## Surfaces × existing reuse

| Surface | Data spine | NAI today | This feature |
|---------|------------|-----------|--------------|
| KPI family | pulse / KPI counts / OnCall intel | OnCalls only | Auto top band for exec |
| Release | `releaseAiSummaryService` | Manual toolbar | Auto for exec + multi-facet stitch |
| Feature | feature dashboard + exec-summary | Per-cell elsewhere | Auto top band via multi-facet stitch |

## Non-goals

- Full Phase-B role-lens UI (preview-as-X)
- Writing summaries into JIRA fields from this band
- Changing existing JQL builders
- Showing the auto band to non-exec users (manual Generate remains where it exists)
