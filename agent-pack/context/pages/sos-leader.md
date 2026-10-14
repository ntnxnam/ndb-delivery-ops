---
name: sos-leader
route: /sos-leader-summary
audience: tpm, rm
---

# SoS by Leader

**Route**: `/sos-leader-summary`  
**Audience**: `tpm, rm`

## Job

Same SoS payload regrouped Leader → Release → Features, with per-leader KPIs,
history, breakdowns, NAI coaching Asks (release + sprint), and readiness-gated
email to `sosEmailConfig`.

## Prompts

- `sos-leader-coaching` (production) — `naiService#SOS_LEADER_COACHING_SYSTEM_PROMPT`
- reuses `sos-tier` + feature-exec for tier boxes

## Engineering docs

`apps/delivery-ops/docs/pages/` → SosLeaderSummary-requirements.md, SosLeaderSummary-data-layer.md

## Agent notes

See domain/leader-org.md. Friday cron not in this phase — manual Email Leader SoS only.
