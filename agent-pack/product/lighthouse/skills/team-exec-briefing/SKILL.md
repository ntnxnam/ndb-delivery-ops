---
name: team-exec-briefing
description: Generate Team Executive briefings — status answers with compound question + risk register, release reports with systematic risk escalation, and RAG + top blockers + 7-day actions. Use when any Team Executive / Director or Portfolio Manager needs a release health view, from ad-hoc Q&A to scheduled readouts.
audience: team-exec, director, portfolio_mgr
---

# Team Executive Briefing — Unified Executive View (D15, D4, D8, D9)

Single skill for **all** Team Executive briefing needs. Merged from `team-exec-status-answer` (compound Q + risk register) + `team-exec-release-report` (dense bullets + 6 sections) + `release-ai-briefing` (RAG + blockers + 7-day actions). Every executive-level release health output goes through this skill — mode selects depth + format.

## When to Use This Skill

- User asks "how's NDB-2.11?", "are we landing?", "what's blocking?" — ad-hoc status (mode=status)
- User asks for a Team Executive release report / readout / health summary (mode=report or mode=briefing)
- The ✦ AI Briefing button is clicked in SyncHub UI (mode=briefing, default trigger)
- Weekly Monday digest job runs for Team Executive audience (D14 opt-in) — mode=status or mode=briefing per config
- Portfolio Manager, TPM, RM, or Team Executive asks for any executive-lens output ("show me as Team Executive")
- Any request that previously went to `team-exec-status-answer`, `team-exec-release-report`, or `release-ai-briefing` — this skill replaces all three

If the user wants a **forecast** with Monte Carlo / completion probability / what-if, use `predictive-team-exec-analytics` instead. If they want a **retrospective** vs gate contracts, use `release-retrospective`. If they want a **TPM weekly email** (3-tier hybrid for broad leadership), use `weekly-status-email`.

## Quick Start

```
Input: {
  release: 'NDB-2.11',
  productId: 'ndb',
  mode: 'status' | 'report' | 'briefing',  // default 'status' for ad-hoc, 'briefing' for SyncHub button
  audience: 'team-exec' | 'director' | 'portfolio_mgr',
  outputSurface: 'chat' | 'email' | 'confluence',  // D15d three renderers
  // mode=report extras
  includeSections?: string[],  // subset of 6 required sections, default all with items > 0
}

Route by mode:
- status → compound Q + risk register + landing prediction + charts + drill-in offer
- report → systematic readout: 6 sections, dense bullets, risk escalation ladder, complete coverage
- briefing → RAG verdict + top blockers (real keys) + 7-day action list (under 400 words)

Data collection (parallel where possible):
- status: predictLanding + topBlockers + teamGraph (parallel A/B/C)
- report: full release payload + per-project risk calculation via escalation rules
- briefing: committed features (buildCommitItemsJQL + exclude long-term-funded) + P0 blockers (priority=P0 Blocker) + must-fix (labels=mustfix) + deriveSignals buckets
```

## Core Rules

### Universal (all modes)

1. **Audience declaration** — every output declares `audience: team-exec` (or director/portfolio_mgr per input). Renderer density adjusts: Team Executive = chart-first, no inline JQL (appendix only), no tables >5 columns.
2. **Citation on every claim** (D10). JIRA keys, queries, snapshots, or data-source references. Every ticket key cited must appear in intelligence data — no hallucination (copy from VALID TICKET KEYS list for briefing mode).
3. **Confidence indicator** on every prediction (high / medium / low).
4. **Ask scope if ambiguous** (D15c). No release specified → return clarifying question listing active releases with RAGs, don't guess.
5. **Same payload, three renderers** (D15d) — chat (Markdown), email (inline-CSS HTML max 800px), Confluence (storage XML + width-cleanup). Only renderer changes, not logic.

### Mode: status — Compound question + risk register (from team-exec-status-answer, D15a-d)

6. **Compound question always** (D15a). Every Team Executive question is "when landing?" AND "what's blocking?" — answer both halves even if only one was asked.
7. **Risk-register format, not bullet summary** (D15b). Blocker list is as long as risks demand — no artificial compression. Each entry: what / owner / expected resolution / mitigation / impact on landing (days, confidence). Ordered by impact × proximity-to-RTM × uncertainty.
8. **Parallel service calls** — predictLanding + topBlockers + teamGraph run concurrently, never sequentially. Charts via chartService inline.
9. **No JQL inline** for vp audience — JQL belongs in appendix / hover tooltips, never in body. No tables >5 columns — collapse to chart or split.
10. **Drill-in offer** at end: "Want me to dig into [risk X] / [risk Y]?"

### Mode: report — Systematic readout (from team-exec-release-report, D9)

