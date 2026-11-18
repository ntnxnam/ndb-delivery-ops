# Plan — What ails the team

## Proposed KPIs (baselines → targets)

| KPI | Baseline | Target | Evidence |
|-----|----------|--------|----------|
| Exec pages with auto summary | 0 of 3 families | 3/3 (KPI, release, feature) | Page wiring + tests |
| NAI call pattern | 1-shot | ≥2 facets + stitch (+ compress if over budget) | Service unit test |
| Non-exec auto-fetch | n/a | 0 auto calls | Gate test |
| Ticket-key integrity | release/oncall prompts | Same rules on facet/stitch/compress | Prompt + review |
| p95 briefing latency (warm) | unknown | Prefer <45s via parallel facets | Parallel `Promise.all` |
| Auth/secrets | existing | Route auth + server AI key | Security review |

## Steps

1. **Docs trackers** — Feature / GOALS / PLAN / STATUS (this folder)
2. **Auth** — `execAudienceUsers` in `allowedUsers.json` → `exec_audience` + role `team_exec`; client `useIsExecAudience`
3. **NAI prompts** — facet / stitch / compress in `naiService.js` (+ agent-pack prompt stub if needed)
4. **Service** — `pageAiBriefingService.js` builds facets per surface, parallel NAI, stitch, compress
5. **Route** — `POST /api/ai/page-briefing` + `docs/api/ai.md`
6. **UI kit** — `ExecPageBriefing` + `useExecPageBriefing`
7. **Wire pages** — KPIPage, OncallsPage, CfdCfiPage, SystemTestScalePage, ReleaseVersionTab, FeatureDashboardPage
8. **Tests** — orchestration + gate + render
9. **Pipeline** — Code Review → QA → UX → PM → Exec → JIRA → Fix → Security

## Workstream split (delegate only when independent)

| Stream | Owner | Depends on |
|--------|-------|------------|
| Auth gate | Dev (main) | — |
| Service + NAI + route | Dev (main) | Auth optional |
| Client band + hooks | Dev (main) | Route contract |
| Page wiring | Dev (main) | Band |
| Adversarial review stages | Sub-agents | Code landed |

## Non-goals (do not schedule)

- Preview-as-X role lens chrome
- Pushing band text to JIRA `customfield_38460`
- Editing JQL builders
- Sprint Performance / Retrospective pages
