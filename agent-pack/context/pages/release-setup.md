---
name: release-setup
route: /release-setup
audience: rm
---

# Release Setup

**Route**: `/release-setup`  
**Audience**: `rm`

## Job

Create / rename releases, cleanup filters.

## Prompts

- _(none — deterministic UI)_

## Engineering docs

`apps/delivery-ops/docs/pages/` → ReleaseSetup-requirements.md, ReleaseSetup-data-layer.md

## Agent notes

Deterministic + mutate HITL. Workflow release-cascade-rename.
