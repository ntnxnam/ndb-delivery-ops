#!/usr/bin/env node
/**
 * Host-agnostic smoke: the pack loads from disk without Cursor.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packRoot = join(repoRoot, 'agent-pack');
const manifest = JSON.parse(readFileSync(join(packRoot, 'manifest.json'), 'utf8'));

const missing = [];
const check = (rel) => {
  if (!existsSync(join(packRoot, rel))) missing.push(rel);
};

check(manifest.identity.orchestrator);
check(manifest.memorySchema);
for (const rel of manifest.constitutionalRules) check(rel);
for (const entry of manifest.identities) check(entry.path);
for (const entry of manifest.skills) check(entry.path);
for (const entry of manifest.workflows) check(entry.path);

if (missing.length) {
  console.error('agent-pack missing files:\n' + missing.map((p) => `  ${p}`).join('\n'));
  process.exit(1);
}

const skillNames = new Set(manifest.skills.map((s) => s.name));
if (skillNames.size !== manifest.skills.length) {
  console.error('agent-pack: duplicate skill names in manifest');
  process.exit(1);
}

const cursorAdapters = [
  ['.cursor/agents', 'agent-pack/identity'],
  ['.cursor/skills', 'agent-pack/skills'],
  ['.cursor/workflows', 'agent-pack/workflows'],
];
for (const [adapter, target] of cursorAdapters) {
  // Presence is enough — git records these as symlinks.
  if (!existsSync(join(repoRoot, adapter))) {
    console.error(`Cursor adapter missing: ${adapter} -> ${target}`);
    process.exit(1);
  }
}

console.log(
  `agent-pack ok: ${manifest.identities.length} identities, ${manifest.skills.length} skills, ${manifest.workflows.length} workflows, ${manifest.constitutionalRules.length} rules`
);
