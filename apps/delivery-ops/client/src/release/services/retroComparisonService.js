import { authenticatedGet, authenticatedPost } from '../../utils/api';

export { jiraSearchUrl } from './retrospectiveService';

/**
 * Fetch the per-release ticket bundle for one release (flat ticket array).
 * Same endpoint ReleaseDataContext uses, called directly so the comparison
 * can load several releases without swapping the globally-selected one.
 */
export async function fetchPerReleaseTickets({ release, productId, jiraToken, username }) {
  if (!release || !productId) return { release, tickets: [] };
  const res = await authenticatedGet(
    `/api/release-dataset/per-release/${encodeURIComponent(release)}`,
    { productId },
    { jiraToken, username }
  );
  const data = res?.data?.data || {};
  return { release, tickets: Array.isArray(data.tickets) ? data.tickets : [], meta: data.meta || null };
}

/**
 * Fetch the KPI-by-resolution breakdown for one release.
 * Returns { [kpiId]: { name, total, done, open, links } | { error } }.
 */
export async function fetchKpiBreakdown({ release, teamId, jiraToken, username }) {
  if (!release || !teamId) return {};
  const res = await authenticatedPost(
    '/api/jira/release-kpi-breakdown-batch',
    { releaseVersion: release, teamId },
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const e = new Error(body?.error || 'KPI breakdown failed');
    e.response = { data: body };
    throw e;
  }
  return body.results || {};
}
