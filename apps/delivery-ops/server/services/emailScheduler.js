/**
 * Runs scheduled Generic Emailer jobs. Checks every minute; when a schedule's day/time matches (in its timezone), runs JQL and sends email.
 * Requires env: JIRA_SCHEDULED_EMAIL_TOKEN, JIRA_SCHEDULED_EMAIL_USER (optional; used as fromEmail if set)
 */
const cron = require('node-cron');
const { getEnabledSchedules, markScheduleRun } = require('../utils/scheduledEmailsDB');
const { runSearchByJql } = require('../utils/jiraSearchByJql');
const { sendGenericReminderEmail } = require('./genericReminderEmailService');
const { usernameToEmail } = require('./userService');
const logger = require('../utils/logger');

const JIRA_TOKEN = process.env.JIRA_SCHEDULED_EMAIL_TOKEN;
const JIRA_USER = process.env.JIRA_SCHEDULED_EMAIL_USER || '';

/**
 * Get current hour and minute and day of week in a given timezone (e.g. 'America/Los_Angeles').
 * Uses Intl to format; day 0 = Sunday, 1 = Monday, ... 6 = Saturday.
 */
function getNowInTimezone(timezone) {
  const tz = timezone || 'America/Los_Angeles';
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
    weekday: 'short'
  });
  const parts = formatter.formatToParts(now);
  let hour = 0;
  let minute = 0;
  let weekday = 0; // 0 Sun .. 6 Sat
  parts.forEach(p => {
    if (p.type === 'hour') hour = parseInt(p.value, 10);
    if (p.type === 'minute') minute = parseInt(p.value, 10);
    if (p.type === 'weekday') {
      const w = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[p.value];
      if (w !== undefined) weekday = w;
    }
  });
  return { hour, minute, dayOfWeek: weekday };
}

/**
 * Check if a schedule should run at the given "now" (in schedule's timezone).
 * schedule.schedule: { dayOfWeek: 0-6 (0=Sun), hour: 0-23, minute: 0-59, timezone }
 */
function isScheduleDue(schedule, nowInTz) {
  const s = schedule.schedule || {};
  const day = s.dayOfWeek != null ? Number(s.dayOfWeek) : 1;
  const hour = s.hour != null ? Number(s.hour) : 9;
  const minute = s.minute != null ? Number(s.minute) : 0;
  return nowInTz.dayOfWeek === day && nowInTz.hour === hour && nowInTz.minute === minute;
}

/**
 * Run a single schedule: fetch JIRA, send email, mark lastRun.
 */
async function runSchedule(schedule) {
  const token = JIRA_TOKEN;
  if (!token || !token.trim()) {
    console.warn('[emailScheduler] JIRA_SCHEDULED_EMAIL_TOKEN not set; skipping scheduled send');
    return;
  }
  const jql = (schedule.jql || '').trim();
  if (!jql) {
    console.warn('[emailScheduler] Schedule', schedule.id, 'has no JQL; skipping');
    return;
  }
  const selectedFieldIds = Array.isArray(schedule.selectedFieldIds) && schedule.selectedFieldIds.length > 0
    ? schedule.selectedFieldIds
    : ['key', 'summary', 'assignee', 'priority'];
  let issues;
  let fieldsWithData;
  try {
    const result = await runSearchByJql(token, jql, 500);
    issues = result.issues || [];
    fieldsWithData = result.fieldsWithData || [];
  } catch (err) {
    console.error('[emailScheduler] JQL search failed for schedule', schedule.id, err.message);
    return;
  }
  const fieldLabels = {};
  fieldsWithData.forEach(f => { fieldLabels[f.id] = f.label || f.id; });
  const fromUsername = (schedule.createdBy || JIRA_USER || '').trim().toLowerCase().replace(/@nutanix\.com$/i, '') || 'scheduler';
  const fromEmail = usernameToEmail(fromUsername) || (JIRA_USER && JIRA_USER.includes('@') ? JIRA_USER : `${fromUsername}@nutanix.com`);
  try {
    const result = await sendGenericReminderEmail({
      fromEmail,
      fromUsername,
      selectedFieldIdsInOrder: selectedFieldIds,
      issuesPayload: issues,
      fieldLabels,
      toRecipients: schedule.toRecipients || '',
      includeProjectTeam: schedule.includeProjectTeam || [],
      selectedCCRecipients: schedule.selectedCCRecipients || [],
      subject: schedule.subject || 'NDB Reminder',
      notes: schedule.notes || ''
    });
    await markScheduleRun(schedule.id, new Date().toISOString());
    console.log('[emailScheduler] Sent schedule', schedule.id, schedule.name || schedule.jql?.slice(0, 30), 'messageId', result.messageId);
  } catch (err) {
    console.error('[emailScheduler] Send failed for schedule', schedule.id, err.message);
  }
}

/**
 * Tick: load enabled schedules, for each one check if due in its timezone and run.
 */
async function tick() {
  const schedules = await getEnabledSchedules();
  for (const schedule of schedules) {
    const tz = (schedule.schedule && schedule.schedule.timezone) || 'America/Los_Angeles';
    const now = getNowInTimezone(tz);
    if (isScheduleDue(schedule, now)) {
      await runSchedule(schedule);
    }
  }
}

let cronJob = null;

function start() {
  if (cronJob) return;
  cronJob = cron.schedule('* * * * *', () => {
    tick().catch(err => console.error('[emailScheduler] tick error', err));
  }, { timezone: 'UTC' });
  console.log('[emailScheduler] Started (runs every minute)');
}

function stop() {
  if (cronJob) {
    cronJob.stop();
    cronJob = null;
    console.log('[emailScheduler] Stopped');
  }
}

module.exports = { start, stop, tick, getNowInTimezone, isScheduleDue };
