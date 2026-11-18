---
name: multi-model-review
description: >-
  Run an adversarial multi-model code review (parallel subagent reviewers, then
  synthesize). Absorbs delivery-pipeline hard rules without replacing the
  Dev→Review→QA→UX→Exec→JIRA→Fix→Security stage order. Use when the user
  invokes /multi-model-review or asks for multi-model / multi-LLM review.
disable-model-invocation: true
---

# Multi-Model Review

**Portable SoT:** `agent-pack/skills/multi-model-review/` (D38). Hosts
(Cursor, Claude Code, Codex, web) adapt — do not fork this file per surface.

**Invoke:** `pack.skills.get('multi-model-review')` or read this path.
Do not treat `.cursor/skills/…` or `~/.cursor/skills/…` as a separate copy.

Adversarial multi-model code review: several independent reviewers on different
models, then a synthesized verdict. **Do not edit files or apply fixes** unless
the user explicitly asks.

This skill **takes in** (does not replace) the delivery-ops pipeline in
`.cursor/rules/multi-agent-delivery-pipeline.mdc` (builder-only rule). Multi-model
review strengthens **stage 2 (Code Review)** while the full stage order remains
owned by that rule.

## Relationship to the delivery pipeline

| Concern | Owner |
|---|---|
| Stage order (Dev → Code Review → QA → UX → Exec → JIRA → Fix → Security → user) | `multi-agent-delivery-pipeline.mdc` |
| Parallel multi-model adversarial review + synthesis | **This skill** |
| Auto-fix / rewrite the feature | Neither — Fix is stage 7, only after user wants fixes |

When this skill runs **inside** a delivery-ops session:

1. Treat findings as a **Code Review punch list** (Blocking / High / Medium / Nit).
2. **Blocking** findings stop the pipeline until stage 7 clears them.
3. Do **not** skip QA, UX, Exec, JIRA Query Checker, or Security — say which
   stages still apply after this review.
4. Do **not** silently edit JQL (`jql-edit-approval`).
5. Do **not** rubber-stamp — FAIL unless findings are listed or the reviewer
   rigorously proves the diff is clean.

## 1) Pick models

If a structured multiple-choice question tool is present, call it before
launching reviewers. Use the exact tool name from that list. Build a single
question from the exact subagent model slugs listed in the host's system
prompt/tool instructions. Do not hardcode, invent, or repeat a repo-local
model list. Use those slugs verbatim for `options[].id`, set
`allow_multiple: true`, and use short human-readable labels. Present every
available model neutrally and in source order: do not recommend, rank,
preselect, omit, or add "(Recommended)".

If that tool is not available, ask the user to choose models inline and **wait**
for their response before launching reviewers. Offer the exact model slugs from
the host, with the same neutrality rules.

If the user already chose models in the `/multi-model-review` line or chat,
skip asking only when selection is explicit and unambiguous. If a selected
slug is rejected at execution time, prefer the closest valid slug suggested by
the host's subagent tool feedback.

## 2) Scope and intent

1. Determine what to review: user-specified paths or diff, else
   `git diff main...HEAD` (or repo default base vs HEAD), else local
   unstaged + staged diffs, else files/symbols from the conversation.
2. State one clear paragraph of **intent** — what the change is trying to
   accomplish (from messages, commits, or the code).
3. Collect the material to pass to reviewers: full diff or key file excerpts.

## 3) Launch one subagent per selected model (parallel only)

For **each** model slug the user selected, launch a **readonly** general-purpose
subagent with that model (Cursor: `Task` / `generalPurpose`; Claude Code /
Codex: equivalent parallel agent / subagent API). **Parallelism is mandatory:**
fire all reviewer launches in one batch — never sequentially. Each subagent
gets the same reviewer prompt; diversity comes from the models, not different
personas.

Each subagent prompt must include:

- The stated intent paragraph
- The code/diff under review
- Instructions to act as an adversarial reviewer: prioritize bugs,
  correctness, security, and maintainability
- Structured findings with severity (**Blocking** | **High** | **Medium** |
  **Nit** — map critical→Blocking, warning→High/Medium), concrete locations,
  evidence, optional suggestion
