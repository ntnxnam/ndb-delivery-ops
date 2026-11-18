/**
 * Email history: GET/DELETE /api/email/history, DELETE /api/email/history/:id, DELETE /api/email/history/test/all
 */

const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { checkEmailHistoryAuthorization } = require('./middleware');
const { getEmailHistory, getEmailStatistics, deleteEmailHistory, deleteEmailById, deleteTestEmails } = require('../../utils/emailHistoryDB');

function register(router) {
  router.get('/history', validateJiraTokenMiddleware, checkEmailHistoryAuthorization, async (req, res) => {
    try {
      const { username, jiraKey, releaseVersion, limit, offset } = req.query;
      const history = await getEmailHistory({
        username,
        jiraKey,
        releaseVersion,
        limit: limit ? parseInt(limit) : 100,
        offset: offset ? parseInt(offset) : 0
      });
      const stats = await getEmailStatistics();
      return res.json({ success: true, history, statistics: stats });
    } catch (error) {
      console.error('[Email History] Error fetching history:', error);
      return res.status(500).json({ success: false, error: 'Failed to fetch email history' });
    }
  });

  router.delete('/history', validateJiraTokenMiddleware, checkEmailHistoryAuthorization, async (req, res) => {
    try {
      const { username, jiraKey, releaseVersion, beforeDate, afterDate, testOnly } = req.body;
      const filters = {};
      if (username) filters.username = username;
      if (jiraKey) filters.jiraKey = jiraKey;
      if (releaseVersion) filters.releaseVersion = releaseVersion;
      if (beforeDate) filters.beforeDate = new Date(beforeDate);
      if (afterDate) filters.afterDate = new Date(afterDate);
      if (testOnly) filters.testOnly = true;
      const deletedCount = await deleteEmailHistory(filters);
      return res.json({ success: true, message: `Deleted ${deletedCount} email record(s)`, deletedCount });
    } catch (error) {
      console.error('[Email History] Error deleting history:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete email history' });
    }
  });

  router.delete('/history/:id', validateJiraTokenMiddleware, checkEmailHistoryAuthorization, async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await deleteEmailById(id);
      if (deleted) {
        return res.json({ success: true, message: 'Email record deleted' });
      }
      return res.status(404).json({ success: false, error: 'Email record not found' });
    } catch (error) {
      console.error('[Email History] Error deleting email:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete email record' });
    }
  });

  router.delete('/history/test/all', validateJiraTokenMiddleware, checkEmailHistoryAuthorization, async (req, res) => {
    try {
      const deletedCount = await deleteTestEmails();
      return res.json({ success: true, message: `Deleted ${deletedCount} test email record(s)`, deletedCount });
    } catch (error) {
      console.error('[Email History] Error deleting test emails:', error);
      return res.status(500).json({ success: false, error: 'Failed to delete test emails' });
    }
  });
}

module.exports = { register };
