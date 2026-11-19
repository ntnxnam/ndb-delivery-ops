const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { plaintextToJql } = require('../services/plaintextToJqlService');

function loadJson(rel) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', rel), 'utf8')); } catch { return null; }
}

router.post('/preview', (req, res) => {
  const { plaintext, teamId, releaseVersion } = req.body || {};
  const kpiConfig = loadJson('config/kpiConfig.json');
  const teamBoardConfig = loadJson('config/teamBoardConfig.json');
  const jiraFieldsConfig = loadJson('config/jiraFieldsConfig.json');
  const releaseGateDates = loadJson('config/releaseVersionsEmailConfig.json')?.releaseGateDates || null;
  const result = plaintextToJql({ plaintext, teamId, releaseVersion, kpiConfig, teamBoardConfig, jiraFieldsConfig, releaseGateDates, now: new Date() });
  res.json(result);
});

router.get('/corpus', (req, res) => {
  const kpiConfig = loadJson('config/kpiConfig.json');
  const teamBoardConfig = loadJson('config/teamBoardConfig.json');
  const kpiExamples = [];
  if (kpiConfig?.teams) for (const [teamId, kpis] of Object.entries(kpiConfig.teams)) for (const k of kpis) kpiExamples.push({ teamId, name: k.name, baseQuery: k.baseQuery });
  const baseFilters = (teamBoardConfig?.teams || []).map(t => ({ teamId: t.id, baseFilter: t.baseFilter }));
  res.json({ kpiExamples, baseFilters });
});

router.post('/test', async (req, res) => {
  const jql = String(req.body?.jql || '').trim();
  if (!jql) return res.status(400).json({ error: 'jql required' });
  const pat = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!pat) return res.json({ ok: true, total: 0, warning: 'Jira not configured — no PAT, returning mock' });
  try {
    const { JiraConnector } = require('@portfolio-delivery-ops/shared');
    const { loadEnv } = require('@portfolio-delivery-ops/shared');
    const env = loadEnv({ requirePat: false });
    env.jiraPat = pat;
    const jira = new JiraConnector(env);
    const total = await jira.searchCount(jql);
    res.json({ ok: true, total });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

module.exports = router;
