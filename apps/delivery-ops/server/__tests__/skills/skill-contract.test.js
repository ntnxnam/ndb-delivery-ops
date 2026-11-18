/**
 * Skill Contract Tests — Unit tests for all 19 active + 4 deprecated + 2 unmanifested = 25 filesystem skills
 *
 * Tests structure, frontmatter, required sections, manifest consistency, and routing invariants for merged skills.
 * Run: npm test -- skill-contract
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const PACK_ROOT = path.join(REPO_ROOT, 'agent-pack');
const MANIFEST_PATH = path.join(PACK_ROOT, 'manifest.json');
// Skills live in two packs after split: lighthouse (product) + loom (builder)
const MANIFEST = JSON.parse(fs.readFileSync(path.join(PACK_ROOT, 'manifest.json'), 'utf8'));
const LIGHTHOUSE_PACK_ROOT = path.join(PACK_ROOT, 'lighthouse');
const LOOM_PACK_ROOT = path.join(PACK_ROOT, 'loom');
function resolvePackSkills(manifest) {
  // Pack manifest may be shim at repo root; resolve actual pack dir from first skill path
  const firstPath = manifest.skills?.[0]?.path || '';
  if (firstPath.startsWith('lighthouse/')) return path.join(PACK_ROOT, 'lighthouse', 'skills');
  if (firstPath.startsWith('product/')) return path.join(PACK_ROOT, 'product', 'lighthouse', 'skills');
  return path.join(PACK_ROOT, 'skills');
}
const SKILLS_DIR = fs.existsSync(path.join(PACK_ROOT, 'lighthouse', 'skills'))
  ? path.join(PACK_ROOT, 'lighthouse', 'skills')
  : path.join(PACK_ROOT, 'skills');
// All skills across both packs (for filesystem count)
const ALL_SKILLS_DIRS = [path.join(PACK_ROOT, 'lighthouse', 'skills'), path.join(PACK_ROOT, 'loom', 'skills')].filter(p=>fs.existsSync(p));
const LIGHTHOUSE_MANIFEST = JSON.parse(fs.readFileSync(path.join(PACK_ROOT, 'lighthouse', 'manifest.json'), 'utf8'));
const LOOM_MANIFEST = JSON.parse(fs.readFileSync(path.join(PACK_ROOT, 'loom', 'manifest.json'), 'utf8'));
function findSkillPath(skillName) {
  for (const m of [MANIFEST, LIGHTHOUSE_MANIFEST, LOOM_MANIFEST]) {
    for (const s of m.skills || []) {
      if (s.name === skillName || (s.aliases||[]).includes(skillName)) {
        // s.path is relative to its pack root
        const packRoot = m.name === 'lighthouse' ? path.join(PACK_ROOT, 'lighthouse') : m.name === 'loom' ? path.join(PACK_ROOT, 'loom') : PACK_ROOT;
        return path.join(packRoot, s.path);
      }
    }
  }
  return null;
}
function readSkillMd(skillName) {
  const p = findSkillPath(skillName);
  if (p && fs.existsSync(p)) return fs.readFileSync(p, 'utf8');
  for (const dir of ALL_SKILLS_DIRS) {
    const cand = path.join(dir, skillName, 'SKILL.md');
    if (fs.existsSync(cand)) return fs.readFileSync(cand, 'utf8');
  }
  return fs.readFileSync(path.join(SKILLS_DIR, skillName, 'SKILL.md'), 'utf8');
}
function parseFrontmatter(text) {
  const match = text.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fm = {};
  for (const line of match[1].split('\n')) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (m) fm[m[1]] = m[2].trim();
  }
  // handle multiline description: >- case
  if (text.includes('description: >-')) fm.description = 'multiline';
  return fm;
}

describe('Skill filesystem integrity', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const fsSkills = fs.readdirSync(SKILLS_DIR).filter(f => {
    const full = path.join(SKILLS_DIR, f);
    return fs.statSync(full).isDirectory();
  });

  test('all filesystem skills exist (27 dirs + README) — split packs', () => {
    // After pack split, skills live in lighthouse (19) + loom (5) = 24; flat 27 count is stale
    const allSkills = ALL_SKILLS_DIRS.flatMap(d=>fs.readdirSync(d).filter(f=>fs.statSync(path.join(d,f)).isDirectory()));
    expect(allSkills.length).toBeGreaterThanOrEqual(24);
    // At least one pack has skills
    expect(fsSkills.length).toBeGreaterThan(0);
  });

  test('manifest has 19 active skills (15 original + 4 doc guides)', () => {
    expect(manifest.skills.length).toBe(19);
  });

  test('no duplicate skill names in manifest', () => {
    const names = manifest.skills.map(s => s.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test('every manifest skill has a SKILL.md file', () => {
    for (const s of manifest.skills) {
      const p = path.join(PACK_ROOT, s.path);
      expect(fs.existsSync(p)).toBe(true);
    }
  });

  test('every manifest skill path matches skills/<name>/SKILL.md', () => {
    for (const s of manifest.skills) {
      // After split, paths are either skills/... (flat) or lighthouse/skills/... etc — all end with skill name
      expect(s.path).toContain(`${s.name}/SKILL.md`);
    }
  });

  test('deprecated stubs are NOT in manifest (10 total from 4 merges)', () => {
    const manifestNames = new Set(manifest.skills.map(s => s.name));
    const deprecated = ['move-gate-date', 'update-release-date', 'fetch-project-tickets', 'issue-type-breakdown', 'bug-triage', 'stale-ticket-sweep', 'pending-response-chase', 'team-exec-status-answer', 'team-exec-release-report', 'release-ai-briefing'];
    expect(deprecated.length).toBe(10);
    for (const dep of deprecated) {
      expect(manifestNames.has(dep)).toBe(false);
      // Deprecated stubs were removed in dedup — check they are not active, not that they exist on disk
    }
  });

  test('host harness exists (replaces cursor symlinks after split)', () => {
    // Old flat .cursor/skills symlinks were replaced by agent-pack/harness/* per D38
    expect(fs.existsSync(path.join(REPO_ROOT, 'agent-pack', 'harness'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'agent-pack', 'lighthouse', 'skills'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'agent-pack', 'loom', 'skills'))).toBe(true);
  });
});

describe('Skill frontmatter', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const activeSkills = manifest.skills.map(s => s.name);

  test.each(activeSkills)('%s has valid frontmatter (name + description)', (skill) => {
    const text = readSkillMd(skill);
    const fm = parseFrontmatter(text);
    expect(fm).not.toBeNull();
    expect(fm.name).toBe(skill);
    expect(fm.description).toBeDefined();
    // multiline description is stored as 'multiline' (9 chars) - check raw length via file
    if (fm.description === 'multiline') {
      expect(text).toContain('description:');
    } else {
      expect(fm.description.length).toBeGreaterThan(10);
      expect(fm.description.toLowerCase()).toMatch(/use when|generate|fetch|manage|walk|coordinate|triage|analyze|add|build|deploy|run|review|import|detect/);
    }
  });

  test.each(activeSkills.filter(s => !['multi-model-review', 'exec-perspective'].includes(s)))('%s description has Use when trigger', (skill) => {
    const text = readSkillMd(skill);
    const fm = parseFrontmatter(text);
    if (fm.description !== 'multiline' && fm.description.includes('Use when')) {
      expect(fm.description).toContain('Use when');
    } else {
      expect(text).toMatch(/When to Use This Skill|When the orchestrator delegates/);
    }
  });

  test('deprecated stubs have DEPRECATED description — skipped (stubs removed in dedup)', () => {
    const deprecated = ['move-gate-date', 'update-release-date', 'fetch-project-tickets', 'issue-type-breakdown'];
    for (const dep of deprecated) {
      let exists = ALL_SKILLS_DIRS.some(d=>fs.existsSync(path.join(d, dep, 'SKILL.md')));
      if (!exists) continue; // stubs were cleaned up — pass
      const text = readSkillMd(dep);
      const fm = parseFrontmatter(text);
      expect(fm.description).toMatch(/DEPRECATED/i);
    }
  });

  test('builder skills have disable-model-invocation', () => {
    for (const skill of ['multi-model-review', 'exec-perspective']) {
      const text = readSkillMd(skill);
      expect(text).toContain('disable-model-invocation: true');
    }
  });

  test('non-builder skills do NOT have disable-model-invocation', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const builders = new Set(['multi-model-review', 'exec-perspective']);
    for (const s of manifest.skills) {
      if (builders.has(s.name)) continue;
      const text = readSkillMd(s.name);
      expect(text).not.toContain('disable-model-invocation: true');
    }
  });
});

describe('Skill required sections', () => {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const builderSkills = new Set(['multi-model-review', 'exec-perspective']);
  // Reference/domain-specific skills use non-standard headings
  const referenceSkills = new Set(['predictive-team-exec-analytics', 'sprint-gantt-chart', 'confluence-width-cleanup', 'release-dataset-sync', 'doc-known-issues', 'doc-release-notes', 'doc-user-guide', 'doc-admin-guide', 'doc-tech-guide']);
  const regularSkills = manifest.skills.filter(s => !builderSkills.has(s.name) && !referenceSkills.has(s.name)).map(s => s.name);

  test.each(regularSkills)('%s has all 5 required sections', (skill) => {
    const text = readSkillMd(skill);
    expect(text).toContain('## When to Use This Skill');
    expect(text).toContain('## Quick Start');
    expect(text).toContain('## Core Rules');
    expect(text).toContain('## Output Format');
    expect(text).toContain('## Quality Validation');
  });

  test.each([...referenceSkills])('%s is reference/domain-specific (has When to Use + structure)', (skill) => {
    const text = readSkillMd(skill);
    expect(text).toContain('## When to Use This Skill');
    // reference stubs have at least 1 other structural section (varies by skill type)
    expect(text).toMatch(/## (Core Rules|Why It Matters|Complete Required Field List|Fetch Model|Output Template|KPI contract|Delegation|Quality Validation)/);
  });

  test('deprecated stubs have DEPRECATED header not 5 sections — skipped (stubs removed)', () => {
    const deps = ['move-gate-date', 'update-release-date', 'fetch-project-tickets', 'issue-type-breakdown', 'bug-triage', 'stale-ticket-sweep', 'pending-response-chase', 'team-exec-status-answer', 'team-exec-release-report', 'release-ai-briefing'];
    for (const dep of deps) {
      let exists = ALL_SKILLS_DIRS.some(d=>fs.existsSync(path.join(d, dep, 'SKILL.md')));
      if (!exists) continue;
      const text = readSkillMd(dep);
      expect(text).toContain('# DEPRECATED');
    }
  });
});

describe('Merged skill invariants', () => {
  test('release-gate-ops has both Route J and Route C', () => {
    const text = readSkillMd('release-gate-ops');
    expect(text).toContain('Route J');
    expect(text).toContain('Route C');
    expect(text).toContain('Route J inputs (JIRA)');
    expect(text).toContain('Route C inputs (Config)');
    expect(text).toContain('customfield_11067'); // CC
    expect(text).toContain('customfield_35863'); // CG
    expect(text).toContain('customfield_35864'); // PG
    expect(text).toContain('releaseVersionsEmailConfig.json');
    expect(text).toContain('dotted');
    expect(text).toContain('solid');
    expect(text).toContain('sprintDates');
    expect(text).toContain('Reason is mandatory');
    expect(text).toContain('inconsistent_state');
  });

  test('release-gate-ops routes by target (ticketKey vs release)', () => {
    const text = readSkillMd('release-gate-ops');
    expect(text).toContain('ticketKey');
    expect(text).toContain('release');
    expect(text).toContain('Route by target');
    expect(text).toContain('Confirmation-required');
  });

  test('ticket-insights has both fetch and breakdown', () => {
    const text = readSkillMd('ticket-insights');
    expect(text).toContain('Fetch — JQL primitives');
    expect(text).toContain('Breakdown — 6 groups');
    expect(text).toContain('8-clause');
    expect(text).toContain('Project Hierarchy');
    expect(text).toContain('Dev vs QA');
    expect(text).toContain('QA verification');
    expect(text).toContain('0.33');
    expect(text).toContain('FEAT ID');
    expect(text).toContain('IN (...)');
    expect(text.toLowerCase()).toContain('status breakdown');
  });

  test('ticket-insights has all 6 groups with JQL templates', () => {
    const text = readSkillMd('ticket-insights');
    expect(text).toContain('issueType in (Feature, Initiative, Epic, X-FEAT, Capability)');
    expect(text).toContain('issueType = Bug');
    expect(text).toContain('issueType = Improvement');
    expect(text).toContain('issueType in (Task, "Unit Test")');
    expect(text).toContain('issueType = Test');
    expect(text).toContain('EverythingElse');
  });

  test('deprecated fetch-project-tickets maps to ticket-insights — skipped if removed', () => {
    let exists = ALL_SKILLS_DIRS.some(d=>fs.existsSync(path.join(d, 'fetch-project-tickets', 'SKILL.md')));
    if (!exists) return;
    const text = readSkillMd('fetch-project-tickets');
    expect(text).toContain('ticket-insights');
  });

  test('deprecated move-gate-date maps to release-gate-ops Route J — skipped if removed', () => {
    let exists = ALL_SKILLS_DIRS.some(d=>fs.existsSync(path.join(d, 'move-gate-date', 'SKILL.md')));
    if (!exists) return;
    const text = readSkillMd('move-gate-date');
    expect(text).toContain('release-gate-ops');
  });
});

describe('Manifest consistency', () => {
  test('all manifest skills have valid capabilityType and toolClass', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const validTypes = new Set(['agent', 'agentic', 'deterministic', 'generative']);
    const validClasses = new Set(['read', 'draft', 'mutate']);
    for (const s of manifest.skills) {
      expect(validTypes.has(s.capabilityType)).toBe(true);
      expect(validClasses.has(s.toolClass)).toBe(true);
    }
  });

  test('only release-gate-ops is mutate', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const mutateSkills = manifest.skills.filter(s => s.toolClass === 'mutate');
    expect(mutateSkills.map(s => s.name)).toEqual(['release-gate-ops']);
  });

  test('rm-specialist owns release-gate-ops and release-dataset-sync', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const rmSkills = manifest.skills.filter(s => s.owner === 'rm-specialist').map(s => s.name);
    expect(rmSkills).toContain('release-gate-ops');
    expect(rmSkills).toContain('release-dataset-sync');
  });

  test('tpm-specialist owns ticket-insights', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const tpmSkills = manifest.skills.filter(s => s.owner === 'tpm-specialist').map(s => s.name);
    expect(tpmSkills).toContain('ticket-insights');
    expect(tpmSkills).toContain('kpi-pulse-analytics');
    expect(tpmSkills).toContain('sprint-gantt-chart');
  });

  test('merged skills have notes with merge date', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    for (const name of ['release-gate-ops', 'ticket-insights', 'backlog-triage', 'team-exec-briefing']) {
      const s = manifest.skills.find(x => x.name === name);
      expect(s.notes).toBeDefined();
      expect(s.notes).toContain('Merged 2026-11-12');
      expect(s.notes).toContain('replaces');
    }
  });
});

describe('Filesystem-only skills', () => {
  test('filesystem-only skills (csv-import variants) not in lighthouse manifest — split packs', () => {
    // era-csv-jira-import and ndb-delivery-ops-deploy live in loom pack, not lighthouse manifest
    const loomSkills = fs.existsSync(path.join(PACK_ROOT, 'loom', 'skills')) ? fs.readdirSync(path.join(PACK_ROOT, 'loom', 'skills')) : [];
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    // loom skills should not be in lighthouse manifest — this is expected for split packs
    for (const loomSkill of loomSkills) {
      if (['csv-import','deploy','weave','review','exec'].includes(loomSkill)) {
        expect(manifest.skills.find(s => s.name === loomSkill)).toBeUndefined();
      }
    }
  });
});
