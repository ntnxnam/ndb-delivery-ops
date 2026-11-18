import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadEnv } from './config/env.js';

const SERVER_INSTRUCTIONS = [
  'You are connected to the Loom MCP server (builder). It exposes builder capabilities for the Loom personal manager.',
  '',
  'Loom orchestrates: takes request → clarifies → sets goal → spins leads → leads spin agents (parallel/serial).',
  'Builder tools (scaffold, deploy, review) live here. Product tools (release status, JQL, etc.) live in lighthouse/mcp.',
  '',
  'Errors are returned as `isError: true` with a human-readable text body. Read them and self-correct rather than escalating immediately.',
].join('\n');

async function main(): Promise<void> {
  const env = loadEnv();
  const server = new McpServer({ name: 'loom', version: '0.1.0' }, { instructions: SERVER_INSTRUCTIONS });
  // Builder-owned tools will register here. Product tools (getReleaseStatus etc.) are in lighthouse/mcp.
  // Keep env loaded for JIRA_PAT / GITHUB_TOKEN used by builder connectors (loomAuth).
  void env;
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[loom MCP] connected over stdio (builder, product tools in lighthouse/mcp)');
}
main().catch((err) => { console.error('[loom MCP] fatal:', err); process.exit(1); });
