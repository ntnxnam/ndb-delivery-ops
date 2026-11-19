/**
 * JIRA Data Digging — Slice 2b: full download + disk cache + optional history/comments
 * POST /api/jira-digging/prepare → searchCount + searchAll (full) + optional changelog/comments + cache
 * Uses per-request PAT from Authorization: Bearer <pat> via validateJiraTokenMiddleware
 * Cache layout: shared/.cache/jira-digging/{productId}/{jqlHash}/ {manifest.json, tickets.json.gz}
 * Slice 2 was live-sample only; 2b persists and enriches.
 */
const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { JiraConnector } = require('@portfolio-delivery-ops/shared');
const { loadEnv } = require('@portfolio-delivery-ops/shared');
const logger = require('../utils/logger');
const { getFieldId, getFieldValue } = require('../utils/jiraFieldsConfig');

const MAX_JQL_LENGTH = 4000;
const MAX_ISSUES = 10000;
const SAMPLE_KEYS = 10;
// Expanded to scrubbed fields: system + checkpoint + people + content + custom scrub
const DIGGING_FIELDS = [
  'key', 'summary', 'issuetype', 'status', 'priority', 'assignee', 'reporter',
  'fixVersions', 'created', 'updated', 'resolution', 'resolutiondate', 'duedate',
  'labels', 'components', 'parent',
  getFieldId('storyPoints'), getFieldId('sprintNdb'), getFieldId('epicLink'), getFieldId('qaContact'),
  getFieldId('testLead'), getFieldId('codeComplete'), getFieldId('testPlan'), getFieldId('guiLead'),
  getFieldId('requirementsDone'), getFieldId('fsdsDone'), getFieldId('requirementsLink'), getFieldId('primaryComponent'),
  getFieldId('parentLink'), getFieldId('statusUpdate'), getFieldId('riskIndicator'), getFieldId('tpmOwner'),
  getFieldId('tcmsLink'), getFieldId('commitGate'), getFieldId('promotionGate'), getFieldId('executiveStatusUpdate'),
  getFieldId('statusUpdateDate'), getFieldId('riskAssessment'), getFieldId('teamMembers'), getFieldId('cgChecklistLink'),
  getFieldId('pgChecklistLink'), getFieldId('pathToGreen'),
].join(',');

function cryptoHash(jql) {
  return crypto.createHash('md5').update(jql).digest('hex').slice(0, 12);
}

const PRODUCT_ID_RE = /^[a-z0-9_-]{1,32}$/i;
function sanitizeProductId(pid) {
  const v = String(pid || 'ndb').trim().toLowerCase();
  if (!PRODUCT_ID_RE.test(v)) throw Object.assign(new Error('Invalid productId'), { statusCode: 400 });
  return v;
}

function cacheDirFor(productId, jqlHash) {
  const pid = sanitizeProductId(productId);
  const jqlHashRe = /^[a-f0-9]{6,32}$/;
  if (!jqlHashRe.test(String(jqlHash || ''))) throw Object.assign(new Error('Invalid jqlHash'), { statusCode: 400 });
  const base = path.join(__dirname, '..', '..', '..', '..', 'shared', '.cache', 'jira-digging', pid, jqlHash);
  return base;
}

async function writeCache(productId, jqlHash, manifest, tickets) {
  const dir = cacheDirFor(productId, jqlHash);
  await fs.promises.mkdir(dir, { recursive: true });
  const manifestPath = path.join(dir, 'manifest.json');
  const ticketsPath = path.join(dir, 'tickets.json.gz');
  // Atomic write: tmp + rename avoids partial read race
  const tmpManifest = `${manifestPath}.tmp`;
  const tmpTickets = `${ticketsPath}.tmp`;
  await fs.promises.writeFile(tmpManifest, JSON.stringify(manifest, null, 2));
  await fs.promises.rename(tmpManifest, manifestPath);
  const gz = await new Promise((resolve, reject) => zlib.gzip(JSON.stringify(tickets), (e, b) => e ? reject(e) : resolve(b)));
  await fs.promises.writeFile(tmpTickets, gz);
  await fs.promises.rename(tmpTickets, ticketsPath);
  return dir;
}

async function enrichHistoryComments(jira, issues, { includeHistory, includeComments, concurrency = 5 }) {
  if (!includeHistory && !includeComments) return issues;
  if (issues.length > 500 && (includeHistory || includeComments)) {
    logger.warn(`[jira-digging] enrichment capped: ${issues.length} >500, enriching first 500 only`);
    const head = issues.slice(0, 500);
    const tail = issues.slice(500).map((i) => ({ ...i, _enrichCapped: true }));
    const enrichedHead = await enrichHistoryComments(jira, head, { includeHistory, includeComments, concurrency });
    return [...enrichedHead, ...tail];
  }
  const queue = [...issues];
  const out = [];
  const workers = Array.from({ length: concurrency }, async () => {
    while (queue.length) {
      const issue = queue.shift();
      if (!issue) break;
      let enriched = { ...issue };
      try {
        if (includeHistory) {
          const full = await jira.getIssue(issue.key, { fields: ['status'], expand: 'changelog' });
          enriched.changelog = full.changelog || null;
        }
        if (includeComments) {
          const comments = await jira.getComments(issue.key);
          enriched.comments = comments;
        }
      } catch (e) {
        enriched._enrichError = e.message;
      }
      out.push(enriched);
    }
  });
  await Promise.all(workers);
  return out;
}

