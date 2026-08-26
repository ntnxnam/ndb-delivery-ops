/**
 * Live per-release dataset fetch. Pages hit JIRA on load. Disk write-through
 * is off for page reads so no team inherits another team's cache.
 */

const path = require('path');
const { extractToken } = require('../middleware/auth/jira');

const PRODUCT_CONFIG_PATH = path.resolve(
  __dirname,
  '..',
  'config',
  'teamBoardConfig.json'
);
const RELEASE_DATASET_CACHE_DIR = path.resolve(
  __dirname,
  '..', '..', '..', '..', 'shared', '.cache', 'release-dataset'
);

let _sharedPromise = null;
async function getShared() {
  if (!_sharedPromise) {
    _sharedPromise = process.env.NODE_ENV === 'test'
      ? Promise.resolve(require('@portfolio-delivery-ops/shared'))
      : import('@portfolio-delivery-ops/shared');
  }
  return _sharedPromise;
}

function throwStatus(message, statusCode, publicError) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (publicError) err.publicError = publicError;
  throw err;
}

async function resolveProduct(productId) {
  const shared = await getShared();
  const productService = shared.getProductService(PRODUCT_CONFIG_PATH);
  let product;
  try {
    product = productService.getProduct(productId);
  } catch (e) {
    throwStatus(`Unknown productId '${productId}': ${e.message}`, 400, 'Unknown team');
  }
  const baseFilter = typeof product.baseFilter === 'string' ? product.baseFilter.trim() : '';
  if (!baseFilter) {
    throwStatus(
      `Team "${productId}" has no baseFilter in Admin. Set the team base filter, then Fetch again.`,
      400,
      'Team has no base filter'
    );
  }
  return { shared, productService, product, baseFilter };
}

/**
 * Fetch one release live from JIRA, wrapped with the team's baseFilter.
 * Optionally writes through to the per-release disk cache.
 */
async function fetchLivePerRelease({ productId, release, jiraToken, writeThrough = true } = {}) {
  if (!release) {
    throwStatus('release path parameter is required', 400);
  }
  if (!jiraToken) {
    throwStatus('JIRA Bearer token required in Authorization header', 401);
  }

  const { shared, productService, product, baseFilter } = await resolveProduct(productId);
  const {
    JiraConnector,
    loadEnv,
    fetchReleaseData,
    ReleaseDatasetCache,
  } = shared;

  const env = { ...loadEnv({ requirePat: false }), jiraPat: jiraToken };
  const jira = new JiraConnector(env);
  const labelPrefix = productService.getLabelPrefix(productId);
  const productPrefix = productService.getReleasePrefix
    ? productService.getReleasePrefix(productId)
    : '';
  const isCatchAllVersion = Boolean(
    productPrefix && !String(release).toUpperCase().startsWith(productPrefix.toUpperCase())
  );

  const result = await fetchReleaseData(jira, release, {
    labelPrefix,
    baseFilter,
    isCatchAllVersion,
  });

  const tickets = Array.isArray(result.tickets) ? result.tickets : [];
  const meta = {
    fetchedAtIso: new Date().toISOString(),
    source: 'jira',
    ticketCount: tickets.length,
    bucketCounts: result.bucketCounts || {},
    bucketErrors: result.bucketErrors || {},
    error: result.error || null,
  };

  if (writeThrough && tickets.length > 0 && product.projectKey && typeof ReleaseDatasetCache === 'function') {
    try {
      const cache = new ReleaseDatasetCache({
        cacheDir: RELEASE_DATASET_CACHE_DIR,
        productId,
      });
      cache.saveRelease(release, tickets, {
        projectKey: product.projectKey,
        labelPrefix,
      });
    } catch (err) {
      console.warn(`[releaseLiveDataset] write-through failed for ${release}:`, err.message);
    }
  }

  return { release, tickets, meta };
}

/**
 * Unique fixVersions for the team's baseFilter. Used by the version
 * dropdown and the Sync Hub grid.
 */
async function listLiveFixVersions({ productId, jiraToken } = {}) {
  const { shared, product } = await resolveProduct(productId);
  const { JiraConnector, loadEnv, listFixVersionsForTeam } = shared;
  if (typeof listFixVersionsForTeam !== 'function') {
    throwStatus('listFixVersionsForTeam is unavailable', 500);
  }
  if (!jiraToken) {
    throwStatus('JIRA Bearer token required in Authorization header', 401);
  }
  const env = { ...loadEnv({ requirePat: false }), jiraPat: jiraToken };
  const jira = new JiraConnector(env);
  return listFixVersionsForTeam(product, jira);
}

function tokenFromReq(req) {
  return req.jiraToken || extractToken(req) || '';
}

module.exports = {
  fetchLivePerRelease,
  listLiveFixVersions,
  tokenFromReq,
  RELEASE_DATASET_CACHE_DIR,
  PRODUCT_CONFIG_PATH,
};
