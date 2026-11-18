---
name: leader-org
area: sos-leader
---

# Eng leader org map (SoS by Leader)

## Purpose

Regroup SoS Feature/Initiative items under eng leaders for Friday digest
review. Attribution = **Assignee Manager** rolled up through config.

## Config

- File: `apps/delivery-ops/server/config/ndbLeaderOrgConfig.json`
- API: `GET /api/config/ndb-leader-org`
- Client util: `client/src/utils/sosLeaderGrouping.js`

## Leaders (NDB fixture)

Anil · Naveen · Jovan · Ashish — plus managers and nested `reports`.

Match: case-insensitive trimmed display name against `matchNames`,
`displayName`, nested reports.

## Unmapped

Empty / unknown Assignee Manager → Unmapped section (drain into config).

## Future AI

Per-leader coaching asks after SoS data loads:
`prompts/draft/sos-leader-coaching.md`.

Do not invent managers or leaders not in the org packet.
