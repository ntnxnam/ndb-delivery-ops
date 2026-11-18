/**
 * Resource: ndb://glossary
 *
 * Surfaces the NDB-Ops glossary (`~/.cursor/context/ndb-ops/glossary.md`)
 * as an MCP resource so any LLM client can pull it on demand instead of
 * baking the definitions into prompts.
 *
 * This is the prove-out for the resources pillar; future resources
 * (releases, customfields, teams, jql-recipes) follow the same template.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const GLOSSARY_PATH = path.join(os.homedir(), '.cursor', 'context', 'ndb-ops', 'glossary.md');

export function registerNdbGlossary(server: McpServer): void {
  server.registerResource(
    'ndb-glossary',
    'ndb://glossary',
    {
      title: 'NDB-Ops Glossary',
      description:
        'Authoritative definitions for NDB-Ops domain terms (Team Executive, EC, CG, X-FEAT, ...). Pulled from ~/.cursor/context/ndb-ops/glossary.md so a single source of truth feeds both Cursor and MCP clients.',
      mimeType: 'text/markdown',
    },
    async (uri) => {
      try {
        const text = await fs.readFile(GLOSSARY_PATH, 'utf8');
        return {
          contents: [
            { uri: uri.href, mimeType: 'text/markdown', text },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'text/plain',
              text: `Glossary unavailable at ${GLOSSARY_PATH}: ${msg}`,
            },
          ],
        };
      }
    }
  );
}
