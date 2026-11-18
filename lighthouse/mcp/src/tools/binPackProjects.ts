/**
 * Tool: bin_pack_projects
 *
 * First-Fit-Decreasing bin-packing for NDB work items: given a list of
 * items with durations (sprints / weeks) and a fixed FTE capacity,
 * arrange them into the smallest number of parallel "lanes" without
 * exceeding capacity per lane.
 *
 * Replaces the standalone ~/ndb-projects-bin-packing/ HTML viz. That
 * project was purely client-side JS — the packing algorithm lives here
 * (so any MCP client can ask for a packed plan); the visualisation
 * stays in apps/delivery-ops/ where the existing Gantt UI can render
 * the result.
 *
 * This is a pure-compute tool — no JIRA call, no env, no side effects.
 * Same algorithm as the source repo's allocation.html, just in TypeScript.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const itemSchema = z.object({
  id: z.string().describe('Opaque identifier; echoed back in the output.'),
  name: z.string().describe('Display name.'),
  durationSprints: z.number().positive()
    .describe('Length of work in sprints (or any consistent time unit).'),
  fteRequired: z.number().positive()
    .describe('Headcount the item consumes for its whole duration.'),
  earliestStartSprint: z.number().int().min(0).optional().default(0)
    .describe('Sprint index this item can start; defaults to 0.'),
});

const inputSchema = {
  items: z.array(itemSchema).min(1)
    .describe('Work items to pack.'),
  capacityFte: z.number().positive()
    .describe('Total FTE available in any given sprint.'),
  horizonSprints: z.number().int().positive()
    .describe('How many sprints the plan covers; items that do not fit go to the overflow list.'),
};

type PackedItem = {
  id: string;
  name: string;
  startSprint: number;
  endSprint: number;
  laneIndex: number;
  fteRequired: number;
};

export function registerBinPackProjects(server: McpServer): void {
  server.registerTool(
    'bin_pack_projects',
    {
      title: 'Bin-pack NDB Projects',
      description: 'First-Fit-Decreasing schedule: pack work items into sprints under a fixed FTE capacity. Used for NDB 3.0-style capacity allocation planning. Use when the user says "pack these projects", "what fits in 6 sprints with 12 FTE", "bin packing".',
      inputSchema,
      annotations: {
        title: 'Bin-pack Projects',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ items, capacityFte, horizonSprints }) => {
      // FFD: sort largest-duration-first; break ties by largest FTE.
      const sorted = [...items].sort((a, b) =>
        (b.durationSprints - a.durationSprints) || (b.fteRequired - a.fteRequired)
      );

      // remainingCapacityPerSprint[sprintIdx] = how much FTE is still free.
      const remainingCapacity = new Array<number>(horizonSprints).fill(capacityFte);

      const packed: PackedItem[] = [];
      const overflow: { id: string; name: string; reason: string }[] = [];

      for (const item of sorted) {
        const startBound = item.earliestStartSprint ?? 0;
        let placed = false;
        for (let start = startBound; start + item.durationSprints <= horizonSprints; start += 1) {
          // Item fits if every sprint in its run has at least fteRequired free.
          let fits = true;
          for (let s = start; s < start + item.durationSprints; s += 1) {
            if (remainingCapacity[s]! < item.fteRequired) { fits = false; break; }
          }
          if (!fits) continue;
          // Place it.
          for (let s = start; s < start + item.durationSprints; s += 1) {
            remainingCapacity[s] = remainingCapacity[s]! - item.fteRequired;
          }
          // Lane = max occupied lane index in this run. We don't track lanes
          // explicitly; clients can lay them out vertically by id order.
          packed.push({
            id: item.id, name: item.name,
            startSprint: start, endSprint: start + item.durationSprints - 1,
            laneIndex: packed.length, // simple per-item lane for now
            fteRequired: item.fteRequired,
          });
          placed = true;
          break;
        }
        if (!placed) {
          overflow.push({
            id: item.id, name: item.name,
            reason: `No window for ${item.durationSprints} sprint(s) at ${item.fteRequired} FTE within horizon ${horizonSprints}.`,
          });
        }
      }

      const utilisationPerSprint = remainingCapacity.map((free, i) => ({
        sprint: i,
        usedFte: capacityFte - free,
        freeFte: free,
        utilisationPct: Math.round(((capacityFte - free) / capacityFte) * 100),
      }));

      const lines: string[] = [];
      lines.push(`# Bin-pack — ${packed.length}/${items.length} items placed`);
      lines.push(`Horizon: ${horizonSprints} sprints  •  Capacity: ${capacityFte} FTE`);
      lines.push('');
      lines.push('| Item | Start | End | FTE |');
      lines.push('|---|---:|---:|---:|');
      for (const p of packed) lines.push(`| ${p.name} | ${p.startSprint} | ${p.endSprint} | ${p.fteRequired} |`);
      if (overflow.length) {
        lines.push('');
        lines.push(`## Overflow (${overflow.length})`);
        for (const o of overflow) lines.push(`- **${o.name}** — ${o.reason}`);
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: {
          packed,
          overflow,
          utilisationPerSprint,
          capacityFte,
          horizonSprints,
        },
      };
    }
  );
}
