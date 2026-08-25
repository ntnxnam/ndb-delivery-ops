# Project rules (Cursor adapter)

Constitutional product-agent rules live in `agent-pack/rules/` and are
symlinked here (D38). Builder-only rules for this repo stay as real files
in this folder (`minimal-architecture`, `api-docs-required`,
`page-docs-required`, `documentation-consistency`, `gerrit-push-for-review`).

Most other rules live at the **user level** so they apply across every
NDB-Ops repo:

- `~/.cursor/rules/minimal-architecture.mdc`
- `~/.cursor/rules/no-localhost.mdc`
- `~/.cursor/rules/nutanix-jira-date-hierarchy.mdc`
- `~/.cursor/rules/documentation-consistency.mdc`
- `~/.cursor/rules/confluence-cleanup-clarification.mdc`
- `~/.cursor/rules/react-useeffect-infinite-loop-prevention.mdc`
- (and ~10 others — see that folder)

Add a rule **here** only when it's a project-specific delta that contradicts
or extends a user-level rule, and call out the override in the rule's
description so we can audit it.
