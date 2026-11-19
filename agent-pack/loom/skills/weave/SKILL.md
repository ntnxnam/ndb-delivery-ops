---
name: weave
description: Loom pipeline — Discuss target, draft plan to /opencode/plan/, then execute full stack weave (scaffold → review → QA → UX → Final Acceptance → merge). QA owns UX acceptance at the end. Includes link integrity gate (no broken/DOA links).
aliases: [multi-agent-delivery-pipeline]
---

# Weave

Discuss the target feature with the user, produce a plan file in `/Users/namratha.singh/.opencode/plan/weave-<slug>.md`, then execute the delivery pipeline via `agent-pack/loom/rules/weave.mdc` (Dev → Impact Scout → Review → QA → UX → PM → Exec → JIRA → Fix → Doc → Final Acceptance → Merge), where **Final Acceptance (8.6) is QA owning UX acceptance at the end** to catch post-Fix regressions.

## Link integrity gate (applies to Loom and Lighthouse — including lighthouse docs)

Every weave must pass a broken-link check before Merge — no dead-on-arrival hyperlinks reach the user (Loom app code, Lighthouse app code, and `docs/` are all in scope):

- **QA must run** `bash scripts/docs-verify.sh` (stale paths + hub + required guides) and `node scripts/docs-build.js` when any `docs/`, `client/src`, `apps/delivery-ops/client/src`, `apps/delivery-ops/server/`, or `agent-pack/lighthouse/` link is added/changed. Broken internal links (`href` to non-existent file, markdown `[text](path)` to missing doc, `/docs/` routes not served by `server/index.js:docsRoot` or `client/src/setupProxy.js`) block the stage — this includes Lighthouse user/admin/tech guides, API/page specs, and release-notes/known-issues docs.
- **Dev must** use relative `/docs/` links (never `http://localhost:8001`), and add new docs pages to `docs/index.html` nav when creating them.
- **User should not find broken links** — QA verdict is `MISS` if `docs-verify` warns on a link introduced by this weave (Loom or Lighthouse).

Use `agent-pack/loom/skills/review` for stage 2 and `agent-pack/loom/skills/exec` for stage 6.
