# Handover Documentation — portfolio-delivery-ops

> **Repo:** `portfolio-delivery-ops` (currently `ndb-delivery-ops` per D2) — `package.json:2`
> **Date:** 2026-11-11
> **Audience:** Engineering leadership / incoming maintainers

This folder contains top-level capability documentation for the platform. Each doc is self-contained.

| Doc | What it covers |
|-----|----------------|
| [00 — User Guide](./00-User-Guide.md) | One-stop user guide: what the app does, what it's used for, and per-page why + how to use |
| [01 — Platform Overview](./01-Platform-Overview.md) | What the app does, who uses it, architecture, integrations, tech stack |
| [02 — Capability Map](./02-Capability-Map.md) | Full feature catalog by domain, live vs planned, reuse matrix |
| [03 — Operations Guide](./03-Operations-Guide.md) | How to run locally, env vars, deployment, data flow |

Source-of-truth docs in repo root remain authoritative:
- `ARCHITECTURE.md` — 5-layer architecture
- `DECISIONS.md` — D0–D43 locked decisions
- `FEATURE_CATALOG.md` — 8-domain feature inventory
- `CONSOLIDATION.md` — 17-app port tracker
- `agent-pack/manifest.json` — agent/skill registry

## Updates

| Date | Change |
|------|--------|
| 2026-11-11 | Added `04-Dead-Code-Audit.md` — full repo scan for unreachable / unused code with severity tiers and delete order. |