router.post('/prepare', validateJiraTokenMiddleware, async (req, res) => {
  const jql = String(req.body?.jql || '').trim();
  let productId;
  try { productId = sanitizeProductId(req.body?.productId || 'ndb'); } catch (e) { return res.status(400).json({ error: e.message }); }
  const includeHistory = Boolean(req.body?.includeHistory);
  const includeComments = Boolean(req.body?.includeComments);

  if (!jql) return res.status(400).json({ error: 'jql is required' });
  if (jql.length > MAX_JQL_LENGTH) return res.status(400).json({ error: `jql too long (max ${MAX_JQL_LENGTH})` });

  const jiraPat = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!jiraPat) return res.status(401).json({ error: 'JIRA PAT required (Bearer)' });

  try {
    const env = loadEnv({ requirePat: false });
    env.jiraPat = jiraPat;
    const jira = new JiraConnector(env);
    const jqlHash = cryptoHash(`${productId}:${jql}`);
    const total = await jira.searchCount(jql);
    if (total > MAX_ISSUES) {
      return res.status(400).json({ error: `Result too large: ${total} > ${MAX_ISSUES} cap. Narrow JQL.`, total });
    }
    if (total > 500 && (includeHistory || includeComments)) {
      return res.status(400).json({ error: `Enrichment (history/comments) not allowed for ${total} >500 tickets. Narrow JQL or uncheck history/comments.`, total, cap: 500, hint: 'Uncheck history/comments or add filters to reduce to ≤500' });
    }
    if (total === 0) {
      const datasetId = `dig_${jqlHash}_${Date.now()}`;
      const manifest = { datasetId, jql, productId, jqlHash, ticketCount: 0, fetchedAt: new Date().toISOString(), fields: DIGGING_FIELDS, mode: 'cached-full', includeHistory, includeComments };
      await writeCache(productId, jqlHash, manifest, []);
      return res.json({ ...manifest, sampleKeys: [], cachedDir: cacheDirFor(productId, jqlHash) });
    }
    // Full download — paginated via searchAll (pageSize 500, delay 200ms per JiraConnector defaults)
    const issues = await jira.searchAll(jql, DIGGING_FIELDS, { pageSize: 500, maxIssues: MAX_ISSUES });
    const enriched = (includeHistory || includeComments)
      ? await enrichHistoryComments(jira, issues, { includeHistory, includeComments })
      : issues;
    const sampleKeys = enriched.slice(0, SAMPLE_KEYS).map((i) => i.key);
    const datasetId = `dig_${jqlHash}_${Date.now()}`;
    const fetchedAt = new Date().toISOString();
    const manifest = {
      datasetId, jql, productId, jqlHash, ticketCount: enriched.length,
      fetchedAt, fields: DIGGING_FIELDS, mode: 'cached-full',
      includeHistory, includeComments, sampleKeys,
    };
    const cachedDir = await writeCache(productId, jqlHash, manifest, enriched);
    logger.info(`[jira-digging] 2b ok jqlHash=${jqlHash} total=${enriched.length} product=${productId} user=${req.username || '-'} history=${includeHistory} comments=${includeComments} dir=${cachedDir}`);
    return res.json({ ...manifest, cachedDir, truncated: false });
  } catch (err) {
    const status = err.statusCode || err.response?.status || 500;
    const msg = err.message || err.response?.data?.errorMessages?.[0] || 'JIRA fetch failed';
    logger.error('[jira-digging] prepare 2b failed', err, { jql, status, msg });
    return res.status(status >= 400 && status < 600 ? status : 500).json({ error: msg, details: err.details || err.response?.data });
  }
});

// Preview tickets for drill panel (first 20)
router.post('/dataset', validateJiraTokenMiddleware, async (req, res) => {
  let productId; try { productId = sanitizeProductId(req.body?.productId || req.query.productId || 'ndb'); } catch (e) { return res.status(400).json({ error: e.message }); }
  const jqlHash = String(req.body?.jqlHash || req.query.jqlHash || '').trim().toLowerCase();
  if (!/^[a-f0-9]{6,32}$/.test(jqlHash)) return res.status(400).json({ error: 'jqlHash required' });
  const dir = cacheDirFor(productId, jqlHash);
  try {
    const gz = await fs.promises.readFile(path.join(dir, 'tickets.json.gz'));
    const json = await new Promise((resolve, reject) => zlib.gunzip(gz, (e, b) => e ? reject(e) : resolve(b.toString('utf8'))));
    const tickets = JSON.parse(json);
    return res.json({ productId, jqlHash, tickets: tickets.slice(0, 20), total: tickets.length });
  } catch (err) { return res.status(404).json({ error: 'dataset not found', details: err.message }); }
});

// List cached datasets for a product
router.get('/datasets', validateJiraTokenMiddleware, async (req, res) => {
  let productId;
  try { productId = sanitizeProductId(req.query.productId || 'ndb'); } catch (e) { return res.status(400).json({ error: e.message }); }
  const base = path.join(__dirname, '..', '..', '..', '..', 'shared', '.cache', 'jira-digging', productId);
  try {
    const entries = await fs.promises.readdir(base, { withFileTypes: true }).catch(() => []);
    const datasets = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const manifestPath = path.join(base, e.name, 'manifest.json');
      try {
        const raw = await fs.promises.readFile(manifestPath, 'utf8');
        datasets.push(JSON.parse(raw));
      } catch (_) { /* skip corrupt */ }
    }
    datasets.sort((a, b) => (b.fetchedAt || '').localeCompare(a.fetchedAt || ''));
    return res.json({ productId, datasets });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
