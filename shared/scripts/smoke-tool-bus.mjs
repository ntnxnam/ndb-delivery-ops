#!/usr/bin/env node
/**
 * Wave 2: MCP must not ship a private JIRA connector; aliases match D30 fields.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GATE_DATE_FIELD_ALIASES, GATE_DATE_FIELDS } from '../dist/index.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const banned = join(repoRoot, 'mcp-server', 'src', 'connectors', 'jiraConnector.ts');
if (existsSync(banned)) {
  console.error('tool-bus failed: mcp-server/src/connectors/jiraConnector.ts must not exist');
  process.exit(1);
}

for (const [alias, fieldId] of Object.entries(GATE_DATE_FIELD_ALIASES)) {
  if (!Object.prototype.hasOwnProperty.call(GATE_DATE_FIELDS, fieldId)) {
    console.error(`tool-bus failed: alias ${alias} -> ${fieldId} is not a GATE_DATE_FIELDS key`);
    process.exit(1);
  }
}

console.log('tool-bus ok: shared JiraConnector + DateMoverService aliases; no MCP-private JIRA client');
