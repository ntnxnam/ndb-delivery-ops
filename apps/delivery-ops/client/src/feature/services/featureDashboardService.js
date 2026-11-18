import { authenticatedGet, authenticatedPost, getApiBase } from '../../shared/services/apiService';

const API_BASE = getApiBase();

export async function listReleaseFeatures({ release, jiraToken, username }) {
  const res = await authenticatedGet(
    `${API_BASE}/api/feature/list`,
    { release },
    { jiraToken, username }
  );
  if (!res?.data?.success) {
    throw new Error(res?.data?.error || 'Failed to fetch features');
  }
  return res.data.data;
}

export async function fetchFeatureDashboard({
  release,
  featureKey,
  teamId,
  jiraToken,
  username,
}) {
  const params = { release, featureKey };
  if (teamId) params.teamId = teamId;
  const res = await authenticatedGet(
    `${API_BASE}/api/feature/dashboard`,
    params,
    { jiraToken, username }
  );
  if (!res?.data?.success) {
    throw new Error(res?.data?.error || 'Failed to fetch dashboard');
  }
  return res.data.data;
}

export async function reparentFeatureTicket({
  ticketKey,
  newParent,
  reason,
  jiraToken,
  username,
}) {
  const res = await authenticatedPost(
    `${API_BASE}/api/feature/reparent`,
    { ticketKey, newParent, reason },
    { jiraToken, username }
  );
  if (!res?.data?.success) {
    throw new Error(res?.data?.error || 'Failed to re-parent ticket');
  }
  return res.data.data;
}

export function jiraSearchUrl(jiraBaseUrl, jql) {
  if (!jiraBaseUrl || !jql) return '';
  return `${jiraBaseUrl.replace(/\/+$/, '')}/issues/?jql=${encodeURIComponent(jql)}`;
}
