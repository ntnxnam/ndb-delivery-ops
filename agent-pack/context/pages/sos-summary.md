---
name: sos-summary
route: /sos-summary
audience: vp, director, tpm
---

# SoS Summary

**Route**: `/sos-summary`  
**Audience**: `vp, director, tpm`

## Job

Cross-release Feature/Initiative SoS with tier AI + email snapshot.

## Prompts

- `feature-exec-summary`
- `sos-tier-briefing`

## Engineering docs

`apps/delivery-ops/docs/pages/` → SosSummary-requirements.md, SosSummary-data-layer.md

## Agent notes

Email uses already-loaded page data — no JIRA refetch on send.
