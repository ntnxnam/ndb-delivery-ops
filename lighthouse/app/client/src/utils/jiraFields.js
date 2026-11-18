/**
 * JIRA Fields — client-side mirror of server/utils/jiraFieldsConfig.js
 * Single source of truth: client/src/config/jiraFieldsConfig.json (copied from server)
 * Keep in sync via: cp server/config/jiraFieldsConfig.json client/src/config/jiraFieldsConfig.json
 */
import fieldsConfig from '../config/jiraFieldsConfig.json';

function getAllFields() {
  const all = {};
  Object.keys(fieldsConfig.fields).forEach((cat) => {
    Object.keys(fieldsConfig.fields[cat]).forEach((k) => {
      all[k] = { ...fieldsConfig.fields[cat][k], category: cat };
    });
  });
  return all;
}

export function getFieldId(fieldKey) {
  const all = getAllFields();
  return all[fieldKey]?.id || null;
}

export function getFieldConfig(fieldKey) {
  return getAllFields()[fieldKey] || null;
}

export function getFieldConfigById(fieldId) {
  const all = getAllFields();
  for (const [k, v] of Object.entries(all)) if (v.id === fieldId) return { ...v, logicalKey: k };
  return null;
}

export function getFieldIdsByCategory(category) {
  const cat = fieldsConfig.fields[category] || {};
  return Object.values(cat).map((f) => f.id);
}

export function getFieldValue(issueFields, fieldKey) {
  const id = getFieldId(fieldKey);
  if (!id || !issueFields) return null;
  return issueFields[id] ?? null;
}

export function buildFieldIdsString(fieldKeys) {
  return fieldKeys.map(getFieldId).filter(Boolean).join(',');
}

export function getFieldIdsForContext(context) {
  const all = getAllFields();
  return Object.entries(all)
    .filter(([, c]) => c.usedIn?.includes(context))
    .map(([, c]) => c.id)
    .filter(Boolean)
    .join(',');
}

export function getFieldKeyByName(displayName) {
  const n = displayName?.toLowerCase().trim();
  return fieldsConfig.fieldNameMappings?.[n] || null;
}

// Labels helpers (minimal)
export function getLabelJql(key, params = {}) {
  const parts = key.split('.');
  let cur = fieldsConfig.labels;
  for (const p of parts) cur = cur?.[p];
  if (!cur?.jql) return null;
  const prefix = (params.prefix || 'ndb').toLowerCase();
  return cur.jql.replace(/\{(\w+)\}/g, (_, k) => (k === 'prefix' ? prefix : params[k] != null ? String(params[k]) : `{${k}}`));
}

export default {
  getFieldId,
  getFieldConfig,
  getFieldConfigById,
  getFieldIdsByCategory,
  getFieldValue,
  buildFieldIdsString,
  getFieldIdsForContext,
  getFieldKeyByName,
  getLabelJql,
};
