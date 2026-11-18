---
name: confluence-width-cleanup
description: Remove width constraints and formatting issues from Confluence HTML/XML content while preserving Confluence-specific markup. Use when cleaning up Confluence pages, removing table width styles, or fixing Confluence formatting issues.
audience: tpm, rm, portfolio_mgr
---

# Confluence Width Cleanup — Confluence HTML/XML Normalization (D15d, D17)

> Canonical: ~/.cursor/skills/confluence-width-cleanup/SKILL.md — this wrapper ensures agent discovery via agent-pack/harness symlinks. Keep in sync via harness install.sh. This file is the portable-pack SoT per D38; the user-level file is the harness mirror.

Mandatory pre-push step for every Confluence publish. The `confluence-publisher-specialist` runs this skill before any `confluenceConnector.createPage` or `confluenceConnector.updatePage` call. Other specialists run it when rendering email/Confluence variants of their output (D15d three renderers).

## When to Use This Skill

- The `confluence-publisher-specialist` is about to push to Confluence (mandatory pre-push step)
- A user pastes Confluence HTML/XML and asks to clean it
- A weekly status email is being rendered to Confluence (D17, D15d)
- A Team Executive report is being rendered to Confluence (D9, D15d)
- Any skill producing Confluence storage XML output

## Quick Start

```
Input: { html: string, scope?: "page" | "table" }
Output: { cleanedHtml: string, removedCount: number }

1. Read the Confluence HTML/XML input
2. Ask for clarification if scope is ambiguous (per agent-pack/lighthouse/rules/confluence-cleanup-clarification.mdc)
3. Remove style="width: ...; ..." attributes from <table> tags
4. Delete <colgroup> sections
5. Normalize fixed-width <div> wrappers to Confluence default
6. Return pure Confluence markup — no <!DOCTYPE>, no <html> wrapper
```

## Core Rules

1. **Always runs before any push** by `confluence-publisher-specialist` (mandatory step in the publish pipeline).
2. **Never strip Confluence macros** — `<ac:*>`, `<ri:user>`, `<ac:task-list>`, `<ac:structured-macro>`.
3. **Citation preservation** — if the storage XML contains citation metadata blocks per `citation-first-output.mdc`, preserve them verbatim.
4. **Width removal is surgical** — only remove width-related CSS (`width`, `max-width`, `min-width` on tables/colgroups). Leave colour, padding, and alignment styles untouched.
5. **Well-formedness check** — output must be valid Confluence storage XML (parseable). If cleanup breaks structure, abort and surface the parse error.

## Delegation

Owner: `confluence-publisher-specialist`. Triggered by `ops-assistant` or directly by any specialist rendering Confluence output.

## Quality Validation

- [ ] All `style="width: ..."` removed from `<table>` tags
- [ ] All `<colgroup>` sections removed
- [ ] Confluence macros (`<ac:*>`, `<ri:user>`) preserved
- [ ] Citation metadata block (per `citation-first-output.mdc`) preserved
- [ ] Audience declaration in the page unchanged
- [ ] Result is well-formed XML (passes Confluence storage format validation)
- [ ] If invoked from `confluence-publisher-specialist`, validate before allowing push

## Cross-references

- `agent-pack/lighthouse/rules/confluence-cleanup-clarification.mdc`
- `agent-pack/lighthouse/rules/citation-first-output.mdc`
- `agent-pack/lighthouse/identity/specialists/confluence-publisher-specialist.md`
- `agent-pack/harness/install.sh` — symlink sync
