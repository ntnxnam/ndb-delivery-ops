/**
 * Tool: leadership_commit_report
 *
 * For a list of GitHub repositories and a date range, return per-author
 * commit + PR activity rolled up for a leadership check-in.
 *
 * Replaces ~/GitHub-Commits/ — a Node app that combined JIRA, Confluence
 * and GitHub APIs into a single "Leadership Report" dashboard. The JIRA
 * and Confluence aggregations belong with the other NDB-Ops tools (and
 * will be added as separate tools); this one ports the GitHub piece.
 *
 * Uses an unauthenticated GitHub API call by default (works for public
 * repos like nutanix-enterprise/* if the user has token access via
 * env GITHUB_TOKEN; falls back to unauthenticated which hits a 60/hr
 * rate limit).
 */

import { z } from 'zod';
import axios from 'axios';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const inputSchema = {
  repos: z.array(z.string()).min(1)
    .describe('GitHub repos in "owner/name" form, e.g. ["nutanix-enterprise/era-server"].'),
  sinceIsoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe('Start of the window (ISO YYYY-MM-DD), inclusive.'),
  untilIsoDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    .describe('End of the window (ISO YYYY-MM-DD), inclusive. Defaults to today.'),
  topAuthors: z.number().int().min(1).max(50).optional().default(10)
    .describe('Cap on the per-repo top-author table size.'),
};

type AuthorRollup = {
  login: string;
  name: string;
  commitCount: number;
};

export function registerLeadershipCommitReport(server: McpServer): void {
  server.registerTool(
    'leadership_commit_report',
    {
      title: 'Leadership Commit Report',
      description: 'Per-repo per-author GitHub commit counts for a date range. Used for monthly leadership check-ins. Use when the user asks "who committed what in repo X this month", "leadership report", "engineering activity".',
      inputSchema,
      annotations: {
        title: 'Leadership Commit Report',
        readOnlyHint: true,
        idempotentHint: true,
      },
    },
    async ({ repos, sinceIsoDate, untilIsoDate, topAuthors }) => {
      const githubToken = process.env.GITHUB_TOKEN || '';
      const until = untilIsoDate ?? new Date().toISOString().slice(0, 10);
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };
      if (githubToken) headers['Authorization'] = `Bearer ${githubToken}`;

      const perRepo: Record<string, { totalCommits: number; topAuthors: AuthorRollup[]; error?: string }> = {};

      for (const repo of repos) {
        try {
          // Paginate /repos/{owner}/{repo}/commits?since=&until=
          let page = 1;
          let perRepoTotal = 0;
          const byAuthor = new Map<string, AuthorRollup>();
          while (page <= 10) { // 10-page cap (= 1000 commits) per repo to bound runtime
            const url = `https://api.github.com/repos/${repo}/commits`;
            const res = await axios.get(url, {
              headers,
              params: { since: `${sinceIsoDate}T00:00:00Z`, until: `${until}T23:59:59Z`, per_page: 100, page },
              timeout: 20000,
              validateStatus: () => true,
            });
            if (res.status === 404) { perRepo[repo] = { totalCommits: 0, topAuthors: [], error: 'repo not found' }; break; }
            if (res.status === 403) { perRepo[repo] = { totalCommits: 0, topAuthors: [], error: 'rate limited or forbidden' }; break; }
            if (!Array.isArray(res.data)) { perRepo[repo] = { totalCommits: 0, topAuthors: [], error: `unexpected response shape (${res.status})` }; break; }
            if (res.data.length === 0) break;

            for (const commit of res.data as Array<{ author?: { login?: string }; commit?: { author?: { name?: string } } }>) {
              const login = commit.author?.login ?? '(unknown)';
              const name = commit.commit?.author?.name ?? login;
              const existing = byAuthor.get(login) ?? { login, name, commitCount: 0 };
              existing.commitCount += 1;
              byAuthor.set(login, existing);
              perRepoTotal += 1;
            }

            if (res.data.length < 100) break;
            page += 1;
          }

          if (!perRepo[repo]) {
            const sorted = [...byAuthor.values()].sort((a, b) => b.commitCount - a.commitCount).slice(0, topAuthors);
            perRepo[repo] = { totalCommits: perRepoTotal, topAuthors: sorted };
          }
        } catch (err) {
          perRepo[repo] = {
            totalCommits: 0, topAuthors: [],
            error: err instanceof Error ? err.message : String(err),
          };
        }
      }

      const lines: string[] = [];
      lines.push(`# Leadership Commit Report`);
      lines.push(`Window: ${sinceIsoDate} → ${until}`);
      lines.push('');
      for (const [repo, data] of Object.entries(perRepo)) {
        lines.push(`## ${repo}`);
        if (data.error) { lines.push(`_Error: ${data.error}_`); lines.push(''); continue; }
        lines.push(`**Total commits**: ${data.totalCommits}`);
        if (data.topAuthors.length) {
          lines.push('');
          lines.push('| Author | Commits |');
          lines.push('|---|---:|');
          for (const a of data.topAuthors) lines.push(`| ${a.name} (${a.login}) | ${a.commitCount} |`);
        }
        lines.push('');
      }
      if (!githubToken) {
        lines.push('_Note: no GITHUB_TOKEN set; unauthenticated requests are rate-limited to 60/hr per IP._');
      }

      return {
        content: [{ type: 'text', text: lines.join('\n') }],
        structuredContent: { sinceIsoDate, untilIsoDate: until, perRepo },
      };
    }
  );
}
