/**
 * POST /api/email/send-release-versions
 * Sends Release Versions consolidated email with table, notes, Gantt, legend.
 */

const allowedUsersConfig = require('../../config/allowedUsers.json');
const releaseVersionsCCConfig = require('../../config/releaseVersionsCCConfig.json');
const logger = require('../../utils/logger');
const { emailLimiter } = require('../../middleware/security');
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { checkReleaseVersionsAuthorization } = require('./middleware');
const { sendEmailDirect, wrapReleaseVersionsEmailHTML, parseEmailRecipients, formatDateForEmail } = require('../../services/emailService');
const { normalizeToUsername, usernameToEmail } = require('../../services/userService');
const { saveEmailHistory } = require('../../utils/emailHistoryDB');

function register(router) {
  router.post(
    '/send-release-versions',
    emailLimiter,
    validateJiraTokenMiddleware,
    checkReleaseVersionsAuthorization,
    async (req, res) => {
      const username = req.username || normalizeToUsername(req.userEmail) || 'unknown';

      if (!req.jiraUser || (!req.jiraUser.emailAddress && !req.jiraUser.email)) {
        return res.status(400).json({
          success: false,
          error: 'JIRA user email is required. Unable to extract email from JIRA token validation.'
        });
      }

      const userEmail = req.jiraUser.emailAddress || req.jiraUser.email;
      const userIp = req.ip || req.connection?.remoteAddress || 'unknown';
      const userAgent = req.headers['user-agent'] || 'unknown';

      const emailAccess = (process.env.RELEASE_VERSIONS_EMAIL_ACCESS || 'allowlist').toLowerCase().trim();
      if (emailAccess === 'none') {
        return res.status(403).json({ success: false, error: 'Release Versions email sending is currently disabled.' });
      }
      if (emailAccess !== 'all') {
        const emailSenders = (allowedUsersConfig.releaseVersionsEmailSenders || []).map(u => normalizeToUsername(u));
        if (emailSenders.length > 0 && !emailSenders.includes(normalizeToUsername(username))) {
          return res.status(403).json({
            success: false,
            error: 'You are not allowed to send release versions emails.'
          });
        }
      }

      try {
        const previewOnly = !!req.body.previewOnly;
        const { selectedVersion, tableHTML, lowlights, highlights, callToAction, emailRecipients, ganttConfig, items, ganttChartImageData } = req.body;

        if (!selectedVersion) {
          return res.status(400).json({ success: false, error: 'No version selected' });
        }
        if (!tableHTML || !tableHTML.trim()) {
          return res.status(400).json({ success: false, error: 'No table HTML provided' });
        }

        if (previewOnly) {
          const { JIRA_BASE_URL } = require('../../config/api');
          const releaseVersionsHtml = wrapReleaseVersionsEmailHTML(
            selectedVersion,
            tableHTML,
            lowlights || '',
            highlights || '',
            callToAction || '',
            ganttConfig || null,
            items || null,
            JIRA_BASE_URL,
            ganttChartImageData || null
          );
          const emailHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"></head><body><div class="email-container">${releaseVersionsHtml}</div></body></html>`;
          const dateStr = formatDateForEmail();
          const toEmails = parseEmailRecipients(emailRecipients);
          const recipientEmail = usernameToEmail(req.username || userEmail);
          // Always include the sender in the To list.
          if (recipientEmail && !toEmails.includes(recipientEmail)) {
            toEmails.push(recipientEmail);
          }
          const toEmailList = toEmails.length > 0 ? toEmails.join(', ') : recipientEmail;
          const ccEmails = new Set(releaseVersionsCCConfig.defaultCC || []);
          if (selectedVersion && releaseVersionsCCConfig.versionDRIs && releaseVersionsCCConfig.versionDRIs[selectedVersion]) {
            (releaseVersionsCCConfig.versionDRIs[selectedVersion] || []).forEach(dri => {
              const driEmail = usernameToEmail(dri);
              if (driEmail) ccEmails.add(driEmail);
            });
          }
          ccEmails.add(recipientEmail);
          const subject = `NDB Consolidated Status Summary (Weekly) - ${dateStr}`;
          const stripHtml = (html) => (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
          return res.json({
            success: true,
            to: toEmailList,
            cc: Array.from(ccEmails).join(', '),
            subject,
            htmlBody: emailHtml,
            textBody: stripHtml(emailHtml)
          });
        }

        logger.audit.action(username, 'RELEASE_VERSIONS_EMAIL_SEND_ATTEMPT', `Version: ${selectedVersion}`, {
          selectedVersion,
          userEmail,
          ip: userIp,
          userAgent
        });

        const { JIRA_BASE_URL } = require('../../config/api');

        const releaseVersionsHtml = wrapReleaseVersionsEmailHTML(
          selectedVersion,
          tableHTML,
          lowlights || '',
          highlights || '',
          callToAction || '',
          ganttConfig || null,
          items || null,
          JIRA_BASE_URL,
          ganttChartImageData || null
        );

        const emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; font-size: 0.9375rem; line-height: 1.5; color: #1a1a1a; margin: 0; padding: 0; background-color: #ffffff; }
            .email-container { width: 100%; max-width: 100%; margin: 0; background-color: #ffffff; padding: 2rem; border: 1px solid #1a1a1a; box-sizing: border-box; }
            h2 { font-size: 1rem; font-weight: 600; color: #1a1a1a; border-bottom: 1px solid #1a1a1a; padding-bottom: 0.5rem; margin-top: 2rem; margin-bottom: 1rem; }
            h3 { font-size: 0.9375rem; font-weight: 600; color: #1a1a1a; margin-top: 1.5rem; margin-bottom: 0.75rem; }
            p { font-size: 0.9375rem; color: #1a1a1a; margin-bottom: 1rem; }
            .footer { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #1a1a1a; font-size: 0.6875rem; color: #666; text-align: center; }
            table { width: 100%; max-width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; table-layout: auto; border: 1px solid #1a1a1a; }
            th, td { padding: 0.5rem; border: 1px solid #1a1a1a; vertical-align: top; word-wrap: break-word; font-size: 0.9375rem; }
            th { background-color: #ffffff; font-weight: 600; text-align: left; color: #1a1a1a; }
            td { text-align: left; color: #1a1a1a; }
            a { color: #0065ff; text-decoration: none; }
            a:hover { text-decoration: underline; }
          </style>
        </head>
        <body>
          <div class="email-container">
            ${releaseVersionsHtml}
            <div class="footer"><p>This is an automated status update email.</p></div>
          </div>
        </body>
      </html>
    `;

        const dateStr = formatDateForEmail();
        const toEmails = parseEmailRecipients(emailRecipients);
        const recipientEmail = usernameToEmail(req.username || userEmail);
        // Always include the sender in the To list.
        if (recipientEmail && !toEmails.includes(recipientEmail)) {
          toEmails.push(recipientEmail);
        }
        const toEmailList = toEmails.length > 0 ? toEmails.join(', ') : recipientEmail;

        const ccEmails = new Set(releaseVersionsCCConfig.defaultCC || []);
        if (selectedVersion && releaseVersionsCCConfig.versionDRIs && releaseVersionsCCConfig.versionDRIs[selectedVersion]) {
          (releaseVersionsCCConfig.versionDRIs[selectedVersion] || []).forEach(dri => {
            const driEmail = usernameToEmail(dri);
            if (driEmail) ccEmails.add(driEmail);
          });
        }
        ccEmails.add(recipientEmail);

        const mailOptions = {
          replyTo: userEmail,
          to: toEmailList,
          cc: Array.from(ccEmails).join(', '),
          subject: `NDB Consolidated Status Summary (Weekly) - ${dateStr}`,
          html: emailHtml
        };

        logger.email.attempt(
          userEmail,
          toEmails.length > 0 ? toEmails : [recipientEmail],
          mailOptions.subject,
          null,
          [selectedVersion],
          { username, cc: Array.from(ccEmails), contentSize: emailHtml.length, tableHtmlSize: tableHTML.length, hasNotes: !!(lowlights || highlights || callToAction), ip: userIp, userAgent }
        );

        const info = await sendEmailDirect(mailOptions);

        logger.email.sent(
          userEmail,
          toEmails.length > 0 ? toEmails : [recipientEmail],
          Array.from(ccEmails),
          mailOptions.subject,
          null,
          [selectedVersion],
          { username, messageId: info.messageId, contentSize: emailHtml.length, tableHtmlSize: tableHTML.length, hasNotes: !!(lowlights || highlights || callToAction), ip: userIp, userAgent }
        );

        try {
          const isTest = req.body.isTest || req.query.isTest === 'true' ||
            (process.env.NODE_ENV === 'development' &&
              (mailOptions.subject?.toLowerCase().includes('test') || mailOptions.subject?.toLowerCase().includes('[test]')));
          await saveEmailHistory({
            username,
            userEmail,
            to: toEmails.length > 0 ? toEmails : [recipientEmail],
            cc: Array.from(ccEmails),
            subject: mailOptions.subject,
            jiraKey: null,
            releaseVersions: [selectedVersion],
            messageId: info.messageId,
            metadata: { contentSize: emailHtml.length, tableHtmlSize: tableHTML.length, hasNotes: !!(lowlights || highlights || callToAction), ip: userIp, userAgent, isTest }
          });
        } catch (dbError) {
          console.error('[Email History DB] Failed to save email history:', dbError);
        }

        return res.json({ success: true, message: 'Email sent successfully', messageId: info.messageId });
      } catch (error) {
        const toEmails = req.body?.emailRecipients ? req.body.emailRecipients.split(',').map(r => r.trim()).filter(Boolean) : [];
        logger.email.failed(
          req.userEmail || 'unknown',
          toEmails.length > 0 ? toEmails : [usernameToEmail(username)],
          `NDB Consolidated Status Summary (Weekly) - ${new Date().toLocaleDateString()}`,
          error,
          null,
          [req.body?.selectedVersion || 'unknown'],
          { username, ip: userIp, userAgent, errorCode: error.code, errorResponseCode: error.responseCode }
        );
        return res.status(500).json({
          success: false,
          error: error.response?.data?.error || error.message || 'Failed to send email',
          message: error.message
        });
      }
    }
  );
}

module.exports = { register };
