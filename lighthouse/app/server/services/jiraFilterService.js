/**
 * JIRA Filter Service
 *
 * Owns the JIRA REST primitives for finding / updating saved filters and
 * fixVersions, plus the two orchestrators used by the release setup tools:
 *   - renameReleaseCascade: rename a release end-to-end (versions + 5 filters + config)
 *   - cleanupDuplicatePrefixFilters: fix filters previously created with the
 *     bad `GetNDB<NDB-x.y>...` prefix bug
 *
 * Route handlers in server/routes/jira/index.js stay thin and only validate input
 * before delegating to functions in this file.
 */

const fs = require('fs');
const path = require('path');
const { JIRA_API_V2 } = require('../config/api');
const { getJira } = require('../utils/jiraClient');
const { generateFilterChain, RELEASE_PROJECTS } = require('../utils/jqlTemplates');
const logger = require('../utils/logger');

const RELEASE_CONFIG_PATH = path.join(__dirname, '../config/releaseVersionsColumnsConfig.json');
const FILTER_SUFFIXES = [
  'FeaturesAndInitiatives',
  'EpicsOfFeaturesAndInitiatives',
  'IssuesInEpics',
  'ChildIssues',
];

// ---------- Primitives ----------

async function findFilterByName(token, name) {
  if (!name) return null;
  const jira = await getJira(token);
  const url = `${JIRA_API_V2.FILTER_SEARCH}?filterName=${encodeURIComponent(name)}&maxResults=50`;
  try {
    const res = await jira.get(url, { timeout: 15000 });
    const filters = Array.isArray(res.data?.values)
      ? res.data.values
      : Array.isArray(res.data?.results)
        ? res.data.results
        : Array.isArray(res.data)
          ? res.data
          : [];
    const match = filters.find(f => f.name && String(f.name).trim() === String(name).trim());
    return match || null;
  } catch (err) {
    if (err.response?.status === 404) return null;
    throw err;
  }
}

async function updateFilter(token, id, payload) {
  if (!id) throw new Error('filter id is required');
  const jira = await getJira(token);
  const body = {};
  if (payload.name !== undefined) body.name = String(payload.name).trim();
  if (payload.jql !== undefined) body.jql = String(payload.jql).trim();
  if (payload.description !== undefined) body.description = String(payload.description);
  const res = await jira.put(JIRA_API_V2.FILTER(id), body, { timeout: 15000 });
  return res.data;
}

async function findVersionByName(token, projectKey, name) {
  if (!projectKey || !name) return null;
  const jira = await getJira(token);
  const res = await jira.get(JIRA_API_V2.PROJECT_VERSIONS(projectKey), { timeout: 15000 });
  const versions = Array.isArray(res.data) ? res.data : [];
  return versions.find(v => v.name && String(v.name).trim() === String(name).trim()) || null;
}

async function updateVersion(token, id, payload) {
  if (!id) throw new Error('version id is required');
  const jira = await getJira(token);
  const body = {};
  if (payload.name !== undefined) body.name = String(payload.name).trim();
  if (payload.releaseDate !== undefined) body.releaseDate = payload.releaseDate;
  if (payload.released !== undefined) body.released = !!payload.released;
  if (payload.archived !== undefined) body.archived = !!payload.archived;
  const res = await jira.put(JIRA_API_V2.VERSION(id), body, { timeout: 15000 });
  return res.data;
}

// ---------- Helpers ----------

function jiraErrorMessage(err) {
  return err.response?.data?.errorMessages?.[0]
    || (err.response?.data?.errors && Object.values(err.response.data.errors).join(', '))
    || err.message
    || 'JIRA request failed';
}

function readReleaseConfig() {
  const raw = fs.readFileSync(RELEASE_CONFIG_PATH, 'utf8');
  return raw && raw.trim() ? JSON.parse(raw) : {};
}

