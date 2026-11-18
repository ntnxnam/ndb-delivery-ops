# ndb-delivery-ops MCP server

A custom Model Context Protocol server that exposes NDB-Ops delivery
tooling as tools and resources. Any MCP-aware client (Cursor, Claude
Desktop, Claude.ai connectors, the `mcp` CLI) can call into it.

## Architecture

```
              client (Cursor / Claude Desktop / Claude.ai)
                                 |
                          stdio transport
                                 |
                       +---------v---------+
                       |  McpServer        |
                       +---+-------+-------+
                           |       |
                  +--------+       +--------+
                  v                         v
              tools/                    resources/
            (thin adapters)            (readable)
                  |
                  v
     @portfolio-delivery-ops/shared
     jiraConnector (DC PAT Bearer) + DateMoverService
                  |
                  v
            JIRA Data Center REST API v2
```

| Pillar | Path |
|---|---|
| Server entry | `src/index.ts` |
| Env / config | `src/config/env.ts` — wraps shared `loadEnv()` |
| Tools | `src/tools/*.ts` — call `shared`, never a private JIRA client |
| Resources | `src/resources/*.ts` |

## Build + run

```bash
# From the repo root
npm install
npm run mcp:build      # tsc -> mcp-server/dist/
npm run mcp:start      # node dist/index.js  (stdio; reads from stdin)
```

`mcp:start` blocks waiting for MCP protocol messages on stdin — that's
expected. Clients spawn it as a child process.

## Wire into a client

### Cursor (this repo)

`.cursor/mcp.json` at the repo root already registers the server. Cursor
will spawn `node mcp-server/dist/index.js` automatically when the
workspace opens.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "ndb-delivery-ops": {
      "command": "node",
      "args": ["/Users/namratha.singh/NDB-Ops-Tools/ndb-delivery-ops/mcp-server/dist/index.js"],
      "env": {
        "JIRA_BASE_URL": "https://jira.nutanix.com",
        "JIRA_PAT": "<your PAT>"
      }
    }
  }
}
```

Then restart Claude Desktop.

### Claude.ai connectors

Same shape as Claude Desktop; paste the JSON into the connector config UI.

## Required env

| Var | Required | Default | Notes |
|---|---|---|---|
| `JIRA_PAT` (or `JIRA_TOKEN`) | yes | — | JIRA **Data Center** Personal Access Token (`Authorization: Bearer`). Not a Cloud API token. |
| `JIRA_BASE_URL` | no | `https://jira.nutanix.com` | No trailing slash |
| `JIRA_TIMEOUT_MS` | no | `30000` | Per-request axios timeout |
| `HTTPS_PROXY` | no | — | Corporate VPN / proxy |
| `CONFLUENCE_BASE_URL` | for `move_jira_dates` apply | — | Required when `dryRun: false` (D30 audit) |
| `CONFLUENCE_PAT` | no | JIRA PAT | Confluence PAT if SSO is not shared |
| `DEFAULT_PRODUCT_ID` / `NDB_DEFAULT_TEAM_ID` | no | — | Shared `loadEnv` default product |

## Available tools

| Tool | What it does | Replaces |
|---|---|---|
| `get_release_status` | Audience-aware release snapshot (vp / em / engineer): total items, R/Y/G risk, top blockers | — |
| `move_jira_dates` | Gate-date move via `DateMoverService` (reason + Confluence audit, dryRun default). Data Center PAT. | `ndb-date-mover` |
| `calculate_story_points` | Walk a parent's hierarchy and sum committed + delivered SP by issue type | `ndb-story-point-calculator` |
| `say_vs_do` | Release predictability: SP_said vs SP_did, per-issue-type | `ndb-say-vs-do` |
| `bin_pack_projects` | First-Fit-Decreasing schedule of work items under a fixed FTE capacity | `ndb-projects-bin-packing` |
| `gantt_release_timeline` | Per-item start/end dates for a release, honouring the NDB date hierarchy | `Release-Timelines-Visualizer` |
| `plan_capacity` | Compute gross + net SP capacity for a team over a horizon | `ndb-capacity-planner` |
| `leadership_commit_report` | Per-repo per-author GitHub commit counts for a date range | `GitHub-Commits` (GitHub slice) |

## Available resources

| URI | What |
|---|---|
| `ndb://glossary` | Pulls `~/.cursor/context/ndb-ops/glossary.md` so any client can read NDB-Ops term definitions. |

## Adding a tool

1. Create `src/tools/<name>.ts` exporting `registerX(server, env)`.
2. Wire it from `src/index.ts`.
3. Use `JiraConnector` from `@portfolio-delivery-ops/shared` (Data Center PAT Bearer). Never add a private JIRA client or Cloud Basic/OAuth auth.
4. Define a Zod `inputSchema` and provide `structuredContent` in the response.
5. Set `annotations.readOnlyHint` / `destructiveHint` honestly so clients can warn users.
6. Add a row to the "Available tools" table above.
