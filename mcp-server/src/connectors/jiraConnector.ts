/**
 * jiraConnector — thin facade over the Nutanix JIRA REST API v2.
 *
 * Encapsulates the patterns we converged on in apps/delivery-ops/server
 * during the Phase 2b consolidation:
 *
 *   - Bearer-token auth via a single jiraHeaders() helper
 *   - Optional HTTPS proxy support (corporate VPN)
 *   - Exponential-backoff retries on 429
 *   - Paginated /search fetcher with tunable page size + per-page delay
 *   - JIRA-error unwrapping into { statusCode, message, details }
 *
 * Every MCP tool that talks to JIRA must go through this connector. No
 * tool should ever import axios directly.
 *
 * Mirrors apps/delivery-ops/server/services/jiraService.js so behaviour
 * stays identical across the web app and the MCP surface.
 */

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Env } from '../config/env.js';

export type JiraIssue = {
  key: string;
  id?: string;
  fields?: Record<string, unknown>;
  [k: string]: unknown;
};

export type JiraSearchResponse = {
  total?: number;
  issues?: JiraIssue[];
  [k: string]: unknown;
};

export type JiraErrorShape = Error & {
  statusCode: number;
  details?: unknown;
};

export class JiraConnector {
  private readonly env: Env;
  private readonly httpsAgent: https.Agent;

  constructor(env: Env) {
    this.env = env;
    this.httpsAgent = env.httpsProxy
      ? (new HttpsProxyAgent(env.httpsProxy) as unknown as https.Agent)
      : new https.Agent({
          rejectUnauthorized: process.env.NODE_ENV === 'production',
          keepAlive: true,
          maxSockets: 50,
        });
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.env.jiraPat}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /** GET wrapper with retry-on-429 + sane timeouts. */
  async get<T = unknown>(path: string, options: AxiosRequestConfig = {}): Promise<AxiosResponse<T>> {
    return this.retry(() =>
      axios.get<T>(this.absolute(path), {
        headers: this.headers(),
        httpsAgent: this.httpsAgent,
        timeout: this.env.jiraTimeoutMs,
        ...options,
      })
    );
  }

  /** POST wrapper. */
  async post<T = unknown>(
    path: string,
    body: unknown,
    options: AxiosRequestConfig = {}
  ): Promise<AxiosResponse<T>> {
    return this.retry(() =>
      axios.post<T>(this.absolute(path), body, {
        headers: this.headers(),
        httpsAgent: this.httpsAgent,
        timeout: this.env.jiraTimeoutMs,
        ...options,
      })
    );
  }

  /** PUT wrapper. */
  async put<T = unknown>(
    path: string,
    body: unknown,
    options: AxiosRequestConfig = {}
  ): Promise<AxiosResponse<T>> {
    return this.retry(() =>
      axios.put<T>(this.absolute(path), body, {
        headers: this.headers(),
        httpsAgent: this.httpsAgent,
        timeout: this.env.jiraTimeoutMs,
        ...options,
      })
    );
  }

  /**
   * Paginated /search walker. Returns the full accumulated issue list. Same
   * tunables as the Node-side makeJiraSearchFetcher in
   * apps/delivery-ops/server/services/jiraService.js so per-tool tuning is
   * portable across the two callers.
   */
  async searchAll(
    jql: string,
    fields: string,
    {
      pageSize = 1000,
      perPageDelayMs = 200,
      perPageTimeoutMs = 6000,
    }: { pageSize?: number; perPageDelayMs?: number; perPageTimeoutMs?: number } = {}
  ): Promise<JiraIssue[]> {
    const all: JiraIssue[] = [];
    let startAt = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await this.get<JiraSearchResponse>('/rest/api/2/search', {
        timeout: perPageTimeoutMs,
        params: { jql, fields, maxResults: pageSize, startAt },
      });
      const issues = res.data.issues ?? [];
      all.push(...issues);
      const total = res.data.total ?? all.length;
      startAt += issues.length;
      hasMore = all.length < total && issues.length === pageSize;
      if (hasMore && perPageDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, perPageDelayMs));
      }
    }
    return all;
  }

  /**
   * Normalise a raw axios/JIRA error into { statusCode, message, details }.
   * Mirrors wrapJiraError() in the web-app's jiraService.js.
   */
  static wrapError(error: unknown, fallbackMessage = 'JIRA request failed'): JiraErrorShape {
    const ax = error as AxiosError<{
      errorMessages?: string[];
      errors?: Record<string, string>;
    }>;
    const status = ax?.response?.status ?? 500;
    const data = ax?.response?.data;
    const jiraMsg =
      data?.errorMessages?.[0] ||
      (data?.errors && typeof data.errors === 'object'
        ? Object.values(data.errors).join(', ')
        : undefined) ||
      ax?.message ||
      fallbackMessage;
    const wrapped = new Error(jiraMsg) as JiraErrorShape;
    wrapped.statusCode = status;
    if (data) wrapped.details = data;
    return wrapped;
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private absolute(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.env.jiraBaseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private async retry<T>(call: () => Promise<T>, maxAttempts = 5): Promise<T> {
    let attempt = 0;
    // 429 = rate limited; exponential backoff with a 60s cap.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await call();
      } catch (err) {
        const ax = err as AxiosError;
        const status = ax?.response?.status;
        if (status === 429 && attempt < maxAttempts - 1) {
          const delay = Math.min(2 ** attempt * 5000, 60000);
          console.error(
            `[jiraConnector] Rate limited (429); retrying in ${delay / 1000}s (attempt ${
              attempt + 1
            }/${maxAttempts})`
          );
          await new Promise((resolve) => setTimeout(resolve, delay));
          attempt += 1;
          continue;
        }
        if (status === 429) {
          throw new Error('JIRA rate limit exceeded. Wait 60-90s and try again.');
        }
        throw err;
      }
    }
  }
}
