/**
 * Tool: team_overall_report
 *
 * Fetches and returns the Overall Team Report for a given team and date
 * window. Uses the shared jqlBuilder for JQL construction and JiraConnector
 * for live JIRA queries. Returns KPIs, grouped aggregation, and issue samples.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { JiraConnector, jqlBuilder, loadEnv } from '@portfolio-delivery-ops/shared';

const AUDIENCES = ['team-exec', 'em', 'engineer'] as const;

const inputSchema = {
  teamId: z.string().describe('Team identifier (e.g. "ndb", "prism-infra").'),
  baseFilter: z.string().describe('Team base filter JQL (e.g. "filter=NDB-All-Base-Filter and statusCategory!=Done").'),
  periodType: z.enum(['quarter', 'year', 'custom']).optional().default('quarter').describe('Period type.'),
  quarter: z.string().regex(/^\d{4}-Q[1-4]$/).optional().describe('Quarter in YYYY-QN format (e.g. "2025-Q2").'),
  year: z.string().regex(/^\d{4}$/).optional().describe('Year (e.g. "2025").'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Start date (ISO) for custom period.'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('End date (ISO) for custom period.'),
  inclusionMode: z.enum(['closed', 'touched', 'worklogged']).optional().default('closed').describe('Inclusion mode.'),
  groupBy: z.string().optional().default('issuetype').describe('Field to group by (issuetype, status, priority, assignee).'),
  includeSubtasks: z.boolean().optional().default(false).describe('Include sub-tasks.'),
  includeCompanions: z.boolean().optional().default(true).describe('Include companion project issues.'),
  companionProjectKeys: z.array(z.string()).optional().describe('Companion project keys (e.g. ["TECHPUBS", "SDL"]).'),
  maxIssues: z.number().int().min(1).max(2000).optional().default(500).describe('Max issues to fetch.'),
  audience: z.enum(AUDIENCES).optional().default('em').describe('Recipient persona.'),
};

function resolveDateRange(params: {
  periodType?: string;
  quarter?: string;
  year?: string;
  startDate?: string;
  endDate?: string;
}): { start: string; end: string } {
  const { periodType, quarter, year, startDate, endDate } = params;
  if (periodType === 'quarter' && quarter) {
    const [y, q] = String(quarter).split('-Q');
    const yy = parseInt(y, 10);
    const qq = parseInt(q, 10);
    const startMonth = (qq - 1) * 3;
    const start = new Date(Date.UTC(yy, startMonth, 1));
    const end = new Date(Date.UTC(yy, startMonth + 3, 0));
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (periodType === 'year' && year) {
    return { start: `${year}-01-01`, end: `${year}-12-31` };
  }
  if (periodType === 'custom' && startDate && endDate) {
    return { start: startDate, end: endDate };
  }
  throw new Error('Invalid period parameters');
}

export function registerTeamOverallReport(server: McpServer): void {
  server.registerTool(
    'team_overall_report',
    {
      title: 'Team Overall Report',
      description: 'Fetches the Overall Team Report for a given team and date window. Returns KPIs (total issues, story points, avg cycle time, throughput), grouped aggregation by work type, and issue samples. Use when the user asks for "team report", "overall team status", "team delivery summary", or "team metrics for period X".',
      inputSchema,
      annotations: {
        title: 'Team Overall Report',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async (params) => {
      const env = loadEnv({ requirePat: false });
      const jira = new JiraConnector(env);

      try {
        const {
          teamId, baseFilter, periodType, quarter, year, startDate, endDate,
          inclusionMode, groupBy, includeSubtasks, includeCompanions,
          companionProjectKeys, maxIssues, audience,
        } = params;

        const dateRange = resolveDateRange({ periodType, quarter, year, startDate, endDate });
        const mode = inclusionMode || 'closed';
        const reportBaseFilter = jqlBuilder.stripDoneFromBaseFilter(baseFilter);

        const jqlResult = jqlBuilder.buildTimeWindowJql(
          { baseFilter: reportBaseFilter, startDate: dateRange.start, endDate: dateRange.end, includeSubtasks },
          mode as 'closed' | 'touched' | 'worklogged'
        );
        const jql = jqlResult.jql;

        const FIELDS = 'key,summary,issuetype,status,priority,assignee,created,updated,resolved,storyPoints,fixVersions,components,labels,project';
        const issues = await jira.searchAll(jql, FIELDS, { maxIssues });

        // Companion fetch
        let companionIssues: any[] = [];
        if (includeCompanions && companionProjectKeys && companionProjectKeys.length > 0) {
          const projectClause = companionProjectKeys.length === 1
            ? `project = ${companionProjectKeys[0]}`
            : `project in (${companionProjectKeys.join(', ')})`;
          const subtaskClause = includeSubtasks ? '' : ' AND issuetype not in (Sub-task)';
          let companionJql = '';
          if (mode === 'closed') {
            companionJql = `${projectClause} AND statusCategory = Done AND resolved >= "${dateRange.start}" AND resolved <= "${dateRange.end}"${subtaskClause} ORDER BY resolved DESC`;
          } else if (mode === 'touched') {
            companionJql = `${projectClause} AND ((updated >= "${dateRange.start}" AND updated <= "${dateRange.end}") OR (statusCategory = Done AND resolved >= "${dateRange.start}" AND resolved <= "${dateRange.end}"))${subtaskClause} ORDER BY updated DESC`;
          } else {
            companionJql = `${projectClause} AND statusCategory = Done AND resolved >= "${dateRange.start}" AND resolved <= "${dateRange.end}"${subtaskClause} ORDER BY resolved DESC`;
          }
          companionIssues = await jira.searchAll(companionJql, FIELDS, { maxIssues });
          for (const issue of companionIssues) {
            const pk = (issue as any).fields?.project?.key;
            issue._sourceProject = pk || 'unknown';
          }
        }

        const allIssues = [...issues, ...companionIssues];
        for (const issue of issues) {
          if (!issue._sourceProject) {
            issue._sourceProject = (issue as any).fields?.project?.key || teamId;
          }
        }

        // Aggregate
        const groups: Record<string, { key: string; label: string; count: number; storyPoints: number }> = {};
        let totalStoryPoints = 0;
        const byStatus: Record<string, number> = {};
        for (const issue of allIssues) {
          const f = issue.fields || {};
          const key = f[groupBy] || f.issuetype?.name || 'Unknown';
          const groupKey = typeof key === 'object' ? (key.name || key.displayName || key.value || 'Unknown') : String(key);
          if (!groups[groupKey]) {
            groups[groupKey] = { key: groupKey, label: groupKey, count: 0, storyPoints: 0 };
          }
          groups[groupKey].count++;
          const sp = f.storyPoints || f.customfield_10016 || f.customfield_10026;
          if (sp != null) {
            const num = parseFloat(sp);
            if (!isNaN(num)) {
              groups[groupKey].storyPoints += num;
              totalStoryPoints += num;
            }
          }
          const status = f.status?.name;
          if (status) {
            byStatus[status] = (byStatus[status] || 0) + 1;
          }
        }

        const totalIssues = allIssues.length;
        const groupArray = Object.values(groups)
          .map(g => ({ ...g, percentage: totalIssues > 0 ? Math.round((g.count / totalIssues) * 100) : 0 }))
          .sort((a, b) => b.count - a.count);

        const issuesSample = allIssues.slice(0, 20).map((issue: any) => ({
          key: issue.key,
          summary: issue.fields?.summary || '',
          issuetype: issue.fields?.issuetype?.name || 'Unknown',
          status: issue.fields?.status?.name || 'Unknown',
          storyPoints: issue.fields?.storyPoints || issue.fields?.customfield_10016 || null,
          url: `https://jira.nutanix.com/browse/${issue.key}`,
          sourceProject: issue._sourceProject || null,
        }));

        const payload = {
          teamId,
          period: { type: periodType, start: dateRange.start, end: dateRange.end },
          inclusionMode: mode,
          groupBy,
          jqlExecuted: jql,
          totalIssues,
          totalStoryPoints,
          byStatus,
          groups: groupArray,
          totalGroups: groupArray.length,
          issuesSample,
          companionIssueCount: companionIssues.length,
          primaryIssueCount: issues.length,
        };

        // Audience-aware markdown
        let markdown: string;
        if (audience === 'team-exec') {
          markdown = `# Team Overall Report — ${teamId}\n\n**Period:** ${dateRange.start} to ${dateRange.end} (${mode})\n**Total Issues:** ${totalIssues} | **Story Points:** ${totalStoryPoints} | **Work Types:** ${groupArray.length}\n\n## Top Work Types\n${groupArray.slice(0, 5).map(g => `- ${g.label}: ${g.count} (${g.percentage}%)`).join('\n')}\n`;
        } else {
          markdown = `# Team Overall Report — ${teamId}\n\n**Period:** ${dateRange.start} to ${dateRange.end} (${mode})\n**Total Issues:** ${totalIssues} | **Story Points:** ${totalStoryPoints} | **Work Types:** ${groupArray.length}\n\n## All Work Types\n${groupArray.map(g => `- ${g.label}: ${g.count} (${g.percentage}%) — ${g.storyPoints} SP`).join('\n')}\n\n## Status Breakdown\n${Object.entries(byStatus).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n`;
        }

        return {
          content: [{ type: 'text', text: markdown }],
          structuredContent: payload,
        };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: 'text', text: `Error fetching team overall report: ${msg}` }],
          isError: true,
        };
      }
    }
  );
}
