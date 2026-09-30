/**
 * outstandingService — "what's still open / what got pushed" tile counts.
 *
 * Sibling of `payloadJqlService`. Where the payload service answers
 * "what is the release made of right now?", this one answers "what
 * about that work is still unfinished, and what already left the
 * release?". Powers the Outstanding & Deferred panel on the Release
 * Brief.
 *
 * Five tiles, JQL semantics approved 2026-05-20:
 *
 *   1. open_in_release    — engineering payload AND resolution is EMPTY
 *   2. closed_in_release  — engineering payload AND resolution in done-family
 *   3. deferred_label     — labels = "<labelPrefix>-<release>-deferred"
 *                           NOT wrapped in payload (deferred items by
 *                           definition aren't in the current payload).
 *   4. pushed_out         — fixVersion was X AND fixVersion != X
 *                           NOT wrapped in payload (same reason).
 *   5. blocked_open       — engineering payload AND open AND
 *                           (is-blocked-by link OR labels = blocked)
 *
 * D1 inputs (projectKey, labelPrefix, release) all flow in via
 * productService at the call site; nothing here is NDB-specific.
 */

import type { JiraConnector } from '../connectors/jiraConnector.js';
import {
  buildEngineeringPayloadJql,
  getDeferredQuery,
} from './payloadJqlService.js';

/** Positive resolutions — ticket shipped. What is not positive is negative.
 * Source: .cursor/context/jira-workflows-and-resolutions.md §3
 */
const POSITIVE_RESOLUTIONS = '(Fixed, Done, Resolved, Complete, Approved)';

/** Canonical tile keys. Order matters — the UI renders in this order. */
export const OUTSTANDING_TILE_KEYS = [
  'open_in_release',
  'closed_in_release',
  'deferred_label',
  'pushed_out',
  'blocked_open',
] as const;

export type OutstandingTileKey = (typeof OUTSTANDING_TILE_KEYS)[number];

export interface OutstandingJqlOptions {
  /** Release fixVersion (e.g. `'NDB-2.11'`). */
  release: string;
  /**
   * JIRA project key the engineering team's work lives in (e.g. `'ERA'`).
   * Required for tiles 1, 2, 5 which wrap the engineering payload.
   */
  projectKey: string;
  /**
   * Label prefix used to derive the `<prefix>-<release>-deferred` label
   * for tile 3. From `productService.getLabelPrefix(productId)`.
   */
  labelPrefix: string;
}

/** Tile JQL strings keyed by canonical tile key. */
export function buildOutstandingJqls(
  options: OutstandingJqlOptions
): Record<OutstandingTileKey, string> {
  if (!options?.release) throw new Error('buildOutstandingJqls: release is required');
  if (!options?.projectKey) {
    throw new Error('buildOutstandingJqls: projectKey is required (D1: no hardcoded "ERA")');
  }
  if (!options?.labelPrefix) {
    throw new Error('buildOutstandingJqls: labelPrefix is required (D1)');
  }

  const { release, projectKey, labelPrefix } = options;

  // Tiles 1, 2, 5: wrap the engineering payload (D36) so counts agree
  // with the Engineering Payload denominator on the same page.
  const openInRelease = buildEngineeringPayloadJql(release, {
    projectKey,
    extras: ['resolution is EMPTY'],
  });

  const closedInRelease = buildEngineeringPayloadJql(release, {
    projectKey,
    extras: [`resolution in ${POSITIVE_RESOLUTIONS}`],
  });

  const blockedOpen = buildEngineeringPayloadJql(release, {
    projectKey,
    extras: [
      'resolution is EMPTY',
      // is-blocked-by link OR label-based fallback ("blocked" is a
      // widely-used hygiene label even when the link isn't filled in).
      'issueLinkType = "is blocked by" OR labels = blocked',
    ],
  });

  // Tile 3: label-anchored. Not in the current payload by construction
  // (deferred items have usually been pushed off the fixVersion).
  // Scoped to the engineering project only so we don't count deferred
  // tickets from unrelated teams that happened to use the same label.
  const deferredLabel =
    `project = ${projectKey} AND (${getDeferredQuery(release, { labelPrefix })})`;

  // Tile 4: `fixVersion was X AND fixVersion != X` finds anything that
  // ever carried this fixVersion but no longer does. Same project scope
  // as tile 3.
  const pushedOut =
    `project = ${projectKey} AND fixVersion was ${release} AND fixVersion != ${release}`;

  return {
    open_in_release: openInRelease,
    closed_in_release: closedInRelease,
    deferred_label: deferredLabel,
    pushed_out: pushedOut,
    blocked_open: blockedOpen,
  };
}

export interface OutstandingTileResult {
  key: OutstandingTileKey;
  /** Display label for the tile. */
  label: string;
  /** Short caption (UI subtitle) describing the JQL semantics. */
  caption: string;
  /** Issue count returned by JIRA, or null if the search failed. */
  count: number | null;
  /** Backing JQL (for click-through per jira-authenticity-links.mdc). */
  jql: string;
  /** Whether this tile is wrapped in the engineering payload. */
  wrapped: boolean;
  /** Search error message, if any. */
  error: string | null;
}

const TILE_META: Record<
  OutstandingTileKey,
  { label: string; caption: string; wrapped: boolean }
> = {
  open_in_release: {
    label: 'Open in release',
    caption: 'Engineering payload · resolution is EMPTY',
    wrapped: true,
  },
  closed_in_release: {
    label: 'Closed in release',
    caption: 'Engineering payload · resolution in done-family',
    wrapped: true,
  },
  deferred_label: {
    label: 'Deferred (label)',
    caption: 'Labels say deferred · not wrapped in current payload',
    wrapped: false,
  },
  pushed_out: {
    label: 'Pushed out',
    caption: 'Was on this fixVersion, no longer is',
    wrapped: false,
  },
  blocked_open: {
    label: 'Blocked / at risk',
    caption: 'Open · is-blocked-by link OR label = blocked',
    wrapped: true,
  },
};

/**
 * Run all five searchCount calls in parallel and return the assembled
 * tile results. Each tile fails independently (errors are returned as
 * `count: null, error: <msg>` rather than throwing) so one slow/broken
 * JQL doesn't dark out the whole panel.
 */
export async function computeOutstandingCounts(
  jira: JiraConnector,
  options: OutstandingJqlOptions
): Promise<OutstandingTileResult[]> {
  const jqls = buildOutstandingJqls(options);
  const results = await Promise.all(
    OUTSTANDING_TILE_KEYS.map(async (key) => {
      const meta = TILE_META[key];
      const jql = jqls[key];
      try {
        const count = await jira.searchCount(jql);
        return {
          key,
          label: meta.label,
          caption: meta.caption,
          count,
          jql,
          wrapped: meta.wrapped,
          error: null,
        } satisfies OutstandingTileResult;
      } catch (e: unknown) {
        return {
          key,
          label: meta.label,
          caption: meta.caption,
          count: null,
          jql,
          wrapped: meta.wrapped,
          error: e instanceof Error ? e.message : 'Search failed',
        } satisfies OutstandingTileResult;
      }
    })
  );
  return results;
}
