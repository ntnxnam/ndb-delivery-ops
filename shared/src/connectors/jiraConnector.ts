/**
 * jiraConnector — thin facade over the JIRA REST API v2 + Agile API.
 *
 * Per D3 (5 connectors, one per external system) and `minimal-architecture.mdc`
 * (no axios in components/services/routes), every JIRA call in this monorepo
 * goes through this single connector. Behaviour mirrors the legacy
 * `apps/delivery-ops/server/services/jiraService.js` and the previous
 * `mcp-server/src/connectors/jiraConnector.ts` so behaviour stays identical
 * across the web app and MCP surface.
 *
 * Features:
 *   - Bearer-token auth via single jiraHeaders() helper
 *   - Optional HTTPS proxy support
 *   - Exponential-backoff retries on 429
 *   - Paginated /search walker with tunable page size + per-page delay
 *   - JIRA-error unwrapping into { statusCode, message, details }
 *   - Typed responses where it adds value
 */

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Env } from './env.js';
import type { Sprint, SprintState } from '../types/sprint.js';

export interface JiraIssue {
  key: string;
  id?: string;
  fields?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface JiraSearchResponse {
  total?: number;
  startAt?: number;
  maxResults?: number;
  issues?: JiraIssue[];
  [k: string]: unknown;
}

export interface JiraIssueLink {
  id: string;
  type: { name: string; inward: string; outward: string };
  inwardIssue?: { key: string; fields?: { status?: { name: string } } };
  outwardIssue?: { key: string; fields?: { status?: { name: string } } };
}

export type JiraErrorShape = Error & {
  statusCode: number;
  details?: unknown;
};

export interface SearchAllOptions {
  pageSize?: number;
  perPageDelayMs?: number;
  perPageTimeoutMs?: number;
  /** Hard cap; throws if exceeded. Default: 100k. */
  maxIssues?: number;
}

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

