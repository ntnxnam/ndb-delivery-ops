#!/usr/bin/env node
/**
 * Mocked agentRuntime loop: native tool_calls, JSON protocol, mutate refuse.
 * Does not call a live LLM.
 */
import { loadAgentPack, runAgentTurn } from '../dist/index.js';

function scriptedComplete(script) {
  let i = 0;
  return async (messages) => {
    const step = script[Math.min(i, script.length - 1)];
    i += 1;
    if (typeof step === 'function') {
      return step(messages);
    }
    return step;
  };
}

function assert(cond, msg) {
  if (!cond) {
    console.error(`smoke-agent-runtime failed: ${msg}`);
    process.exit(1);
  }
}

const pack = loadAgentPack();
const firstSkill = [...pack.skills.keys()][0];
assert(firstSkill, 'pack has at least one skill');

const native = await runAgentTurn(
  {
    message: 'List available skills.',
    session: { productId: 'ndb', audience: 'tpm' },
    perceive: { health: { verdict: 'GREEN' } },
    validTicketKeys: ['ERA-1'],
    completeChat: scriptedComplete([
      {
        content: '',
        toolCalls: [{ id: 'c1', name: 'list_skills', arguments: '{}' }],
        finishReason: 'tool_calls',
      },
      {
        content: '18 skills are registered. [source: list_skills]',
        toolCalls: [],
        finishReason: 'stop',
      },
    ]),
  },
  pack
);
assert(native.runtime === 'agent', 'runtime is agent');
assert(native.trace.some((t) => t.tool === 'list_skills' && t.ok), 'list_skills ran');
assert(native.reply.includes('skills'), 'final reply present');

const protocol = await runAgentTurn(
  {
    message: `Read the ${firstSkill} skill.`,
    session: { productId: 'ndb' },
    completeChat: scriptedComplete([
      {
        content: JSON.stringify({ tool: 'read_skill', arguments: { name: firstSkill } }),
        toolCalls: [],
        finishReason: 'stop',
      },
      {
        content: `Loaded ${firstSkill}.`,
        toolCalls: [],
        finishReason: 'stop',
      },
    ]),
  },
  pack
);
assert(
  protocol.trace.some((t) => t.tool === 'read_skill' && t.ok),
  'JSON protocol invoked read_skill'
);

let mutateExecuted = false;
const refused = await runAgentTurn(
  {
    message: 'Write this to JIRA.',
    session: { productId: 'ndb' },
    tools: [
      {
        name: 'fake_write',
        description: 'Must be refused in Wave 1',
        toolClass: 'mutate',
        parameters: { type: 'object', properties: {} },
        execute: async () => {
          mutateExecuted = true;
          return { wrote: true };
        },
      },
    ],
    completeChat: scriptedComplete([
      {
        content: '',
        toolCalls: [{ id: 'w1', name: 'fake_write', arguments: '{}' }],
        finishReason: 'tool_calls',
      },
      (messages) => {
        const lastTool = [...messages].reverse().find((m) => m.role === 'tool');
        const parsed = JSON.parse(lastTool.content);
        if (!String(parsed.error || '').includes('refused')) {
          throw new Error(`expected refuse payload, got ${lastTool.content}`);
        }
        return { content: 'Write refused; session is read-only.', toolCalls: [], finishReason: 'stop' };
      },
    ]),
  },
  pack
);
assert(!mutateExecuted, 'mutate execute() must not run');
assert(
  refused.trace.some((t) => t.tool === 'fake_write' && t.ok === false && t.detail === 'refused_non_read'),
  'mutate tool refused'
);

console.log('agent-runtime ok: native tools, JSON protocol, mutate refused');
