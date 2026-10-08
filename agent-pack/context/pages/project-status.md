---
name: project-status
route: /project-status
audience: tpm, rm, feat
---

# Project Status

**Route**: `/project-status`  
**Audience**: `tpm, rm, feat`

## Job

Release picker, FEAT/Initiative table, Gantt, exec summary, task breakdown.

## Prompts

- `feature-exec-summary`

## Engineering docs

`apps/delivery-ops/docs/pages/` → ProjectStatus-requirements.md, ProjectStatus-data-layer.md

## Agent notes

Filters client-side. Status update raw text never rendered — AI only.
