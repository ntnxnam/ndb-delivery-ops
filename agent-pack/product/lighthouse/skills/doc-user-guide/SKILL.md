---
name: doc-user-guide
description: Maintain the end-user guide — how to use the product as an IC/TPM/FEAT owner. Use when a user-facing flow ships or user asks "update user guide".
audience: ic, team_lead, tpm, feat, qa_lead
---

## When to Use This Skill

- New page, tab, or user flow ships (client/src/components, client/src/pages)
- Existing flow materially changes (new filter, new chart, new bulk action)
- User asks "how do I use X?" / "update user guide for X"
- Pipeline stage 8.5 when diff touches `client/` user surfaces

## Quick Start

```
Input: { featureArea, releaseName }
Output: Documentation/guides/USER_GUIDE.md
```

Procedure:
1. Inventory affected surfaces from git diff (pages, tabs, modals, bulk actions)
2. For each surface: purpose, who uses it (persona), step-by-step, screenshots placeholder, tips, FAQ
3. Sections per `documentation-consistency.mdc`:
   - Frontmatter: `product`, `lastUpdated`, `coversVersion`
   - TOC with anchors
   - Getting Started → Per-Feature flows → Tips & FAQ → Keyboard/Permissions notes
4. Link to ADMIN_GUIDE for permission-dependent steps; link to KNOWN_ISSUES for caveats
5. Keep language persona-aware (per `persona-aware-output.mdc`) — plain steps, no impl jargon

## Output Template

```markdown
---
product: NDB Delivery Ops
lastUpdated: 2026-05-19
coversVersion: "2.11"
---

# User Guide

## Table of Contents
- [Getting Started](#getting-started)
- [Feature: Sprint Report](#sprint-report)

## Getting Started
...

## Sprint Report
**Who:** TPM, FEAT owners
**Steps:**
1. ...
**Tips:** ...
**See also:** [ADMIN_GUIDE.md#permissions](./ADMIN_GUIDE.md#permissions)
```

## KPI contract

- `KPI: every user-facing surface in diff has a guide section` — MISS if missing
- `KPI: no broken internal anchors` — MISS if 404
- `KPI: persona + steps + tips present per feature` — MISS if incomplete

## Delegation

Owner: `doc-specialist`. Triggered by `ops-assistant` or pipeline stage 8.5.