  // ── auth + transport ──────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.env.jiraPat}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  async get<T = unknown>(
    path: string,
    options: AxiosRequestConfig = {}
  ): Promise<AxiosResponse<T>> {
    return this.retry(() =>
      axios.get<T>(this.absolute(path), {
        headers: this.headers(),
        httpsAgent: this.httpsAgent,
        timeout: this.env.jiraTimeoutMs,
        ...options,
      })
    );
  }

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

  // ── high-level helpers ────────────────────────────────────────────────────

  /**
   * Single-issue fetch.
   *
   * Backwards compatible: `getIssue(key)` and `getIssue(key, ['field1', ...])`
   * both still work. New callers can pass an options object to also request
   * `expand` (e.g. `'changelog'`) — required for the Phase-3 targeted
   * Closed-Date enrichment in `releaseDatasetService` / `releaseDatasetSync`
   * (see CONSOLIDATION.md #1b).
   */
  async getIssue(
    key: string,
    fieldsOrOptions?: string[] | { fields?: string[]; expand?: string | string[] }
  ): Promise<JiraIssue> {
    let fields: string[] | undefined;
    let expand: string | string[] | undefined;
    if (Array.isArray(fieldsOrOptions)) {
      fields = fieldsOrOptions;
    } else if (fieldsOrOptions) {
      fields = fieldsOrOptions.fields;
      expand = fieldsOrOptions.expand;
    }
    const params: Record<string, string> = {};
    if (fields?.length) params.fields = fields.join(',');
    if (expand) {
      params.expand = Array.isArray(expand) ? expand.join(',') : expand;
    }
    const res = await this.get<JiraIssue>(
      `/rest/api/2/issue/${encodeURIComponent(key)}`,
      Object.keys(params).length ? { params } : undefined
    );
    return res.data;
  }

  /**
   * Bulk fetch by key (uses /search with `key in (...)`).
   */
  async bulkGetIssues(keys: string[], fields: string[] = []): Promise<JiraIssue[]> {
    if (!keys.length) return [];
    // JIRA caps `IN` lists; chunk at 250 to be safe.
    const out: JiraIssue[] = [];
    const chunkSize = 250;
    for (let i = 0; i < keys.length; i += chunkSize) {
      const chunk = keys.slice(i, i + chunkSize);
      const jql = `key in (${chunk.join(',')})`;
      const issues = await this.searchAll(jql, fields.join(','), { pageSize: chunkSize });
      out.push(...issues);
    }
    return out;
  }

  /**
   * Issue links of a given issue.
   */
  async getIssueLinks(key: string): Promise<JiraIssueLink[]> {
    const issue = await this.getIssue(key, ['issuelinks']);
    const links = (issue.fields?.issuelinks as JiraIssueLink[] | undefined) ?? [];
    return links;
  }

  /**
   * Paginated /search walker. Returns the full accumulated issue list.
   *
   * Tunables mirror the legacy makeJiraSearchFetcher in jiraService.js so
   * per-query tuning is portable.
   */
  async searchAll(
    jql: string,
    fields: string,
    options: SearchAllOptions = {}
  ): Promise<JiraIssue[]> {
    const {
      pageSize = 1000,
      perPageDelayMs = 200,
      perPageTimeoutMs = 6000,
      maxIssues = 100_000,
    } = options;

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
      if (all.length > maxIssues) {
        throw new Error(
          `jiraConnector.searchAll exceeded maxIssues=${maxIssues}. Refine the JQL.`
        );
      }
      if (hasMore && perPageDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, perPageDelayMs));
      }
    }
    return all;
  }

  /**
   * Search returning just the count (uses /search with maxResults=0).
   */
  async searchCount(jql: string): Promise<number> {
    const res = await this.get<JiraSearchResponse>('/rest/api/2/search', {
      params: { jql, maxResults: 0 },
    });
    return res.data.total ?? 0;
  }

  /**
   * Update an issue's fields (mutating — caller must require user approval
   * per the triage-specialist / rm-specialist contracts).
   */
  async updateIssue(key: string, fields: Record<string, unknown>): Promise<void> {
    await this.put(`/rest/api/2/issue/${encodeURIComponent(key)}`, { fields });
  }

  /**
   * Bulk update issues — naive serial implementation. For large batches,
   * use chunked parallelism with rate-limit awareness.
   */
  async bulkUpdate(
    updates: Array<{ key: string; fields: Record<string, unknown> }>,
    concurrency = 4
  ): Promise<Array<{ key: string; ok: boolean; error?: string }>> {
    const results: Array<{ key: string; ok: boolean; error?: string }> = [];
    const queue = [...updates];
    const workers = Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const next = queue.shift();
        if (!next) break;
        try {
          await this.updateIssue(next.key, next.fields);
          results.push({ key: next.key, ok: true });
        } catch (err) {
          const wrapped = JiraConnector.wrapError(err);
          results.push({ key: next.key, ok: false, error: wrapped.message });
        }
      }
    });
    await Promise.all(workers);
    return results;
  }

  /**
   * Add a comment to an issue (mutating).
   */
  async addComment(key: string, body: string): Promise<void> {
    await this.post(`/rest/api/2/issue/${encodeURIComponent(key)}/comment`, { body });
  }

  /**
   * Sprints for a board (Agile API).
   *
   * Per-process cache with a 10-minute TTL and request-coalescing so that
   * concurrent callers (e.g. `/velocity` + `/forecast` both rendering on
   * the Release Brief page) share a single round-trip rather than each
   * paginating the same hundreds of historical sprints separately.
   *
   * State defaults to `'active,closed'` — `future` sprints have no
   * completed work so they're irrelevant for velocity windows, and
   * including them on NDB-scale boards adds ~50 extra rows per page that
   * blow the request budget for no value. Callers needing future sprints
   * can pass an explicit `state` arg to bypass the default + cache.
   */
  async getSprintsForBoard(boardId: number, state?: SprintState): Promise<Sprint[]> {
    // Bypass cache + bypass default state when an explicit state is set,
    // so callers asking for a specific slice get exactly that.
    if (state) {
      return this.fetchSprintsForBoardPaginated(boardId, { state });
    }
    const key = String(boardId);
    const cached = JiraConnector.SPRINTS_CACHE.get(key);
    if (cached && Date.now() - cached.fetchedAt < JiraConnector.SPRINTS_CACHE_TTL_MS) {
      return cached.sprints;
    }
    let inflight = JiraConnector.SPRINTS_INFLIGHT.get(key);
    if (!inflight) {
      inflight = (async () => {
        try {
          // 'active,closed' (no 'future') — see JSDoc above for why.
          const sprints = await this.fetchSprintsForBoardPaginated(boardId, {
            state: 'active,closed' as unknown as SprintState,
          });
          JiraConnector.SPRINTS_CACHE.set(key, {
            sprints,
            fetchedAt: Date.now(),
          });
          return sprints;
        } finally {
          JiraConnector.SPRINTS_INFLIGHT.delete(key);
        }
      })();
      JiraConnector.SPRINTS_INFLIGHT.set(key, inflight);
    }
    return inflight;
  }

  private async fetchSprintsForBoardPaginated(
    boardId: number,
    options: { state?: SprintState }
  ): Promise<Sprint[]> {
    const params: Record<string, unknown> = { maxResults: 50 };
    if (options.state) params.state = options.state;
    const out: Sprint[] = [];
    let startAt = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await this.get<{ values?: Sprint[]; isLast?: boolean }>(
        `/rest/agile/1.0/board/${boardId}/sprint`,
        { params: { ...params, startAt } }
      );
      const values = res.data.values ?? [];
      out.push(...values);
      hasMore = !(res.data.isLast ?? true) && values.length > 0;
      startAt += values.length;
    }
    return out;
  }

  // Per-process caches — see getSprintsForBoard JSDoc for usage.
  private static readonly SPRINTS_CACHE_TTL_MS = 10 * 60 * 1000;
  private static readonly SPRINTS_CACHE: Map<
    string,
    { sprints: Sprint[]; fetchedAt: number }
  > = new Map();
  private static readonly SPRINTS_INFLIGHT: Map<string, Promise<Sprint[]>> = new Map();

  /**
   * Versions for a JIRA project (releases live here).
   */
  async getProjectVersions(projectKey: string): Promise<Array<{
    id: string;
    name: string;
    archived?: boolean;
    released?: boolean;
    startDate?: string;
    releaseDate?: string;
    description?: string;
  }>> {
    const res = await this.get<Array<{
      id: string;
      name: string;
      archived?: boolean;
      released?: boolean;
      startDate?: string;
      releaseDate?: string;
      description?: string;
    }>>(`/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`);
    return res.data;
  }

  // ── error handling ────────────────────────────────────────────────────────

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
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await call();
      } catch (err) {
        const ax = err as AxiosError;
        const status = ax?.response?.status;
        if (status === 429 && attempt < maxAttempts - 1) {
          const delay = Math.min(2 ** attempt * 5000, 60_000);
          // eslint-disable-next-line no-console
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
