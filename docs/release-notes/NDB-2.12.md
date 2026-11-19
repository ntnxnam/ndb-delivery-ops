---
product: NDB Delivery Ops
release: "2.12"
date: 2026-11-19
gate: GA TBD
source: doc-specialist @ 2026-11-19
---

# Release Notes — NDB 2.12

## Unreleased — weave-client-fields-labels (jiraFieldsConfig v1.1.0 client consolidation)

- **Client SoT mirror:** `client/src/config/jiraFieldsConfig.json` mirrors server SoT (8 field cats + labels taxonomy: porExclude, lifecycle{deferred,mustfix,wishlist,longTermFunded,extension}, dependency.trainAsk, testType.systemTest).
- **fieldConfig fetch-cache:** `client/src/utils/fieldConfig.js` ensureLoaded() via `GET /api/config/jira-fields` (fetch-once, cached) delegates to `client/src/utils/jiraFields` (getFieldId/getLabelJql); consumers must await ensureLoaded() before use.
- **385→0 (resilience):** Hardcoded field IDs/labels removed from client services — all resolved via SoT; badge contrast fix on status pills.
- **P2 cache labels:** trainAsk/longTerm cache keys use taxonomy patterns (no inline strings).
- **Live proof 3× HTTP200:** `/api/config/jira-fields`, project-status, and dependency-view all 200 on QA run.

## Highlights

- JIRA fields/labels centralised in `jiraFieldsConfig.json` — single SoT for custom fields + labels JQL taxonomy.

## What's New

- Client mirror (`client/src/config/jiraFieldsConfig.json` + `client/src/utils/jiraFields` + `fieldConfig` fetch-cache) keeps frontend JQL taxonomy in sync with `GET /api/config/jira-fields`.

## Upgrade Notes

- No config change. `cp server/config/jiraFieldsConfig.json client/src/config/jiraFieldsConfig.json` when taxonomy changes (or rely on `GET /api/config/jira-fields` fetch).

## Known Issues

- See [KNOWN_ISSUES.md](../known-issues/KNOWN_ISSUES.md).
