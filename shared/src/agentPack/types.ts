export type CapabilityType =
  | 'deterministic'
  | 'generative'
  | 'agent'
  | 'agentic';

export type ToolClass = 'read' | 'draft' | 'mutate';

export type IdentityRole = 'orchestrator' | 'specialist';

export interface ManifestContextDoc {
  name: string;
  path: string;
  kind: 'domain' | 'page' | 'index';
}

export interface ManifestPrompt {
  name: string;
  path: string;
  status: 'production' | 'draft';
  area: string;
}

export interface AgentPackManifest {
  name: string;
  version: string;
  decision: string;
  description: string;
  orchestrator: string;
  identity: {
    orchestrator: string;
    specialistsDir: string;
  };
  constitutionalRules: string[];
  memorySchema: string;
  identities: ManifestIdentity[];
  skills: ManifestSkill[];
  workflows: ManifestWorkflow[];
  /** Portable domain/page briefs — host-agnostic. */
  context?: ManifestContextDoc[];
  /** Canonical LLM system prompts (production + draft). */
  prompts?: ManifestPrompt[];
}

export interface ManifestIdentity {
  name: string;
  role: IdentityRole;
  path: string;
}

export interface ManifestSkill {
  name: string;
  capabilityType: CapabilityType;
  toolClass: ToolClass;
  owner: string;
  path: string;
}

export interface ManifestWorkflow {
  name: string;
  capabilityType: CapabilityType;
  toolClass: ToolClass;
  path: string;
}

export interface MarkdownDocument {
  path: string;
  body: string;
  frontmatter: Record<string, string>;
}

export interface LoadedIdentity extends MarkdownDocument {
  name: string;
  role: IdentityRole;
}

export interface LoadedSkill extends MarkdownDocument {
  name: string;
  capabilityType: CapabilityType;
  toolClass: ToolClass;
  owner: string;
}

export interface LoadedWorkflow extends MarkdownDocument {
  name: string;
  capabilityType: CapabilityType;
  toolClass: ToolClass;
}

export interface LoadedRule extends MarkdownDocument {
  name: string;
}

export interface LoadedContextDoc extends MarkdownDocument {
  name: string;
  kind: 'domain' | 'page' | 'index';
}

export interface LoadedPrompt extends MarkdownDocument {
  name: string;
  status: 'production' | 'draft';
  area: string;
}

export interface AgentPack {
  root: string;
  manifest: AgentPackManifest;
  identity: {
    orchestrator: LoadedIdentity;
    specialists: LoadedIdentity[];
  };
  skills: Map<string, LoadedSkill>;
  workflows: Map<string, LoadedWorkflow>;
  constitutionalRules: LoadedRule[];
  /** Domain + page context docs (empty Map if manifest omits context). */
  context: Map<string, LoadedContextDoc>;
  /** Prompt docs keyed by name (empty Map if manifest omits prompts). */
  prompts: Map<string, LoadedPrompt>;
  memorySchema: unknown;
}
