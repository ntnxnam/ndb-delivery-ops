---
name: kpis
route: /kpis
audience: tpm, director
---

# KPIs

**Route**: `/kpis`  
**Audience**: `tpm, director`

## Job

Configured KPI dashboard chips with JIRA deep-links.

## Prompts

- _(none — deterministic UI)_

## Engineering docs

`apps/delivery-ops/docs/pages/` → KPIPage-requirements.md, KPIPage-data-layer.md

## Agent notes

Counts must be clickable (jira authenticity). When a page has an in-app list for a chip, use dual-click: count → panel, Open in JIRA → JQL.
