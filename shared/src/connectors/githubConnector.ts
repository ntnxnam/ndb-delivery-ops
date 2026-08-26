/**
 * githubConnector — thin facade over GitHub REST (commits).
 *
 * One module for every host (MCP today, Express later). Auth is optional
 * `GITHUB_TOKEN` as `Authorization: Bearer`. Unauthenticated calls work
 * for public repos and are rate-limited by GitHub.
 *
 * Add methods only when a real caller needs them (D3).
 */

import axios from 'axios';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Env } from './env.js';

export interface GithubCommit {
  author?: { login?: string };
  commit?: { author?: { name?: string } };
}

export interface ListCommitsParams {
  sinceIso: string;
  untilIso: string;
  page: number;
  perPage?: number;
}

export class GithubConnector {
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly httpsAgent: https.Agent;

  constructor(env: Pick<Env, 'githubToken' | 'httpsProxy' | 'jiraTimeoutMs'>) {
    this.token = env.githubToken || '';
    this.timeoutMs = env.jiraTimeoutMs || 20000;
    this.httpsAgent = env.httpsProxy
      ? (new HttpsProxyAgent(env.httpsProxy) as unknown as https.Agent)
      : new https.Agent({ keepAlive: true });
  }

  private headers(): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    return headers;
  }

  /**
   * One page of commits for `owner/name`. Does not throw on 404/403 —
   * callers inspect `status`.
   */
  async listCommits(
    repo: string,
    params: ListCommitsParams
  ): Promise<{ status: number; commits: GithubCommit[] }> {
    const perPage = params.perPage ?? 100;
    const res = await axios.get(`https://api.github.com/repos/${repo}/commits`, {
      headers: this.headers(),
      httpsAgent: this.httpsAgent,
      timeout: this.timeoutMs,
      params: {
        since: `${params.sinceIso}T00:00:00Z`,
        until: `${params.untilIso}T23:59:59Z`,
        per_page: perPage,
        page: params.page,
      },
      validateStatus: () => true,
    });
    return {
      status: res.status,
      commits: Array.isArray(res.data) ? (res.data as GithubCommit[]) : [],
    };
  }
}
