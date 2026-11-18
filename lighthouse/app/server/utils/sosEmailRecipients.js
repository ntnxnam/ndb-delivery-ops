const { parseEmailRecipients } = require('../services/emailService');
const sosEmailConfig = require('../config/sosEmailConfig.json');

function nutanixEmails(list) {
  return (Array.isArray(list) ? list : [])
    .map((e) => String(e || '').trim().toLowerCase())
    .filter((e) => e.endsWith('@nutanix.com'));
}

function uniqueEmails(list) {
  return [...new Set((list || []).filter(Boolean))];
}

/**
 * Resolve SoS To+CC lists.
 * To = sosEmailConfig.defaultTo + optional extra recipients.
 * CC = sosEmailConfig.defaultCC + optional extra CC + sender.
 * Only @nutanix.com addresses are kept (corporate relay rejects others).
 */
function resolveSosRecipientLists(senderEmail, recipients, ccRecipients) {
  const extraTo = recipients && String(recipients).trim()
    ? parseEmailRecipients(recipients).filter((e) => e.endsWith('@nutanix.com'))
    : [];
  const toList = uniqueEmails([...nutanixEmails(sosEmailConfig.defaultTo), ...extraTo]);

  const extraCC = ccRecipients && String(ccRecipients).trim()
    ? parseEmailRecipients(ccRecipients).filter((e) => e.endsWith('@nutanix.com'))
    : [];
  const sender = senderEmail && senderEmail.toLowerCase().endsWith('@nutanix.com')
    ? senderEmail.toLowerCase()
    : null;
  const ccList = uniqueEmails([
    ...nutanixEmails(sosEmailConfig.defaultCC),
    ...extraCC,
    sender,
  ].filter((e) => !toList.includes(e)));

  return { toList, ccList };
}

module.exports = { resolveSosRecipientLists };
