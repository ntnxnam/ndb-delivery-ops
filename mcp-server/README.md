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

## Available tools (v0.1.0)

| Tool | What it does |
|---|---|
| `get_release_status` | Audience-aware release snapshot. Args: `version`, optional `audience` (vp / em / engineer). |

(Phase 5 adds: `move_jira_dates`, `calculate_story_points`, `say_vs_do`, `bin_pack_projects`, `gantt_release_timeline`, `plan_capacity`, `leadership_commit_report`.)

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
