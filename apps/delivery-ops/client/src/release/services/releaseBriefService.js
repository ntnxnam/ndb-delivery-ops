/*
 * releaseBriefService — HTTP layer for the Release Brief page.
 *
 * Per minimal-architecture.mdc:
 *   - components render
 *   - hooks fetch (compose state)
 *   - services transform (HTTP + shape)
 *
 * No React in this file. Only HTTP + shape normalisation.
 */

import {
  authenticatedGet,
  authenticatedPost,
  getApiBase,
} from '../../utils/api';

const API_BASE = getApiBase();

/**
 * List open release versions for a team.
 * Server endpoint exists already and is the same one Release Versions tab uses.
 *
 * @returns {Promise<{versions: Array<{name: string, released: boolean, releaseDate?: string}>}>}
 */
export async function listReleaseVersions({ teamId, jiraToken, username }) {
  if (!teamId) return { versions: [] };
  const res = await authenticatedPost(
    `${API_BASE}/api/jira/release-versions`,
    { teamId },
    { jiraToken, username }
  );
  const data = res?.data || {};
  const raw = Array.isArray(data.versions) ? data.versions : [];
  // Normalise — server can return either string names or objects.
  const versions = raw.map((v) =>
    typeof v === 'string'
      ? { name: v, released: false }
      : {
          name: v.name,
          released: !!v.released,
          releaseDate: v.releaseDate || v.release_date || undefined,
          startDate: v.startDate || v.start_date || undefined,
        }
  );
  return { versions };
}

/**
 * Fetch the configured KPIs for a team (definitions only; no counts).
 *
 * @returns {Promise<{kpis: Array<{id: string, name: string, baseQuery: string, displayType: 'count'|'list'}>}>}
 */
export async function listTeamKpis({ teamId, jiraToken, username }) {
  if (!teamId) return { kpis: [] };
  const res = await authenticatedGet(
    `${API_BASE}/api/config/kpi`,
    { teamId },
    { jiraToken, username }
  );
  const data = res?.data || {};
  const kpis = Array.isArray(data.kpis) ? data.kpis : [];
  return { kpis };
}

/**
 * Run all team KPIs scoped to a release version. Counts only (display=count)
 * because the Release Brief just wants the headline number per KPI.
 *
 * @returns {Promise<{results: Record<string, {total?: number, combinedJql?: string, error?: string}>}>}
 */
export async function fetchReleaseKpiBatch({
  teamId,
  releaseVersion,
  jiraToken,
  username,
}) {
  if (!teamId || !releaseVersion) return { results: {} };
  const res = await authenticatedPost(
    `${API_BASE}/api/jira/release-kpi-results-batch`,
    { teamId, releaseVersion },
    { jiraToken, username }
  );
  const data = res?.data || {};
  return { results: data.results || {} };
}

/**
 * Fetch the Engineering Payload synopsis for a release.
 *
 * Server endpoint composes the 5 D36 bucket counts + the deferred sidecar
 * + a deduped Engineering Payload union, returning shape:
 *
 *   {
 *     productId, release, projectKey, labelPrefix,
 *     total:      { key, label, jql, count, error },
 *     components: [{ key, label, jql, count, error }, ...×5],
 *     sidecars:   [{ key, label, jql, count, error }, ...×1],
 *     rawComponentSum: number
 *   }
 *
 * @param {{productId?: string, release: string, jiraToken: string, username: string}} args
 */
export async function fetchReleasePayloadSynopsis({
  productId = 'ndb',
  release,
  jiraToken,
  username,
}) {
  if (!release) return { synopsis: null };
  const res = await authenticatedGet(
    `${API_BASE}/api/release-dataset/synopsis`,
    { productId, release },
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const err = body?.error || 'Synopsis failed';
    const e = new Error(err);
    e.response = { data: body };
    throw e;
  }
  return { synopsis: body.data };
}

/**
 * Fetch 3-stream sprint velocity (Dev / QA-Verification / QA-Test-Tasks)
 * for the most recent N sprints, scoped to a product + optional release.
 *
 * Per `sprint-velocity-types.mdc`. Backed by `shared/velocityService` via
 * `/api/release-dataset/velocity` (Path B — uses `shared/JiraConnector`).
 *
 * @param {{productId?: string, release?: string, sprintsBack?: number, jiraToken: string, username: string}} args
 */
