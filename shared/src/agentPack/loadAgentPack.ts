import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentPack,
  AgentPackManifest,
  LoadedContextDoc,
  LoadedIdentity,
  LoadedPrompt,
  LoadedRule,
  LoadedSkill,
  LoadedWorkflow,
  MarkdownDocument,
} from './types.js';

const PACK_DIRNAME = 'agent-pack';
const MANIFEST_NAME = 'manifest.json';

function parseFrontmatter(raw: string): { frontmatter: Record<string, string>; body: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, body: raw };
  }
  const frontmatter: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    if (key) frontmatter[key] = value;
  }
  return { frontmatter, body: match[2] };
}

function readMarkdown(root: string, relativePath: string): MarkdownDocument {
  const path = join(root, relativePath);
  const raw = readFileSync(path, 'utf8');
  const { frontmatter, body } = parseFrontmatter(raw);
  return { path, body, frontmatter };
}

function findPackRootFrom(startDir: string): string | null {
  let current = resolve(startDir);
  for (let i = 0; i < 8; i += 1) {
    const candidate = join(current, PACK_DIRNAME, MANIFEST_NAME);
    if (existsSync(candidate)) {
      return join(current, PACK_DIRNAME);
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return null;
}

/**
 * Resolve the portable pack. Order:
 * 1. explicit argument
 * 2. AGENT_PACK_ROOT
 * 3. walk from cwd
 * 4. walk from this module (monorepo checkout)
 */
export function resolveAgentPackRoot(explicitRoot?: string): string {
  if (explicitRoot) {
    const root = isAbsolute(explicitRoot) ? explicitRoot : resolve(explicitRoot);
    if (!existsSync(join(root, MANIFEST_NAME))) {
      throw new Error(`Agent pack manifest not found at ${join(root, MANIFEST_NAME)}`);
    }
    return root;
  }

  const fromEnv = process.env.AGENT_PACK_ROOT?.trim();
  if (fromEnv) {
    return resolveAgentPackRoot(fromEnv);
  }

  const fromCwd = findPackRootFrom(process.cwd());
  if (fromCwd) return fromCwd;

  const fromModule = findPackRootFrom(dirname(fileURLToPath(import.meta.url)));
  if (fromModule) return fromModule;

  throw new Error(
    'Agent pack not found. Set AGENT_PACK_ROOT or run from the repo that contains agent-pack/.'
  );
}

export function loadAgentPack(explicitRoot?: string): AgentPack {
  const root = resolveAgentPackRoot(explicitRoot);
  const manifest = JSON.parse(
    readFileSync(join(root, MANIFEST_NAME), 'utf8')
  ) as AgentPackManifest;

  const identities = manifest.identities.map((entry) => {
    const doc = readMarkdown(root, entry.path);
    const loaded: LoadedIdentity = {
      ...doc,
      name: entry.name,
      role: entry.role,
    };
    return loaded;
  });

  const orchestrator = identities.find((id) => id.name === manifest.orchestrator);
  if (!orchestrator) {
    throw new Error(`Orchestrator "${manifest.orchestrator}" missing from pack identities`);
  }

  const skills = new Map<string, LoadedSkill>();
  for (const entry of manifest.skills) {
    const doc = readMarkdown(root, entry.path);
    skills.set(entry.name, {
      ...doc,
      name: entry.name,
      capabilityType: entry.capabilityType,
      toolClass: entry.toolClass,
      owner: entry.owner,
    });
  }

  const workflows = new Map<string, LoadedWorkflow>();
  for (const entry of manifest.workflows) {
    const doc = readMarkdown(root, entry.path);
    workflows.set(entry.name, {
      ...doc,
      name: entry.name,
      capabilityType: entry.capabilityType,
      toolClass: entry.toolClass,
    });
  }

  const constitutionalRules: LoadedRule[] = manifest.constitutionalRules.map((relativePath) => {
    const doc = readMarkdown(root, relativePath);
    const name = relativePath.split('/').pop()?.replace(/\.mdc$/, '') || relativePath;
    return { ...doc, name };
  });

  const memorySchema = JSON.parse(
    readFileSync(join(root, manifest.memorySchema), 'utf8')
  );

  const context = new Map<string, LoadedContextDoc>();
  for (const entry of manifest.context || []) {
    const doc = readMarkdown(root, entry.path);
    context.set(entry.name, {
      ...doc,
      name: entry.name,
      kind: entry.kind,
    });
  }

  const prompts = new Map<string, LoadedPrompt>();
  for (const entry of manifest.prompts || []) {
    const doc = readMarkdown(root, entry.path);
    prompts.set(entry.name, {
      ...doc,
      name: entry.name,
      status: entry.status,
      area: entry.area,
    });
  }

  return {
    root,
    manifest,
    identity: {
      orchestrator,
      specialists: identities.filter((id) => id.role === 'specialist'),
    },
    skills,
    workflows,
    constitutionalRules,
    context,
    prompts,
    memorySchema,
  };
}

/** Extract the fenced System Prompt body from a pack prompt markdown file. */
export function extractSystemPromptBody(prompt: LoadedPrompt): string | null {
  const match = prompt.body.match(/## System Prompt\s*```\r?\n([\s\S]*?)```/);
  return match ? match[1].trimEnd() : null;
}

export function listSkillsByType(pack: AgentPack, type: LoadedSkill['capabilityType']): LoadedSkill[] {
  return [...pack.skills.values()].filter((skill) => skill.capabilityType === type);
}

export function listSkillsByToolClass(pack: AgentPack, toolClass: LoadedSkill['toolClass']): LoadedSkill[] {
  return [...pack.skills.values()].filter((skill) => skill.toolClass === toolClass);
}
