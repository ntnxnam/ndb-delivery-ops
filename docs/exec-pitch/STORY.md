# Project Lighthouse — Story spine (content SoT)

## Audience rule
**Executives do not need ticket keys.** Outcomes, ownership, cadence.
JCH ticket lists = TPM audit only.
**Never put meta deck-talk on slides** (“this deck is…”, “not a beauty parade”). State what Lighthouse *is*.

## Mission / Vision
- **Mission:** Honest, usable operational truth; ownership on who can act.
- **Vision:** Shine → Suggest → Fix (HITL). Operational Truth first.

## How the framework was built (4 pillars — plain language for newcomers)
1. **Trust the numbers** — JIRA SoR + board hygiene + clickable counts  
2. **Run the release train** — Pre-CC*(soft)* → **CC** → Pre-EC*(soft)* → EC → Code Complete → CG → PG → GA  
   Capacity sizing + bin-pack at Pre-CC→CC (before EC). Patch/maint = Code Complete + GA only.  
3. **Pulse every week** — NDB Ops weekly: OnCalls, CFD/CFI first  
4. **Assist, then act safely** — EM reminders, AI with receipts, human before write  
Slide 02 = marketing intro (no acronym soup). Unpack jargon on later slides.  

## Weekly NDB Ops KPIs (kpiConfig NDB)
Standing weekly focus (not ad-hoc):
- **OnCalls** (`project=OnCall`)
- **Top-CFD / Top-CFI / Non-Top-CFD / Non-Top-CFI**
- Product Blockers (P0), Product Criticals (P1)
- System Test, Smokes, NDB PreCommits, CVE, Deferral  

Surfaces: `/kpis`, SoS KPI strip.

## Automated EM reminders
- Generic Emailer + **schedules** (day/hour/minute/timezone) → JQL → SMTP  
- Email History type `generic-reminder`  
- EM owns action after send; system owns the nag  

Also: Monday weekly-status-email skill; SoS/Brief send; Friday leader email (planned).

## Capability map (all jobs)
See deck slide 04 — See / Judge / Cross-team / Sprint / Weekly KPIs / Remind / Communicate / Component / Ask / Govern.

## JCH (2026-10-14)
249 filed · 239 shipped · 6 no-change · 4 open. Exec = theme counts only.

## RACI
Green/release → FEAT Risk Indicator  
OnCalls/CFD weekly → EM/Ops on KPI pulse  
EM queues → scheduler R, EM A  
Deps → FEAT/TPM A, partner sees view  
Sprint → EM say/do, QA verification  
Gate move → RM/FEAT + reason  

## Savings model
**SoT:** `docs/exec-pitch/SAVINGS.md` (hours + CTC + $ by role).  
Accruing @ $150k median: TPM ~$37k + **EM×8 ~$150k** + Dir/VP ~$11k = **~$199k/yr**.  
EM dollars dominate. Capacity ~$15k still ahead.

## Still open
Capacity UI · mutable deps · Sprint Planner · HITL agents · Confluence auto-publish  
