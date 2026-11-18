/**
 * POST /api/email/send-sos
 *
 * Send a Scrum-of-Scrums snapshot email via the existing SMTP relay.
 * Does not call JIRA — HTML and recipient lists come from the client payload
 * plus status-sender default To/CC config. Saves to email history on success.
 */

const { emailLimiter } = require('../../middleware/security');
const { validateJiraTokenMiddleware } = require('../../middleware/auth/jira');
const { sendEmailDirect } = require('../../services/emailService');
const { normalizeToUsername } = require('../../services/userService');
const { saveEmailHistory } = require('../../utils/emailHistoryDB');
const { resolveSosRecipientLists } = require('../../utils/sosEmailRecipients');

const SOS_EMAIL_STYLES = `
  body { font-family: Arial, sans-serif; font-size: 13px; color: #333; }
  h2 { color: #1a1a2e; margin: 16px 0 8px; }
  h3 { color: #333; margin: 12px 0 6px; font-size: 13px; }
  table { border-collapse: collapse; width: 100%; }
  th { background: #f0f4f8; padding: 6px 10px; text-align: left; font-size: 12px; border: 1px solid #ddd; }
  td { padding: 5px 10px; border: 1px solid #ddd; font-size: 12px; }
  .footer { color: #888; font-size: 11px; margin-top: 24px; border-top: 1px solid #eee; padding-top: 8px; }
`;

function buildSosEmailHTML({ releases, gateSection, blockers, risks, actionItems, tableHTML, generatedAt }) {
  const releaseLabel = Array.isArray(releases) ? releases.join(', ') : (releases || '');
  const actionItemsHtml = actionItems
    ? `<ol>${actionItems.split('\n').filter(Boolean).map((a) => `<li>${a}</li>`).join('')}</ol>`
    : '<p><em>No action items.</em></p>';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>${SOS_EMAIL_STYLES}</style></head>
<body>
<!-- SoS Summary | ${releaseLabel} | ${generatedAt} | audience: vp -->
<h2>Scrum of Scrums Status — ${releaseLabel}</h2>
<p style="color:#888;font-size:11px">Generated ${generatedAt} &nbsp;|&nbsp; Audience: Engineering Leadership</p>
<div class="section"><h2>Gate Dates</h2>${gateSection || '<p>No gate date information available.</p>'}</div>
${blockers ? `<div class="section"><h2>Top Blockers</h2>${blockers}</div>` : ''}
${risks ? `<div class="section"><h2>Risks</h2>${risks}</div>` : ''}
<div class="section"><h2>7-Day Action Items</h2>${actionItemsHtml}</div>
<div class="section"><h2>Feature / Initiative Status</h2>${tableHTML}</div>
<div class="footer">Sent via Delivery Ops</div>
</body>
</html>`;
}

function resolveHtmlBody(body, generatedAt) {
  const snapshot = body.htmlBody && String(body.htmlBody).trim();
  if (snapshot) return snapshot;
  return buildSosEmailHTML({
    releases: body.releases,
    gateSection: body.gateSection,
    blockers: body.blockers,
    risks: body.risks,
    actionItems: body.actionItems,
    tableHTML: body.tableHTML,
    generatedAt,
  });
}

function register(router) {
  router.post(
    '/send-sos',
    emailLimiter,
    validateJiraTokenMiddleware,
    async (req, res) => {
      try {
        if (!req.jiraUser || (!req.jiraUser.emailAddress && !req.jiraUser.email)) {
          return res.status(400).json({ success: false, error: 'JIRA user email is required.' });
        }

        const { recipients, ccRecipients, subject, releases, tableHTML, htmlBody, previewOnly } = req.body;
        const hasSnapshot = htmlBody && String(htmlBody).trim();
        const hasLegacyTable = tableHTML && String(tableHTML).trim();

        if (!subject || !String(subject).trim()) {
          return res.status(400).json({ success: false, error: 'subject is required' });
        }
        if (!hasSnapshot && !hasLegacyTable) {
          return res.status(400).json({ success: false, error: 'htmlBody is required' });
        }
        if (!releases || !Array.isArray(releases) || releases.length === 0) {
          return res.status(400).json({ success: false, error: 'releases array is required' });
        }

        const senderEmail = req.jiraUser.emailAddress || req.jiraUser.email;
        const username = req.username || normalizeToUsername(senderEmail) || 'unknown';
        const generatedAt = new Date().toISOString().slice(0, 10);
        const { toList, ccList } = resolveSosRecipientLists(senderEmail, recipients, ccRecipients);
        const resolvedHtml = resolveHtmlBody(req.body, generatedAt);

        if (previewOnly) {
          return res.json({
            success: true,
            preview: resolvedHtml,
            htmlBody: resolvedHtml,
            to: toList,
            cc: ccList,
            subject: subject.trim(),
          });
        }

        if (toList.length === 0) {
          return res.status(400).json({
            success: false,
            error: 'No To recipients. Fill To in the dialog or set sosEmailConfig.json defaultTo.',
          });
        }

        const info = await sendEmailDirect({
          replyTo: senderEmail,
          to: toList.join(', '),
          cc: ccList.join(', '),
          subject: subject.trim(),
          html: resolvedHtml,
        });

        await saveEmailHistory({
          type: 'sos',
          username,
          userEmail: senderEmail,
          to: toList,
          cc: ccList,
          subject: subject.trim(),
          releaseVersions: releases,
          messageId: info?.messageId || null,
        });

        return res.json({
          success: true,
          messageId: info?.messageId || null,
          recipientCount: toList.length,
          accepted: info?.accepted || [],
          rejected: info?.rejected || [],
        });
      } catch (err) {
        console.error('[send-sos] Error:', err.message);
        return res.status(500).json({ success: false, error: err.message || 'Failed to send SoS email' });
      }
    }
  );
}

module.exports = { register };
