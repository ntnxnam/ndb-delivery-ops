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
                       |  instructions     |
                       +---+-------+-------+
                           |       |
                  +--------+       +--------+
                  v                         v
              tools/                    resources/
            (callable)                 (readable)
                  |                         |
                  v                         v
            connectors/              ndb://glossary, ...
            (jira, confluence, tcms, slack)
                  |
                  v
                JIRA REST API v2
                Confluence API
                TCMS API
                Internal Nutanix services
```

| Pillar | Path |
|---|---|
| Server entry | `src/index.ts` |
| Connectors | `src/connectors/*.ts` |
| Tools | `src/tools/*.ts` |
| Resources | `src/resources/*.ts` |
| Prompts (future) | `src/prompts/*.ts` |
| Env / config | `src/config/env.ts` |

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
| `JIRA_PAT` (or `JIRA_TOKEN`) | yes | — | Nutanix JIRA Personal Access Token |
| `JIRA_BASE_URL` | no | `https://jira.nutanix.com` | No trailing slash |
| `JIRA_TIMEOUT_MS` | no | `30000` | Per-request axios timeout |
| `HTTPS_PROXY` | no | — | Corporate VPN / proxy |
| `NDB_DEFAULT_TEAM_ID` | no | — | Used by tools that take an optional `teamId` |

## Available tools

| Tool | What it does | Replaces |
|---|---|---|
| `get_release_status` | Audience-aware release snapshot (vp / em / engineer): total items, R/Y/G risk, top blockers | — |
| `move_jira_dates` | Bulk-set one NDB date field on N issues (dryRun by default) | `ndb-date-mover` |
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
3. Use `JiraConnector` (or the right sibling connector) for upstream calls — never `axios` directly.
4. Define a Zod `inputSchema` and provide `structuredContent` in the response.
5. Set `annotations.readOnlyHint` / `destructiveHint` honestly so clients can warn users.
6. Add a row to the "Available tools" table above.