export async function fetchSprintVelocity({
  productId = 'ndb',
  release,
  sprintsBack = 3,
  jiraToken,
  username,
}) {
  const res = await authenticatedGet(
    `${API_BASE}/api/release-dataset/velocity`,
    { productId, release: release || '', sprintsBack },
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const err = body?.error || 'Velocity failed';
    const e = new Error(err);
    e.response = { data: body };
    throw e;
  }
  return { velocity: body.data };
}

/**
 * Fetch the landing-date forecast for a release (MVP — first Streamlit
 * fusion of `landing_forecast.py`). Returns a predicted GA date, gap to
 * plan, verdict + confidence + one-line explanation. See
 * STREAMLIT_PARITY.md for what's intentionally MVP.
 *
 * `plannedGaIso` is optional; without it the response sets verdict to
 * 'unknown' (correct — not 'on_time' by default).
 *
 * @param {{productId?: string, release: string, plannedGaIso?: string, jiraToken: string, username: string}} args
 */
export async function fetchLandingForecast({
  productId = 'ndb',
  release,
  plannedGaIso,
  jiraToken,
  username,
}) {
  if (!release) return { forecast: null };
  const params = { productId, release };
  if (plannedGaIso) params.plannedGaIso = plannedGaIso;
  const res = await authenticatedGet(
    `${API_BASE}/api/release-dataset/forecast`,
    params,
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const err = body?.error || 'Forecast failed';
    const e = new Error(err);
    e.response = { data: body };
    throw e;
  }
  return { forecast: body.data };
}

/**
 * Fetch the curated release-gate timeline (EC + CC + CG + PG + GA) for
 * a release. Source: `releaseVersionsEmailConfig.json` (server-owned;
 * same file the legacy emailer reads). No JIRA round-trip — fast.
 *
 * Returned shape:
 *   {
 *     timeline: {
 *       release, totalGates, configured,
 *       gates:        [{ kind, label, iso, color, style, source, past }],
 *       nextByKind:   { EC?, CC?, CG?, PG?, GA? },
 *       nextOverall:  { ... } | null
 *     } | null
 *   }
 *
 * @param {{release: string, jiraToken: string, username: string}} args
 */
export async function fetchGateTimeline({
  release,
  jiraToken,
  username,
}) {
  if (!release) return { timeline: null };
  const res = await authenticatedGet(
    `${API_BASE}/api/release-dataset/gates`,
    { release },
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const err = body?.error || 'Gate timeline failed';
    const e = new Error(err);
    e.response = { data: body };
    throw e;
  }
  return { timeline: body.data };
}

/**
 * Fetch the 5-tile Outstanding & Deferred composition for a release.
 * JQL semantics approved 2026-05-20 — see
 * `shared/src/services/outstandingService.ts`.
 *
 * Returned shape:
 *   {
 *     outstanding: {
 *       productId, release, projectKey, labelPrefix,
 *       tiles: [{ key, label, caption, count, jql, wrapped, error }, ...×5]
 *     } | null
 *   }
 *
 * @param {{productId?: string, release: string, jiraToken: string, username: string}} args
 */
export async function fetchOutstanding({
  productId = 'ndb',
  release,
  jiraToken,
  username,
}) {
  if (!release) return { outstanding: null };
  const res = await authenticatedGet(
    `${API_BASE}/api/release-dataset/outstanding`,
    { productId, release },
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const err = body?.error || 'Outstanding failed';
    const e = new Error(err);
    e.response = { data: body };
    throw e;
  }
  return { outstanding: body.data };
}

/**
 * Turn a JQL string + a JIRA base URL into a clickable filter URL.
 *
 * Per jira-authenticity-links.mdc — every count on the page links to JIRA
 * via this helper, so users can always click through to verify.
 */
export function jiraSearchUrl(jiraBaseUrl, jql) {
  if (!jiraBaseUrl || !jql) return '';
  const trimmed = jiraBaseUrl.replace(/\/+$/, '');
  return `${trimmed}/issues/?jql=${encodeURIComponent(jql)}`;
}

/**
 * Pick a sensible default release from a list of versions.
 *
 * Preference order:
 *   1. Caller-provided `preferred` (if it exists in the list)
 *   2. Last unreleased version (assumed to be the active one)
 *   3. First version overall
 *   4. null
 */
export function pickDefaultRelease(versions, preferred) {
  if (!versions || versions.length === 0) return null;
  if (preferred && versions.some((v) => v.name === preferred)) return preferred;
  const unreleased = versions.filter((v) => !v.released);
  if (unreleased.length > 0) return unreleased[unreleased.length - 1].name;
  return versions[0].name;
}
