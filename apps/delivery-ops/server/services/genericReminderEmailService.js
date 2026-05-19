/**
 * Build and send Generic Emailer (reminder) email. Used by POST /api/email/send-generic-reminder and by the scheduled email runner.
 */
const { sendEmailDirect, parseEmailRecipients, formatDateForEmail } = require('./emailService');
const { usernameToEmail, extractEmailFromJiraUser, extractEmailsFromJiraUserArray } = require('./userService');
const { formatGenericEmailerCellValue } = require('../utils/emailFormatter');
const genericEmailerCCConfig = require('../config/genericEmailerCCConfig.json');
const { JIRA_BASE_URL } = require('../config/api');

/**
 * Send a generic reminder email with the given payload.
 * @param {object} options
 * @param {string} options.fromEmail - Sender email
 * @param {string} [options.fromUsername] - Sender username (for CC when toRecipients provided)
 * @param {string[]} options.selectedFieldIdsInOrder - Column IDs in order
 * @param {object[]} options.issuesPayload - JIRA issues (normalized: key + fields)
 * @param {object} [options.fieldLabels={}] - Map field id -> label
 * @param {string} [options.toRecipients] - To recipients (comma/semicolon separated)
 * @param {string[]} [options.includeProjectTeam] - Field IDs to add as CC from issue values
 * @param {string[]} [options.selectedCCRecipients] - Optional CC names/emails
 * @param {string} [options.subject] - Subject line (without date; date is appended)
 * @param {string} [options.notes] - HTML body above table
 * @returns {Promise<{ messageId: string }>}
 */
async function sendGenericReminderEmail(options) {
  const {
    fromEmail,
    fromUsername,
    selectedFieldIdsInOrder,
    issuesPayload,
    fieldLabels = {},
    toRecipients,
    includeProjectTeam = [],
    selectedCCRecipients = [],
    subject: subjectInput,
    notes: notesInput
  } = options;

  const toEmails = toRecipients && String(toRecipients).trim()
    ? parseEmailRecipients(toRecipients)
    : [];
  const senderEmailForCC = fromUsername ? usernameToEmail(fromUsername) : fromEmail;
  // Always include the sender in the To list.
  const senderToAdd = senderEmailForCC || fromEmail;
  if (senderToAdd && !toEmails.includes(senderToAdd)) {
    toEmails.push(senderToAdd);
  }
  const toEmailList = toEmails.length > 0 ? toEmails.join(', ') : fromEmail;

  const defaultCCNormalized = parseEmailRecipients((Array.isArray(genericEmailerCCConfig.defaultCC) ? genericEmailerCCConfig.defaultCC : []).join(', '));
  const ccEmails = new Set(defaultCCNormalized.filter(Boolean));
  if (senderEmailForCC) ccEmails.add(senderEmailForCC);
  if (Array.isArray(selectedCCRecipients) && selectedCCRecipients.length > 0) {
    const normalized = parseEmailRecipients(selectedCCRecipients.join(', '));
    normalized.forEach(e => ccEmails.add(e));
  }
  includeProjectTeam.forEach(fieldId => {
    issuesPayload.forEach(issue => {
      const raw = fieldId === 'key' ? issue.key : issue[fieldId];
      if (!raw) return;
      if (fieldId === 'watchers') {
        extractEmailsFromJiraUserArray(raw).forEach(e => ccEmails.add(e));
      } else {
        const email = extractEmailFromJiraUser(raw);
        if (email) ccEmails.add(email);
      }
    });
  });

  const dateStr = formatDateForEmail();
  const subjectBase = subjectInput && String(subjectInput).trim() ? subjectInput : 'NDB Reminder';
  const subject = `${subjectBase} – ${dateStr}`;

  const headerLabels = selectedFieldIdsInOrder.map(id => fieldLabels[id] || id);
  const rows = issuesPayload.map(issue =>
    selectedFieldIdsInOrder.map(fid => {
      const raw = fid === 'key' ? issue.key : issue[fid];
      const cell = formatGenericEmailerCellValue(raw, JIRA_BASE_URL);
      return cell === '' ? 'N/A' : cell;
    })
  );

  const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const escapeTableBreaking = (html) => String(html || '')
    .replace(/<\/td>/gi, '&lt;/td&gt;')
    .replace(/<td(?=[\s>])/gi, '&lt;td')
    .replace(/<\/tr>/gi, '&lt;/tr&gt;')
    .replace(/<tr(?=[\s>])/gi, '&lt;tr')
    .replace(/<\/table>/gi, '&lt;/table&gt;')
    .replace(/<table(?=[\s>])/gi, '&lt;table');
  const cellPadding = '5px';
  const tableRows = rows.map(cells =>
    '<tr>' + cells.map(c => {
      const raw = c === '' ? 'N/A' : c;
      return `<td style="padding: ${cellPadding}; border: 1px solid #ddd;">${escapeTableBreaking(raw)}</td>`;
    }).join('') + '</tr>'
  ).join('');
  const headerRow = '<tr>' + headerLabels.map(h =>
    `<th style="padding: ${cellPadding}; border: 1px solid #ddd; text-align: left; background: #f5f5f5;">${escapeHtml(h)}</th>`
  ).join('') + '</tr>';

  const bodyHtml = (notesInput && String(notesInput).trim())
    ? `<div class="email-body" style="margin-bottom: 1rem;">${String(notesInput).trim()}</div>`
    : '';

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>body{font-family:'Segoe UI',Tahoma,Geneva,Verdana,sans-serif;font-size:0.9375rem;color:#1a1a1a;margin:0;padding:0;background:#fff;box-sizing:border-box}.email-container{max-width:min(600px,100%);padding:1rem;box-sizing:border-box}.table-wrap{overflow-x:auto;max-width:100%}table{border-collapse:collapse;width:100%}.email-body p{margin:0.35rem 0}.footer{margin-top:1rem;font-size:0.75rem;color:#666}</style>
</head>
<body><div class="email-container">${bodyHtml}<div class="table-wrap"><table><thead>${headerRow}</thead><tbody>${tableRows}</tbody></table></div><div class="footer"><p>This is an automated reminder email.</p></div></div></body>
</html>`;

  const ccList = Array.from(ccEmails).filter(Boolean);
  const info = await sendEmailDirect({
    replyTo: fromEmail,
    to: toEmailList,
    cc: ccList.join(', '),
    subject,
    html: emailHtml
  });
  return { messageId: info.messageId, subject, toEmails: toEmails.length > 0 ? toEmails : [fromEmail], ccList };
}

module.exports = { sendGenericReminderEmail };
