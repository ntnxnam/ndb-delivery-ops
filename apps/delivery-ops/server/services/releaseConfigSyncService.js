/**
 * releaseConfigSyncService — append-only sync of JIRA FIX versions into runtime config.
 *
 * Compares JIRA project versions against releaseGateDates keys and seeds any
 * missing names as minimal stubs so Release Configuration reflects JIRA truth.
 * Product-agnostic (D1), Bearer PAT only (D40).
 */

const { getJira } = require('../utils/jiraClient');
const { loadTeamBoardConfig, getTeamById } = require('../utils/teamConfig');
const path = require('path');
const fs = require('fs');

const RELEASE_VERSIONS_EMAIL_CONFIG_PATH = path.join(__dirname, '../config/releaseVersionsEmailConfig.json');

function loadReleaseDatesConfig() {
  let config = { releases: {} };
  try {
    delete require.cache[require.resolve(RELEASE_VERSIONS_EMAIL_CONFIG_PATH)];
    const raw = fs.readFileSync(RELEASE_VERSIONS_EMAIL_CONFIG_PATH, 'utf8');
    if (raw && raw.trim()) {
      const emailConfig = JSON.parse(raw);
      config.releases = emailConfig.releaseGateDates || {};
    }
  } catch (_) {}
  return config;
}

function saveReleaseDatesConfig(config) {
  try {
    delete require.cache[require.resolve(RELEASE_VERSIONS_EMAIL_CONFIG_PATH)];
    const raw = fs.readFileSync(RELEASE_VERSIONS_EMAIL_CONFIG_PATH, 'utf8');
    const emailConfig = raw && raw.trim() ? JSON.parse(raw) : {};
    emailConfig.releaseGateDates = config.releases || {};
    delete emailConfig.releases;
    fs.writeFileSync(RELEASE_VERSIONS_EMAIL_CONFIG_PATH, JSON.stringify(emailConfig, null, 2), 'utf8');
  } catch (e) {
    console.error('[releaseConfigSync] save failed:', e.message);
    throw e;
  }
}

function sanitizeJiraMeta(val) {
  if (!val || typeof val !== 'object') return null;
  const out = {};
  if (val.projectKey) out.projectKey = String(val.projectKey);
  if (val.name) out.name = String(val.name);
  if (val.released != null) out.released = !!val.released;
  if (val.archived != null) out.archived = !!val.archived;
  if (val.releaseDate) {
    const s = String(val.releaseDate).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) out.releaseDate = s;
  }
  if (val.id) out.id = String(val.id);
  if (val.syncedAt) out.syncedAt = String(val.syncedAt);
  if (val.description) out.description = String(val.description).slice(0, 2000);
  return out;
}

function buildStub(versionName, jiraVersion) {
  const now = new Date().toISOString();
  const stub = {};
  if (jiraVersion) {
    stub._jira = {
      projectKey: jiraVersion.projectKey || '',
      name: versionName,
      released: !!jiraVersion.released,
      archived: !!jiraVersion.archived,
      releaseDate: jiraVersion.releaseDate || undefined,
      id: jiraVersion.id || undefined,
      syncedAt: now,
    };
    // Strip undefined keys
    Object.keys(stub._jira).forEach((k) => stub._jira[k] === undefined && delete stub._jira[k]);
  } else {
    stub._jira = { name: versionName, syncedAt: now };
  }
  stub._source = 'jira-sync';
  stub._syncedAt = now;
  // Optional freeform notes — empty until user fills via * popover
  // Not set here so existing rows show no filled indicator; new stubs get empty string lazily on first edit
  return stub;
}

/**
 * Sync missing JIRA versions into releaseGateDates.
 * Append-only: never overwrites existing gate dates; only refreshes _jira meta on existing keys.
 *
 * @param {string} jiraToken - Bearer PAT
 * @param {{ teamId?: string, projectKeys?: string[] }} opts
 * @returns {Promise<{ created: string[], skipped: string[], updatedMeta: string[], projectKey: string, existing: number }>}
 */
async function syncMissingReleases(jiraToken, { teamId, projectKeys } = {}) {
  let targetTeams = [];

  if (projectKeys && projectKeys.length) {
    // Explicit projectKeys — resolve or synthesize minimal team objects
    const allTeams = loadTeamBoardConfig().teams || [];
    for (const pk of projectKeys) {
      const found = allTeams.find((t) => String(t.projectKey || '').toLowerCase() === String(pk).toLowerCase());
      if (found) targetTeams.push(found);
      else targetTeams.push({ id: String(pk).toLowerCase(), projectKey: String(pk) });
    }
  } else if (teamId) {
    const team = getTeamById(teamId);
    if (!team) {
      const err = new Error(`Team "${teamId}" not found`);
      err.statusCode = 404;
      throw err;
    }
    targetTeams = [team];
  } else {
    const cfg = loadTeamBoardConfig();
    targetTeams = (cfg.teams || []).filter((t) => t.projectKey);
    if (!targetTeams.length) return { created: [], skipped: [], updatedMeta: [], projectKey: '', existing: 0 };
  }

  const config = loadReleaseDatesConfig();
  const existingKeys = new Set(Object.keys(config.releases || {}));
  const existing = existingKeys.size;
  const created = [];
  const skipped = [];
  const updatedMeta = [];
  let primaryProjectKey = '';

  for (const team of targetTeams) {
    const projectKey = String(team.projectKey || '').trim();
    if (!projectKey) {
      skipped.push(team.id || 'unknown');
      continue;
    }
    if (!primaryProjectKey) primaryProjectKey = projectKey;

    let jiraVersions;
    try {
      const jira = await getJira(jiraToken);
      jiraVersions = await jira.getProjectVersions(projectKey);
    } catch (e) {
      console.warn(`[releaseConfigSync] getProjectVersions ${projectKey} failed:`, e.message);
      skipped.push(projectKey);
      continue;
    }

    for (const v of jiraVersions || []) {
      if (!v || !v.name) continue;
      if (v.archived === true) continue;
      const name = String(v.name).trim();
      if (!name) continue;

      if (!existingKeys.has(name)) {
        // New version — seed stub
        const jiraMeta = {
          projectKey,
          name,
          released: !!v.released,
          archived: !!v.archived,
          releaseDate: v.releaseDate || undefined,
          id: v.id || undefined,
        };
        config.releases[name] = buildStub(name, jiraMeta);
        existingKeys.add(name);
        created.push(name);
      } else {
        // Existing — refresh _jira meta if releaseDate/released changed or missing
        const existingEntry = config.releases[name];
        const prevMeta = existingEntry && existingEntry._jira;
        const needsRefresh =
          !prevMeta ||
          prevMeta.released !== !!v.released ||
          prevMeta.releaseDate !== (v.releaseDate || undefined) ||
          prevMeta.projectKey !== projectKey;
        if (needsRefresh) {
          const nextMeta = {
            projectKey,
            name,
            released: !!v.released,
            archived: !!v.archived,
            releaseDate: v.releaseDate || undefined,
            id: v.id || undefined,
            syncedAt: new Date().toISOString(),
          };
          Object.keys(nextMeta).forEach((k) => nextMeta[k] === undefined && delete nextMeta[k]);
          config.releases[name] = { ...existingEntry, _jira: nextMeta, _syncedAt: nextMeta.syncedAt };
          updatedMeta.push(name);
        }
      }
    }
  }

  if (created.length || updatedMeta.length) {
    saveReleaseDatesConfig(config);
  }

  return { created, skipped, updatedMeta, projectKey: primaryProjectKey, existing };
}

module.exports = { syncMissingReleases, buildStub, sanitizeJiraMeta };
