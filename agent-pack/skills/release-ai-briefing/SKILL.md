---
name: release-ai-briefing
description: Generate a release-level AI health briefing — RAG verdict, top blockers with real ticket keys, and a 7-day action list — by aggregating committed features, open P0 bugs, and must-fix tickets. Use when a Portfolio Manager or TPM asks for an overall release health summary, wants to know the top blockers across all features, or needs a prioritised action list for the next week.
audience: portfolio_mgr, tpm, rm
---

## When to Use This Skill

- User asks "what is the health of NDB-2.11?" or "give me a release briefing"
- User wants top blockers across the entire release (not just one feature)
- User asks for a 7-day action list for a release
- The `✦ AI Briefing` button is clicked in the SyncHub UI (`ReleaseVersionTab`)
- Weekly Monday release-status pipeline needs a release-level RAG verdict

## Quick Start

```
POST /api/ai/release-summary
{ "version": "NDB-2.11" }
Authorization: Bearer <jira-token>
```

Response shape:
```json
{
  "summary": "## Release Health: RED\n...\n## Top Blockers\n...\n## 7-Day Action List\n...",
  "intelligence": {
    "totalFeatures": 19,
    "p0BugsCount": 2,
    "p0Bugs": [{ "key": "ERA-66381", "summary": "...", "assignee": "...", "status": "..." }],
    "mustFixTickets": [{ "key": "ERA-66374", "issueType": "Bug", "priority": "Critical - P1", ... }],
    "bucketCounts": { "gate-lagging": 0, "blocked": 0, "compliance": 0, "dark": 3 },
    "generatedAt": "2026-06-17T08:13:57.000Z"
  }
}
```

## Core Rules

### Data collection (in `releaseAiSummaryService.js`)

1. **Committed features scope** — use `buildCommitItemsJQL(version)` PLUS append `AND labels != "${versionLabel}-long-term-funded"` to match exactly what the SyncHub commit section shows.
2. **P0 blockers** — query `filter = "${versionLabel}-all" AND statusCategory != Done AND priority = "P0 - Blocker"`, fetch `key,summary,assignee,status`. Do NOT count-only — the LLM needs real keys.
3. **Must-fix tickets** — query `labels = "${versionLabel}-mustfix" AND statusCategory != Done`, fetch `key,summary,assignee,status,priority,issuetype`. These exist regardless of feature hierarchy — a standalone bug can be must-fix.
4. **Feature signals** — run `deriveSignals` on each committed feature (CPU-only, no extra JIRA calls) to classify into buckets: `gate-lagging`, `compliance`, `blocked`, `dark`, `watching`, `clear`.

### Prompt construction (in `naiService.js → buildReleaseSummaryPrompt`)

5. **VALID TICKET KEYS block** — before any detail blocks, emit a numbered list of every key from P0 bugs + must-fix tickets. Example:
   ```
   VALID TICKET KEYS (copy these exactly):
     1. ERA-66381
     2. ERA-66374
     3. ERA-66366
   ```
   This is the LLM's reference — it must copy from this list, never interpolate.
6. **P0 block** — list each P0 with key, summary, status, owner.
7. **Must-fix block** — list each open must-fix with key, type, priority, summary, status, owner. Cap display at 20; add "... and N more" if exceeded.
8. **Feature buckets block** — gate-lagging, blocked, compliance, dark (with stale age), watching count, clear count.

### RAG verdict logic (enforced in system prompt)

Apply in order — first match wins:

| Priority | Condition | Verdict |
|---|---|---|
| 1 | `OPEN_P0_BLOCKERS > 0` | **RED** |
| 2 | `OPEN_MUSTFIX_TICKETS > 0` AND `DAYS_TO_PG ≤ 14` | **RED** |
| 3 | `gate-lagging > 2` features | **RED** |
| 4 | `OPEN_MUSTFIX_TICKETS > 0` | **YELLOW** |
| 5 | gate-lagging 1–2 OR dark > 20% of committed count OR compliance-at-risk > 0 OR Yellow/Red features missing Path to Green | **YELLOW** |
| 6 | All of the above are zero/clear | **GREEN** |

Feature-level team narrative (Indicator + Risk Assessment + Path to Green) is evaluated by `evaluateTeamRiskContext` and exposed via `deriveSignals` for per-feature AI summaries.

### Anti-hallucination (critical)

9. The system prompt must contain a `⚠️ TICKET KEY INTEGRITY` block with these exact constraints:
   - Copy keys character-for-character from the data provided.
   - Never generate, invent, approximate, or reconstruct keys.
   - If unsure of a key, omit the entry — a missing entry is better than a fabricated one.
   - Before writing any key in the response, confirm it appears verbatim in `VALID TICKET KEYS` above.
10. The user prompt must close with: _"When citing ticket keys, use ONLY the keys listed in VALID TICKET KEYS above."_

### UI (`ReleaseSummaryPanel.js`)

11. **No RAG colouring on the panel border or header background** — keep those neutral (`#dee2e6` / `#f8f9fa`). The RAG badge appears exactly once: inside the body, rendered by `SummaryBody` when it encounters `## Release Health: <VERDICT>`.
12. The header stat line shows: `{N} features · {P0 count} P0s (red) · {must-fix count} must-fix (orange)` — in bold coloured text, not neutral grey, so critical counts are immediately visible.
13. Footer shows: `gate-lagging: N · P0 blockers: N · must-fix open: N`.

## Output Format

Three sections, strict:

```markdown
## Release Health: RED|YELLOW|GREEN
<one paragraph, 3–5 sentences — verdict + evidence + trajectory>

## Top Blockers
- [ERA-NNNNN] <summary> — P0 Blocker (Owner: <name>)
- [ERA-NNNNN] <summary> — Must-fix [status] (Owner: <name>)
- [ERA-NNNNN] <feature name> — <gate gap or compliance issue> (Owner: <name>)

## 7-Day Action List
1. Ask <owner> to <specific action> on <ERA-NNNNN> by <date>.
2. ...
```

Constraints:
- Under 400 words total
- No generic phrases: "monitor", "follow up", "ongoing", "areas for improvement"
- Only keys from `VALID TICKET KEYS` list

## Quality Validation

Before accepting the output:

- [ ] RAG verdict matches the rule table above (P0 > 0 → must be RED, not GREEN/YELLOW)
- [ ] Every ticket key cited in Top Blockers appears in the `VALID TICKET KEYS` list emitted in the prompt
- [ ] Must-fix count in the header stat matches `intelligence.mustFixTickets.length`
- [ ] Feature count matches the commit section count in the SyncHub UI (not inflated by long-term-funded items)
- [ ] Footer shows must-fix open count
- [ ] Panel border is neutral grey — no RAG colour on the container itself
