---
name: confluence-width-cleanup
description: Remove width constraints and formatting issues from Confluence HTML/XML content while preserving Confluence-specific markup. Use when cleaning up Confluence pages, removing table width styles, or fixing Confluence formatting issues.
audience: tpm, rm, portfolio_mgr
---

# Confluence Width Cleanup (project-level reference)

This skill is canonically defined at:

```
~/.cursor/skills/confluence-width-cleanup/SKILL.md
```

The project-level entry exists so the `confluence-publisher-specialist`
sub-agent can find it in the local `.cursor/skills/` directory. The
canonical content is at the user level — read that file for the full
procedure.

## When to Use This Skill

- The `confluence-publisher-specialist` is about to push to Confluence
  (mandatory pre-push step)
- A user pastes Confluence HTML/XML and asks to clean it
- A weekly status email is being rendered to Confluence (D17, D15d)
- A Team Executive report is being rendered to Confluence (D9, D15d)

## Quick Start

Per the user-level definition:

1. Read the Confluence HTML/XML
2. Ask for clarification if scope is ambiguous (per `confluence-cleanup-clarification.mdc`)
3. Remove `style="width: ..."` attributes from `<table>` tags
4. Delete `<colgroup>` sections
5. Return pure Confluence markup — no `<!DOCTYPE>`, no `<html>` wrapper

## Core Rules

Inherits all rules from the user-level skill. Additionally:

1. **Always runs before any push** by `confluence-publisher-specialist`
   (mandatory step in the publish pipeline per the specialist's procedure).
2. **Never strip Confluence macros** — `<ac:*>`, `<ri:user>`, `<ac:task-list>`.
3. **Citation preservation** — if the storage XML contains citation
   metadata blocks per `citation-first-output.mdc`, preserve them
   verbatim.

## Quality Validation

See user-level skill. Plus:

- [ ] Citation metadata block (per `citation-first-output.mdc`) is preserved
- [ ] Audience declaration in the page is unchanged
- [ ] If invoked from `confluence-publisher-specialist`, validate the
      result is well-formed XML before allowing the push

## Cross-references

- `~/.cursor/skills/confluence-width-cleanup/SKILL.md` — canonical
- `.cursor/rules/confluence-cleanup-clarification.mdc`
- `.cursor/rules/citation-first-output.mdc`
- `.cursor/agents/specialists/confluence-publisher-specialist.md`
