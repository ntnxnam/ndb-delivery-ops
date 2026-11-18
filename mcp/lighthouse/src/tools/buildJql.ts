/**
 * Tool: build_jql
 *
 * Constructs JQL strings from structured parameters using the shared
 * jqlBuilder. Product-agnostic — all team/version/field references come
 * from caller params or config, never hardcoded.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { jqlBuilder, loadEnv } from '@portfolio-delivery-ops/shared';

const JQL_TYPES = [
  'closed', 'touched', 'worklogged',
  'release-feature', 'release-initiative',
  'release-commit', 'release-commit-total',
  'kpi-closed', 'feature-summary',
  'feature-count', 'initiative-count',
] as const;

const inputSchema = {
  type: z.enum(JQL_TYPES).describe('JQL builder type.'),
  baseFilter: z.string().optional().describe('Base filter (e.g. "filter=NDB-All-Base-Filter"). Required for time-window types.'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Start date (ISO YYYY-MM-DD). Required for time-window types.'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date (ISO YYYY-MM-DD). Required for time-window types.'),
  mode: z.enum(['closed', 'touched', 'worklogged']).optional().default('closed').describe('Inclusion mode for time-window types.'),
  includeSubtasks: z.boolean().optional().default(false).describe('Include sub-tasks in results.'),
  releaseVersion: z.string().optional().describe('Release version name (e.g. "NDB-2.12"). Required for release types.'),
  kpiBaseQuery: z.string().optional().describe('KPI base query. Required for kpi-closed type.'),
  labelPrefix: z.string().optional().default('ndb').describe('Label prefix for POR filtering.'),
};

export function registerBuildJql(server: McpServer): void {
  server.registerTool(
    'build_jql',
    {
      title: 'Build JQL',
      description: 'Construct a JQL string from structured parameters using the canonical shared jqlBuilder. Use when you need a JQL query for reports, KPIs, Gantt, or sprint analytics. Supports time-window (closed/touched/worklogged), release (feature/initiative/commit), KPI-closed, and feature-summary builders. All output uses issuetype (never type=) and correct field IDs.',
      inputSchema,
      annotations: {
        title: 'Build JQL',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (params) => {
      try {
        const { type, baseFilter, startDate, endDate, mode, includeSubtasks, releaseVersion, kpiBaseQuery, labelPrefix } = params;

        let result: { name: string; jql: string; warnings: string[] };

        switch (type) {
          case 'closed':
          case 'touched':
          case 'worklogged': {
            if (!baseFilter || !startDate || !endDate) {
              return {
                content: [{ type: 'text', text: 'Error: baseFilter, startDate, and endDate are required for time-window types.' }],
                isError: true,
              };
            }
            result = jqlBuilder.buildTimeWindowJql(
              { baseFilter, startDate, endDate, includeSubtasks },
              mode || type as 'closed' | 'touched' | 'worklogged'
            );
            break;
          }
          case 'release-feature':
            if (!releaseVersion) {
              return { content: [{ type: 'text', text: 'Error: releaseVersion is required.' }], isError: true };
            }
            result = jqlBuilder.buildReleaseFeatureJql(releaseVersion);
            break;
          case 'release-initiative':
            if (!releaseVersion) {
              return { content: [{ type: 'text', text: 'Error: releaseVersion is required.' }], isError: true };
            }
            result = jqlBuilder.buildReleaseInitiativeJql(releaseVersion);
            break;
          case 'release-commit':
            if (!releaseVersion) {
              return { content: [{ type: 'text', text: 'Error: releaseVersion is required.' }], isError: true };
            }
            result = jqlBuilder.buildReleaseCommitJql(releaseVersion, labelPrefix);
            break;
          case 'release-commit-total':
            if (!releaseVersion) {
              return { content: [{ type: 'text', text: 'Error: releaseVersion is required.' }], isError: true };
            }
            result = jqlBuilder.buildReleaseCommitTotalJql(releaseVersion);
            break;
          case 'kpi-closed':
            if (!releaseVersion || !kpiBaseQuery) {
              return { content: [{ type: 'text', text: 'Error: releaseVersion and kpiBaseQuery are required.' }], isError: true };
            }
            result = jqlBuilder.buildKpiClosedJql(releaseVersion, kpiBaseQuery, labelPrefix);
            break;
          case 'feature-summary':
            if (!releaseVersion) {
              return { content: [{ type: 'text', text: 'Error: releaseVersion is required.' }], isError: true };
            }
            result = jqlBuilder.buildFeatureSummaryJql(releaseVersion);
            break;
          case 'feature-count':
            if (!releaseVersion) {
              return { content: [{ type: 'text', text: 'Error: releaseVersion is required.' }], isError: true };
            }
            result = jqlBuilder.buildFeatureCountJql(releaseVersion);
            break;
          case 'initiative-count':
            if (!releaseVersion) {
              return { content: [{ type: 'text', text: 'Error: releaseVersion is required.' }], isError: true };
            }
            result = jqlBuilder.buildInitiativeCountJql(releaseVersion);
            break;
          default:
            return { content: [{ type: 'text', text: `Error: unknown type "${type}".` }], isError: true };
        }

        const warnings = result.warnings.length > 0 ? `\n\nWarnings: ${result.warnings.join('; ')}` : '';
        return {
          content: [{ type: 'text', text: `${result.jql}${warnings}` }],
          structuredContent: { name: result.name, jql: result.jql, warnings: result.warnings },
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error building JQL: ${error instanceof Error ? error.message : String(error)}` }],
          isError: true,
        };
      }
    }
  );
}
