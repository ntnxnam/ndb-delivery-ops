/**
 * CC resolution + SMTP send/preview for Status Sender (keeps route handler thin).
 */

const { sendEmailDirect, parseEmailRecipients, formatDateForEmail } = require('./emailService');
const { extractEmailFromJiraUser, extractEmailsFromJiraUserArray } = require('./userService');
const { buildStatusEmailHtml } = require('./statusEmailHtmlService');
const emailConfig = require('../config/emailConfig.json');
const emailSenderCCConfig = require('../config/emailSenderCCConfig.json');
const { saveEmailHistory } = require('../utils/emailHistoryDB');
const logger = require('../utils/logger');
const { HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS } = require('../utils/emailHighlights');

function validateHighlights(additionalDetails) {
  const highlightsLowlights = (additionalDetails && typeof additionalDetails === 'string')
    ? additionalDetails.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
  if (!highlightsLowlights) {
    return 'Highlights and Lowlights is required';
  }
  const textLower = highlightsLowlights.toLowerCase();
  const missingSections = HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS.filter(
    (s) => !textLower.includes(s.toLowerCase())
  );
  if (missingSections.length > 0) {
    return 'Highlights and Lowlights must include all sections. Missing: ' + missingSections.join('; ');
  }
  return null;
}

function resolveToList(emailRecipients, userEmail) {
  const toEmails = emailRecipients && emailRecipients.trim()
    ? parseEmailRecipients(emailRecipients)
    : [];
  const defaultTo = Array.isArray(emailConfig.defaultTo) ? emailConfig.defaultTo : [];
  const toList = [...defaultTo, ...toEmails].filter(Boolean);
  if (userEmail && userEmail.endsWith('@nutanix.com') && !toList.includes(userEmail.toLowerCase())) {
    toList.push(userEmail.toLowerCase());
  }
  return toList;
}

function resolveCcEmails({ userEmail, selectedCCRecipients, jiraData }) {
  const ccEmails = new Set();
  const addNutanixCC = (email) => {
    const normalized = String(email || '').trim().toLowerCase();
    if (normalized.endsWith('@nutanix.com')) ccEmails.add(normalized);
  };
  if (userEmail && userEmail.endsWith('@nutanix.com')) {
    ccEmails.add(userEmail.toLowerCase());
  }
  const allowedCC = new Set(
    (Array.isArray(emailSenderCCConfig.defaultCC) ? emailSenderCCConfig.defaultCC : [])
      .map((a) => String(a || '').trim().toLowerCase())
      .filter((a) => a.endsWith('@nutanix.com'))
  );
  const selectedCC = Array.isArray(selectedCCRecipients) ? selectedCCRecipients : [];
  for (const addr of selectedCC) {
    if (allowedCC.has(String(addr || '').trim().toLowerCase())) {
      addNutanixCC(addr);
    }
  }
  if (jiraData) {
    const projectTeamFields = Array.isArray(emailSenderCCConfig.projectTeamFields)
      ? emailSenderCCConfig.projectTeamFields
      : [];
    for (const field of projectTeamFields) {
      const fieldId = field && field.id;
      if (!fieldId) continue;
      const raw = jiraData[fieldId];
      if (!raw) continue;
      if (fieldId === 'watchers' || fieldId === 'customfield_51460') {
        extractEmailsFromJiraUserArray(raw).forEach(addNutanixCC);
      } else {
        addNutanixCC(extractEmailFromJiraUser(raw));
      }
    }
  }
  return ccEmails;
}

/**
 * Build mail options (sanitized HTML) for preview or send.
 */
function buildMailOptions(params) {
  const {
    additionalDetails,
    aiSummary,
    emailRecipients,
    emailSubject,
    jiraKey,
    jiraData,
    epics,
    workItems,
    issueBreakdown,
    sprintGanttData,
    selectedCCRecipients,
    userEmail,
    isTestMode,
  } = params;

  const toList = resolveToList(emailRecipients, userEmail);
  const emailHtml = buildStatusEmailHtml({
    additionalDetails,
    aiSummary,
    jiraKey,
    jiraData,
    epics,
    workItems,
    issueBreakdown,
    sprintGanttData,
  });
  const ccEmails = resolveCcEmails({ userEmail, selectedCCRecipients, jiraData });

  const dateStr = formatDateForEmail();
  let subject = emailSubject || `NDB Status Update - ${dateStr}`;
  let toEmailList;
  let ccForSend;
  if (isTestMode) {
    toEmailList = userEmail;
    ccForSend = '';
    if (!subject.toLowerCase().startsWith('[test]')) {
      subject = `[TEST] ${subject}`;
    }
  } else {
    toEmailList = toList.length > 0 ? toList.join(', ') : userEmail;
    ccForSend = Array.from(ccEmails).join(', ');
  }

  return {
    mailOptions: {
      replyTo: userEmail,
      to: toEmailList,
      cc: ccForSend,
      subject,
      html: emailHtml,
    },
    toList,
    ccEmails,
    emailHtml,
    subject,
  };
}

async function persistHistory(record) {
  try {
    await saveEmailHistory(record);
  } catch (dbError) {
    console.error('[Email History DB] Failed to save email history:', dbError?.message || 'unknown');
  }
}

module.exports = {
  validateHighlights,
  resolveToList,
  buildMailOptions,
  persistHistory,
  parseEmailRecipients,
  logger,
};
