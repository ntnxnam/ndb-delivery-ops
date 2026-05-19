# Agent primer — ndb-status-sender

## What this project is

The primary internal tool for sending NDB release-version status emails and dashboards to NDB Engineering. It's a React + Express stack:

- **Frontend**: React app served on `localhost:6100` in dev; talks to backend on `localhost:6001`
- **Backend**: Node/Express server in `server/`; proxies JIRA, sends SMTP through Nutanix mail relay
- **Data sources**: JIRA (Nutanix instance), TCMS, Confluence

## Read first (in order)

1. `~/.cursor/AGENTS.md` — the user's role, layered loading, recipient audiences
2. `~/.cursor/context/ndb-ops/AGENTS.md` — domain primer (releases, customfields, teams, JQL)
3. `.cursor/rules/minimal-architecture.mdc` — this repo's structural deltas (the hit-list of oversized files)
4. `.cursor/rules/documentation-consistency.mdc` — this repo's report-naming deltas

The user-level rules in `~/.cursor/rules/` are auto-applied and you don't need to re-read them every turn.

## Running locally

```bash
./start          # starts backend on 6001 and frontend on 6100
./stop           # stops both
./restart        # restart
tail -f .pid-backend .pid-frontend     # PIDs live here
```

Logs go to `ndb-app.log` (gitignored). Hot-reload is on for both client and server.

## Project structure

```
client/src/
  components/         JSX only — no fetch (see minimal-architecture rule)
  hooks/              data fetching + state
  shared/services/    canonical HTTP wrapper (apiService.js)
  services/           domain services (jiraQueryService, taskBreakdownService)
  utils/              pure functions (no React, no axios)
  constants/          magic strings
  auth/               authentication module (LoginForm, AuthContext, permissions)
  layout/             chrome (Sidebar, Layout)

server/
  routes/             thin Express handlers, one file per resource
  services/           multi-step orchestration
  utils/              single-purpose helpers
  config/             JSON config (jiraFieldsConfig, teamBoardConfig, allowedUsers)
  middleware/         auth, timeout, security

reports/              generated artifacts (committed)
```

## Permissions model (recently fixed)

- Users defined in `server/config/allowedUsers.json` (one of: `allowedUsers`, `kpiTabAllowedUsers`, etc.)
- Server maps legacy lists → fine-grained permissions in `server/routes/auth.js::LEGACY_PERMISSION_MAPPING`
- Client mirror in `client/src/auth/constants/permissions.js::LEGACY_PERMISSION_MAPPING`
- Sidebar items hidden if user lacks the permission for that tab
- "Test Connection & Refresh Permissions" button forces a re-fetch (use this after backend `auth.js` changes)

If a sidebar tab is missing for a user, check both legacy-mapping files (they must agree) and that the user appears in the corresponding `allowedUsers.json` list.

## SMTP / email sending — sacred path

`server/services/emailService.js`, `server/routes/email/sendEmailHandler.js`, `server/utils/sanitize.js`: preserve byte-for-byte unless the user approves. Current mail relay: `mailrelay.dyn.nutanix.com:25` (no auth). Several commits on `origin/main` are SMTP fixes; never rebase or squash them out.

## Refactor state

The codebase is in active refactor. Plan and progress:

- **Phase 1** ✓ committed — dead code purge (App.clean.js, email/ folder, root scripts, redundant shell scripts, stale top-level markdown)
- **AI architecture** ✓ committed at `48748a5` — generic rules/skills/agents promoted to user level; workspace `.cursor/` trimmed
- **Phase 2** in-flight on branch `refactor/phase-2`:
  - **2a** ✓ committed at `cd05f75` — extracted 17 pure helpers from `server/routes/jira/index.js` into 6 utility modules under `server/utils/`. File shrunk 7,397 → 7,149.
  - **2b** next — service extraction. Five new services under `server/services/`: `releaseService.js`, `sprintService.js`, `kpiService.js`, `execSummaryService.js`, `jiraTicketService.js`. Target: index.js shrinks to ~3,000 lines.
  - **2c** — split the now-thin index.js into 6 resource-scoped route files (`meta.js`, `releases.js`, `sprints.js`, `kpi.js`, `tickets.js`, `execSummary.js`). Target: every JIRA route file ≤250 lines.
- **Phase 3** — extract fetch out of `EmailSender.js` (2,189 lines), `ReleaseTrendsPage.js`, `SprintReportPage.js`, `ReleaseVersionTab.js`, `ReleaseVersionGantt.js`
- **Phase 4** — consolidate the two API wrappers (`utils/api.js` ↔ `shared/services/apiService.js`)
- **Phase 5** — consolidate customfield references (currently 238 inline in client, 1,190 in server) onto `jiraFields.js` / `jiraFieldsConfig.json`
- **Phase 6** — performance pass (memoize tables, virtualize long lists, batch JIRA calls)

When adding code, do not regress against earlier phases.

### Phase 2a utility files (already extracted — import from these)

When working in the JIRA routes, do NOT inline these helpers — import them:

| Symbol | Lives in |
|---|---|
| `extractTextFieldValue` | `server/utils/adfText.js` |
| `extractQIFromItem` | `server/utils/tcmsHelpers.js` |
| `classifySprintIssue`, `getAddedToSprintAt`, `getSprintsForBoard`, `resolveSprintState` | `server/utils/sprintCache.js` |
| `normalizeTeamId`, `loadKpiConfigSync`, `getKpisForTeam`, `getTeamBaseFilter`, `getTeamSprintBaseFilter` | `server/utils/teamConfig.js` |
| `upstreamStatus`, `getDefaultReleaseBaseFilter`, `getTeamConfig`, `constructParentProjectFilter`, `getConfigOverride`, `getReleaseBaseFilter` | `server/utils/jiraRouteHelpers.js` |
| `buildOptimizedProjectTicketsJQL`, `buildSprintReportJql`, plus the older `buildCommitItemsJQL`, `buildLongTermItemsJQL`, `buildTaskBreakdownJQL`, `buildAllTicketsJQL`, `getAllItemKeysForVersion` | `server/utils/jiraQueryUtils.js` |

## JIRA quirks specific to this project

- Sprint field is `customfield_10360` (not the default `customfield_10020`). See `~/.cursor/context/ndb-ops/customfields.md`.
- Three team base filters: `NDB-All-Base-Filter`, `DataLens-All-Base-Filter`, filter ID `175938` (NCM). See `server/config/teamBoardConfig.json` and `~/.cursor/context/ndb-ops/teams.md`.
- Use `runSearchByJql` from `server/utils/jiraSearchByJql.js` for paginated bulk fetches.

## Gotchas

- Frontend port changed from 8888 → 6100 in a recent commit; old bookmarks fail.
- Some tabs (Release Trends, Release Analysis) are gated behind `release_trends_view`; only granted via legacy `allowedUsers` mapping.

## Skills available

The user-level skills under `~/.cursor/skills/` are all directly useful here:

- `team-exec-release-report` — when the user asks for a Team Executive-style release summary
- `sprint-gantt-chart` — when building a Gantt visualization
- `fetch-project-tickets` — when gathering ticket data using the NDB JIRA hierarchy
- `confluence-width-cleanup` — when fixing Confluence HTML pasted into descriptions
- `predictive-team-exec-analytics` — when predictive/forecasting analysis is requested

## When in doubt

The user is an Ops person, not an NDB engineer. She does not own JIRA configuration, customfield IDs, or release calendar — she consumes them. When something looks off (e.g. a customfield ID that doesn't resolve), she'll ask a TPM/PM; don't try to "fix" the JIRA side. Fix the tool to be resilient instead.
