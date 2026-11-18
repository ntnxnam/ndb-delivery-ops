# Project Lighthouse — Design AI Brief

**Purpose:** Paste this into a design AI to restyle / redesign the exec pitch.  
**Content SoT:** `STORY.md` · `SAVINGS.md` · `SPEAKER_NOTES.md` · `index.html`  
**Product depth (optional):** `apps/delivery-ops/docs/DeliveryOps-full-capabilities.md`  
**Date context:** 2026-10-14 / 2026-10-15  
**Branch:** `docs/project-lighthouse-story-content` (ndb-delivery-ops)

---

## 1. What Project Lighthouse is (one paragraph)

**Project Lighthouse** is the name for NDB Engineering’s delivery **operating system** — not a feature beauty parade and not a status-deck project. It is Delivery Ops (React + Express internal web app) wired to JIRA as system of record: release **gate train**, weekly **NDB Ops KPI pulse** (OnCalls, CFD/CFI first), **automated EM reminders**, clickable metrics, RACI on the person who can act, and AI that suggests with receipts while humans approve writes (HITL).

**North Star:** Shine the problem → Suggest the fix → Fix under human-in-the-loop.

**Mission:** Honest, usable operational truth; ownership on who can act.

---

## 2. Audience & tone rules (critical for design)

| Do | Don’t |
|----|-------|
| Speak to a **new exec** — plain language first | Assume Delivery Ops / JIRA fluency on early slides |
| Outcomes, ownership, cadence | Ticket keys (ERA-…, FEAT-…) on exec slides |
| State what Lighthouse **is** | Meta deck-talk (“this deck is…”, “not a beauty parade”) |
| Hours first, then $ via CTC | Finance-nerd “loaded = cash × 1.3” speech |
| Accruing run-rate vs still-ahead | Claim build-cost “already recovered” / ROI payback |
| Dense, laptop-friendly (13" / ~1400px content) | Generic purple-glow SaaS hero aesthetics |

**Personas who appear in the story:** TPM / RM, EM (×8 on pulse), FEAT manager, QA lead, Director / VP, Ops.

---

## 3. Deck structure (12 slides) — content for redesign

Aspect: **widescreen 13.333 × 7.5 in** (16:9). Current visual: dark charcoal (`#141414`), amber accent (`#e8a317`), left accent bar, IBM Plex Sans–like UI type. Redesign may change look; **keep the information hierarchy**.

### Slide 01 — Cover
- **Eyebrow:** Project Lighthouse  
- **H1:** How we built the NDB delivery framework — and how it runs every week.  
- **Mission:** honest, usable operational truth with ownership on the person who can act.  
- **Vision:** Shine → Suggest → Fix (HITL).  
- **OS line:** gate-train SDLC, Delivery Ops surfaces, weekly NDB Ops KPI rhythm (OnCalls, CFD/CFI), automated EM reminders, clear RACI.

### Slide 02 — What it is (newcomer / marketing)
- **H2:** One operating system for NDB delivery — so leaders decide, not assemble status.  
- **Lede:** Not another status deck; four capabilities wired into one place.  
- **Four pillars (plain language):**
  1. **Trust the numbers** — JIRA SoR; hygiene at the board; every count opens the real list; no “trust me” spreadsheets  
  2. **Run the release train** — shared calendar planning → ship; named gates; hotfixes shorter path; same UI per release type  
  3. **Pulse every week** — standing NDB Ops weekly; OnCalls & customer defects first; then blockers, quality, security; EMs get auto-nudges  
  4. **Assist, then act safely** — AI drafts from live data; suggestions show source; human before write; never invents ticket IDs  

### Slide 03 — SDLC = gate train
- **Full major/minor train:**  
  **Pre-CC** *(new soft)* → **CC** (Concept Commit, hard) → **Pre-EC** *(new soft)* → **EC** → **Code Complete** → **CG** → **PG** → **GA**
- Soft gates: dashed / “New · Soft” — force readiness before hard CC / EC  
- Patch & maintenance: **Code Complete + GA only** (no interim gates)  
- **Capacity enters at Pre-CC → CC** (before EC): size payload vs engineer-days, bin-pack what fits so EC is a commitment  
- Capacity Planner / Bin-Packing exist as services; **UI is a next beam**  
- Naming: CC = Concept Commit (hard). Pre-CC ≠ JIRA workflow status “Concept Commit.” Don’t confuse CC with Code Complete.

### Slide 04 — Full capability map (jobs → surfaces)
Jobs the framework does (each has a UI surface):

| Job | Capability | Surface examples |
|-----|------------|------------------|
| See release | FEAT table, Gantt, RAG, outstanding work | Project Status · Feature Dashboard · SoS |
| Judge health | Release RAG, blockers / must-fix; green only when clean | Release Brief |
| Cross-team | Partnership + companion deps; ask vs committed | Dependency View |
| Sprint truth | Say/do; Dev / QA-verify / Test as **three streams** | Sprint Report · Sprint Performance |
| Weekly KPIs | OnCalls, Top/Non-Top CFD & CFI, P0/P1, System Test, Smokes, PreCommits, CVE, Deferral | KPIs · SoS KPI strip |
| Remind EMs | Scheduled JQL → email (day/time/tz) | JIRA Emailer schedules |
| Communicate | Status email, SoS email, history | Email Sender · Email History |
| Component / quality | System-test scale, regressions, carry-over | System-Test Scale |
| Ask / learn | AI briefings, leadership asks, chatbot with citations | Brief · Chatbot · SoS by Leader |
| Govern | Teams, permissions, release setup/config, cache/sync | Admin · Release Setup/Config |

**Product scale (from capabilities doc):** ~19 navigable pages; every count designed to open exact JIRA query; SMTP email path; multi-team capable (NDB-first).

### Slide 05 — What was broken
Theme: **Fog = broken truth + wrong RACI + no weekly scoreboard.**  
Pain: archaeology for green/red; TPM chase on Slack; OnCalls/CFD not a standing pulse; blended velocity lies; silent gate edits.

### Slide 06 — Radical change + JCH
Theme: Fix the board → one surface → cadence → assist.  
**JCH (JIRA hygiene project) snapshot 2026-10-14:** 249 filed · **239 shipped** · 6 no-change · 4 open.  
Exec gets **theme outcomes only** — not ticket laundry.  
Also: reminders; three velocity streams (Dev / QA verification ×0.33 / Test tasks).

### Slide 07 — NDB Ops weekly
Standing weekly focus (kpiConfig), clickable chips:
- **Hot first:** OnCalls, Top-CFD, Top-CFI, Non-Top-CFD, Non-Top-CFI  
- Then: Product Blockers (P0), Product Criticals (P1)  
- Quality/security trains: System Test, Smokes, NDB PreCommits, CVE, Deferral  
Surfaces: `/kpis`, SoS KPI strip. Not a special report.

### Slide 08 — Automated EM reminders
- Generic Emailer + schedules (day · hour · minute · timezone) → JQL → SMTP  
- Type: `generic-reminder` in Email History  
- **System owns the nag; EM owns the action**  
- Also: Monday weekly-status-email; SoS/Brief send; Friday leader email (planned)

### Slide 09 — Tool vs human along the train
| Phase | Lighthouse | Human |
|-------|------------|-------|
| Pre-CC → CC → EC | Capacity size + bin-pack; gates; feature readiness | RM/FEAT/EM set dates & commit what fits |
| Build (sprints) | Say/do, three velocity streams, EM reminders | EM re-plans; IC delivers |
| Verify | QA lag, System-Test Scale, weekly quality KPIs | QA closes TBV |
| CG → PG | Brief RAG, must-fix, Path to Green, deps | FEAT owns risk; partners accept asks |
| Weekly Ops | OnCalls · CFD/CFI · P0/P1 · CVE · Deferral chips | Ops + EMs triage |
| GA / Learn | Retro, forecast, AI asks, chatbot | Ship/slip; HITL on mutate |

### Slide 10 — RACI
Accountability on who can change the outcome:

| Artifact | Was | Now |
|----------|-----|-----|
| “Is the release green?” | TPM slide archaeology | **A:** FEAT (Risk Indicator) · **I:** exec via Brief/SoS |
| OnCalls / CFD weekly | Whoever remembered | **A:** EM / Ops on KPI pulse |
| EM queues | TPM chase on Slack | **R:** scheduler · **A:** EM acts |
| Cross-team ask | Side meeting | **A:** FEAT/TPM · partner sees Dependency View |
| Sprint honesty | Blended velocity | **A:** EM say/do · **A:** QA verification lag |
| Gate move | Silent field edit | **A:** RM/FEAT + reason |

### Slide 11 — Hours → dollars
**Formula:** `$/yr = hrs/wk × people × 52 × (CTC ÷ 2,080)`

**CTC planning bands (avg for people doing this job):**
| Geo | CTC USD | $/hr |
|-----|---------|------|
| US | ~$300k | ~$144 |
| India | ~$150k | ~$72 |
| Mexico | ~$75k | ~$36 |
| **Median (pitch default)** | **~$150k** | **~$72** |

**Org rollup (must show Hrs/wk + Hrs/yr):**

| Role | Ritual hrs each | People | Hrs/wk org | Hrs/yr | $/yr @ median | Status |
|------|-----------------|--------|------------|--------|---------------|--------|
| TPM / RM | 10 | 1 | 10 | 520 | ~$37k | Accruing |
| EM | 5 | 8 | 40 | 2,080 | ~$150k | Accruing |
| Director / VP | 3 | 1 | 3 | 156 | ~$11k | Accruing |
| Capacity | ~4 | 1 | ~4 | ~210 | ~$15k | Still ahead |
| **Accruing** | | | **53** | **2,756** | **~$199k** | Live |
| + capacity | | | ~57 | ~2,966 | ~$214k | If beam lands |

**Sensitivity (same accruing hours):** US ~$397k · Median ~$199k · Mexico ~$99k.

**TPM 10h justification (before-state):** 3.5 SoS/Brief · 2.0 email · 2.5 EM chase · 1.5 OnCall/CFD pull · 0.5 staff stitch.  
**EM 5h:** 2 queue · 2 KPI hunt · 1 status.  
**Not:** Comp Band exacts, Finance-approved budget, or Lighthouse capex payback.  
**Is:** Run-rate of rituals removed; EM×8 dominates dollars (~75%).

### Slide 12 — The ask
- Run the gate train. Keep the weekly Ops pulse. Fund the next beams.  
- Framework = Truth (JCH) + Gate SDLC + Weekly KPIs + EM reminders + RACI.  
- **Still open:** living Capacity UI · mutable deps · Sprint Planner · HITL agents · Confluence auto-publish.  
- Pills: Pre-CC → GA · Weekly OnCalls/CFD/CFI · EM scheduled reminders · Shine→Suggest→Fix · One URL in staff.

---

## 4. Design direction hints (from product rules)

- **Primary viewport:** 13" laptop (1280–1440px); max content width ~1400px; dense, not sparse dashboard chrome.  
- **Current pitch palette:** near-black `#111`/`#141414`, text `#e8e8e8`/`#ddd`, muted `#888`/`#666`, amber accent `#e8a317`, positive green `#8fcf8f`, negative/was `#c97a7a`.  
- **Avoid (user preference for branded work):** default Inter/purple-gradient AI look; cream+terracotta cliché; newspaper broadsheet; emoji clutter; fake “beauty parade” hero.  
- **Charts if any:** keep ≤280px on data pages (product UI rule); exec deck may use simple tables/gate strips instead.  
- **Authenticity visual language:** numbers that feel “clickable to JIRA” (external-link affordance) even if static in PDF.

---

## 5. Artifact locations

| File | Role |
|------|------|
| `docs/exec-pitch/index.html` | Live 12-slide HTML (print to PDF) |
| `docs/exec-pitch/Project-Lighthouse-NDB-Exec-Pitch-2026-10-14.pdf` | Exported deck |
| `docs/exec-pitch/STORY.md` | Narrative SoT |
| `docs/exec-pitch/SAVINGS.md` | Hours + CTC + $ SoT |
| `docs/exec-pitch/SPEAKER_NOTES.md` | ~10–12 min talk track |
| `apps/delivery-ops/docs/DeliveryOps-full-capabilities.md` | Full product capability encyclopedia (~19 pages) |

---

## 6. Prompt you can paste to a design AI

```
Redesign a 12-slide executive pitch for “Project Lighthouse” — NDB Engineering’s delivery operating system (not a feature beauty parade).

Constraints:
- Widescreen 16:9 (13.333×7.5in). Dense enough for a 13" laptop.
- Audience: executives new to the tool. Plain language early; jargon only after it’s introduced.
- No ticket keys. No meta “this deck is…” copy.
- Visual: serious ops / control-plane energy; amber accent OK; avoid purple SaaS glow and emoji.
- Preserve ALL information from the brief below (gates including soft Pre-CC/Pre-EC and hard CC; weekly OnCalls/CFD KPIs; EM reminders; RACI; savings table with Hrs/wk + Hrs/yr + CTC geo bands + ~$199k median accruing).

[Paste sections 1–3 of DESIGN-AI-BRIEF.md]
```

---

## 7. 30-second verbal cut (for motion / trailer)

Truth + gate train + weekly OnCalls/CFD KPIs + EM reminders + right owners → one URL.
