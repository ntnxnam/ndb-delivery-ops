---
name: update-release-date
description: Update release gate dates (GA, Code Complete, Commit Gate, Promotion Gate) in the NDB delivery-ops config. Use when a release date slips, a new milestone is announced, or an existing gate date needs to change. Trigger phrases: "update release date", "date slipped to", "changed release date", "move GA to", "push code complete to", "new commit gate date", "/update-release-date".
disable-model-invocation: true
---

# Update Release Date

Updates gate dates in `apps/delivery-ops/server/config/releaseVersionsEmailConfig.json`.

## Step 1 — Gather inputs

Ask for (or extract from the user's message):
1. **Release** — e.g. `NDB-2.11`, `NDB-2.12`
2. **Gate** — GA, Code Complete, Commit Gate, or Promotion Gate
3. **New date** — in `YYYY-MM-DD` format

If any of the three are missing, ask before proceeding.

## Step 2 — Read the config

Read `apps/delivery-ops/server/config/releaseVersionsEmailConfig.json` and locate the target release under `releaseGateDates`.

## Step 3 — Apply the slip pattern

A slipped date is **always a new numbered entry**, not an overwrite. The previous solid entry becomes dotted.

### Gate → JSON key prefix mapping

| Gate | Key prefix | Color |
|---|---|---|
| General Availability | `ga` | `#28a745` |
| Code Complete | `ccm` + number + `Gate` | `#de350b` |
| Commit Gate | `commitGate` | `#ff9800` |
| Promotion Gate | `promotionGate` | `#9c27b0` |

### Slip pattern rules

1. Find the **highest-numbered key** for the gate (e.g. `ga2`, `commitGate2`).
2. Change its `"style"` from `"solid"` to `"dotted"` — keep any existing `reason` on that entry.
3. Add a new entry with the next number (e.g. `ga3`, `commitGate3`) using `"style": "solid"` and the new date.
4. Write the slip `reason` on the **new** entry (each revision owns its own `reason`).
5. Use a label like `"GA 3"`, `"Commit Gate 3"`, `"Promotion Gate 3"`, etc.
6. **Never** overwrite an existing slot, rotate keys, or push into `gaOverflow` / `promotionGateOverflow`.

### Example — GA slipping from June 15 to July 14 on NDB-2.11

Before:
```json
"ga2": { "label": "General Availability 2", "date": "2026-06-15", "color": "#28a745", "style": "solid" }
```

After:
```json
"ga2": { "label": "General Availability 2", "date": "2026-06-15", "color": "#28a745", "style": "dotted" },
"ga3": { "label": "General Availability 3", "date": "2026-07-14", "color": "#28a745", "style": "solid" }
```

## Step 4 — Check sprint dates

Look at `sprintDates` in the same file. If the new date falls **after the last sprint date**, offer to extend the list with additional 21-day Wednesday-anchored sprint boundaries (per `sprint-system.mdc`: 3-week sprints, Wednesday start).

## Step 5 — Confirm and apply

Show a summary of changes before editing:
- Release: `NDB-X.XX`
- Gate: `GA / Code Complete / …`
- Previous date (dotted): old date
- New target date (solid): new date

Apply with `StrReplace` — do not rewrite the whole file.

## Step 6 — Report

Confirm what changed in a short table. Note if `sprintDates` needs extending.