function writeReleaseConfig(config) {
  fs.writeFileSync(RELEASE_CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// ---------- Orchestrators ----------

async function renameReleaseCascade(token, opts) {
  const oldVersion = (opts.oldVersion || '').trim();
  const newVersion = (opts.newVersion || '').trim();
  const excludeVersion = (opts.excludeVersion || '').trim();
  const projects = Array.isArray(opts.projects) && opts.projects.length
    ? opts.projects
    : RELEASE_PROJECTS;
  const dryRun = !!opts.dryRun;
  const actor = opts.actor || 'unknown';

  if (!oldVersion || !newVersion) {
    throw new Error('oldVersion and newVersion are required');
  }
  if (oldVersion === newVersion) {
    throw new Error('oldVersion and newVersion must differ');
  }

  const oldChain = generateFilterChain(oldVersion, excludeVersion);
  const newChain = generateFilterChain(newVersion, excludeVersion);

  // Pre-flight: lookup all old filters and check for new-name collisions
  const filterPlan = [];
  const conflicts = [];
  for (let i = 0; i < oldChain.length; i++) {
    const oldEntry = oldChain[i];
    const newEntry = newChain[i];
    const existingOld = await findFilterByName(token, oldEntry.name);
    const existingNew = await findFilterByName(token, newEntry.name);
    if (existingNew && (!existingOld || existingNew.id !== existingOld.id)) {
      conflicts.push({ order: newEntry.order, oldName: oldEntry.name, newName: newEntry.name, conflictWithId: existingNew.id });
    }
    filterPlan.push({
      order: newEntry.order,
      oldName: oldEntry.name,
      newName: newEntry.name,
      newJql: newEntry.jql,
      filterId: existingOld ? existingOld.id : null,
      foundOld: !!existingOld,
    });
  }

  if (conflicts.length) {
    const err = new Error('Filter name conflicts in JIRA prevent the rename cascade');
    err.statusCode = 409;
    err.conflicts = conflicts;
    throw err;
  }

  // Plan versions in parallel-safe lookups
  const versionPlan = [];
  for (const projectKey of projects) {
    let existing = null;
    try {
      existing = await findVersionByName(token, projectKey, oldVersion);
    } catch (err) {
      versionPlan.push({ projectKey, oldName: oldVersion, newName: newVersion, status: 'error', error: jiraErrorMessage(err) });
      continue;
    }
    versionPlan.push({
      projectKey,
      oldName: oldVersion,
      newName: newVersion,
      versionId: existing ? existing.id : null,
      foundOld: !!existing,
    });
  }

  if (dryRun) {
    return {
      dryRun: true,
      oldVersion,
      newVersion,
      versions: versionPlan.map(v => ({
        projectKey: v.projectKey,
        oldName: v.oldName,
        newName: v.newName,
        status: v.status || (v.foundOld ? 'will-rename' : 'missing'),
        error: v.error,
      })),
      filters: filterPlan.map(f => ({
        order: f.order,
        oldName: f.oldName,
        newName: f.newName,
        status: f.foundOld ? 'will-rename' : 'missing',
      })),
      config: {
        oldKey: oldVersion,
        newKey: newVersion,
        plannedValue: `filter=${newVersion}-All`,
      },
    };
  }

  // Execute version renames
  const versionResults = [];
  for (const v of versionPlan) {
    if (v.status === 'error') {
      versionResults.push({ projectKey: v.projectKey, oldName: v.oldName, newName: v.newName, status: 'error', error: v.error });
      continue;
    }
    if (!v.foundOld) {
      versionResults.push({ projectKey: v.projectKey, oldName: v.oldName, newName: v.newName, status: 'missing' });
      continue;
    }
    try {
      await updateVersion(token, v.versionId, { name: newVersion });
      logger.audit.action(actor, 'rename-version', `${v.projectKey}:${oldVersion}->${newVersion}`, { versionId: v.versionId });
      versionResults.push({ projectKey: v.projectKey, oldName: v.oldName, newName: v.newName, status: 'renamed' });
    } catch (err) {
      versionResults.push({ projectKey: v.projectKey, oldName: v.oldName, newName: v.newName, status: 'error', error: jiraErrorMessage(err) });
    }
  }

  // Execute filter renames in chain order (leaf to root)
  const filterResults = [];
  for (const f of filterPlan) {
    if (!f.foundOld) {
      filterResults.push({ order: f.order, oldName: f.oldName, newName: f.newName, status: 'missing' });
      continue;
    }
    try {
      await updateFilter(token, f.filterId, { name: f.newName, jql: f.newJql });
      logger.audit.action(actor, 'rename-filter', `${f.oldName}->${f.newName}`, { filterId: f.filterId });
      filterResults.push({ order: f.order, oldName: f.oldName, newName: f.newName, status: 'renamed' });
    } catch (err) {
      filterResults.push({ order: f.order, oldName: f.oldName, newName: f.newName, status: 'error', error: jiraErrorMessage(err) });
    }
  }

  // Update config
  let configResult = { updated: false, oldKey: oldVersion, newKey: newVersion };
  try {
    const config = readReleaseConfig();
    if (!config.releaseBaseFilters || typeof config.releaseBaseFilters !== 'object') {
      config.releaseBaseFilters = {};
    }
    const hadOld = Object.prototype.hasOwnProperty.call(config.releaseBaseFilters, oldVersion);
    if (hadOld) delete config.releaseBaseFilters[oldVersion];
    config.releaseBaseFilters[newVersion] = `filter=${newVersion}-All`;
    writeReleaseConfig(config);
    logger.audit.action(actor, 'rename-release-config', `${oldVersion}->${newVersion}`, { hadOld });
    configResult = { updated: true, oldKey: oldVersion, newKey: newVersion, value: `filter=${newVersion}-All` };
  } catch (err) {
    configResult = { updated: false, oldKey: oldVersion, newKey: newVersion, error: err.message };
  }

  return {
    dryRun: false,
    oldVersion,
    newVersion,
    versions: versionResults,
    filters: filterResults,
    config: configResult,
  };
}

async function cleanupDuplicatePrefixFilters(token, opts) {
  const versions = Array.isArray(opts.versions) ? opts.versions.map(v => String(v || '').trim()).filter(Boolean) : [];
  const dryRun = !!opts.dryRun;
  const actor = opts.actor || 'unknown';

  if (!versions.length) {
    throw new Error('versions[] is required');
  }

  const results = [];

  for (const v of versions) {
    const correctChain = generateFilterChain(v, '');
    const perVersion = { version: v, filters: [], allFilter: null };

    // The 4 "Get..." filters
    for (let i = 0; i < FILTER_SUFFIXES.length; i++) {
      const suffix = FILTER_SUFFIXES[i];
      const badName = `GetNDB${v}${suffix}`;
      const correctName = correctChain[i].name;
      const correctJql = correctChain[i].jql;

      let existingBad = null;
      try {
        existingBad = await findFilterByName(token, badName);
      } catch (err) {
        perVersion.filters.push({ order: i + 1, badName, correctName, status: 'error', error: jiraErrorMessage(err) });
        continue;
      }

      if (!existingBad) {
        perVersion.filters.push({ order: i + 1, badName, correctName, status: 'missing' });
        continue;
      }

      let existingCorrect = null;
      try {
        existingCorrect = await findFilterByName(token, correctName);
      } catch (err) {
        perVersion.filters.push({ order: i + 1, badName, correctName, status: 'error', error: jiraErrorMessage(err) });
        continue;
      }

      if (existingCorrect && existingCorrect.id !== existingBad.id) {
        perVersion.filters.push({
          order: i + 1,
          badName,
          correctName,
          status: 'skipped-conflict',
          conflictWithId: existingCorrect.id,
        });
        continue;
      }

      if (dryRun) {
        perVersion.filters.push({ order: i + 1, badName, correctName, status: 'will-rename', filterId: existingBad.id });
        continue;
      }

      try {
        await updateFilter(token, existingBad.id, { name: correctName, jql: correctJql });
        logger.audit.action(actor, 'cleanup-rename-filter', `${badName}->${correctName}`, { filterId: existingBad.id });
        perVersion.filters.push({ order: i + 1, badName, correctName, status: 'renamed' });
      } catch (err) {
        perVersion.filters.push({ order: i + 1, badName, correctName, status: 'error', error: jiraErrorMessage(err) });
      }
    }

    // The -All filter: patch its JQL if it still references the bad GetNDB<v>... names
    try {
      const allName = `${v}-All`;
      const existingAll = await findFilterByName(token, allName);
      if (existingAll) {
        const stillReferencesBad = typeof existingAll.jql === 'string' && existingAll.jql.includes(`GetNDB${v}`);
        if (stillReferencesBad) {
          if (dryRun) {
            perVersion.allFilter = { name: allName, status: 'will-update-jql', filterId: existingAll.id };
          } else {
            try {
              await updateFilter(token, existingAll.id, { jql: correctChain[4].jql });
              logger.audit.action(actor, 'cleanup-patch-all-jql', allName, { filterId: existingAll.id });
              perVersion.allFilter = { name: allName, status: 'updated' };
            } catch (err) {
              perVersion.allFilter = { name: allName, status: 'error', error: jiraErrorMessage(err) };
            }
          }
        } else {
          perVersion.allFilter = { name: allName, status: 'ok-no-change' };
        }
      } else {
        perVersion.allFilter = { name: allName, status: 'missing' };
      }
    } catch (err) {
      perVersion.allFilter = { name: `${v}-All`, status: 'error', error: jiraErrorMessage(err) };
    }

    results.push(perVersion);
  }

  return { dryRun, results };
}

module.exports = {
  findFilterByName,
  updateFilter,
  findVersionByName,
  updateVersion,
  renameReleaseCascade,
  cleanupDuplicatePrefixFilters,
};
