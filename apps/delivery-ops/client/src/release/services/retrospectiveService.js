import { authenticatedGet } from '../../utils/api';
import { listReleaseVersions, pickDefaultRelease } from './releaseBriefService';

export { listReleaseVersions, pickDefaultRelease };

export async function fetchRetrospective({
  release,
  productId = 'ndb',
  topN = 10,
  jiraToken,
  username,
}) {
  if (!release) return { retro: null };
  const res = await authenticatedGet(
    '/api/release-dataset/retrospective',
    { release, productId, topN },
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const err = body?.error || 'Retrospective fetch failed';
    const e = new Error(err);
    e.response = { data: body };
    throw e;
  }
  return { retro: body.data };
}

export async function fetchRetrospectiveBootstrap({
  release,
  productId = 'ndb',
  jiraToken,
  username,
}) {
  if (!release) return { bootstrap: null };
  const res = await authenticatedGet(
    '/api/release-dataset/retrospective/bootstrap',
    { release, productId },
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const err = body?.error || 'Retrospective bootstrap failed';
    const e = new Error(err);
    e.response = { data: body };
    throw e;
  }
  return { bootstrap: body.data };
}

export async function fetchRetrospectiveProjects({
  release,
  productId = 'ndb',
  page = 1,
  limit = 10,
  jiraToken,
  username,
}) {
  if (!release) return { projectsPage: null };
  const res = await authenticatedGet(
    '/api/release-dataset/retrospective/projects',
    { release, productId, page, limit },
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const err = body?.error || 'Retrospective projects failed';
    const e = new Error(err);
    e.response = { data: body };
    throw e;
  }
  return { projectsPage: body.data };
}

export async function fetchRetrospectiveProjectDetail({
  release,
  productId = 'ndb',
  parentKey,
  parentType,
  parentSummary,
  jiraToken,
  username,
}) {
  if (!release || !parentKey) return { detail: null };
  const res = await authenticatedGet(
    `/api/release-dataset/retrospective/project/${encodeURIComponent(parentKey)}`,
    { release, productId, parentType, parentSummary },
    { jiraToken, username }
  );
  const body = res?.data;
  if (!body?.success) {
    const err = body?.error || 'Retrospective project detail failed';
    const e = new Error(err);
    e.response = { data: body };
    throw e;
  }
  return { detail: body.data };
}

export function jiraSearchUrl(jiraBaseUrl, jql) {
  if (!jiraBaseUrl || !jql) return '';
  const trimmed = jiraBaseUrl.replace(/\/+$/, '');
  return `${trimmed}/issues/?jql=${encodeURIComponent(jql)}`;
}