11. **Dense one-line bullet per project** (one line, not multi-paragraph):
    ```
    • **{Project Name}** ({JIRA-KEY}) - {Priority} - {Assignee} - {Test Lead} - CC: {date} ({status}) - CG: {date} ({status}) - PG: {date} ({status}) - QI: {%} - Status: {Status} ({Date})
    ```
12. **Risk escalation ladder** (systematic, not by gut):
    - Date slips: 0–1 use manual indicator; 2–3 escalate one level; 4+ → Red; 6+ month delay → critical
    - Priority multipliers: P0+any slip → Red, P1+2 slips → Red, P2+4 slips → escalate to Red
    - Status freshness: status >7 days old → "Latest Status Not Available"
13. **6 required sections** — only include if items > 0:
    1. Executive Summary (2–3 sentences with risk assessment)
    2. Project Breakdown (risk distribution table)
    3. Section Analysis (Highlights / Lowlights / Visibility Gaps)
    4. Systemic Risk Analysis (cross-project patterns)
    5. Executive Recommendations (immediate + strategic)
    6. Risk Trend Analysis
14. **Complete project coverage** — every project from source data included; count in header must match source count (no drops).
15. **File naming**: `TeamExec-{Product}-{Release}-{YYYY-MM-DD}.md` per documentation-consistency.mdc; email variant `-Email.html` max 800px inline CSS.

### Mode: briefing — RAG + blockers + 7-day actions (from release-ai-briefing)

16. **Data collection** (in releaseAiSummaryService.js + naiService.js):
    - Committed features: `buildCommitItemsJQL(version)` + `AND labels != "${versionLabel}-long-term-funded"`
    - P0 blockers: `filter = "${versionLabel}-all" AND statusCategory != Done AND priority = "P0 - Blocker"` (fetch key,summary,assignee,status — not count-only)
    - Must-fix: `labels = "${versionLabel}-mustfix" AND statusCategory != Done` (fetch key,summary,assignee,status,priority,issuetype)
    - Feature signals: `deriveSignals` per committed feature → buckets: gate-lagging, compliance, blocked, dark, watching, clear
17. **VALID TICKET KEYS block** (anti-hallucination) — before any detail blocks, emit numbered list of every key from P0 + must-fix. LLM must copy character-for-character from this list, never invent. System prompt contains ⚠️ TICKET KEY INTEGRITY block + user prompt closes with "When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above."
18. **RAG verdict ladder** (first match wins, enforced in system prompt):
    | Priority | Condition | Verdict |
    |---|---|---|
    | 1 | OPEN_P0_BLOCKERS > 0 | RED |
    | 2 | OPEN_MUSTFIX > 0 AND DAYS_TO_PG ≤14 | RED |
    | 3 | gate-lagging >2 features | RED |
    | 4 | OPEN_MUSTFIX >0 | YELLOW |
    | 5 | gate-lagging 1–2 OR dark >20% OR compliance-at-risk>0 OR Yellow/Red missing Path to Green | YELLOW |
    | 6 | All clear | GREEN |
19. **Under 400 words total** for briefing mode. No generic phrases: "monitor", "follow up", "ongoing", "areas for improvement" — be specific per ticket.
20. **Header stat line** (bold coloured text, not neutral grey): `{N} features · {P0 count} P0s (red) · {must-fix count} must-fix (orange)`. Footer: `gate-lagging: N · P0 blockers: N · must-fix open: N`. Panel border neutral grey — no RAG colour on container (RAG badge appears once inside body at `## Release Health: <VERDICT>`).

## Tool Contract

### Mode: status — agent runtime (POST /api/ai/chat → team-exec-specialist)

```
POST /api/ai/chat
{ "message": "How's NDB-2.11?", "audience": "team-exec", "release": "NDB-2.11" }

Orchestrator parallel calls (via shared services / agentRuntime):
  A. predictabilityService.predictLanding(productId, release) // or landingForecastService
  B. statusService.topBlockers(productId, release)
  C. dependencyService.teamGraph(productId, release)
  → charts via chartService, render with vp preset
```

### Mode: report — deterministic report service

```
Input: HTML or JIRA-derived project data for a release
Processing: per-project risk escalation (ladder) + dense bullet + 6-section assembly
Output: TeamExec-{Product}-{Release}-{YYYY-MM-DD}.md + -Email.html
Service: shared/services/vpReportService.ts (CONSOLIDATION #7, port pending) ← ~/.cursor/skills/team-exec-release-report/
```

### Mode: briefing — generative briefing (POST /api/ai/release-summary)

```
POST /api/ai/release-summary
{ "version": "NDB-2.11" } + Authorization: Bearer <jira-token>

Response:
{
  "summary": "## Release Health: RED\n...\n## Top Blockers\n...\n## 7-Day Action List\n...",
  "intelligence": {
    "totalFeatures": 19,
    "p0BugsCount": 2,
    "p0Bugs": [{ "key": "ERA-66381", ... }],
    "mustFixTickets": [{ "key": "ERA-66374", ... }],
    "bucketCounts": { "gate-lagging": 0, "blocked": 0, "compliance": 0, "dark": 3 },
    "generatedAt": "2026-06-17T08:13:57.000Z"
  }
}
Prompt: naiService.buildReleaseSummaryPrompt(intelligence) → VALID TICKET KEYS + P0/must-fix/buckets → LLM with RAG ladder + integrity constraints
```

