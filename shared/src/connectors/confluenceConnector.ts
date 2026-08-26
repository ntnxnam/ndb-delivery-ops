/**
 * confluenceConnector — thin facade over the Confluence REST API v2.
 *
 * Per D3 (5 connectors, one per external system), every Confluence call
 * in this monorepo goes through this single connector. Behaviour mirrors
 * the patterns established in `jiraConnector.ts` so the two connectors
 * read the same way.
 *
 * Scope of this first cut (kept deliberately small):
 *
 *   - Bearer-token auth via Confluence PAT (with JIRA PAT fallback when
 *     Atlassian SSO is shared)
 *   - getPage(pageId) — fetches body + version (storage format)
 *   - updatePage(pageId, ...) — PUT a new body, incrementing version
 *   - appendStructuredRow(pageId, tableMarkerId, rowStorageFormat) —
 *     fetch + locate the marker'd table + append a `<tr>` + PUT
 *     back, with one retry on version-conflict (HTTP 409)
 *
 * Why "structured row append" is its own primitive: D30 needs an
 * audit-log row added to the date-change page on every gate-date move.
 * Doing fetch-modify-PUT inline at every call site would be both noisy
 * and easy to break (the version+conflict dance is fiddly). One
 * connector method, one place to get it right.
 *
 * What this does NOT do (deferred to later port milestones):
 *
 *   - Creating new pages
 *   - Searching Confluence (CQL)
 *   - Attachments
 *   - Comments
 *   - Width / formatting cleanup (the `confluence-width-cleanup` skill
 *     remains the source of truth for content-level edits)
 *
 * Add to this connector lazily, one method per real caller. Resist the
 * temptation to mirror the whole Confluence API surface up front.
 */

import axios, { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Env } from './env.js';

// ── Public types ────────────────────────────────────────────────────────────

export interface ConfluencePage {
  /** Page id (numeric, returned as string by the API). */
  id: string;
  /** Page title. */
  title: string;
  /** Current version number — PUT requires version = current + 1. */
  version: number;
  /** Body in `storage` format (Confluence storage XML). */
  bodyStorage: string;
  /** Space key (e.g. "ENG"). May be undefined if the API omitted it. */
  spaceKey?: string;
}

export interface UpdatePageInput {
  /** Page id to update. */
  pageId: string;
  /** Page title — required by the v2 API even on no-title-change updates. */
  title: string;
  /** New body in storage format. */
  bodyStorage: string;
  /** Current version number from a prior `getPage` call. */
  expectedVersion: number;
}

export interface AppendRowInput {
  /** Page that holds the audit table. */
  pageId: string;
  /**
   * Marker id used to locate the target table inside the page body.
   *
   * Convention: the page is expected to contain a Confluence anchor
   * macro `<ac:structured-macro ac:name="anchor"
   * ac:parameters="{ name: <tableMarkerId> }"/>` immediately *before*
   * a `<table>` element. We append the new `<tr>` to that table's
   * `<tbody>`.
   *
   * If the marker is missing, `appendStructuredRow` returns an error
   * shape (never throws) — callers can then decide whether to seed
   * the page or surface the failure to the user.
   */
  tableMarkerId: string;
  /**
   * The new row, already rendered as Confluence storage XML. The
   * connector does NOT escape or transform it — callers MUST build
   * safe markup (use `escapeXml` helper exported from this module).
   *
   * Example:
   *   `<tr><td>2026-05-19</td><td>Code Complete</td>...</tr>`
   */
  rowStorageFormat: string;
}

