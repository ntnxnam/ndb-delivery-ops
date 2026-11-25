---
name: weave
description: Weave orchestrator — invoked by Loom thinker with a locked Goal Contract; executes full stack weave (scaffold → review → QA → UX → Final Acceptance → merge). QA owns UX acceptance at the end. Includes link integrity gate (no broken/DOA links).
aliases: [multi-agent-delivery-pipeline]
---

# Weave — Orchestrator (invoked by Loom)

Invoked by **Loom** (thinker) with a locked Goal Contract + Decomposition Memo. Produce/confirm plan file in `/Users/namratha.singh/.opencode/plan/weave-<slug>.md`, then execute the delivery pipeline via `agent-pack/loom/rules/weave.mdc` (Dev → Impact Scout → Compile Gate → Review → QA → UX → PM → Exec → JIRA → Fix → Doc → Final Acceptance → API Data Gate → Merge), where **Final Acceptance (8.6) is QA owning UX acceptance at the end** to catch post-Fix regressions.

## Compile gate — zero compile-time errors (stage 1.7, re-checked at 8.6 and before Merge)

Every weave that touches code **must** pass a compile gate before Merge — no broken types or syntax ship:

- **Developer must run** `bash scripts/loom/checks/check-compile.sh` (aka `npm run check:compile`) locally before requesting review. This runs `tsc --noEmit` for `shared`, `mcp/lighthouse`, `mcp/loom` plus a `node --check` canary for `server/index.js`.
- **QA must verify** the gate output — `check:compile PASS` is required for the `compile-gate` KPI to be MET. Any `TSxxxx` error is a **Blocking MISS**.
- **Fix must re-run** the gate when it touches any `.ts`/`.js` file; **Final Acceptance (8.6)** re-runs it to catch post-Fix regressions.
- **Merge is blocked** until the gate is green on the final commit. `compile-gate` is never waivable — fix the type.
- Client is JS/JSX today (no `tsconfig.json`); heavy `react-scripts build` is only run when client bundling is in scope (QA decides). If a client `tsconfig.json` appears, the gate typechecks it too.

## Link integrity gate (applies to Loom and Lighthouse — including lighthouse docs)

Every weave must pass a broken-link check before Merge — no dead-on-arrival hyperlinks reach the user (Loom app code, Lighthouse app code, and `docs/` are all in scope):

- **QA must run** `bash scripts/lighthouse/docs/docs-verify.sh` (stale paths + hub + required guides) and `node scripts/lighthouse/docs/docs-build.js` when any `docs/`, `client/src`, `apps/delivery-ops/client/src`, `apps/delivery-ops/server/`, or `agent-pack/lighthouse/` link is added/changed. Broken internal links (`href` to non-existent file, markdown `[text](path)` to missing doc, `/docs/` routes not served by `server/index.js:docsRoot` or `client/src/setupProxy.js`) block the stage — this includes Lighthouse user/admin/tech guides, API/page specs, and release-notes/known-issues docs.
- **Dev must** use relative `/docs/` links (never `http://localhost:8001`), and add new docs pages to `docs/index.html` nav when creating them.
- **User should not find broken links** — QA verdict is `MISS` if `docs-verify` warns on a link introduced by this weave (Loom or Lighthouse).

## AI Audit gate (stage 8.5 — Doc sign-off)

Every weave that touches a page **must** leave a chronological audit entry:

- Look up affected page(s) in `apps/delivery-ops/server/config/aiAudit.config.json` → `pages.<Page>.auditPath`
- Scaffold one journal file via `scripts/loom/ai-audit/new-entry.sh --page <Page> --slug <kebab> --weave <slug>` — naming `YYYY-MM-DD__kebab-slug__weave-<slug>.md` per `agent-pack/loom/rules/ai-audit-docs.mdc`
- Fill all required sections: Prompt verbatim, GOAL/DONE WHEN, AI Config Snapshot, Changes, Decisions, **Mistakes & Corrections**, Verification, Links, Config Delta
- If the mistake pattern is cross-page, also append to `docs/ai-audit/LEARNINGS.md`
- Regenerate per-folder `INDEX.md` + `docs/ai-audit/timeline.md` via `node scripts/lighthouse/docs/docs-build.js`
- Infra/config-only weaves (no page touched) mark AI Audit as N/A with reason — no journal needed

Doc gate MISS if: audit folder missing for a touched page, journal file missing/misnamed/missing frontmatter, per-folder `INDEX.md` stale, or `LEARNINGS.md` not updated when a cross-page mistake was identified.

Before starting a weave, read `docs/ai-audit/LEARNINGS.md` for anti-patterns relevant to the pages in scope.

Use `agent-pack/loom/skills/review` for stage 2 and `agent-pack/loom/skills/exec` for stage 6.