## Output Format

### Mode: status (risk register)

```markdown
**Release: NDB-2.11**  🔴 RED  Landing: 2026-07-14 (medium confidence)

Health headline (1-line with citation): Landing slipped 2 weeks due to storage P0 [source: predictabilityService]

**Top risks** (ranked by impact × proximity × uncertainty):
1. **Storage throughput regression** — Impact: high
   - Blocker: [NDB-1234], [NDB-1235]
   - Owner: storage team (last commit: 2h ago)
   - Expected resolution: 2026-06-20
   - Mitigation: hotfix branch in review
   - Impact on landing: +7d (medium confidence)

2. **…**

[chart: landing confidence band + risk burndown]

Want me to dig into [risk 1] / [risk 2]?

--- 
<small>Sources: predictLanding(NDB-2.11), topBlockers, teamGraph @ 2026-05-19T12:30Z. Last refreshed 5m ago. [Refresh]</small>
```

### Mode: report (6 sections, dense bullets)

```markdown
# Team Executive Report — NDB-2.11 (2026-05-08) — 19 projects

## Executive Summary
Release is Yellow — 2 Red features (P0 storage), 3 gate-lagging >2 features from PG. Trend: stable WoW.

## Project Breakdown
| Risk | Count | Projects |
|---|---|---|
| 🔴 Red | 2 | storage, networking |
| 🟡 Yellow | 4 | ... |

## Section Analysis
### Highlights: 5 features Green (early CG)
### Lowlights: storage P0 regression
### Visibility Gaps: 3 features stale >7d

• **Storage Rewrite** (FEAT-1001) - P0 - jane.doe - test.lead - CC: 2026-05-01 (Met) - CG: 2026-05-30 (At risk) - QI: 67% - Status: Amber (2026-05-08)
[... all 19 projects, one line each ...]

## Systemic Risk Analysis: cross-project pattern — storage delays cascade to networking
## Executive Recommendations: Immediate: hotfix NDB-1234 by 2026-06-20; Strategic: add 1 FTE to storage
## Risk Trend Analysis: Red count stable WoW (2→2)
```

### Mode: briefing (RAG + blockers + 7-day)

```markdown
## Release Health: RED

Release Health is RED due to 2 open P0 blockers (ERA-66381, ERA-66382) and 3 gate-lagging features (FEAT-1001, FEAT-1002, FEAT-1003) 12 days from PG. Trajectory is worsening WoW (P0s were 1 last week).

## Top Blockers
- [ERA-66381] Write stall on large datasets — P0 Blocker (Owner: jane.doe, Status: In Progress)
- [ERA-66374] Must-fix audit — Must-fix Open (Owner: bob, P1)
- [FEAT-1001] Storage Rewrite — Gate gap: CC slipped 2 weeks (Owner: storage lead)
- ...

## 7-Day Action List
1. Ask storage lead to hotfix ERA-66381 by 2026-06-20 (P0, blocks CG).
2. Ask RM to confirm deferral of NDB-200 to 2.12 (stuck 8d, owner=rm).
3. ...
```

## Quality Validation

### All modes
- [ ] Every claim has citation (JIRA key, query, or snapshot)
- [ ] Every prediction has confidence indicator
- [ ] Audience declared correctly (team-exec/director/portfolio_mgr)
- [ ] Output passes persona-aware-output for Team Executive density (no inline JQL in body, chart-first)

### Mode: status
- [ ] Both halves of compound question answered (landing + blockers)
- [ ] All three service calls were parallel (not sequential)
- [ ] Risk register ordered by impact × proximity × uncertainty
- [ ] At least one chart inline, drill-in offer present, last-refreshed + Refresh

### Mode: report
- [ ] All projects from source included (count matches header)
- [ ] Each bullet follows dense one-line format
- [ ] Risk escalation ladder applied systematically
- [ ] Only sections with items >0 included (6 sections total)
- [ ] Email HTML max 800px inline CSS, file naming per documentation-consistency

### Mode: briefing
- [ ] RAG verdict matches ladder table (P0>0 → RED, not Yellow/Green)
- [ ] Every cited ticket key appears in VALID TICKET KEYS list
- [ ] Must-fix count in header matches intelligence.mustFixTickets.length
- [ ] Feature count matches commit section count (not inflated by long-term-funded)
- [ ] Under 400 words, no generic phrases, panel border neutral grey
- [ ] Footer has must-fix open count, RAG badge once inside body
