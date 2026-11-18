import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadEnv } from '../../shared/config/env.js';
import { registerGetReleaseStatus } from '../../shared/tools/getReleaseStatus.js';
import { registerBuildJql } from './tools/buildJql.js';
import { registerTeamOverallReport } from './tools/teamOverallReport.js';
import { registerMoveJiraDates } from '../../shared/tools/moveJiraDates.js';
import { registerCalculateStoryPoints } from '../../shared/tools/calculateStoryPoints.js';
import { registerSayVsDo } from '../../shared/tools/sayVsDo.js';
import { registerBinPackProjects } from '../../shared/tools/binPackProjects.js';
import { registerGanttReleaseTimeline } from '../../shared/tools/ganttReleaseTimeline.js';
import { registerPlanCapacity } from '../../shared/tools/planCapacity.js';
import { registerLeadershipCommitReport } from '../../shared/tools/leadershipCommitReport.js';
import { registerNdbGlossary } from '../../shared/resources/ndbGlossary.js';

const SERVER_INSTRUCTIONS = [
  'You are connected to the Lighthouse MCP server. It exposes portfolio delivery ops capabilities (JIRA queries, release reports, sprint analytics) as tools.',
  '',
  'Conventions:',
  '- Every tool that produces user-facing output takes an `audience` arg (vp | em | engineer). Pick the right one from context; default is `em` (engineering manager).',
  '- Risk classification follows red/yellow/green/not_set, derived from JIRA customfield_23560.',
  '- For "release status" / "release health" queries, prefer `get_release_status`.',
  '- Pass `productId` where available to scope queries to the correct product.',
  '- The `ndb://glossary` resource has authoritative definitions for Team Executive, EC, CG, X-FEAT, etc. Pull it before guessing.',
  '',
  'Errors are returned as `isError: true` with a human-readable text body. Read them and self-correct (e.g. retry with a different version string) rather than escalating to the user immediately.',
].join('\n');

async function main(): Promise<void> {
  const env = loadEnv();
  const server = new McpServer({ name: 'lighthouse', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS });
  registerGetReleaseStatus(server, env);
  registerBuildJql(server);
  registerTeamOverallReport(server);
  registerMoveJiraDates(server, env);
  registerCalculateStoryPoints(server, env);
  registerSayVsDo(server, env);
  registerBinPackProjects(server);
  registerGanttReleaseTimeline(server, env);
  registerPlanCapacity(server);
  registerLeadershipCommitReport(server);
  registerNdbGlossary(server);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[lighthouse MCP] connected over stdio');
}
main().catch((err) => { console.error('[lighthouse MCP] fatal:', err); process.exit(1); });
