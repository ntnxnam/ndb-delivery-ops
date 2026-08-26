import type { AgentPack } from '../agentPack/types.js';
import type { AgentTool } from './types.js';

const SKILL_BODY_CAP = 12000;

export function createPackTools(pack: AgentPack): AgentTool[] {
  return [
    {
      name: 'list_skills',
      description: 'List portable skills in the agent pack (name, type, tool class, owner).',
      toolClass: 'read',
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      execute: () =>
        [...pack.skills.values()].map((s) => ({
          name: s.name,
          capabilityType: s.capabilityType,
          toolClass: s.toolClass,
          owner: s.owner,
          description: s.frontmatter.description || '',
        })),
    },
    {
      name: 'read_skill',
      description: 'Read one skill SOP by name from the agent pack.',
      toolClass: 'read',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string', description: 'Skill name from list_skills' } },
        required: ['name'],
        additionalProperties: false,
      },
      execute: ({ name }) => {
        const skill = pack.skills.get(String(name || ''));
        if (!skill) return { error: `unknown skill: ${name}` };
        return {
          name: skill.name,
          capabilityType: skill.capabilityType,
          toolClass: skill.toolClass,
          owner: skill.owner,
          body: skill.body.slice(0, SKILL_BODY_CAP),
        };
      },
    },
    {
      name: 'read_specialist',
      description: 'Read a specialist identity file from the agent pack.',
      toolClass: 'read',
      parameters: {
        type: 'object',
        properties: { name: { type: 'string' } },
        required: ['name'],
        additionalProperties: false,
      },
      execute: ({ name }) => {
        const specialist = pack.identity.specialists.find((s) => s.name === name);
        if (!specialist) return { error: `unknown specialist: ${name}` };
        return { name: specialist.name, body: specialist.body.slice(0, SKILL_BODY_CAP) };
      },
    },
  ];
}