- Say "no findings" only with an explicit clean proof — no shallow LGTM
- **Delivery-pipeline hard constraints** (when in delivery-ops / NDB-Ops repos):
  - `minimal-architecture` — components render, hooks fetch, services transform;
    file-size limits; no fetch in components
  - `react-useeffect-infinite-loop-prevention`
  - `no-localhost` in production paths
  - `jql-edit-approval` — flag JQL drift; never propose silent JQL edits as applied
  - `jira-authenticity-links` / clickable metrics when counts/JQL/links touched
    (dual-click: count → panel when drill exists; Open in JIRA → exact JQL; never both external)
  - `ui-density` / `visual-storyteller-ui` when UI changes
  - `page-docs-required` / `api-docs-required` when pages or routes ship
  - Auth, secrets, injection, unsafe HTML/email, data exposure (security lens)

Optional: after the multi-model Code Review batch, the **parent** may still
spawn pipeline specialist stages (QA, UX, Exec, JIRA Query Checker, Security)
per `multi-agent-delivery-pipeline.mdc` — those are separate stages, not a
replacement for multi-model consensus.

## 4) Synthesize (parent agent)

Merge subagent findings:

- **Consensus** (2+ models)
- **Lone-model** findings
- Deduplicate overlapping issues
- Note disagreements

Categorize for the user: **act on** / **consider** / **noted** / **dismissed**,
with brief rationale.

Map to pipeline gating:

| Category | Pipeline effect |
|---|---|
| act on + Blocking/High | Blocks stage 7 until cleared (when running under the pipeline) |
| consider / Medium | List for user; does not block Security by itself |
| noted / Nit | Optional cleanup |
| dismissed | One-line why |

Do **not** auto-apply changes. Short handoff only: verdict, consensus punch
list, open asks, and which pipeline stages remain (if applicable).

## Never do

- Replace the delivery pipeline with "multi-model review only"
- Ship or declare done without noting remaining pipeline stages when code ships
- Collapse review + fix into one turn unless the user explicitly asks to fix
- Change JQL without explicit user approval
- Treat a shallow LGTM from any model as a pass
- Fork this skill into a Cursor-only / Claude-only / Codex-only copy

## 8) New lessons — Phase 1 shared helpers + config v2

When reviewing changes in this area, enforce these lessons (add new ones
here as they are learned):

1. **No hardcoded team/product strings in shared helpers.** `shared/src/utils/teamProjectUtils.ts`
   must pass `grep -n "NDB\|ndb-\|ERA\|FEAT"` with zero hits outside comments.
   All values come from `TeamConfig`.
2. **Config v2 completeness.** Every team entry in `teamBoardConfig.json` must
   include `releasePrefixes`, `labelPrefix`, `homeProjects`, `notificationEmails`,
   `tcms`, `qaEnv`, `branding`, `defaultRelease`, and `storyPointsField`.
   Reviewers should fail PRs that add a team without these fields.
3. **Single config entry onboarding.** A new team must be onboardable with one
   config entry and zero code change — verify by adding a dummy team, exercising
   the helpers, then removing the dummy (no code diff).
4. **Pure helpers + ≥95% coverage.** `teamProjectUtils` helpers are pure
   functions of `TeamConfig`; new helpers need unit tests covering all branches
   including fallback (`|| ''`, `|| []`) paths. Target ≥95% line and branch.
5. **Export surface.** New shared helpers must be re-exported from
   `shared/src/index.ts` (already done via `export * from './utils/teamProjectUtils.js'`).
6. **Schema version.** `_schema_version` must remain `2.0-team-agnostic`; do not
   revert to legacy `4.0-multi-team`.
7. **Do not weaken product-agnostic checks.** `npm run check:product-agnostic`
   must stay green; grandfathered `customfield_NNNNN` warnings are tracked
   separately and are not a license for new hardcodes.


## Related pipeline skills

- Stage 5 Exec sign-off → `agent-pack/skills/exec-perspective/`
- Stage 2 Code Review → this skill or Bugbot (Cursor)
