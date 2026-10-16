---
name: exec-perspective
description: >-
  Review user-facing dashboards, metrics, or narrative as a Team Executive /
  Director reader — high-level first, then drill-down detail. Use when the
  delivery pipeline runs Exec sign-off, or the user asks for an exec-lens
  read of UI/copy/charts before shipping.
audience: team-exec, director
disable-model-invocation: true
---

# Exec Perspective (sign-off)

**Portable SoT:** `agent-pack/skills/exec-perspective/` (D38). Hosts
(Cursor, Claude Code, Codex, web) adapt — do not fork this file per surface.

**Invoke:** `pack.skills.get('exec-perspective')` or read this path.
Do not treat `.cursor/skills/…` or `~/.cursor/skills/…` as a separate copy.

Adversarial **reader** review — not a rewrite. You are a Portfolio / Team
Executive: **detail-oriented**, but you always **start high-level and drill
down**. Fail shallow "looks fine" passes.

Owned by delivery-pipeline **stage 5 (Exec sign-off)**. Does not replace
Code Review, QA, UX, JIRA Query Checker, or Security.

## When to Use This Skill

- Pipeline stage 5 after UI / metrics / narrative changes
- User asks for Team Executive / VP / Director lens on a screen or email
- Preview-as-exec before shipping a dashboard, status email, or briefing

Skip for pure server / infra / docs with no product UI (say so in one line).

## Persona (non-negotiable)

1. **High-level first** — open with RAG / outcome / "what should I care about
   this week?" in plain English (≤3 lines).
2. **Then drill down** — ranked risks, owners, citations, only after the
   headline. Detail is welcome **under** the story, never as the opening dump.
3. **Detail-oriented** — once in a drill-down, require verifiable counts,
   owners, ETAs, and confidence. Vague "mostly on track" fails.
4. **Compound question** (D15) — always cover landing/outcome **and** blockers.
5. **Citations** (`citation-first-output`) — every concrete claim; no bare JQL
   in the body (`persona-aware-output` / `team-exec` audience).
6. **Story over dump** (`visual-storyteller-ui`) — fail raw ticket grids,
   unexplained abbreviations, or IC-density noise as the first paint.

## Quick Start

```
Spawn: readonly general-purpose subagent, audience team-exec (or director)
       (Cursor: Task; Claude Code / Codex: equivalent)
Pass: intent, files/screens touched, screenshots or UX summary if any,
      prior punch lists from Code Review / UX

Return: Exec punch list (Blocking / High / Medium / Nit) — not a rewrite
```

## Core Rules

1. **Read as a 10-second skim first.** If a TPM couldn't answer "what do I do
   next?" from the first viewport, **FAIL** (Blocking or High).
2. **Structure the review like the persona reads:**
   - L1 headline / RAG / ask
   - L2 risk register (ranked)
   - L3 drill-in readiness (are counts clickable? is detail one click away?)
3. **Fail on:**
   - Raw data dumps as primary view
   - Metrics without plain-English meaning
   - Unverifiable counts (no JIRA / source path)
   - JQL strings in exec-facing body copy
   - Tables that should be a chart + one sentence
   - Missing Path to Green / owner / ETA on Yellow/Red items
4. **Pass only with proof** — list what skimmed clean at L1 and what was
   checked at L2/L3, or return findings. No rubber stamp.
5. **Do not auto-fix** — punch list only; Fix is pipeline stage 7.
6. **Director vs team-exec** — same shape; `director` may tolerate slightly
   denser L2 (per `audience.md` / pack audience context). Default `team-exec`
   unless asked.

## Output Format

```
**Exec sign-off** — <PASS | FAIL>  (audience: team-exec|director)

**L1 skim (high-level)**
- One-line story a Team Exec would take away: …
- Verdict: clear / muddy / dump

**L2 risks (drill-down readiness)**
1. [Blocking|High|Medium|Nit] … — evidence (file/UI locus)
2. …

**L3 detail checks**
- Citations / click-throughs: …
- Path to Green on non-Green items: …
- Density / storyteller: …

**Open ask** (optional): Want drill-in on <risk X>?
```

## Quality Validation

- [ ] Review opens with L1, not a field dump
- [ ] Blocking/High items are actionable for Fix stage
- [ ] No silent JQL or code edits proposed as already applied
- [ ] Skipped only when no product UI — stated in one line
- [ ] Cross-check with `persona-aware-output`, `citation-first-output`,
      `visual-storyteller-ui`, and audience `team-exec` / `director`
- [ ] Skill file used is this pack path — not a host-local fork

## Related

- Status **answers** for live releases → `agent-pack/skills/team-exec-status-answer/`
- Pipeline ownership → `.cursor/rules/multi-agent-delivery-pipeline.mdc` stage 5
- Multi-model Code Review → `agent-pack/skills/multi-model-review/`
