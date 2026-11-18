---
name: weave
description: Loom pipeline — Discuss target, draft plan to /opencode/plan/, then execute full stack weave (scaffold → review → QA → merge). Harness-agnostic.
aliases: [multi-agent-delivery-pipeline]
---

# Weave

Discuss the target feature with the user, produce a plan file in `/Users/namratha.singh/.opencode/plan/weave-<slug>.md`, then execute the delivery pipeline via `agent-pack/loom/rules/weave.mdc` (Dev → Impact Scout → Review → QA → UX → PM → Exec → JIRA → Fix → Merge).

Use `agent-pack/loom/skills/review` for stage 2 and `agent-pack/loom/skills/exec` for stage 6.
