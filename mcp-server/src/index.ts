/**
 * NDB-Delivery-Ops MCP server entry point.
 *
 * Spawned by the host (Cursor, Claude Desktop, Claude.ai connectors) over
 * stdio. Registers connectors, tools, resources, and prompts, then connects
 * to the transport and waits.
 *
 * Subsequent tools are registered by importing their `register…` function
 * here. Keep this file thin — server-wide instructions and the connector
 * lifecycle stay here; everything else lives next to its domain.
 *
 * The server *instructions* below double as the system prompt the client
 * may add when planning tool calls. See the MCP spec on instructions.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadEnv } from './config/env.js';
import { registerGetReleaseStatus } from './tools/getReleaseStatus.js';
import { registerMoveJiraDates } from './tools/moveJiraDates.js';
import { registerCalculateStoryPoints } from './tools/calculateStoryPoints.js';
import { registerSayVsDo } from './tools/sayVsDo.js';
import { registerBinPackProjects } from './tools/binPackProjects.js';
import { registerGanttReleaseTimeline } from './tools/ganttReleaseTimeline.js';
import { registerPlanCapacity } from './tools/planCapacity.js';
import { registerLeadershipCommitReport } from './tools/leadershipCommitReport.js';
import { registerNdbGlossary } from './resources/ndbGlossary.js';

const SERVER_INSTRUCTIONS = [
  'You are connected to the NDB-Delivery-Ops MCP server. It exposes NDB-Ops capabilities (JIRA queries, release reports, sprint analytics) as tools.',
  '',
  'Conventions:',
  '- Every tool that produces user-facing output takes an `audience` arg (vp | em | engineer). Pick the right one from context; default is `em` (engineering manager).',
  '- Risk classification follows red/yellow/green/not_set, derived from JIRA customfield_23560.',
  '- For "release status" / "release health" queries, prefer `get_release_status`.',
  '- The `ndb://glossary` resource has authoritative definitions for Team Executive, EC, CG, X-FEAT, etc. Pull it before guessing.',
  '',
  'Errors are returned as `isError: true` with a human-readable text body. Read them and self-correct (e.g. retry with a different version string) rather than escalating to the user immediately.',
].join('\n');

async function main(): Promise<void> {
  const env = loadEnv();

  const server = new McpServer(
    { name: 'ndb-delivery-ops', version: '0.1.0' },
    { instructions: SERVER_INSTRUCTIONS }
  );

  // ── tools ──────────────────────────────────────────────────────────────
  registerGetReleaseStatus(server, env);
  registerMoveJiraDates(server, env);
  registerCalculateStoryPoints(server, env);
  registerSayVsDo(server, env);
  registerBinPackProjects(server);
  registerGanttReleaseTimeline(server, env);
  registerPlanCapacity(server);
  registerLeadershipCommitReport(server);

  // ── resources ─────────────────────────────────────────────────────────
  registerNdbGlossary(server);

  // ── transport ─────────────────────────────────────────────────────────
  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Note: stderr is fine for diagnostics; stdout is reserved for the MCP
  // wire protocol when using stdio transport.
  console.error('[ndb-delivery-ops MCP] connected over stdio');
}

main().catch((err) => {
  console.error('[ndb-delivery-ops MCP] fatal:', err);
  process.exit(1);
});
