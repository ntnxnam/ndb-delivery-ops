/**
 * Email schedule CRUD: GET/POST /api/email/schedules, PUT/DELETE /api/email/schedules/:id
 */

const { emailLimiter } = require('../../middleware/security');
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { listSchedules, getScheduleById, createSchedule, updateSchedule, deleteSchedule } = require('../../utils/scheduledEmailsDB');

function register(router) {
  router.get('/schedules', emailLimiter, validateJiraTokenMiddleware, async (req, res) => {
    try {
      const username = req.username || req.headers['x-username'] || req.headers['x-user-email'] || '';
      const schedules = await listSchedules({ createdBy: username });
      return res.json({ success: true, schedules });
    } catch (err) {
      console.error('[GET /api/email/schedules]', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to list schedules' });
    }
  });

  router.post('/schedules', emailLimiter, validateJiraTokenMiddleware, async (req, res) => {
    try {
      const username = req.username || req.headers['x-username'] || req.headers['x-user-email'] || 'unknown';
      const { name, jql, selectedFieldIds, toRecipients, includeProjectTeam, selectedCCRecipients, subject, notes, schedule, enabled } = req.body;
      if (!jql || typeof jql !== 'string' || !jql.trim()) {
        return res.status(400).json({ success: false, error: 'jql is required' });
      }
      const scheduleRecord = await createSchedule({
        createdBy: username,
        name: name || '',
        jql: jql.trim(),
        selectedFieldIds: Array.isArray(selectedFieldIds) ? selectedFieldIds : [],
        toRecipients: toRecipients || '',
        includeProjectTeam: Array.isArray(includeProjectTeam) ? includeProjectTeam : [],
        selectedCCRecipients: Array.isArray(selectedCCRecipients) ? selectedCCRecipients : [],
        subject: subject || 'NDB Reminder',
        notes: notes || '',
        schedule: schedule || { dayOfWeek: 1, hour: 9, minute: 0, timezone: 'America/Los_Angeles' },
        enabled: enabled !== false
      });
      return res.json({ success: true, schedule: scheduleRecord });
    } catch (err) {
      console.error('[POST /api/email/schedules]', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to create schedule' });
    }
  });

  router.put('/schedules/:id', emailLimiter, validateJiraTokenMiddleware, async (req, res) => {
    try {
      const username = (req.username || req.headers['x-username'] || req.headers['x-user-email'] || '').trim().toLowerCase().replace(/@nutanix\.com$/i, '');
      const schedule = await getScheduleById(req.params.id);
      if (!schedule) return res.status(404).json({ success: false, error: 'Schedule not found' });
      const owner = (schedule.createdBy || '').trim().toLowerCase().replace(/@nutanix\.com$/i, '');
      if (owner && username && owner !== username) {
        return res.status(403).json({ success: false, error: 'Not allowed to update this schedule' });
      }
      const updated = await updateSchedule(req.params.id, req.body);
      return res.json({ success: true, schedule: updated });
    } catch (err) {
      console.error('[PUT /api/email/schedules/:id]', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to update schedule' });
    }
  });

  router.delete('/schedules/:id', emailLimiter, validateJiraTokenMiddleware, async (req, res) => {
    try {
      const username = (req.username || req.headers['x-username'] || req.headers['x-user-email'] || '').trim().toLowerCase().replace(/@nutanix\.com$/i, '');
      const schedule = await getScheduleById(req.params.id);
      if (!schedule) return res.status(404).json({ success: false, error: 'Schedule not found' });
      const owner = (schedule.createdBy || '').trim().toLowerCase().replace(/@nutanix\.com$/i, '');
      if (owner && username && owner !== username) {
        return res.status(403).json({ success: false, error: 'Not allowed to delete this schedule' });
      }
      await deleteSchedule(req.params.id);
      return res.json({ success: true, message: 'Schedule deleted' });
    } catch (err) {
      console.error('[DELETE /api/email/schedules/:id]', err);
      return res.status(500).json({ success: false, error: err.message || 'Failed to delete schedule' });
    }
  });
}

module.exports = { register };
