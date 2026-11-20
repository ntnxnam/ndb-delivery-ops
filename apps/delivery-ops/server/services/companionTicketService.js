const path = require('path');
const { JIRA_API_V2 } = require('../config/api');
const { getJira, wrapJiraError } = require('../utils/jiraClient');
const cfg = require('../config/companionTicketsConfig.json');

const TEMPLATES = Array.isArray(cfg.templates) ? cfg.templates : [];
const TIMEOUT_MS = 15000;

function renderTpl(tpl, vars) {
  return String(tpl).replace(/\{\{version\}\}/g, vars.version || '');
}

function buildDesiredTickets(version) {
  return TEMPLATES.map(t => ({
    id: t.id,
    projectKey: t.projectKey,
    summary: renderTpl(t.summaryTpl, { version }),
    description: renderTpl(t.descriptionTpl || '', { version }),
    issuetype: t.issuetype || 'Task',
    fixVersion: t.fixVersionFromRelease ? version : null,
    labels: Array.isArray(t.labels) ? t.labels : undefined,
    priority: t.priority || undefined,
    isSecurity: !!(t.labels && t.labels.includes('security')) || String(t.summaryTpl).toLowerCase().includes('[security]'),
  }));
}

async function checkCompanionTickets(jiraToken, { version }) {
  if (!version) { const e = new Error('version is required'); e.statusCode = 400; throw e; }
  const desired = buildDesiredTickets(version);
  const jira = await getJira(jiraToken);
  const results = [];
  for (const d of desired) {
    // dedup via JQL: project = X AND summary ~ "exact"  (quoted) — JIRA summary search is fuzzy, so fetch and exact-match
    const jql = `project = ${d.projectKey} AND fixVersion = "${d.summary ? version : ''}" AND summary ~ "${d.summary.replace(/"/g, '\\"')}"`;
    // Better: search by project+summary exact via JQL then filter exact summary in code
    const safeJql = `project = ${d.projectKey} AND summary ~ "${d.summary.replace(/"/g, '\\"').slice(0, 80)}"`;
    try {
      const res = await jira.get('/rest/api/2/search', { params: { jql: safeJql, maxResults: 20, fields: 'key,summary,fixVersions,status,issuetype' }, timeout: TIMEOUT_MS });
      const issues = res.data?.issues || [];
      const exact = issues.find(it => String(it.fields?.summary || '').trim() === d.summary);
      if (exact) {
        results.push({ ...d, exists: true, issueKey: exact.key, status: exact.fields?.status?.name, fixVersions: (exact.fields?.fixVersions || []).map(v => v.name) });
      } else {
        // also check by project+fixVersion alone if summary search missed due to escaping
        const jql2 = `project = ${d.projectKey} AND fixVersion = "${version}"`;
        try {
          const res2 = await jira.get('/rest/api/2/search', { params: { jql: jql2, maxResults: 50, fields: 'key,summary' }, timeout: TIMEOUT_MS });
          const exact2 = (res2.data?.issues || []).find(it => String(it.fields?.summary || '').trim() === d.summary);
          if (exact2) results.push({ ...d, exists: true, issueKey: exact2.key, status: exact2.fields?.status?.name });
          else results.push({ ...d, exists: false });
        } catch (_) { results.push({ ...d, exists: false }); }
      }
    } catch (e) {
      // on search failure, report as unknown but not blocking
      results.push({ ...d, exists: false, error: e.message });
    }
  }
  return { version, tickets: results, missingCount: results.filter(r => !r.exists).length };
}

async function createCompanionTickets(jiraToken, { version, ids }) {
  if (!version) { const e = new Error('version is required'); e.statusCode = 400; throw e; }
  const desired = buildDesiredTickets(version);
  const wanted = ids && Array.isArray(ids) && ids.length ? desired.filter(d => ids.includes(d.id)) : desired;
  if (!wanted.length) { const e = new Error('No matching templates for ids'); e.statusCode = 400; throw e; }
  const jira = await getJira(jiraToken);
  const created = [];
  const skipped = [];
  for (const d of wanted) {
    // dedup: skip if already exists (same summary)
    const checkJql = `project = ${d.projectKey} AND summary ~ "${d.summary.replace(/"/g, '\\"').slice(0, 80)}"`;
    try {
      const res = await jira.get('/rest/api/2/search', { params: { jql: checkJql, maxResults: 20, fields: 'key,summary' }, timeout: TIMEOUT_MS });
      const exists = (res.data?.issues || []).find(it => String(it.fields?.summary || '').trim() === d.summary);
      if (exists) { skipped.push({ id: d.id, projectKey: d.projectKey, summary: d.summary, issueKey: exists.key, reason: 'already exists' }); continue; }
    } catch (_) {}
    const fields = {
      project: { key: d.projectKey },
      summary: d.summary,
      description: d.description,
      issuetype: { name: d.issuetype },
    };
    if (d.fixVersion) fields.fixVersions = [{ name: d.fixVersion }];
    if (d.labels) fields.labels = d.labels;
    if (d.priority) fields.priority = { name: d.priority };
    // Attempt to handle mandatory Component/s via retry similar to JCH
    try {
      const res = await jira.post(JIRA_API_V2.CREATE_ISSUE, { fields }, { timeout: TIMEOUT_MS });
      created.push({ id: d.id, projectKey: d.projectKey, summary: d.summary, issueKey: res.data?.key, issueId: res.data?.id });
    } catch (e) {
      const msg = e.response?.data?.errors ? Object.values(e.response.data.errors).join(' ') : '';
      const msg2 = (e.response?.data?.errorMessages || []).join(' ');
      const combined = `${msg} ${msg2}`.toLowerCase();
      if ((e.response?.status === 400 || e.statusCode === 400) && combined.includes('component') && combined.includes('required')) {
        try {
          const compRes = await jira.get(`${JIRA_API_V2.BASE_URL}/rest/api/2/project/${d.projectKey}/components`, { timeout: TIMEOUT_MS });
          const comps = Array.isArray(compRes.data) ? compRes.data : [];
          if (comps.length) {
            const compName = comps[0].name || comps[0].id;
            fields.components = [{ name: compName }];
            const res2 = await jira.post(JIRA_API_V2.CREATE_ISSUE, { fields }, { timeout: TIMEOUT_MS });
            created.push({ id: d.id, projectKey: d.projectKey, summary: d.summary, issueKey: res2.data?.key, issueId: res2.data?.id });
            continue;
          }
        } catch (_) {}
      }
      const w = wrapJiraError(e, `Failed to create ${d.projectKey} ticket`);
      skipped.push({ id: d.id, projectKey: d.projectKey, summary: d.summary, error: w.message, statusCode: w.statusCode });
    }
  }
  return { version, created, skipped, total: wanted.length };
}

module.exports = { buildDesiredTickets, checkCompanionTickets, createCompanionTickets, TEMPLATES };
