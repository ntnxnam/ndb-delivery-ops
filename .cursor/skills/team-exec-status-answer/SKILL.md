---
name: team-exec-status-answer
description: Answer any Team Executive / Director status question using the compound-question + risk-register protocol. Use when the audience is team-exec or director and the question relates to release status, blockers, landing date, or health.
audience: team-exec, director
---

## When to Use This Skill

- The Ops Assistant orchestrator delegates to `team-exec-specialist` and the
  audience is `vp` or `director`
- The user (any role) explicitly asks for Team Executive-lens output ("show me as Team Executive")
- The Monday Team Executive digest job runs (per D14 opt-in cadence)
- A status answer is being rendered for inclusion in a Confluence Team Executive page

## Quick Start

```
Input: { release: "NDB-2.11", audience: "vp", outputSurface: "chat" }

Output (rendered): a risk-register-format answer with landing prediction,
blockers, citations, charts.

Procedure:
1. Verify scope. If `release` is ambiguous → orchestrator ASKs.
2. Run service calls in parallel:
     A. predictabilityService.predictLanding(productId, release)
     B. statusService.topBlockers(productId, release)
     C. dependencyService.teamGraph(productId, release)
3. Compose risk-register payload.
4. Generate charts via chartService.
5. Render with `vp` audience preset.
6. Cite every claim.
7. Offer drill-in.
```

## Core Rules

1. **Compound question always** (D15a). Every Team Executive question is "when landing?"
   AND "what's blocking us?" — answer both halves even if only one was
   asked.
2. **Risk-register format, not bullet summary** (D15b). The blocker list is
   as long as the risks demand — no artificial compression. Each entry has
   what / owner / expected resolution / mitigation / impact on landing.
3. **Always ask scope** (D15c). If no release is specified, return a
   clarifying question listing active releases with their RAGs. Don't
   guess.
4. **Citation on every claim** (D10, `citation-first-output.mdc`). JIRA
   keys, queries, snapshots, or data-source references.
5. **Confidence indicator on every prediction** (high / medium / low).
6. **No JQL inline** (per `vp` audience). JQL belongs in appendix or in
   citation-hover tooltips, never in the body.
7. **No tables wider than 5 columns** in `vp` audience — collapse to chart
   or split.
8. **Parallel service calls** (Anthropic parallelization pattern). The
   three core calls (A/B/C in Quick Start) run concurrently; never
   sequentially.
9. **Same payload, three renderers** (D15d). The output structure works
   identically for chat, email, and Confluence — only the renderer changes.
10. **Drill-in offer** at the end ("Want me to dig into [risk X]?"). The
    orchestrator stores conversation memory so follow-ups resolve.

## Output Format

```
**Release: <name>**  <RAG chip>  Landing: <date> (<confidence>)

[1-line headline with citation]

**Top risks** (ranked by impact × proximity-to-RTM × uncertainty):

1. **<risk title>**  —  Impact: <high|medium|low>
   - Blocker tickets: [KEY-1], [KEY-2]
   - Owner: <team> (last commit: <when>, source: githubConnector)
   - Expected resolution: <date>
   - Mitigation: <status>
   - Impact on landing: <delta in days, confidence>

2. **<...>**

[chart: landing-date confidence band + risk burndown]

Want me to dig into [risk 1] / [risk 2]?

---
<small>Sources: predictabilityService.predictLanding(NDB-2.11) @ 2026-05-19T12:30Z,
statusService.topBlockers, dependencyService.teamGraph.
Last refreshed 5 min ago. Refresh now.</small>
```

For email rendering:

- Same structure, inline-CSS HTML, max 800px width
- Full URLs on every citation
- Plain-text fallback `<div>` block

For Confluence rendering:

- Same structure, Confluence storage XML
- `confluence-width-cleanup` skill runs before publish
- Citations as `<ac:link>` macros

## Quality Validation

Before declaring the answer done, confirm:

- [ ] Both halves of the compound question are answered (landing + blockers)
- [ ] Every numerical claim has a citation
- [ ] Every prediction has a confidence indicator
- [ ] No JQL strings appear in body (appendix only)
- [ ] All three service calls were made in parallel (not sequentially)
- [ ] Risk register entries are ordered by `impact × proximity × uncertainty`
- [ ] At least one chart is generated and inlined
- [ ] Drill-in offer is included
- [ ] Last-refreshed timestamp + Refresh affordance present
- [ ] Audience declaration: `audience: team-exec` (or `director`)
- [ ] Output passes `persona-aware-output.mdc` checks for Team Executive density

## Common Mistakes to Avoid

- Answering only "when landing?" but skipping "what's blocking?" (or vice versa)
- Compressing to 3 bullets when there are 8 high-impact risks
- Guessing the release instead of asking
- Forgetting citations on counts ("12 open bugs" without source)
- Showing JQL inline (it's appendix-only for Team Executive)
- Sequencing the service calls instead of running them in parallel

## Cross-references

- `.cursor/agents/specialists/team-exec-specialist.md`
- `.cursor/rules/persona-aware-output.mdc`
- `.cursor/rules/citation-first-output.mdc`
- `~/.cursor/context/audience.md` — `vp` audience
- `DECISIONS.md` — D4, D10, D15, D15a–d
