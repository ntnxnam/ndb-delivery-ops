const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

const dataDir = path.join(__dirname, '../data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'scheduledEmails.json');

function load() {
  try {
    if (fs.existsSync(dbPath)) {
      const content = fs.readFileSync(dbPath, 'utf8');
      const data = JSON.parse(content);
      return Array.isArray(data) ? data : [];
    }
  } catch (error) {
    console.error('[ScheduledEmailsDB] Error loading:', error);
  }
  return [];
}

function save(data) {
  try {
    fs.writeFileSync(dbPath, JSON.stringify(data, null, 2), 'utf8');
  } catch (error) {
    console.error('[ScheduledEmailsDB] Error saving:', error);
    throw error;
  }
}

/**
 * List all scheduled emails, optionally filtered by createdBy
 * @param {{ createdBy?: string }} filters
 * @returns {Promise<Array>}
 */
async function listSchedules(filters = {}) {
  const data = load();
  let list = [...data];
  if (filters.createdBy) {
    const normalized = (filters.createdBy || '').trim().toLowerCase().replace(/@nutanix\.com$/i, '');
    if (normalized) {
      list = list.filter(s => (s.createdBy || '').trim().toLowerCase().replace(/@nutanix\.com$/i, '') === normalized);
    }
  }
  return list.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
}

/**
 * Get a single schedule by id
 * @param {string} id
 * @returns {Promise<object|null>}
 */
async function getScheduleById(id) {
  const data = load();
  return data.find(s => s.id === id) || null;
}

/**
 * Create a new schedule
 * @param {object} schedule
 * @returns {Promise<object>}
 */
async function createSchedule(schedule) {
  const data = load();
  const id = randomUUID();
  const record = {
    id,
    createdBy: schedule.createdBy || 'unknown',
    name: schedule.name || '',
    jql: schedule.jql || '',
    selectedFieldIds: Array.isArray(schedule.selectedFieldIds) ? schedule.selectedFieldIds : [],
    toRecipients: schedule.toRecipients || '',
    includeProjectTeam: Array.isArray(schedule.includeProjectTeam) ? schedule.includeProjectTeam : [],
    selectedCCRecipients: Array.isArray(schedule.selectedCCRecipients) ? schedule.selectedCCRecipients : [],
    subject: schedule.subject || 'NDB Reminder',
    notes: schedule.notes || '',
    schedule: schedule.schedule || { dayOfWeek: 1, hour: 9, minute: 0, timezone: 'America/Los_Angeles' },
    enabled: schedule.enabled !== false,
    lastRun: null,
    createdAt: new Date().toISOString()
  };
  data.push(record);
  save(data);
  return record;
}

/**
 * Update an existing schedule
 * @param {string} id
 * @param {object} updates
 * @returns {Promise<object|null>}
 */
async function updateSchedule(id, updates) {
  const data = load();
  const index = data.findIndex(s => s.id === id);
  if (index === -1) return null;
  const allowed = ['name', 'jql', 'selectedFieldIds', 'toRecipients', 'includeProjectTeam', 'selectedCCRecipients', 'subject', 'notes', 'schedule', 'enabled'];
  allowed.forEach(key => {
    if (updates[key] !== undefined) {
      data[index][key] = updates[key];
    }
  });
  save(data);
  return data[index];
}

/**
 * Update lastRun for a schedule
 * @param {string} id
 * @param {string} lastRunIso
 * @returns {Promise<object|null>}
 */
async function markScheduleRun(id, lastRunIso) {
  const data = load();
  const index = data.findIndex(s => s.id === id);
  if (index === -1) return null;
  data[index].lastRun = lastRunIso;
  save(data);
  return data[index];
}

/**
 * Delete a schedule
 * @param {string} id
 * @returns {Promise<boolean>}
 */
async function deleteSchedule(id) {
  const data = load();
  const len = data.length;
  const next = data.filter(s => s.id !== id);
  if (next.length === len) return false;
  save(next);
  return true;
}

/**
 * Get all enabled schedules (for scheduler)
 * @returns {Promise<Array>}
 */
async function getEnabledSchedules() {
  const data = load();
  return data.filter(s => s.enabled === true);
}

module.exports = {
  listSchedules,
  getScheduleById,
  createSchedule,
  updateSchedule,
  markScheduleRun,
  deleteSchedule,
  getEnabledSchedules
};
