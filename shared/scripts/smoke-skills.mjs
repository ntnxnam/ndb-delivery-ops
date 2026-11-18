#!/usr/bin/env node
/**
 * Smoke: all skills load and pass contract checks
 * Run: node shared/scripts/smoke-skills.mjs
 */
import { existsSync, readFileSync, readdirSync, lstatSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const packRoot = join(repoRoot, 'agent-pack');
const manifest = JSON.parse(readFileSync(join(packRoot, 'manifest.json'), 'utf8'));

let failures = 0;
const fail = (msg) => { console.error(`FAIL: ${msg}`); failures++; };
const ok = (msg) => console.log(`OK: ${msg}`);

// 1. Manifest count
if (manifest.skills.length !== 15) fail(`manifest.skills.length=${manifest.skills.length} expected 15`);
else ok(`manifest: 15 skills (21 -6 from 4 merges)`);

// 2. Filesystem count
const fsSkills = readdirSync(join(packRoot, 'skills')).filter(f => {
  try { return lstatSync(join(packRoot, 'skills', f)).isDirectory(); } catch { return false; }
});
if (fsSkills.length !== 27) fail(`filesystem skills dirs=${fsSkills.length} expected 27`);
else ok(`filesystem: 27 skill dirs (25 + 2 new)`);

// 3. No dupes
const names = manifest.skills.map(s => s.name);
if (new Set(names).size !== names.length) fail('duplicate skill names');
else ok('no duplicate names');

// 4. Every manifest skill has file
for (const s of manifest.skills) {
  if (!existsSync(join(packRoot, s.path))) fail(`missing file: ${s.path}`);
}
ok('all manifest skills have SKILL.md');

// 5. Deprecated stubs not in manifest but exist
const deprecated = ['move-gate-date','update-release-date','fetch-project-tickets','issue-type-breakdown','bug-triage','stale-ticket-sweep','pending-response-chase','team-exec-status-answer','team-exec-release-report','release-ai-briefing'];
for (const dep of deprecated) {
  if (names.includes(dep)) fail(`deprecated ${dep} should NOT be in manifest`);
  if (!fsSkills.includes(dep)) fail(`deprecated ${dep} missing on filesystem`);
  const text = readFileSync(join(packRoot, 'skills', dep, 'SKILL.md'), 'utf8');
  if (!text.includes('DEPRECATED')) fail(`${dep} missing DEPRECATED marker`);
}
ok(`deprecated stubs: ${deprecated.length} correct`);

// 6. Merged skills have expected content
const gateOps = readFileSync(join(packRoot, 'skills/release-gate-ops/SKILL.md'), 'utf8');
for (const needle of ['Route J','Route C','customfield_11067','customfield_35863','releaseVersionsEmailConfig.json','inconsistent_state']) {
  if (!gateOps.includes(needle)) fail(`release-gate-ops missing: ${needle}`);
}
ok('release-gate-ops: Route J/C + 3 fields + slip');

const ticketInsights = readFileSync(join(packRoot, 'skills/ticket-insights/SKILL.md'), 'utf8');
for (const needle of ['8-clause','Project Hierarchy','Dev vs QA','0.33','FEAT ID','IN (...)']) {
  if (!ticketInsights.includes(needle)) fail(`ticket-insights missing: ${needle}`);
}
ok('ticket-insights: 8-clause + 6 groups + Dev/QA');

// 7. Frontmatter
for (const s of manifest.skills) {
  const text = readFileSync(join(packRoot, s.path), 'utf8');
  if (!text.startsWith('---')) fail(`${s.name}: missing frontmatter`);
  if (!text.includes(`name: ${s.name}`)) fail(`${s.name}: frontmatter name mismatch`);
  if (!text.includes('description:')) fail(`${s.name}: missing description`);
}
ok(`frontmatter: all ${manifest.skills.length} valid`);

// 8. Required sections for regular skills (reference stubs have domain-specific structure)
const exemptSections = new Set(['predictive-team-exec-analytics','sprint-gantt-chart','confluence-width-cleanup','release-dataset-sync']);
const builders = new Set(['multi-model-review','exec-perspective']);
for (const s of manifest.skills) {
  if (builders.has(s.name) || exemptSections.has(s.name)) continue;
  const text = readFileSync(join(packRoot, s.path), 'utf8');
  for (const sec of ['## When to Use This Skill','## Quick Start','## Core Rules','## Output Format','## Quality Validation']) {
    if (!text.includes(sec)) fail(`${s.name} missing section: ${sec}`);
  }
}
ok('required sections: 9 regular skills have all 5 (4 reference/domain-specific + 2 builders exempt)');

// 9. Builder skills have disable-model-invocation
for (const b of ['multi-model-review','exec-perspective']) {
  const text = readFileSync(join(packRoot, `skills/${b}/SKILL.md`), 'utf8');
  if (!text.includes('disable-model-invocation: true')) fail(`${b} missing disable-model-invocation`);
}
ok('builder: disable-model-invocation');

// 10. Only mutate is release-gate-ops
const mutate = manifest.skills.filter(s => s.toolClass === 'mutate').map(s=>s.name);
if (mutate.length !== 1 || mutate[0] !== 'release-gate-ops') fail(`mutate skills=${mutate.join(',')} expected only release-gate-ops`);
else ok('toolClass mutate: only release-gate-ops');

// 11. Symlinks
for (const adapter of ['.cursor/skills','.claude/skills','.codex/skills','.agents/skills']) {
  const p = join(repoRoot, adapter);
  if (!existsSync(p)) fail(`missing symlink: ${adapter}`);
  else if (!lstatSync(p).isSymbolicLink()) fail(`not a symlink: ${adapter}`);
}
ok('symlinks: 4 hosts');

// 12. RM/T PM ownership
const rmSkills = manifest.skills.filter(s=>s.owner==='rm-specialist').map(s=>s.name);
if (!rmSkills.includes('release-gate-ops')) fail('rm-specialist missing release-gate-ops');
if (!rmSkills.includes('release-dataset-sync')) fail('rm-specialist missing release-dataset-sync');
ok(`rm-specialist: ${rmSkills.join(', ')}`);

const tpmSkills = manifest.skills.filter(s=>s.owner==='tpm-specialist').map(s=>s.name);
if (!tpmSkills.includes('ticket-insights')) fail('tpm-specialist missing ticket-insights');
ok(`tpm-specialist: ${tpmSkills.join(', ')}`);

console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'}: ${manifest.skills.length} active + ${deprecated.length} deprecated + 2 unmanifested = ${manifest.skills.length + deprecated.length + 2} dirs — ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
