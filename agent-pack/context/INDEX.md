# Context index — load order for any host

**Audience**: agent runtime / human onboarding a new host  
**Start here** when leaving Cursor or bootstrapping web/Slack.

## 1. Bootstrap (always)

1. `../identity/ops-assistant.md` — orchestrator
2. `../manifest.json` — skills, prompts, context registry
3. Constitutional rules listed in manifest (`../rules/`)
4. This file + `domain/app-surface-map.md`

## 2. Domain primers (read on demand)

| File | Use when |
|---|---|
| `domain/app-surface-map.md` | Need route → job → prompt map |
| `domain/release-gates.md` | Gate dates, RAG floors, phase language |
| `domain/jira-workflows-and-resolutions.md` | Status / resolution authenticity |
| `domain/jira-hygiene-and-collaterals.md` | Hygiene, links, stale status |
| `domain/deferral-tracking.md` | fixVersion kicks, chronic deferral |
| `domain/velocity-and-sprints.md` | Dev / QA verification / Test streams |
| `domain/leader-org.md` | SoS-by-leader rollup (Anil/Naveen/Jovan/Ashish) |
| `domain/ai-prompt-inventory.md` | Which production prompt lives where |

## 3. Page briefs (one per surface)

| File | Route |
|---|---|
| `pages/email-sender.md` | `/` |
| `pages/project-status.md` | `/project-status` |
| `pages/feature-dashboard.md` | `/feature-dashboard` |
| `pages/retrospective.md` | `/release/retrospective` |
| `pages/release-setup.md` | `/release-setup` |
| `pages/jira-emailer.md` | `/generic-emailer` |
| `pages/email-history.md` | `/email-history` |
| `pages/sprint-report.md` | `/sprint-report` |
| `pages/sprint-performance.md` | `/sprint-performance` |
| `pages/component-report.md` | `/component-report` |
| `pages/chatbot.md` | `/chatbot` |
| `pages/kpis.md` | `/kpis` |
| `pages/system-test-scale.md` | `/system-test-scale` |
| `pages/sos-summary.md` | `/sos-summary` |
| `pages/sos-leader.md` | `/sos-leader-summary` |
| `pages/release-brief.md` | `/release/brief` |
| `pages/release-config.md` | `/release-config` |
| `pages/admin.md` | `/team-management` |

## 4. Prompts

See `../prompts/INDEX.md`.

## 5. Engineering contracts (not duplicated here)

- Page requirements / data layer: `apps/delivery-ops/docs/pages/`
- API contracts: `apps/delivery-ops/docs/api/`
- AI LLD: `apps/delivery-ops/docs/LLD-ai-layer.md`
- Architecture: repo root `ARCHITECTURE.md`, `DECISIONS.md`, `FEATURE_CATALOG.md`
