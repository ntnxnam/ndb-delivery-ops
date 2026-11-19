/**
 * fieldConfig — client fetch-cached wrapper around jiraFieldsConfig
 * Fetches GET /api/config/jira-fields once, caches, falls back to bundled JSON.
 * Pure helpers delegate to jiraFields.js which is the SoT mirror.
 * Components must not fetch directly; hooks call ensureLoaded() then use sync getters.
 */
import * as jiraFields from './jiraFields';

let remoteConfig = null;
let fetchPromise = null;

export async function ensureLoaded() {
  if (remoteConfig) return remoteConfig;
  if (fetchPromise) return fetchPromise;
  fetchPromise = fetch('/api/config/jira-fields')
    .then(r => r.ok ? r.json() : null)
    .then(cfg => { if (cfg && cfg.fields) remoteConfig = cfg; return remoteConfig; })
    .catch(() => null)
    .finally(() => { fetchPromise = null; });
  return fetchPromise;
}

export function getFieldId(fieldKey) { return jiraFields.getFieldId(fieldKey); }
export function getFieldValue(issue, fieldKey) { return jiraFields.getFieldValue(issue, fieldKey); }
export function getLabelPattern(key, params) { return jiraFields.getLabelPattern ? jiraFields.getLabelPattern(key, params) : null; }
export function getLabelJql(key, params) { return jiraFields.getLabelJql(key, params); }

export default { ensureLoaded, getFieldId, getFieldValue, getLabelPattern, getLabelJql };
