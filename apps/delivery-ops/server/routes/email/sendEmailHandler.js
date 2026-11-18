/**
 * POST /api/email/send — thin orchestrator.
 * Auth: validateJiraTokenMiddleware on route (required).
 */
const { sendEmailDirect } = require('../../services/emailService');
const {
  validateHighlights,
  buildMailOptions,
  persistHistory,
  parseEmailRecipients,
  logger,
} = require('../../services/statusEmailSendService');

function clientSafeSendError(error) {
  const code = error?.code || error?.responseCode;
  if (code === 'EENVELOPE' || code === 'EMESSAGE') {
    return 'Email rejected by mail server. Check recipients and try again.';
  }
  if (typeof error?.message === 'string' && /relay access denied|554\s*5\.7\.1/i.test(error.message)) {
    return 'Mail relay rejected the send. Contact ops if this persists.';
  }
  return 'Failed to send email. Please try again.';
}

module.exports = async function sendEmailHandler(req, res) {
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
    const body = req.body || {};
    const validationError = validateHighlights(body.additionalDetails);
    if (validationError) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const isTestMode = body.isTest === true || req.query.isTest === 'true' || process.env.EMAIL_DRY_RUN === 'true';
    const { mailOptions, toList, ccEmails, emailHtml, subject } = buildMailOptions({
      additionalDetails: body.additionalDetails,
      aiSummary: body.aiSummary,
      emailRecipients: body.emailRecipients,
      emailSubject: body.emailSubject,
      jiraKey: body.jiraKey,
      jiraData: body.jiraData,
      epics: body.epics,
      workItems: body.workItems,
      issueBreakdown: body.issueBreakdown,
      sprintGanttData: body.sprintGanttData,
      selectedCCRecipients: body.selectedCCRecipients,
      userEmail,
      isTestMode,
    });

    const { jiraKey, jiraData, epics, attachPdf } = body;
    logger.email.attempt(
      userEmail,
      toList.length > 0 ? toList : [userEmail],
      subject,
      jiraKey || null,
      null,
      { username, ip: userIp, userAgent, hasJiraData: !!jiraData, hasEpics: !!epics, attachPdf: !!attachPdf }
    );

    if (req.previewOnly) {
      const textBody = emailHtml.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      return res.json({
        success: true,
        to: mailOptions.to,
        cc: mailOptions.cc || '',
        subject: mailOptions.subject,
        htmlBody: emailHtml,
        textBody
      });
    }

    if (body.dryRun === true || req.query.dryRun === 'true' || process.env.EMAIL_DRY_RUN === 'true') {
      return res.json({
        success: true,
        message: 'Dry run: email not sent.',
        dryRun: true,
        recipients: isTestMode ? [userEmail] : (toList.length > 0 ? toList : [userEmail])
      });
    }

    const info = await sendEmailDirect(mailOptions);
    const sentTo = isTestMode ? [userEmail] : (toList.length > 0 ? toList : [userEmail]);
    const sentCc = Array.from(ccEmails);
    const accepted = info.accepted || [];
    const rejected = info.rejected || [];

    if (accepted.length === 0) {
      logger.email.failed(
        userEmail, sentTo, subject,
        new Error('All recipients were rejected by the mail server'),
        jiraKey || null, null,
        { username, rejectedCount: rejected.length, ip: userIp, userAgent }
      );
      return res.status(500).json({
        success: false,
        error: 'All recipients were rejected by the mail server. No one received the email.',
        message: 'Check SMTP relay and recipient addresses.'
      });
    }

    logger.email.sent(userEmail, sentTo, sentCc, subject, jiraKey || null, null, {
      username,
      messageId: info.messageId,
      contentSize: emailHtml.length,
      hasJiraData: !!jiraData,
      hasEpics: !!epics,
      attachPdf: !!attachPdf,
      isTestMode,
      acceptedCount: accepted.length,
      rejectedCount: rejected.length,
      ip: userIp,
      userAgent
    });

    const isTestRecord = isTestMode || (process.env.NODE_ENV === 'development' &&
      (subject?.toLowerCase().includes('test') || subject?.toLowerCase().includes('[test]')));
    await persistHistory({
      username,
      userEmail,
      to: sentTo,
      cc: sentCc,
      subject,
      jiraKey: jiraKey || null,
      releaseVersions: null,
      messageId: info.messageId,
      metadata: {
        contentSize: emailHtml.length,
        hasJiraData: !!jiraData,
        hasEpics: !!epics,
        attachPdf: !!attachPdf,
        ip: userIp,
        userAgent,
        isTest: isTestRecord
      }
    });

    return res.json({
      success: true,
      message: isTestMode ? 'Email sent only to you (test mode).' : 'Email sent successfully',
      messageId: info.messageId,
      recipients: sentTo,
      isTestMode: !!isTestMode
    });
  } catch (error) {
    const logEmail = (req.jiraUser && (req.jiraUser.emailAddress || req.jiraUser.email))
      ? (req.jiraUser.emailAddress || req.jiraUser.email)
      : 'unknown';
    const toEmails = req.body?.emailRecipients
      ? parseEmailRecipients(req.body.emailRecipients)
      : [];

    logger.email.failed(
      logEmail,
      toEmails.length > 0 ? toEmails : [logEmail],
      req.body?.emailSubject || 'NDB Status Update',
      error,
      req.body?.jiraKey || null,
      null,
      { username, ip: userIp, userAgent, errorCode: error.code, errorResponseCode: error.responseCode }
    );

    const safe = clientSafeSendError(error);
    return res.status(500).json({ success: false, error: safe, message: safe });
  }
};
