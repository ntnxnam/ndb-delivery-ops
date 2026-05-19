/**
 * JIRA Fields Config Utility
 * 
 * Provides utilities to access JIRA custom field configuration from jiraFieldsConfig.json
 * This is the single source of truth for all JIRA field mappings.
 */

const fs = require('fs');
const path = require('path');

// Load config file
const configPath = path.join(__dirname, '../config/jiraFieldsConfig.json');
let fieldsConfig = null;

/**
 * Load and cache the JIRA fields config
 * @returns {Object} The fields configuration object
 */
function loadConfig() {
  if (fieldsConfig) {
    return fieldsConfig;
  }
  
  try {
    const configData = fs.readFileSync(configPath, 'utf8');
    fieldsConfig = JSON.parse(configData);
    return fieldsConfig;
  } catch (error) {
    console.error('Error loading JIRA fields config:', error);
    throw new Error(`Failed to load JIRA fields config from ${configPath}: ${error.message}`);
  }
}

/**
 * Get the full config object
 * @returns {Object} Complete fields configuration
 */
function getConfig() {
  return loadConfig();
}

/**
 * Get all fields flattened by logical key
 * @returns {Object} Object with logical keys (e.g., 'codeComplete') mapping to field config
 */
function getAllFields() {
  const config = loadConfig();
  const allFields = {};
  
  // Flatten fields from all categories
  Object.keys(config.fields).forEach(category => {
    Object.keys(config.fields[category]).forEach(fieldKey => {
      allFields[fieldKey] = {
        ...config.fields[category][fieldKey],
        category: category
      };
    });
  });
  
  return allFields;
}

/**
 * Get field ID by logical key
 * @param {string} fieldKey - Logical field key (e.g., 'codeComplete', 'commitGate')
 * @returns {string|null} JIRA custom field ID (e.g., 'customfield_11067') or null if not found
 */
function getFieldId(fieldKey) {
  const allFields = getAllFields();
  return allFields[fieldKey]?.id || null;
}

/**
 * Get field config by logical key
 * @param {string} fieldKey - Logical field key
 * @returns {Object|null} Field configuration object or null if not found
 */
function getFieldConfig(fieldKey) {
  const allFields = getAllFields();
  return allFields[fieldKey] || null;
}

/**
 * Get field config by JIRA field ID
 * @param {string} fieldId - JIRA custom field ID (e.g., 'customfield_11067')
 * @returns {Object|null} Field configuration object or null if not found
 */
function getFieldConfigById(fieldId) {
  const allFields = getAllFields();
  for (const [key, config] of Object.entries(allFields)) {
    if (config.id === fieldId) {
      return { ...config, logicalKey: key };
    }
  }
  return null;
}

/**
 * Get all field IDs for a specific category
 * @param {string} category - Category name (e.g., 'checkpointDates', 'people')
 * @returns {Array<string>} Array of JIRA field IDs
 */
function getFieldIdsByCategory(category) {
  const config = loadConfig();
  const categoryFields = config.fields[category] || {};
  return Object.values(categoryFields).map(field => field.id);
}

/**
 * Get all checkpoint date field IDs
 * @returns {Array<string>} Array of checkpoint date field IDs
 */
function getCheckpointDateFieldIds() {
  return getFieldIdsByCategory('checkpointDates');
}

/**
 * Get field name mapping for changelog parsing
 * @param {string} displayName - Field display name from JIRA
 * @returns {string|null} Logical field key or null if not found
 */
function getFieldKeyByName(displayName) {
  const config = loadConfig();
  const normalizedName = displayName.toLowerCase().trim();
  return config.fieldNameMappings[normalizedName] || null;
}

/**
 * Get all fields used in a specific context
 * @param {string} context - Context name (e.g., 'gantt', 'table', 'history', 'email')
 * @returns {Array<Object>} Array of field config objects used in that context
 */
function getFieldsByContext(context) {
  const allFields = getAllFields();
  return Object.entries(allFields)
    .filter(([key, config]) => config.usedIn && config.usedIn.includes(context))
    .map(([key, config]) => ({ ...config, logicalKey: key }));
}

/**
 * Get field value from a JIRA issue object using logical key
 * @param {Object} issueFields - JIRA issue fields object
 * @param {string} fieldKey - Logical field key (e.g., 'codeComplete')
 * @returns {*} Field value or null if not found
 */
function getFieldValue(issueFields, fieldKey) {
  const fieldId = getFieldId(fieldKey);
  if (!fieldId || !issueFields) {
    return null;
  }
  return issueFields[fieldId] || null;
}

/**
 * Build a comma-separated list of field IDs for JIRA API requests
 * @param {Array<string>} fieldKeys - Array of logical field keys
 * @returns {string} Comma-separated field IDs
 */
function buildFieldIdsString(fieldKeys) {
  const fieldIds = fieldKeys
    .map(key => getFieldId(key))
    .filter(id => id !== null);
  return fieldIds.join(',');
}

/**
 * Get all field IDs needed for a specific context
 * @param {string} context - Context name (e.g., 'gantt', 'table', 'history', 'email')
 * @returns {string} Comma-separated field IDs for JIRA API
 */
function getFieldIdsForContext(context) {
  const fields = getFieldsByContext(context);
  const fieldIds = fields.map(f => f.id).filter(id => id);
  return fieldIds.join(',');
}

/**
 * Clear the cached config (useful for testing or hot-reloading)
 */
function clearCache() {
  fieldsConfig = null;
}

module.exports = {
  loadConfig,
  getConfig,
  getAllFields,
  getFieldId,
  getFieldConfig,
  getFieldConfigById,
  getFieldIdsByCategory,
  getCheckpointDateFieldIds,
  getFieldKeyByName,
  getFieldsByContext,
  getFieldValue,
  buildFieldIdsString,
  getFieldIdsForContext,
  clearCache
};

