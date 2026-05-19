# Project rules

This folder is intentionally light. Most rules live at the **user level** so
they apply across every NDB-Ops repo:

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
