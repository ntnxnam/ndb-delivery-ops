/**
 * Config Admin Service — self-serve JSON config editor
 *
 * Allowlisted config files that super-admins can view and patch via the
 * Admin → Config Manager UI without a backend deploy or git push.
 *
 * Each entry declares:
 *   file        — on-disk JSON path (relative to server/)
 *   label       — human-readable name for the UI picker
 *   description — short help text
 *   group       — grouping for the UI (oncall | cfdcfi | general | jira | email | teams)
 *   schema      — lightweight field metadata so the UI knows how to render controls
 */

const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');

/**
 * Registry of configs that are safe to edit from the UI.
 * Only files listed here are exposed via /api/admin/config/*.
 */
const CONFIG_REGISTRY = {
  oncall: {
    file: 'oncallConfig.json',
    label: 'OnCall Config',
    group: 'oncall',
    description: 'Thresholds, JQL snippets, RAG rules, and team overrides for OnCalls V2.',
    editableKeys: null, // null = all top-level keys are editable (except _* notes)
  },
  cfdcfi: {
    file: 'cfdcfiConfig.json',
    label: 'CFD / CFI Config',
    group: 'cfdcfi',
    description: 'Hero switches, JQL, and display limits for the CFD/CFI pages.',
    editableKeys: null,
  },
  jiraFields: {
    file: 'jiraFieldsConfig.json',
    label: 'JIRA Fields',
    group: 'jira',
    description: 'Custom-field ID mappings (checkpoint dates, people, links, indicators).',
    editableKeys: null,
  },
  kpi: {
    file: 'kpiConfig.json',
    label: 'KPI Config',
    group: 'general',
    description: 'Team-scoped KPI definitions (name, JQL baseQuery, lifecycle phase).',
    editableKeys: null,
  },
  teamBoard: {
    file: 'teamBoardConfig.json',
    label: 'Team Board Config',
    group: 'teams',
    description: 'Team registry, board IDs, sprint field, and base filters.',
    editableKeys: null,
  },
  jira: {
    file: 'jiraConfig.json',
    label: 'JIRA Connection',
    group: 'jira',
    description: 'JIRA base URL (token is env-only and never exposed here).',
    editableKeys: ['baseUrl', 'description'],
  },
  email: {
    file: 'emailConfig.json',
    label: 'Email Config',
    group: 'email',
    description: 'SMTP and default email settings.',
    editableKeys: null,
  },
  releaseOutstandingWork: {
    file: 'releaseOutstandingWorkConfig.json',
    label: 'Release Outstanding Work',
    group: 'general',
    description: 'Deferral workflow thresholds and labels.',
    editableKeys: null,
  },
  dependencyView: {
    file: 'dependencyViewConfig.json',
    label: 'Dependency View',
    group: 'general',
    description: 'Post-EC dependency view settings.',
    editableKeys: null,
  },
  sprintPerformance: {
    file: 'sprintPerformanceConfig.json',
    label: 'Sprint Performance',
    group: 'general',
    description: 'Sprint performance thresholds and display options.',
    editableKeys: null,
  },
};

/**
 * List all registered configs with current on-disk existence.
 */
function listConfigs() {
  return Object.entries(CONFIG_REGISTRY).map(([key, meta]) => {
    const absPath = path.join(CONFIG_DIR, meta.file);
    let exists = false;
    let lastModified = null;
    try {
      const stat = fs.statSync(absPath);
      exists = true;
      lastModified = stat.mtime.toISOString();
    } catch {
      exists = false;
    }
    return {
      key,
      file: meta.file,
      label: meta.label,
      group: meta.group,
      description: meta.description,
      exists,
      lastModified,
    };
  });
}

/**
 * Read and parse a registered config file.
 * @param {string} configKey - registry key
 * @returns {{ key, file, label, data }}
 */
function getConfig(configKey) {
  const meta = CONFIG_REGISTRY[configKey];
  if (!meta) {
    const err = new Error(`Unknown config key: ${configKey}`);
    err.statusCode = 404;
    throw err;
  }
  const absPath = path.join(CONFIG_DIR, meta.file);
  let raw;
  try {
    raw = fs.readFileSync(absPath, 'utf8');
  } catch (e) {
    const err = new Error(`Config file not found: ${meta.file}`);
    err.statusCode = 404;
    throw err;
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    const err = new Error(`Invalid JSON in ${meta.file}: ${e.message}`);
    err.statusCode = 500;
    throw err;
  }
  // Bust require cache so subsequent require() calls see fresh data
  try {
    delete require.cache[require.resolve(absPath)];
  } catch {}
  return { key: configKey, file: meta.file, label: meta.label, group: meta.group, description: meta.description, data };
}

/**
 * Validate that a candidate JSON value is safe to persist.
 * - Must be a plain JSON value (no functions, no circular refs — JSON.stringify already handles this)
 * - Top-level must be an object
 * - No __proto__ / constructor injection
 */
