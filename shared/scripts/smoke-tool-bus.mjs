#!/usr/bin/env node
/**
 * Wave 2: MCP must not ship a private JIRA connector; aliases match D30 fields.
 * D40: Express jiraService.js must not be a second HTTP client.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

const jiraClient = join(repoRoot, 'apps/delivery-ops/server/utils/jiraClient.js');
if (!existsSync(jiraClient)) {
  console.error('tool-bus failed: apps/delivery-ops/server/utils/jiraClient.js must exist');
  process.exit(1);
}
const jiraClientSrc = readFileSync(jiraClient, 'utf8');
if (!jiraClientSrc.includes('JiraConnector')) {
  console.error('tool-bus failed: jiraClient.js must construct shared JiraConnector');
  process.exit(1);
}

const jiraService = join(repoRoot, 'apps/delivery-ops/server/services/jiraService.js');
const jiraServiceSrc = readFileSync(jiraService, 'utf8');
for (const needle of ["require('axios')", 'createHttpsAgent', 'retryJiraCall']) {
  if (jiraServiceSrc.includes(needle)) {
    console.error(`tool-bus failed: jiraService.js must not contain ${needle}`);
    process.exit(1);
  }
}

const skipNames = new Set([
  'tcmsService.js',
]);
const transportRe = /(?:function|const)\s+(?:createHttpsAgent|retryJiraCall)\b/;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (entry === '__tests__' || entry === 'node_modules') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
      continue;
    }
    if (!entry.endsWith('.js') || skipNames.has(entry)) continue;
    const src = readFileSync(full, 'utf8');
    if (transportRe.test(src)) {
      console.error(`tool-bus failed: leftover JIRA transport in ${full.slice(repoRoot.length + 1)}`);
      process.exit(1);
    }
  }
}

walk(join(repoRoot, 'apps/delivery-ops/server'));

for (const rel of [
  'shared/src/connectors/githubConnector.ts',
  'shared/src/connectors/emailConnector.ts',
  'apps/delivery-ops/server/utils/confluenceClient.js',
  'apps/delivery-ops/server/utils/emailClient.js',
]) {
  if (!existsSync(join(repoRoot, rel))) {
    console.error(`tool-bus failed: missing ${rel}`);
    process.exit(1);
  }
}

const mcpGithub = join(repoRoot, 'mcp-server/src/tools/leadershipCommitReport.ts');
const mcpGithubSrc = readFileSync(mcpGithub, 'utf8');
if (mcpGithubSrc.includes("from 'axios'") || mcpGithubSrc.includes('from "axios"')) {
  console.error('tool-bus failed: leadershipCommitReport.ts must not import axios');
  process.exit(1);
}

console.log('tool-bus ok: shared Jira/GitHub/Email connectors; Express via jiraClient; no MCP-private JIRA client');
