/**
 * JIRA Fields — client-side mirror of server/utils/jiraFieldsConfig.js
 * Single source of truth: client/src/config/jiraFieldsConfig.json (copied from server)
 * Keep in sync via: cp server/config/jiraFieldsConfig.json client/src/config/jiraFieldsConfig.json
 */
import fieldsConfig from '../config/jiraFieldsConfig.json';

export function getAllFields() {
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

function applyLabelPlaceholders(template, replacements = {}) {
  const prefix = replacements.prefix ? String(replacements.prefix).toLowerCase() : 'ndb';
  const map = { ...replacements, prefix };
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in map && map[k] != null ? String(map[k]) : `{${k}}`));
}
export function getLabelPattern(key, params = {}) {
  const parts = key.split('.');
  let cur = fieldsConfig.labels;
  for (const p of parts) cur = cur?.[p];
  if (!cur?.pattern) return null;
  return applyLabelPlaceholders(cur.pattern, params);
}
export function getLabelConfig(key) {
  const parts = key.split('.');
  let cur = fieldsConfig.labels;
  for (const p of parts) cur = cur?.[p];
  return cur || null;
}
// Labels helpers (minimal)
export function getLabelJql(key, params = {}) {
  const parts = key.split('.');
  let cur = fieldsConfig.labels;
  for (const p of parts) cur = cur?.[p];
  if (!cur?.jql) return null;
  return applyLabelPlaceholders(cur.jql, params);
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
  getLabelPattern,
  getLabelConfig,
  getLabelJql,
};
