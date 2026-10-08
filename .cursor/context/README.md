# `.cursor/context` — Cursor adapter stubs

**Canonical domain + page context lives in `agent-pack/context/`.**

Files that used to live only here were copied into the pack:

| Legacy file | Pack path |
|---|---|
| `jira-workflows-and-resolutions.md` | `agent-pack/context/domain/jira-workflows-and-resolutions.md` |
| `DEFERRAL_TRACKING.md` | `agent-pack/context/domain/deferral-tracking.md` |
| `COMPONENT_REPORT_BRIEFING.md` | `agent-pack/context/pages/component-report.md` |

Do not add new long-form context only under `.cursor/`. Add under
`agent-pack/context/`, register in `agent-pack/manifest.json`, and leave a
one-line pointer here if Cursor needs a discoverable path.

Start: `agent-pack/context/INDEX.md`.
