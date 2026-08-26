/**
 * Shared JQL search for Generic Emailer (used by route and by scheduled email runner).
 * Returns { issues, fieldsWithData }.
 */
const { getJira, searchPages } = require('./jiraClient');
const jiraFieldsConfig = require('../config/jiraFieldsConfig.json');
const { getAllFields } = require('./jiraFieldsConfig');

const STANDARD_FIELD_NAMES = 'summary,status,assignee,reporter,issuetype,priority,fixVersions,versions,labels,duedate,watchers,resolution,created,updated,description,parent';
const MAX_JQL_RESULTS = 500;

async function runSearchByJql(token, jql, maxResults = 500) {
  const limit = Math.min(Number(maxResults) || 100, MAX_JQL_RESULTS);

  const customFieldIds = [];
  if (jiraFieldsConfig.fields) {
    Object.keys(jiraFieldsConfig.fields).forEach(category => {
      Object.keys(jiraFieldsConfig.fields[category]).forEach(fieldKey => {
        const id = jiraFieldsConfig.fields[category][fieldKey].id;
        if (id) customFieldIds.push(id);
      });
    });
  }
  const fieldsParam = [STANDARD_FIELD_NAMES, ...customFieldIds].join(',');

  let allIssues = await searchPages(token, jql.trim(), fieldsParam, {
    pageSize: 100,
    maxTotal: limit,
    timeoutMs: 30000,
    delayMs: 300,
  });

  const hasValue = (v) => {
    if (v == null || v === undefined) return false;
    if (v === '') return false;
    if (Array.isArray(v)) return v.length === 0 ? false : true;
    if (typeof v === 'object' && Object.keys(v).length === 0) return false;
    return true;
  };

  const fieldIdsWithData = new Set();
  allIssues.forEach(issue => {
    const f = issue.fields || {};
    Object.keys(f).forEach(fieldId => {
      const val = f[fieldId];
      if (hasValue(val)) fieldIdsWithData.add(fieldId);
    });
  });
  if (allIssues.length > 0) fieldIdsWithData.add('key');

  const idToLabel = {};
  const allFields = getAllFields();
  Object.values(allFields).forEach(config => {
    if (config.id) idToLabel[config.id] = config.label || config.id;
  });
  idToLabel.key = 'Key';

  const missingIds = [...fieldIdsWithData].filter(id => !idToLabel[id]);
  if (missingIds.length > 0) {
    try {
      const jira = await getJira(token);
      const fieldResponse = await jira.get('/rest/api/2/field', { timeout: 10000 });
      const fieldList = fieldResponse.data;
      if (Array.isArray(fieldList)) {
        fieldList.forEach(f => {
          if (f.id && f.name) idToLabel[f.id] = f.name;
        });
      }
    } catch (_) {
      missingIds.forEach(id => {
        idToLabel[id] = id.startsWith('customfield_') ? id.replace('customfield_', 'cf[') + ']' : id;
      });
    }
  }

  const fieldsWithData = [...fieldIdsWithData]
    .map(id => ({ id, label: idToLabel[id] || id }))
    .sort((a, b) => (a.label || '').localeCompare(b.label || '', undefined, { sensitivity: 'base' }));

  const normalizedIssues = allIssues.map(issue => ({
    key: issue.key,
    ...(issue.fields || {})
  }));

  return { issues: normalizedIssues, fieldsWithData };
}

module.exports = { runSearchByJql };