function assertSafePayload(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    const err = new Error('Config payload must be a JSON object (top-level).');
    err.statusCode = 400;
    throw err;
  }
  const serialized = JSON.stringify(value);
  if (serialized.includes('__proto__') || serialized.includes('constructor')) {
    const err = new Error('Payload contains forbidden keys.');
    err.statusCode = 400;
    throw err;
  }
  // Size guard: 500KB max
  if (Buffer.byteLength(serialized, 'utf8') > 500 * 1024) {
    const err = new Error('Config payload too large (max 500KB).');
    err.statusCode = 400;
    throw err;
  }
}

/**
 * Persist a full config object (replaces file contents).
 * Creates a .bak alongside the file before overwriting.
 * @param {string} configKey
 * @param {object} newData - full replacement object
 * @returns {{ key, file, label, data }}
 */
function saveConfig(configKey, newData) {
  const meta = CONFIG_REGISTRY[configKey];
  if (!meta) {
    const err = new Error(`Unknown config key: ${configKey}`);
    err.statusCode = 404;
    throw err;
  }
  assertSafePayload(newData);

  // If editableKeys is restricted, merge only allowed keys
  if (Array.isArray(meta.editableKeys)) {
    const current = getConfig(configKey).data;
    const merged = { ...current };
    for (const k of meta.editableKeys) {
      if (Object.prototype.hasOwnProperty.call(newData, k)) {
        merged[k] = newData[k];
      }
    }
    newData = merged;
  }

  const absPath = path.join(CONFIG_DIR, meta.file);
  // Backup
  try {
    if (fs.existsSync(absPath)) {
      fs.copyFileSync(absPath, `${absPath}.bak`);
    }
  } catch {}

  fs.writeFileSync(absPath, JSON.stringify(newData, null, 2) + '\n', 'utf8');

  // Bust require cache
  try {
    delete require.cache[require.resolve(absPath)];
  } catch {}

  return { key: configKey, file: meta.file, label: meta.label, data: newData };
}

/**
 * Patch a single dotted path within a config.
 * e.g. patchField('oncall', 'rag.redOpenP0', 2)
 * Supports creating new keys (add field flow) and updating existing ones.
 * @param {string} configKey
 * @param {string} fieldPath - dot-notation path
 * @param {*} value - new value (any JSON-serializable)
 * @returns {{ key, file, label, data }}
 */
function patchField(configKey, fieldPath, value) {
  if (!fieldPath || typeof fieldPath !== 'string') {
    const err = new Error('fieldPath is required (dot-notation, e.g. "rag.redOpenP0").');
    err.statusCode = 400;
    throw err;
  }
  // Prevent prototype pollution
  if (fieldPath.includes('__proto__') || fieldPath.includes('constructor') || fieldPath.includes('prototype')) {
    const err = new Error('Forbidden field path.');
    err.statusCode = 400;
    throw err;
  }

  const { data } = getConfig(configKey);
  const parts = fieldPath.split('.').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) {
    const err = new Error('Invalid fieldPath.');
    err.statusCode = 400;
    throw err;
  }

  let cursor = data;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const seg = parts[i];
    if (cursor[seg] === undefined || cursor[seg] === null) {
      cursor[seg] = {};
    } else if (typeof cursor[seg] !== 'object' || Array.isArray(cursor[seg])) {
      const err = new Error(`Cannot traverse into non-object at "${parts.slice(0, i + 1).join('.')}".`);
      err.statusCode = 400;
      throw err;
    }
    cursor = cursor[seg];
  }
  cursor[parts[parts.length - 1]] = value;

  return saveConfig(configKey, data);
}

/**
 * Delete a dotted field path.
 * @param {string} configKey
 * @param {string} fieldPath
 * @returns {{ key, file, label, data }}
 */
function deleteField(configKey, fieldPath) {
  if (!fieldPath || typeof fieldPath !== 'string') {
    const err = new Error('fieldPath is required.');
    err.statusCode = 400;
    throw err;
  }
  if (fieldPath.includes('__proto__') || fieldPath.includes('constructor')) {
    const err = new Error('Forbidden field path.');
    err.statusCode = 400;
    throw err;
  }
  const { data } = getConfig(configKey);
  const parts = fieldPath.split('.').map((p) => p.trim()).filter(Boolean);
  let cursor = data;
  for (let i = 0; i < parts.length - 1; i += 1) {
    if (cursor[parts[i]] == null || typeof cursor[parts[i]] !== 'object') {
      // Path doesn't exist — nothing to delete
      return { key: configKey, file: CONFIG_REGISTRY[configKey].file, label: CONFIG_REGISTRY[configKey].label, data };
    }
    cursor = cursor[parts[i]];
  }
  delete cursor[parts[parts.length - 1]];
  return saveConfig(configKey, data);
}

module.exports = {
  CONFIG_REGISTRY,
  listConfigs,
  getConfig,
  saveConfig,
  patchField,
  deleteField,
};
