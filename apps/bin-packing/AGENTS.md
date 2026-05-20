# Agent primer — NDB Projects Bin-Packing

## What this project is

> _One-paragraph description goes here. Replace this stub when you next open the repo._

## Read first

1. `~/.cursor/AGENTS.md` — user role (Ops supporting NDB Engineering), recipient audiences (VP / Manager / Engineer), layered loading order
2. `~/.cursor/context/ndb-ops/AGENTS.md` — NDB-Ops domain primer
3. `~/.cursor/context/ndb-ops/customfields.md` — JIRA `customfield_NNNNN` translations
4. `~/.cursor/context/ndb-ops/releases.md` — canonical NDB release dates
5. `~/.cursor/context/ndb-ops/audience.md` — VP vs Manager vs Engineer output style

User-level rules under `~/.cursor/rules/` apply automatically — do not redefine them here.

## Project-specific things to fill in (TODO)

When you next work on this repo, fill these in:

- **Stack**: framework, language, key dependencies
- **Local run**: how to start / stop / test
- **Data sources**: JIRA filters used, customfields, REST endpoints
- **Audience**: which of VP / Manager / Engineer this project's output targets
- **Gotchas**: any non-obvious behavior or "sacred" code paths
- **Phase status**: if this project is mid-refactor, where in the plan it sits

## Cross-cutting reminders

- This is an **NDB-Ops** project (tooling around NDB), not an NDB product project.
- JIRA target is `https://jira.nutanix.com` (v2 API).
- Never hardcode `customfield_NNNNN` outside the project's `jiraFields` constants file.
- Every metric in user-facing output needs a JIRA hyperlink (see `jira-authenticity-links.mdc`).
- For ops/incident investigation in this repo, the user can trigger the `ndb-rca-agent` persona at `~/.cursor/agents/ndb-rca-agent.md`.