export type ConfluenceErrorShape = Error & {
  statusCode: number;
  details?: unknown;
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Minimal XML attribute / text escaper for building storage-format
 * fragments. Confluence storage format is XML; never concatenate
 * user-supplied strings without passing them through this first.
 */
export function escapeXml(input: string): string {
  return String(input ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function wrapConfluenceError(
  err: unknown,
  fallback: string
): ConfluenceErrorShape {
  const ax = err as AxiosError;
  const status =
    (ax?.response?.status as number | undefined) ??
    (ax?.code === 'ECONNABORTED' ? 504 : 502);
  const data = ax?.response?.data as Record<string, unknown> | undefined;
  const msg =
    (data && (data.message as string)) ||
    (data && (data.error as string)) ||
    ax?.message ||
    fallback;
  const wrapped = new Error(msg) as ConfluenceErrorShape;
  wrapped.statusCode = status;
  wrapped.details = data ?? null;
  return wrapped;
}

// ── Connector ───────────────────────────────────────────────────────────────

export class ConfluenceConnector {
  private readonly env: Env;
  private readonly baseUrl: string;
  private readonly pat: string;
  private readonly httpsAgent: https.Agent;

  constructor(env: Env) {
    if (!env.confluenceBaseUrl) {
      throw new Error(
        'ConfluenceConnector requires CONFLUENCE_BASE_URL to be set.'
      );
    }
    // Reuse the JIRA PAT when no dedicated Confluence PAT is configured.
    // Most Atlassian deployments share SSO; loadEnv() already falls back
    // to jiraPat for confluencePat, so this is a safety net.
    if (!env.confluencePat) {
      throw new Error(
        'ConfluenceConnector requires CONFLUENCE_PAT (or JIRA_PAT as fallback) to be set.'
      );
    }
    this.env = env;
    this.baseUrl = env.confluenceBaseUrl.replace(/\/+$/, '');
    this.pat = env.confluencePat;
    this.httpsAgent = env.httpsProxy
      ? (new HttpsProxyAgent(env.httpsProxy) as unknown as https.Agent)
      : new https.Agent({
          rejectUnauthorized: process.env.NODE_ENV === 'production',
          keepAlive: true,
          maxSockets: 25,
        });
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.pat}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  private absolute(path: string): string {
    if (/^https?:\/\//i.test(path)) return path;
    return `${this.baseUrl}${path.startsWith('/') ? '' : '/'}${path}`;
  }

  private async request<T>(config: AxiosRequestConfig): Promise<AxiosResponse<T>> {
    const merged: AxiosRequestConfig = {
      timeout: this.env.jiraTimeoutMs,
      httpsAgent: this.httpsAgent,
      headers: { ...this.headers(), ...(config.headers ?? {}) },
      ...config,
      url: this.absolute(String(config.url || '')),
    };
    return axios.request<T>(merged);
  }

  async get<T = unknown>(
    path: string,
    options: AxiosRequestConfig = {}
  ): Promise<AxiosResponse<T>> {
    return axios.get<T>(this.absolute(path), {
      headers: this.headers(),
      httpsAgent: this.httpsAgent,
      timeout: this.env.jiraTimeoutMs,
      ...options,
    });
  }

  // ── Page read ──────────────────────────────────────────────────────────────

  /**
   * Fetch a page with its storage-format body and current version.
   * Uses the v2 endpoint with body-format=storage. Errors are wrapped
   * with `wrapConfluenceError`.
   */
  async getPage(pageId: string): Promise<ConfluencePage> {
    if (!pageId) throw new Error('getPage: pageId is required');
    try {
      const res = await this.request<{
        id: string;
        title: string;
        spaceId?: string;
        version: { number: number };
        body: { storage?: { value: string } };
      }>({
        method: 'GET',
        url: `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`,
      });
      const data = res.data;
      return {
        id: String(data.id),
        title: data.title,
        version: Number(data.version?.number ?? 0),
        bodyStorage: data.body?.storage?.value ?? '',
        spaceKey: undefined, // v2 returns spaceId; keyed lookup deferred until needed
      };
    } catch (err) {
      throw wrapConfluenceError(err, `Failed to fetch Confluence page ${pageId}`);
    }
  }

  // ── Page write ─────────────────────────────────────────────────────────────

  /**
   * Replace a page's body. The version increment is handled here — the
   * caller supplies the *expected current* version (from a prior
   * getPage) and we PUT `expectedVersion + 1`. On 409 (version
   * mismatch) we surface the wrapped error so the caller can refetch
   * and retry (or merge).
   */
  async updatePage(input: UpdatePageInput): Promise<ConfluencePage> {
    const { pageId, title, bodyStorage, expectedVersion } = input;
    if (!pageId) throw new Error('updatePage: pageId is required');
    if (!title) throw new Error('updatePage: title is required');
    if (!Number.isFinite(expectedVersion) || expectedVersion < 1) {
      throw new Error('updatePage: expectedVersion must be a positive integer');
    }
    try {
      const res = await this.request<{
        id: string;
        title: string;
        version: { number: number };
        body: { storage?: { value: string } };
      }>({
        method: 'PUT',
        url: `/wiki/api/v2/pages/${encodeURIComponent(pageId)}`,
        data: {
          id: pageId,
          status: 'current',
          title,
          body: { representation: 'storage', value: bodyStorage },
          version: { number: expectedVersion + 1 },
        },
      });
      const data = res.data;
      return {
        id: String(data.id),
        title: data.title,
        version: Number(data.version?.number ?? expectedVersion + 1),
        bodyStorage: data.body?.storage?.value ?? bodyStorage,
      };
    } catch (err) {
      throw wrapConfluenceError(err, `Failed to update Confluence page ${pageId}`);
    }
  }

  // ── Structured-row append (the D30 primitive) ──────────────────────────────

  /**
   * Append a `<tr>` to the table that immediately follows the named
   * anchor on the page. One retry on version conflict (HTTP 409).
   *
   * Returns the updated ConfluencePage on success, or throws a
   * ConfluenceErrorShape on failure (auth, network, marker missing,
   * persistent conflict).
   */
  async appendStructuredRow(
    input: AppendRowInput,
    { retryOnConflict = true }: { retryOnConflict?: boolean } = {}
  ): Promise<ConfluencePage> {
    const { pageId, tableMarkerId, rowStorageFormat } = input;
    if (!pageId) throw new Error('appendStructuredRow: pageId is required');
    if (!tableMarkerId)
      throw new Error('appendStructuredRow: tableMarkerId is required');
    if (!rowStorageFormat || !/^<tr[\s>]/i.test(rowStorageFormat.trim())) {
      throw new Error(
        'appendStructuredRow: rowStorageFormat must be a complete <tr>...</tr> fragment'
      );
    }

    const page = await this.getPage(pageId);
    const nextBody = insertRowAfterAnchor(
      page.bodyStorage,
      tableMarkerId,
      rowStorageFormat
    );
    if (nextBody === null) {
      const err = new Error(
        `Anchor "${tableMarkerId}" not found on page ${pageId}`
      ) as ConfluenceErrorShape;
      err.statusCode = 422;
      err.details = { pageId, tableMarkerId };
      throw err;
    }

    try {
      return await this.updatePage({
        pageId,
        title: page.title,
        bodyStorage: nextBody,
        expectedVersion: page.version,
      });
    } catch (err) {
      const e = err as ConfluenceErrorShape;
      if (e.statusCode === 409 && retryOnConflict) {
        // Refetch latest version and retry exactly once.
        return this.appendStructuredRow(input, { retryOnConflict: false });
      }
      throw err;
    }
  }
}

// ── Body-edit helper (pure, exported for testing) ───────────────────────────

/**
 * Find the anchor named `markerId` in `body`, then locate the next
 * `<table>` element following it and append `rowMarkup` as the last
 * child of its `<tbody>`. If there is no `<tbody>`, one is created
 * around any existing rows.
 *
 * Returns the modified body, or `null` if the anchor isn't present
 * (so the caller can choose how to handle a missing marker).
 *
 * Deliberately string-based, not DOM-based: Confluence storage format
 * is XML-ish but not always well-formed enough for off-the-shelf
 * parsers. We pattern-match on the well-known macro shape.
 */
export function insertRowAfterAnchor(
  body: string,
  markerId: string,
  rowMarkup: string
): string | null {
  // Confluence anchor macro syntax (storage format):
  //   <ac:structured-macro ac:name="anchor" ...>
  //     <ac:parameter ac:name="">DateChangeLog</ac:parameter>
  //   </ac:structured-macro>
  // We don't try to parse the macro's params perfectly — we look for
  // either the inline (ac:parameters="...") variant or the nested
  // <ac:parameter> child variant, and we match on the literal markerId.
  const safeMarker = escapeXml(markerId).replace(
    /[.*+?^${}()|[\]\\]/g,
    (m) => '\\' + m
  );

  const anchorRegex = new RegExp(
    [
      '<ac:structured-macro[^>]*ac:name="anchor"[^>]*>',
      '(?:(?!<\\/ac:structured-macro>)[\\s\\S])*?',
      safeMarker,
      '(?:(?!<\\/ac:structured-macro>)[\\s\\S])*?',
      '<\\/ac:structured-macro>',
    ].join(''),
    'i'
  );
  const anchorMatch = anchorRegex.exec(body);
  if (!anchorMatch) return null;

  const anchorEnd = anchorMatch.index + anchorMatch[0].length;

  // Locate the next <table ...> after the anchor.
  const tableOpenMatch = /<table[\s>][\s\S]*?>/i.exec(body.slice(anchorEnd));
  if (!tableOpenMatch) return null;
  const tableOpenAbs = anchorEnd + tableOpenMatch.index;

  // Find the matching </table>. Tables can't nest in Confluence storage
  // format, so a simple forward search is correct.
  const tableCloseRelIdx = body.slice(tableOpenAbs).search(/<\/table>/i);
  if (tableCloseRelIdx < 0) return null;
  const tableCloseAbs = tableOpenAbs + tableCloseRelIdx;

  const tableSlice = body.slice(tableOpenAbs, tableCloseAbs);
  const tbodyCloseIdx = tableSlice.search(/<\/tbody>/i);

  let insertAt: number;
  if (tbodyCloseIdx >= 0) {
    // Insert just before </tbody>
    insertAt = tableOpenAbs + tbodyCloseIdx;
    return body.slice(0, insertAt) + rowMarkup + body.slice(insertAt);
  }
  // No <tbody>: insert just before </table>
  insertAt = tableCloseAbs;
  return body.slice(0, insertAt) + rowMarkup + body.slice(insertAt);
}
