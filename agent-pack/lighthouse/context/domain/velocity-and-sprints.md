---
name: velocity-and-sprints
area: domain
---

# Velocity & sprint discipline

## Three velocity streams (never collapse)

| Stream | Filter | Measure |
|---|---|---|
| Dev | not portfolio hierarchy, not Test | SP or count |
| QA verification | Bug/Improvement Closed in window | count × 0.33 (not SP) |
| QA test tasks | issueType = Test | SP or count |

## Resolution authenticity (Nutanix)

- `resolution in (Fixed, Done, Resolved, Complete)` = positive completion family
- `status = Resolved` with work still open to QA = **TBV** (To Be Verified) — not shipped
- Never confuse resolution=Resolved with status=Resolved

See `jira-workflows-and-resolutions.md` for full tables.

## Sprint performance leadership asks

Input packet (deterministic): say/do, Dev-finished vs Completed gap (QA lag),
leader/manager rankings, scope creep, chronic carry-over, hygiene
(staleActive / startedEmpty / lateClosed).

Prompt: `prompts/production/sprint-leadership-asks.md`.

## Sprint calendar (NDB fixture)

3-week Wednesday→Wednesday sprints; naming S1, S2, … — sort numerically, never
alphabetically (S1,S10,S2 is wrong).
