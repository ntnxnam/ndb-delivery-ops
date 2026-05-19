/**
 * POST /api/email/send-generic-reminder
 * Sends Generic Emailer (JQL results as table) email.
 */

const genericEmailerCCConfig = require('../../config/genericEmailerCCConfig.json');
const logger = require('../../utils/logger');
const { emailLimiter } = require('../../middleware/security');
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { requireAuth } = require('../../middleware/authMiddleware');
const { parseEmailRecipients, formatDateForEmail } = require('../../services/emailService');
const { sendGenericReminderEmail } = require('../../services/genericReminderEmailService');
const { saveEmailHistory } = require('../../utils/emailHistoryDB');

function register(router) {
  router.post('/send-generic-reminder', emailLimiter, validateJiraTokenMiddleware, requireAuth('genericEmailer'), async (req, res) => {
    const username = req.username || req.body?.username || req.headers['x-username'] || 'unknown';
    if (!req.jiraUser || (!req.jiraUser.emailAddress && !req.jiraUser.email)) {
      return res.status(400).json({
        success: false,
        error: 'JIRA user email is required. Unable to extract email from JIRA token validation.'
      });
    }
    const userEmail = req.jiraUser.emailAddress || req.jiraUser.email;
    const userIp = req.ip || req.connection?.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';

    try {
      const {
        selectedFieldIdsInOrder,
        issuesPayload,
        toRecipients,
        includeProjectTeam,
        selectedCCRecipients,
        subject: subjectInput,
        fieldLabels = {},
        notes: notesInput,
        isTest
      } = req.body;

      if (!selectedFieldIdsInOrder || !Array.isArray(selectedFieldIdsInOrder) || selectedFieldIdsInOrder.length === 0) {
        return res.status(400).json({ success: false, error: 'selectedFieldIdsInOrder is required and must be a non-empty array' });
      }
      if (!issuesPayload || !Array.isArray(issuesPayload)) {
        return res.status(400).json({ success: false, error: 'issuesPayload is required and must be an array of issues' });
      }

      const projectTeamFieldIds = Array.isArray(includeProjectTeam)
        ? includeProjectTeam
        : (includeProjectTeam === true && genericEmailerCCConfig.projectTeamFields)
          ? (genericEmailerCCConfig.projectTeamFields.map(f => f.id))
          : [];

      const subjectForLog = (subjectInput && String(subjectInput).trim() ? subjectInput : 'NDB Reminder') + ' – ' + formatDateForEmail();
      logger.email.attempt(
        userEmail,
        toRecipients && String(toRecipients).trim() ? parseEmailRecipients(toRecipients) : [userEmail],
        subjectForLog,
        null,
        null,
        { username, ip: userIp, userAgent, type: 'generic-reminder' }
      );

      const result = await sendGenericReminderEmail({
        fromEmail: userEmail,
        fromUsername: req.username,
        selectedFieldIdsInOrder,
        issuesPayload,
        fieldLabels,
        toRecipients,
        includeProjectTeam: projectTeamFieldIds,
        selectedCCRecipients,
        subject: subjectInput,
        notes: notesInput
      });

      logger.email.sent(
        userEmail,
        result.toEmails,
        result.ccList,
        result.subject,
        null,
        null,
        { username, messageId: result.messageId, ip: userIp, userAgent }
      );

      const isTestRecord = isTest === true || (process.env.NODE_ENV === 'development' && (result.subject.toLowerCase().includes('test') || result.subject.toLowerCase().includes('[test]')));
      await saveEmailHistory({
        username,
        userEmail,
        to: result.toEmails,
        cc: result.ccList,
        subject: result.subject,
        jiraKey: null,
        releaseVersions: null,
        messageId: result.messageId,
        type: 'generic-reminder',
        metadata: {
          isTest: isTestRecord,
          ip: userIp,
          userAgent,
          issueCount: Array.isArray(issuesPayload) ? issuesPayload.length : 0,
          columnCount: Array.isArray(selectedFieldIdsInOrder) ? selectedFieldIdsInOrder.length : 0
        }
      });

      return res.json({
        success: true,
        message: 'Email sent successfully',
        messageId: result.messageId
      });
    } catch (error) {
      console.error('[send-generic-reminder] Error:', error);
      const message = error.message || 'Failed to send reminder email';
      return res.status(500).json({
        success: false,
        error: message,
        message
      });
    }
  });
}

module.exports = { register };
