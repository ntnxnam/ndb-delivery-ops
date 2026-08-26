/**
 * CJS adapter onto shared JiraConnector (D40).
 * Express must not open its own axios + Bearer path to JIRA.
 */

let _sharedPromise;

async function getShared() {
  if (!_sharedPromise) {
    _sharedPromise =
      process.env.NODE_ENV === 'test'
        ? Promise.resolve(require('@portfolio-delivery-ops/shared'))
        : import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

function cleanToken(token) {
  return String(token || '')
    .replace(/^Bearer\s+/i, '')
    .trim();
}

async function getJira(token) {
  const pat = cleanToken(token);
  if (!pat) {
    const err = new Error('JIRA Bearer token required');
    err.statusCode = 401;
    throw err;
  }
  const shared = await getShared();
  const env = {
    ...shared.loadEnv({ requirePat: false }),
    jiraPat: pat,
  };
  return new shared.JiraConnector(env);
}

function stripAxiosTransport(options = {}) {
  const { headers, httpsAgent, ...rest } = options;
  return rest;
}

async function jiraGet(url, token, options = {}) {
  const jira = await getJira(token);
  return jira.get(url, stripAxiosTransport(options));
}

async function jiraPost(url, token, data, options = {}) {
  const jira = await getJira(token);
  return jira.post(url, data, stripAxiosTransport(options));
}

async function jiraPut(url, token, data, options = {}) {
  const jira = await getJira(token);
  return jira.put(url, data, stripAxiosTransport(options));
}

function makeJiraSearchFetcher(jiraToken, {
  defaultFields = 'key,labels,fixVersions',
  pageSize = 1000,
  perPageDelayMs = 200,
  timeoutMs = 6000,
} = {}) {
  return async function fetchIssuesWithJQL(jql, fields = defaultFields) {
    const jira = await getJira(jiraToken);
    return jira.searchAll(jql, fields, {
      pageSize,
      perPageDelayMs,
      perPageTimeoutMs: timeoutMs,
    });
  };
}

async function searchPages(
  token,
  jql,
  fields,
  { pageSize = 100, maxTotal = Infinity, timeoutMs = 30000, delayMs = 200, maxTimeMs } = {}
) {
  const jira = await getJira(token);
  const all = [];
  let startAt = 0;
  const started = Date.now();
  while (all.length < maxTotal) {
    if (maxTimeMs && Date.now() - started > maxTimeMs) break;
    const response = await jira.get('/rest/api/2/search', {
      timeout: timeoutMs,
      params: { jql, fields, maxResults: pageSize, startAt },
    });
    const issues = response.data?.issues || [];
    if (!issues.length) break;
    all.push(...issues);
    const total = response.data?.total ?? all.length;
    startAt = all.length;
    if (all.length >= total || issues.length < pageSize || all.length >= maxTotal) break;
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
  }
  return all.slice(0, Number.isFinite(maxTotal) ? maxTotal : all.length);
}

function wrapJiraError(error, fallbackMessage = 'JIRA request failed') {
  if (error && error.statusCode) return error;
  const status = error?.response?.status || 500;
  const data = error?.response?.data;
  const jiraMsg =
    data?.errorMessages?.[0] ||
    (data?.errors && typeof data.errors === 'object' && Object.values(data.errors).join(', ')) ||
    error?.message ||
    fallbackMessage;
  const wrapped = new Error(jiraMsg);
  wrapped.statusCode = status;
  if (data) wrapped.details = data;
  return wrapped;
}

module.exports = {
  getShared,
  getJira,
  jiraGet,
  jiraPost,
  jiraPut,
  makeJiraSearchFetcher,
  searchPages,
  wrapJiraError,
  cleanToken,
};
