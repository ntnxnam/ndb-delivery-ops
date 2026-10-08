/**
 * POST /api/email/send - handler only (used by sendEmail.js and preview.js)
 */
const logger = require('../../utils/logger');
const { sendEmailDirect, getDefaultFromAddress, parseEmailRecipients, formatDateForEmail } = require('../../services/emailService');
const { extractEmailFromJiraUser, extractEmailsFromJiraUserArray } = require('../../services/userService');
const { formatContentForEmail } = require('../../utils/emailFormatter');
const {
  renderAiRiskSummaryEmailSection,
  renderSprintGanttEmailSection,
} = require('../../utils/sprintGanttEmail');
const emailConfig = require('../../config/emailConfig.json');
const emailSenderCCConfig = require('../../config/emailSenderCCConfig.json');
const { saveEmailHistory } = require('../../utils/emailHistoryDB');
const { HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS } = require('./middleware');

const releaseVersionsEmailConfig = require('../../config/releaseVersionsEmailConfig.json');

const EXTRA_EMAIL_FIELDS = [
  ['customfield_55662', 'Link to CG checklist'],
  ['customfield_55663', 'Link to PG checklist'],
];

/** Sequential gates after EC (EC is the timeline origin from release config). */
const SEQUENTIAL_GATE_DEFS = [
  { key: 'fsds', label: 'FS/DS Done', fieldId: 'customfield_13861', color: '#6c757d' },
  { key: 'testPlan', label: 'Test Plan', fieldId: 'customfield_11068', color: '#17a2b8' },
  { key: 'cc', label: 'Code Complete', fieldId: 'customfield_11067', color: '#1f77b4' },
  { key: 'cg', label: 'Commit Gate', fieldId: 'customfield_35863', color: '#ff7f0e' },
  { key: 'pg', label: 'Promotion Gate', fieldId: 'customfield_35864', color: '#2ca02c' },
];

const MONTH_INDEX = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

function parseEmailDisplayDate(value) {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    if (value.type === 'notSet') return null;
    return parseEmailDisplayDate(value.display || value.value || '');
  }
  const str = String(value).trim();
  if (!str || str === 'Not Set' || str === 'N/A' || str === 'NA') return null;
  const m = str.match(/^(\d{1,2})\/([A-Za-z]{3})\/(\d{4})$/);
  if (m && MONTH_INDEX[m[2]] != null) {
    const d = new Date(Number(m[3]), MONTH_INDEX[m[2]], Number(m[1]));
    d.setHours(0, 0, 0, 0);
    return isNaN(d.getTime()) ? null : d;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
    const d = new Date(str.slice(0, 10) + 'T00:00:00');
    return isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(str);
  if (isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function fieldText(field) {
  if (!field) return 'Not Set';
  const v = field.value;
  if (v == null || v === '') return 'Not Set';
  if (typeof v === 'object') {
    if (v.type === 'notSet') return 'Not Set';
    return v.display || v.value || 'Not Set';
  }
  return String(v);
}

function renderExtraEmailCells(jiraData) {
  return EXTRA_EMAIL_FIELDS.map(([id, fallback]) => {
    const field = jiraData?.[id];
    if (!field) return '';
    const name = field.name || fallback;
    const value = field.value;
    if (value && typeof value === 'object' && value.type) {
      const bg = value.type === 'notSet' ? '#fff3cd' : 'transparent';
      const weight = value.type === 'notSet' ? '600' : 'normal';
      const display = value.type === 'link' && value.url
        ? `<a href="${value.url}" style="color: #0065ff; text-decoration: none;">${value.display || 'Link'}</a>`
        : (value.display || 'Not Set');
      return `<td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 12.5%; font-size: 0.9375rem;">${name}</td><td style="padding: 8px; border: 1px solid #1a1a1a; width: 12.5%; font-size: 0.9375rem; background-color: ${bg}; font-weight: ${weight};">${display}</td>`;
    }
    const text = value && value !== 'N/A' && value !== 'NA' && value !== 'Not Set' ? value : 'Not Set';
    const bg = text === 'Not Set' ? '#fff3cd' : 'transparent';
    const weight = text === 'Not Set' ? '600' : 'normal';
    return `<td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 12.5%; font-size: 0.9375rem;">${name}</td><td style="padding: 8px; border: 1px solid #1a1a1a; width: 12.5%; font-size: 0.9375rem; background-color: ${bg}; font-weight: ${weight};">${formatContentForEmail(text)}</td>`;
  }).join('');
}

/** Risk Indicator + Risk Assessment + Path to Green — below Highlights in email. */
function renderRiskContextSection(jiraData) {
  if (!jiraData) return '';
  const risk = jiraData.customfield_23560;
  const assessment = jiraData.customfield_47780;
  const path = jiraData.customfield_55664;
  const riskVal = fieldText(risk);
  const assessmentVal = fieldText(assessment);
  const pathVal = fieldText(path);
  const riskUnset = riskVal === 'Not Set';
  const assessmentUnset = assessmentVal === 'Not Set';
  const pathUnset = pathVal === 'Not Set';
  const riskColor = risk?.color || 'transparent';
  const riskTextColor = !riskUnset && riskColor !== 'transparent' ? '#ffffff' : '#1a1a1a';

  return `
            <h2>Risk context</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
              <tbody>
                <tr>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.875rem; background: #f8f9fa;">${risk?.name || 'Risk Indicator'}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 17%; font-size: 0.875rem; background-color: ${riskUnset ? '#fff3cd' : riskColor}; color: ${riskTextColor}; font-weight: 600; text-align: center;">${riskVal}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.875rem; background: #f8f9fa;">${assessment?.name || 'Risk Assessment'}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 18%; font-size: 0.875rem; background-color: ${assessmentUnset ? '#fff3cd' : 'transparent'}; font-weight: ${assessmentUnset ? '600' : 'normal'};">${formatContentForEmail(assessmentVal)}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.875rem; background: #f8f9fa;">${path?.name || 'Path to Green'}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 17%; font-size: 0.875rem; background-color: ${pathUnset ? '#fff3cd' : 'transparent'}; font-weight: ${pathUnset ? '600' : 'normal'};">${formatContentForEmail(pathVal)}</td>
                </tr>
              </tbody>
            </table>
  `;
}

function resolveEcDateForJiraData(jiraData) {
  const raw = jiraData?.fixVersions;
  if (!raw || raw === 'N/A') return { version: null, ecDate: null };
  const version = String(raw).split(',')[0].trim();
  const cfg = releaseVersionsEmailConfig.releaseGateDates?.[version];
  return { version, ecDate: cfg?.ecDate || null };
}

function formatEmailGateDate(date) {
  if (!date) return 'Not Set';
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day}/${months[date.getMonth()]}/${date.getFullYear()}`;
}

/** Email-safe sequential waterfall: EC → FS/DS → Test Plan → CC → CG → PG. */
function renderGateDatesChartSection(jiraData) {
  if (!jiraData) return '';
  const { version, ecDate: ecRaw } = resolveEcDateForJiraData(jiraData);
  const ecDate = parseEmailDisplayDate(ecRaw);
  if (!ecDate) {
    return `
            <h2>Gates vs dates</h2>
            <p style="font-size: 0.875rem; background: #fff3cd; padding: 8px; border: 1px solid #1a1a1a;">EC date is required as the timeline start${version ? ` (no EC in release config for ${version})` : ''}.</p>
    `;
  }

  const points = [{ key: 'ec', label: 'EC', date: ecDate, dateLabel: formatEmailGateDate(ecDate), color: '#9467bd' }];
  const missing = [];
  SEQUENTIAL_GATE_DEFS.forEach((g) => {
    const date = parseEmailDisplayDate(jiraData[g.fieldId]?.value ?? jiraData[g.fieldId]);
    if (!date) {
      missing.push(g.label);
      return;
    }
    points.push({
      key: g.key,
      label: g.label,
      date,
      dateLabel: formatEmailGateDate(date),
      color: g.color,
    });
  });

  if (points.length < 2) {
    return `
            <h2>Gates vs dates</h2>
            <p style="font-size: 0.875rem; background: #fff3cd; padding: 8px; border: 1px solid #1a1a1a;">EC is ${formatEmailGateDate(ecDate)}, but no later gate dates are set on this ticket.</p>
    `;
  }

  const segments = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    const daySpan = Math.round((to.date.getTime() - from.date.getTime()) / 86400000);
    const inverted = daySpan < 0;
    const duration = Math.max(1, Math.abs(daySpan));
    const offset = Math.max(0, Math.round((from.date.getTime() - ecDate.getTime()) / 86400000));
    segments.push({
      label: `${from.label} → ${to.label}`,
      fromDateLabel: from.dateLabel,
      toDateLabel: to.dateLabel,
      daySpan,
      duration,
      offset,
      color: inverted ? '#dc3545' : to.color,
      inverted,
    });
  }

  const totalSpan = Math.max(
    1,
    ...segments.map((s) => s.offset + s.duration)
  );

  const bars = segments.map((s) => {
    const offsetPct = Math.round((s.offset / totalSpan) * 100);
    const durPct = Math.max(2, Math.round((s.duration / totalSpan) * 100));
    const spanLabel = s.inverted
      ? `${Math.abs(s.daySpan)}d (inverted)`
      : `${s.daySpan}d`;
    return `
                <tr>
                  <td style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; width: 22%; font-weight: 600;">${s.label}</td>
                  <td style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; width: 28%;">${s.fromDateLabel} → ${s.toDateLabel}</td>
                  <td style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; width: 10%;">${spanLabel}</td>
                  <td style="padding: 6px 8px; border: 1px solid #1a1a1a; width: 40%;">
                    <div style="background: #f1f3f5; height: 14px; width: 100%; position: relative;">
                      <div style="position: absolute; left: ${offsetPct}%; width: ${durPct}%; background: ${s.color}; height: 14px;"></div>
                    </div>
                  </td>
                </tr>`;
  }).join('');

  return `
            <h2>Gates vs dates</h2>
            <p style="font-size: 0.8125rem; margin: 0 0 8px;">Start: <strong>EC ${formatEmailGateDate(ecDate)}</strong>${version ? ` · ${version}` : ''} · sequential legs</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
              <thead>
                <tr>
                  <th style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; text-align: left;">Leg</th>
                  <th style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; text-align: left;">Dates</th>
                  <th style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; text-align: left;">Days</th>
                  <th style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; text-align: left;">From EC</th>
                </tr>
              </thead>
              <tbody>${bars}
              </tbody>
            </table>
            <p style="font-size: 0.75rem; color: #666; margin-top: 0;">Each bar is one sequential leg from EC${missing.length ? ` · Skipped (not set): ${missing.join(', ')}` : ''}</p>
  `;
}

module.exports = async function sendEmailHandler(req, res) {
  // Extract username and request metadata for audit logging
  const username = req.username || req.body?.username || req.headers['x-username'] || 'unknown';
  
  // Get JIRA user's email from token validation response (req.jiraUser)
  // REQUIRED: Must have JIRA email - no fallback, fail if not available
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
      executiveSummary, 
      additionalDetails,
      aiSummary,
      emailRecipients, 
      emailSubject,
      jiraKey,
      jiraData,
      epics,
      issueBreakdown,
      sprintGanttData,
      attachPdf
    } = req.body;
    
    // Validate required fields (Highlights and Lowlights = additionalDetails)
    const highlightsLowlights = (additionalDetails && typeof additionalDetails === 'string') ? additionalDetails.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() : '';
    if (!highlightsLowlights) {
      return res.status(400).json({
        success: false,
        error: 'Highlights and Lowlights is required'
      });
    }
    const textLower = highlightsLowlights.toLowerCase();
    const missingSections = HIGHLIGHTS_LOWLIGHTS_REQUIRED_SECTIONS.filter(
      (s) => !textLower.includes(s.toLowerCase())
    );
    if (missingSections.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Highlights and Lowlights must include all sections. Missing: ' + missingSections.join('; ')
      });
    }

    // Parse and normalize email recipients (optional - appended to defaultTo). Only default + explicitly added go to To/CC; no JIRA-derived (relay can reject those).
    const toEmails = emailRecipients && emailRecipients.trim()
      ? parseEmailRecipients(emailRecipients)
      : [];
    const defaultTo = Array.isArray(emailConfig.defaultTo) ? emailConfig.defaultTo : [];
    const toList = [...defaultTo, ...toEmails].filter(Boolean);
    // Always include the sender in the To list (only @nutanix.com to avoid relay rejection).
    if (userEmail && userEmail.endsWith('@nutanix.com') && !toList.includes(userEmail.toLowerCase())) {
      toList.push(userEmail.toLowerCase());
    }

    // AUDIT: Log email send attempt
    logger.email.attempt(
      userEmail,
      toList.length > 0 ? toList : [userEmail],
      emailSubject || 'NDB Status Update',
      jiraKey || null,
      null, // releaseVersions
      {
        username,
        ip: userIp,
        userAgent,
        hasJiraData: !!jiraData,
        hasEpics: !!epics,
        attachPdf: !!attachPdf
      }
    );
    
    // Build email HTML
    let emailHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
              font-size: 0.9375rem;
              line-height: 1.5; 
              color: #1a1a1a; 
              margin: 0; 
              padding: 0;
              background-color: #ffffff;
            }
            .email-container {
              width: 100%;
              max-width: 100%;
              margin: 0;
              background-color: #ffffff;
              padding: 2rem;
              border: 1px solid #1a1a1a;
              box-sizing: border-box;
            }
            h2 { 
              font-size: 1rem;
              font-weight: 600;
              color: #1a1a1a; 
              border-bottom: 1px solid #1a1a1a; 
              padding-bottom: 0.5rem; 
              margin-top: 2rem;
              margin-bottom: 1rem;
            }
            h3 {
              font-size: 0.9375rem;
              font-weight: 600;
              color: #1a1a1a;
              margin-top: 1.5rem;
              margin-bottom: 0.75rem;
            }
            p {
              font-size: 0.9375rem;
              color: #1a1a1a;
              margin-bottom: 1rem;
            }
            ul, ol {
              font-size: 0.9375rem;
              color: #1a1a1a;
              margin-bottom: 1rem;
              padding-left: 1.5rem;
            }
            li {
              margin-bottom: 0.5rem;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-bottom: 1.5rem;
              border: 1px solid #1a1a1a;
            }
            th, td {
              padding: 0.5rem;
              border: 1px solid #1a1a1a;
              vertical-align: top;
              word-wrap: break-word;
              font-size: 0.9375rem;
              text-align: left;
            }
            th {
              background-color: #f5f5f5;
              font-weight: 600;
              color: #1a1a1a;
            }
            td {
              color: #1a1a1a;
            }
            .footer {
              margin-top: 2rem;
              padding-top: 1rem;
              border-top: 1px solid #1a1a1a;
              font-size: 0.6875rem;
              color: #666;
              text-align: center;
            }
            a {
              color: #0065ff;
              text-decoration: none;
            }
            a:hover {
              text-decoration: underline;
            }
          </style>
        </head>
        <body>
          <div class="email-container">
            <h2>Highlights and Lowlights</h2>
            <div>${additionalDetails && additionalDetails.trim() ? formatContentForEmail(additionalDetails) : '<p style="color: #666; font-style: italic;">No highlights and lowlights provided.</p>'}</div>
    `;

    // AI risk brief sits with narrative (Highlights) before JIRA-backed risk/gates.
    emailHtml += renderAiRiskSummaryEmailSection(aiSummary);

    // Risk boxes + gate chart sit between narrative and ticket tables (matches UI)
    if (jiraData) {
      emailHtml += renderRiskContextSection(jiraData);
      emailHtml += renderGateDatesChartSection(jiraData);
    }
    
    // Add JIRA data if provided - match UI table format
    if (jiraData) {
      const jiraBaseUrl = 'https://jira.nutanix.com';
      const jiraUrl = `${jiraBaseUrl}/browse/${jiraKey || jiraData.key || ''}`;
      
      emailHtml += `
            <h2>JIRA Ticket Information</h2>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
              <tbody>
                <tr>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 6%; font-size: 0.9375rem;">Key</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 10%; font-size: 0.9375rem;">
                    <a href="${jiraUrl}" style="color: #0065ff; text-decoration: none;">${jiraKey || jiraData.key || 'N/A'}</a>
                  </td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 8%; font-size: 0.9375rem;">Summary</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 25%; font-size: 0.9375rem;">${jiraData.summary || 'N/A'}</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 7%; font-size: 0.9375rem;">Status</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 12%; font-size: 0.9375rem;">${jiraData.status || 'N/A'}</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 9%; font-size: 0.9375rem;">Fix Version</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 13%; font-size: 0.9375rem;">${jiraData.fixVersions || 'N/A'}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 6%; font-size: 0.9375rem;">Labels</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 94%; font-size: 0.9375rem;" colspan="7">${jiraData.labels || 'N/A'}</td>
                </tr>
      `;
      
      // Date fields row: Code Complete Date, FS/DS Done Date, Test Plan Date, Commit Gate, Promotion Gate
      const codeCompleteDate = jiraData.customfield_11067;
      const fsDsDoneDate = jiraData.customfield_13861;
      const testPlanDate = jiraData.customfield_11068;
      const commitGateDate = jiraData.customfield_35863;
      const promotionGateDate = jiraData.customfield_35864;
      
      if (codeCompleteDate || fsDsDoneDate || testPlanDate || commitGateDate || promotionGateDate) {
        emailHtml += `
                <tr>
        `;
        
        // Code Complete Date
        if (codeCompleteDate) {
          const codeCompleteValue = codeCompleteDate.value && codeCompleteDate.value !== 'N/A' && codeCompleteDate.value !== 'NA' && codeCompleteDate.value !== 'Not Set' 
            ? codeCompleteDate.value 
            : 'Not Set';
          const codeCompleteBg = codeCompleteValue === 'Not Set' ? '#fff3cd' : 'transparent';
          const codeCompleteWeight = codeCompleteValue === 'Not Set' ? '600' : 'normal';
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">${codeCompleteDate.name || 'Code Complete Date'}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: ${codeCompleteBg}; font-weight: ${codeCompleteWeight};">${codeCompleteValue}</td>
          `;
        } else {
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">Code Complete Date</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: #fff3cd; font-weight: 600;">Not Set</td>
          `;
        }
        
        // FS/DS Done Date
        if (fsDsDoneDate) {
          const fsDsValue = fsDsDoneDate.value && fsDsDoneDate.value !== 'N/A' && fsDsDoneDate.value !== 'NA' && fsDsDoneDate.value !== 'Not Set' 
            ? fsDsDoneDate.value 
            : 'Not Set';
          const fsDsBg = fsDsValue === 'Not Set' ? '#fff3cd' : 'transparent';
          const fsDsWeight = fsDsValue === 'Not Set' ? '600' : 'normal';
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">${fsDsDoneDate.name || 'FS/DS Done Date'}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: ${fsDsBg}; font-weight: ${fsDsWeight};">${fsDsValue}</td>
          `;
        } else {
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">FS/DS Done Date</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: #fff3cd; font-weight: 600;">Not Set</td>
          `;
        }
        
        // Test Plan Date
        if (testPlanDate) {
          const testPlanValue = testPlanDate.value && testPlanDate.value !== 'N/A' && testPlanDate.value !== 'NA' && testPlanDate.value !== 'Not Set' 
            ? testPlanDate.value 
            : 'Not Set';
          const testPlanBg = testPlanValue === 'Not Set' ? '#fff3cd' : 'transparent';
          const testPlanWeight = testPlanValue === 'Not Set' ? '600' : 'normal';
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">${testPlanDate.name || 'Test Plan Date'}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: ${testPlanBg}; font-weight: ${testPlanWeight};">${testPlanValue}</td>
          `;
        } else {
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">Test Plan Date</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: #fff3cd; font-weight: 600;">Not Set</td>
          `;
        }
        
        // Commit Gate
        if (commitGateDate) {
          const commitGateValue = commitGateDate.value && commitGateDate.value !== 'N/A' && commitGateDate.value !== 'NA' && commitGateDate.value !== 'Not Set' 
            ? commitGateDate.value 
            : 'Not Set';
          const commitGateBg = commitGateValue === 'Not Set' ? '#fff3cd' : 'transparent';
          const commitGateWeight = commitGateValue === 'Not Set' ? '600' : 'normal';
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">${commitGateDate.name || 'Commit Gate Ready Estimation Date'}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: ${commitGateBg}; font-weight: ${commitGateWeight};">${commitGateValue}</td>
          `;
        } else {
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">Commit Gate Ready Estimation Date</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: #fff3cd; font-weight: 600;">Not Set</td>
          `;
        }
        
        // Promotion Gate
        if (promotionGateDate) {
          const promotionGateValue = promotionGateDate.value && promotionGateDate.value !== 'N/A' && promotionGateDate.value !== 'NA' && promotionGateDate.value !== 'Not Set' 
            ? promotionGateDate.value 
            : 'Not Set';
          const promotionGateBg = promotionGateValue === 'Not Set' ? '#fff3cd' : 'transparent';
          const promotionGateWeight = promotionGateValue === 'Not Set' ? '600' : 'normal';
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">${promotionGateDate.name || 'Promotion Gate Ready Estimation Date'}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: ${promotionGateBg}; font-weight: ${promotionGateWeight};">${promotionGateValue}</td>
          `;
        } else {
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 16%; font-size: 0.9375rem;">Promotion Gate Ready Estimation Date</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 16%; font-size: 0.9375rem; background-color: #fff3cd; font-weight: 600;">Not Set</td>
          `;
        }
        
        emailHtml += `
                </tr>
        `;
      }
      
      const extraEmailCells = renderExtraEmailCells(jiraData);
      if (extraEmailCells) {
        emailHtml += `
                <tr>
                  ${extraEmailCells}
                </tr>
        `;
      }

      // Links row: customfield_14463, customfield_14464, customfield_14465, customfield_31460 (TCMS)
      if (jiraData.customfield_14463 || jiraData.customfield_31460 || jiraData.customfield_14464 || jiraData.customfield_14465) {
        emailHtml += `
                <tr>
        `;
        const linkColWidth = '12.5%';
        if (jiraData.customfield_14463) {
          const field14463 = jiraData.customfield_14463;
          const field14463Name = field14463.name || 'Link to Requirements';
          const field14463Value = field14463.value || {};
          const field14463Bg = field14463Value.type === 'notSet' ? '#fff3cd' : 'transparent';
          const field14463Weight = field14463Value.type === 'notSet' ? '600' : 'normal';
          const field14463Display = field14463Value.type === 'link' 
            ? `<a href="${field14463Value.url}" style="color: #0065ff; text-decoration: none;">${field14463Value.display || 'Link'}</a>`
            : (field14463Value.display || 'Not Set');
          
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: ${linkColWidth}; font-size: 0.9375rem;">${field14463Name}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: ${linkColWidth}; font-size: 0.9375rem; background-color: ${field14463Bg}; font-weight: ${field14463Weight};">${field14463Display}</td>
          `;
        }
        if (jiraData.customfield_14464) {
          const field14464 = jiraData.customfield_14464;
          const field14464Name = field14464.name || 'Link to Design Doc';
          const field14464Value = field14464.value || {};
          const field14464Bg = field14464Value.type === 'notSet' ? '#fff3cd' : 'transparent';
          const field14464Weight = field14464Value.type === 'notSet' ? '600' : 'normal';
          const field14464Display = field14464Value.type === 'link' 
            ? `<a href="${field14464Value.url}" style="color: #0065ff; text-decoration: none;">${field14464Value.display || 'Link'}</a>`
            : (field14464Value.display || 'Not Set');
          
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: ${linkColWidth}; font-size: 0.9375rem;">${field14464Name}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: ${linkColWidth}; font-size: 0.9375rem; background-color: ${field14464Bg}; font-weight: ${field14464Weight};">${field14464Display}</td>
          `;
        }
        if (jiraData.customfield_14465) {
          const field14465 = jiraData.customfield_14465;
          const field14465Name = field14465.name || 'Link to Test Plan';
          const field14465Value = field14465.value || {};
          const field14465Bg = field14465Value.type === 'notSet' ? '#fff3cd' : 'transparent';
          const field14465Weight = field14465Value.type === 'notSet' ? '600' : 'normal';
          const field14465Display = field14465Value.type === 'link' 
            ? `<a href="${field14465Value.url}" style="color: #0065ff; text-decoration: none;">${field14465Value.display || 'Link'}</a>`
            : (field14465Value.display || 'Not Set');
          
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: ${linkColWidth}; font-size: 0.9375rem;">${field14465Name}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: ${linkColWidth}; font-size: 0.9375rem; background-color: ${field14465Bg}; font-weight: ${field14465Weight};">${field14465Display}</td>
          `;
        }
        if (jiraData.customfield_31460) {
          const field31460 = jiraData.customfield_31460;
          const field31460Name = field31460.name || 'TCMS Link';
          const field31460Value = field31460.value || {};
          const field31460Bg = field31460Value.type === 'notSet' ? '#fff3cd' : 'transparent';
          const field31460Weight = field31460Value.type === 'notSet' ? '600' : 'normal';
          const field31460Display = field31460Value.type === 'link'
            ? `<a href="${field31460Value.url}" style="color: #0065ff; text-decoration: none;">${field31460Value.display || 'Link'}</a>`
            : (field31460Value.display || 'Not Set');
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: ${linkColWidth}; font-size: 0.9375rem;">${field31460Name}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: ${linkColWidth}; font-size: 0.9375rem; background-color: ${field31460Bg}; font-weight: ${field31460Weight};">${field31460Display}</td>
          `;
        }
        
        emailHtml += `
                </tr>
        `;
      }
      
      // Status Update row: customfield_23073, customfield_45660
      if (jiraData.customfield_23073 || jiraData.customfield_45660) {
        if (jiraData.customfield_23073) {
          const statusUpdate = jiraData.customfield_23073;
          const statusUpdateName = statusUpdate.name || 'Status Update';
          emailHtml += `
                <tr>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 30%; font-size: 0.9375rem;">${statusUpdateName}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 70%; font-size: 0.9375rem;">${formatContentForEmail(statusUpdate.value || 'N/A')}</td>
                </tr>
          `;
        }
        
        if (jiraData.customfield_45660) {
          const statusUpdateDate = jiraData.customfield_45660;
          const statusUpdateDateName = statusUpdateDate.name || 'Status Update Last Updated Date';
          const statusUpdateDateValue = statusUpdateDate.value && statusUpdateDate.value !== 'N/A' && statusUpdateDate.value !== 'NA' && statusUpdateDate.value !== 'Not Set'
            ? statusUpdateDate.value
            : 'Not Set';
          emailHtml += `
                <tr>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 30%; font-size: 0.9375rem;">${statusUpdateDateName}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 70%; font-size: 0.9375rem;">${statusUpdateDateValue}</td>
                </tr>
          `;
        }
        
      }
      
      emailHtml += `
              </tbody>
            </table>
      `;
    }
    
    // Add epics/breakdown if provided - match UI table format
    if (epics && Array.isArray(epics) && epics.length > 0) {
      // Calculate total epics
      const totalEpics = epics.reduce((total, feature) => total + (feature.childEpics?.length || 0), 0);
      
      emailHtml += `
            <h2>Related Epics and Features</h2>
            <p style="margin-bottom: 15px; font-size: 0.8125rem; color: #666666;">Total Epics: ${totalEpics}</p>
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Issue Type</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Resolution</th>
                  <th>Assignee</th>
      `;
      
      // Check if customfield_10860 exists in any epic
      if (epics.length > 0 && epics[0].customfield_10860?.name) {
        emailHtml += `<th>${epics[0].customfield_10860.name}</th>`;
      }
      
      emailHtml += `
                  <th>Due Date</th>
                  <th>Fix Version</th>
                </tr>
              </thead>
              <tbody>
      `;
      
      epics.forEach((feature, featureIndex) => {
        const bgColor = featureIndex % 2 === 0 ? '#ffffff' : '#fafafa';
        const featureUrl = `https://jira.nutanix.com/browse/${feature.key}`;
        
        // Feature/Initiative row
        emailHtml += `
                <tr style="background-color: ${bgColor};">
                  <td><span style="margin-right: 8px;">-</span><a href="${featureUrl}">${feature.key}</a></td>
                  <td>${feature.issueType || 'Feature'}</td>
                  <td>${feature.summary || 'N/A'}</td>
                  <td>${feature.status || 'N/A'}</td>
                  <td>${feature.resolution || 'N/A'}</td>
                  <td>${feature.assignee || 'N/A'}</td>
        `;
        
        if (epics.length > 0 && epics[0].customfield_10860?.name) {
          emailHtml += `<td>${feature.customfield_10860?.value || 'Not Set'}</td>`;
        }
        
        emailHtml += `
                  <td>${feature.duedate || 'Not Set'}</td>
                  <td>${feature.fixVersions || 'N/A'}</td>
                </tr>
        `;
        
        // Child Epics
        if (feature.childEpics && feature.childEpics.length > 0) {
          feature.childEpics.forEach((epic) => {
            const epicUrl = `https://jira.nutanix.com/browse/${epic.key}`;
            emailHtml += `
                <tr style="background-color: ${bgColor};">
                  <td style="padding-left: 2rem;"><span style="margin-right: 8px;">--</span><a href="${epicUrl}">${epic.key}</a></td>
                  <td>${epic.issueType || 'Epic'}</td>
                  <td>${epic.summary || 'N/A'}</td>
                  <td>${epic.status || 'N/A'}</td>
                  <td>${epic.resolution || 'N/A'}</td>
                  <td>${epic.assignee || 'N/A'}</td>
            `;
            
            if (epics.length > 0 && epics[0].customfield_10860?.name) {
              emailHtml += `<td>${epic.customfield_10860?.value || 'Not Set'}</td>`;
            }
            
            emailHtml += `
                  <td>${epic.duedate || 'Not Set'}</td>
                  <td>${epic.fixVersions || 'N/A'}</td>
                </tr>
            `;
          });
        }
      });
      
      emailHtml += `
              </tbody>
            </table>
      `;
    }
    
    // Issue Breakdown - match UI format with bar charts
    if (issueBreakdown) {
      // Status colors matching UI
      const statusColors = {
        'Done': '#1a1a1a',
        'In Progress': '#666666',
        'To Do': '#999999',
        'Blocked': '#dc3545',
        'Other': '#cccccc'
      };
      
      emailHtml += `
            <h2>Issue Breakdown</h2>
      `;
      
      if (issueBreakdown.total > 0) {
        emailHtml += `
            <p style="margin-bottom: 15px; font-size: 0.8125rem; color: #666666;">Total Issues: ${issueBreakdown.total} (excluding Feature, Epic, Initiative, X-FEAT, Capability)</p>
        `;
        
        // Detailed breakdown by issue type with bar charts
        if (issueBreakdown.breakdown && Array.isArray(issueBreakdown.breakdown) && issueBreakdown.breakdown.length > 0) {
          emailHtml += `<h3>Issue Type Breakdown by Status</h3>`;
          
          issueBreakdown.breakdown.forEach((item) => {
            const typePercentage = ((item.total / issueBreakdown.total) * 100).toFixed(1);
            
            // Calculate percentages for each status category
            const statusCategories = ['Done', 'In Progress', 'To Do', 'Blocked', 'Other'];
            const categoryPercentages = statusCategories.map(category => {
              const categoryData = item.statusCategories?.[category];
              if (!categoryData) return { category, total: 0, percentage: 0 };
              const categoryTotal = Object.values(categoryData).reduce((sum, count) => sum + count, 0);
              return {
                category,
                total: categoryTotal,
                percentage: item.total > 0 ? ((categoryTotal / item.total) * 100) : 0
              };
            }).filter(cat => cat.total > 0);
            
            emailHtml += `
              <div style="margin-bottom: 20px;">
                <p style="font-weight: 600; font-size: 0.875rem; color: #1a1a1a; margin-bottom: 8px;">
                  ${item.type}: ${item.total} (${typePercentage}%)
                </p>
                
                <!-- Stacked bar chart using table -->
                <table style="width: 100%; height: 24px; border-collapse: collapse; border: 1px solid #1a1a1a; margin-bottom: 8px; background-color: #f5f5f5;">
                  <tr>
            `;
            
            // Create bar segments
            categoryPercentages.forEach((cat, catIndex) => {
              const width = cat.percentage > 0 ? cat.percentage : 0;
              const textColor = cat.category === 'Done' ? '#ffffff' : '#1a1a1a';
              const showText = cat.percentage > 5;
              
              emailHtml += `
                    <td style="
                      width: ${width}%;
                      background-color: ${statusColors[cat.category]};
                      color: ${textColor};
                      font-size: 11px;
                      font-weight: 600;
                      text-align: center;
                      vertical-align: middle;
                      border-right: ${catIndex < categoryPercentages.length - 1 ? '1px solid #1a1a1a' : 'none'};
                      padding: 0;
                      height: 24px;
                      line-height: 24px;
                      overflow: hidden;
                      white-space: nowrap;
                    ">${showText ? cat.total : ''}</td>
              `;
            });
            
            emailHtml += `
                  </tr>
                </table>
                
                <!-- Legend -->
                <div style="display: inline-block; margin-top: 6px;">
            `;
            
            categoryPercentages.forEach((cat) => {
              emailHtml += `
                  <span style="display: inline-block; margin-right: 12px; font-size: 0.75rem; color: #1a1a1a;">
                    <span style="
                      display: inline-block;
                      width: 12px;
                      height: 12px;
                      background-color: ${statusColors[cat.category]};
                      margin-right: 6px;
                      border: 1px solid #1a1a1a;
                      vertical-align: middle;
                    "></span>
                    ${cat.category}: ${cat.total} (${cat.percentage.toFixed(1)}%)
                  </span>
              `;
            });
            
            emailHtml += `
                </div>
              </div>
            `;
          });
        }
        
        // Overall Statistics with bar chart
        if (issueBreakdown.overallStats) {
          const stats = issueBreakdown.overallStats;
          
          // Calculate overall percentages
          const overallCategories = [];
          if (stats.done > 0) {
            overallCategories.push({
              category: 'Done',
              total: stats.done,
              percentage: ((stats.done / issueBreakdown.total) * 100)
            });
          }
          if (stats.inProgress > 0) {
            overallCategories.push({
              category: 'In Progress',
              total: stats.inProgress,
              percentage: ((stats.inProgress / issueBreakdown.total) * 100)
            });
          }
          if (stats.toDo > 0) {
            overallCategories.push({
              category: 'To Do',
              total: stats.toDo,
              percentage: ((stats.toDo / issueBreakdown.total) * 100)
            });
          }
          if (stats.blocked > 0) {
            overallCategories.push({
              category: 'Blocked',
              total: stats.blocked,
              percentage: ((stats.blocked / issueBreakdown.total) * 100)
            });
          }
          if (stats.other > 0) {
            overallCategories.push({
              category: 'Other',
              total: stats.other,
              percentage: ((stats.other / issueBreakdown.total) * 100)
            });
          }
          
          emailHtml += `
            <div style="margin-top: 20px; padding: 15px; background-color: #ffffff; border: 1px solid #1a1a1a;">
              <h4 style="margin-top: 0; margin-bottom: 12px; font-size: 0.875rem; font-weight: 600; color: #1a1a1a;">
                Overall Statistics
              </h4>
              
              <!-- Overall bar chart -->
              <table style="width: 100%; height: 24px; border-collapse: collapse; border: 1px solid #1a1a1a; margin-bottom: 10px; background-color: #f5f5f5;">
                <tr>
          `;
          
          overallCategories.forEach((cat, catIndex) => {
            const width = cat.percentage > 0 ? cat.percentage : 0;
            const textColor = cat.category === 'Done' ? '#ffffff' : '#1a1a1a';
            const showText = cat.percentage > 5;
            
            emailHtml += `
                  <td style="
                    width: ${width}%;
                    background-color: ${statusColors[cat.category]};
                    color: ${textColor};
                    font-size: 11px;
                    font-weight: 600;
                    text-align: center;
                    vertical-align: middle;
                    border-right: ${catIndex < overallCategories.length - 1 ? '1px solid #1a1a1a' : 'none'};
                    padding: 0;
                    height: 24px;
                    line-height: 24px;
                    overflow: hidden;
                    white-space: nowrap;
                  ">${showText ? cat.total : ''}</td>
            `;
          });
          
          emailHtml += `
                </tr>
              </table>
              
              <!-- Overall legend -->
              <div style="font-size: 0.8125rem; color: #1a1a1a; margin-bottom: 10px;">
          `;
          
          overallCategories.forEach((cat) => {
            emailHtml += `
                <span style="display: inline-block; margin-right: 12px;">
                  <span style="
                    display: inline-block;
                    width: 12px;
                    height: 12px;
                    background-color: ${statusColors[cat.category]};
                    margin-right: 6px;
                    border: 1px solid #1a1a1a;
                    vertical-align: middle;
                  "></span>
                  ${cat.category}: ${cat.total} (${cat.percentage.toFixed(1)}%)
                </span>
            `;
          });
          
          emailHtml += `
              </div>
              
              <div style="margin-top: 10px; font-weight: 600; color: #1a1a1a; font-size: 0.875rem;">
                Overall Completion Rate: ${stats.completionRate || '0'}%
              </div>
            </div>
          `;
        }
      } else {
        emailHtml += `
            <p style="color: #666666; font-size: 0.8125rem;">No tasks, bugs, or other issues found (excluding Feature, Epic, Initiative, X-FEAT, Capability).</p>
        `;
      }
    }

    emailHtml += renderSprintGanttEmailSection(sprintGanttData);
    
    emailHtml += `
            <div class="footer">
              <p>This is an automated status update email.</p>
            </div>
          </div>
        </body>
      </html>
    `;
    
    // Always CC the sender so they get a copy of what they sent.
    // Also apply the status-sender people list (emailSenderCCConfig.defaultCC).
    // Only add @nutanix.com addresses to avoid relay rejection on external domains.
    const ccEmails = new Set();
    if (userEmail && userEmail.endsWith('@nutanix.com')) {
      ccEmails.add(userEmail.toLowerCase());
    }
    const statusSenderCC = Array.isArray(emailSenderCCConfig.defaultCC) ? emailSenderCCConfig.defaultCC : [];
    for (const addr of statusSenderCC) {
      const normalized = String(addr || '').trim().toLowerCase();
      if (normalized.endsWith('@nutanix.com')) {
        ccEmails.add(normalized);
      }
    }

    // CC the assignee's manager when JIRA data is present (customfield_19262).
    if (jiraData) {
      const managerEmail = jiraData.customfield_19262?.emailAddress;
      if (managerEmail && managerEmail.endsWith('@nutanix.com')) {
        ccEmails.add(managerEmail.toLowerCase());
      }
    }

    // Format date for subject if not provided
    const dateStr = formatDateForEmail();
    let subject = emailSubject || `NDB Status Update - ${dateStr}`;

    // Test mode: send only to the sender (no DL), no CC, tag subject.
    const isTestMode = req.body.isTest === true || req.query.isTest === 'true' || process.env.EMAIL_DRY_RUN === 'true';
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

    const mailOptions = {
      replyTo: userEmail,
      to: toEmailList,
      cc: ccForSend,
      subject: subject,
      html: emailHtml
    };

    if (req.previewOnly) {
      const stripHtml = (html) => {
        if (!html || typeof html !== 'string') return '';
        return html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
      };
      return res.json({
        success: true,
        to: mailOptions.to,
        cc: mailOptions.cc || '',
        subject: mailOptions.subject,
        htmlBody: emailHtml,
        textBody: stripHtml(emailHtml)
      });
    }
    
    // Dry run: don't send, just log and return success
    const isDryRun = req.body.dryRun === true || req.query.dryRun === 'true' || process.env.EMAIL_DRY_RUN === 'true';
    if (isDryRun) {
      console.log('[Email /send] DRY RUN - email not sent:', {
        from: getDefaultFromAddress(),
        to: mailOptions.to,
        cc: mailOptions.cc || '(none)',
        subject: mailOptions.subject
      });
      const wouldSendTo = isTestMode ? [userEmail] : (toList.length > 0 ? toList : [userEmail]);
      return res.json({
        success: true,
        message: 'Dry run: email not sent.',
        dryRun: true,
        recipients: wouldSendTo
      });
    }
    
    // TODO: Handle PDF attachment if attachPdf is true
    // Note: Would require puppeteer or similar library to generate PDF from HTML
    // Currently not implemented - puppeteer was removed to reduce bundle size
    
    const info = await sendEmailDirect(mailOptions);
    console.log(JSON.stringify({
      event: 'email_sent',
      subject: mailOptions.subject,
      to: mailOptions.to,
      cc: mailOptions.cc || [],
      accepted: (info && info.accepted) || [],
      rejected: (info && info.rejected) || []
    }));
    console.log(`[Email /send] Sent via method: ${info.method || 'unknown'}`);

    const accepted = info.accepted || [];
    const rejected = info.rejected || [];
    if (rejected.length > 0) {
      console.warn(`[Email /send] Some recipients rejected by SMTP: ${rejected.join(', ')}`);
    }
    if (accepted.length === 0) {
      console.error('[Email /send] No recipients were accepted by SMTP; all rejected.');
      logger.email.failed(
        userEmail,
        isTestMode ? [userEmail] : (toList.length > 0 ? toList : [userEmail]),
        subject,
        new Error('All recipients were rejected by the mail server'),
        jiraKey || null,
        null,
        { username, rejected, ip: userIp, userAgent }
      );
      return res.status(500).json({
        success: false,
        error: 'All recipients were rejected by the mail server. No one received the email.',
        message: rejected.length > 0 ? `Rejected: ${rejected.join(', ')}` : 'Check SMTP relay and recipient addresses.'
      });
    }

    // Actual recipients sent to (in test mode this is only the user)
    const sentTo = isTestMode ? [userEmail] : (toList.length > 0 ? toList : [userEmail]);
    const sentCc = Array.from(ccEmails);

    // AUDIT: Log successful email send
    logger.email.sent(
      userEmail,
      sentTo,
      sentCc,
      subject,
      jiraKey || null,
      null, // releaseVersions
      {
        username,
        messageId: info.messageId,
        contentSize: emailHtml.length,
        hasJiraData: !!jiraData,
        hasEpics: !!epics,
        attachPdf: !!attachPdf,
        isTestMode,
        ip: userIp,
        userAgent
      }
    );
    
    // Save to database for history tracking (only non-sensitive data)
    try {
      const isTestRecord = isTestMode || (process.env.NODE_ENV === 'development' && 
                     (subject?.toLowerCase().includes('test') || 
                      subject?.toLowerCase().includes('[test]')));
      
      await saveEmailHistory({
        username,
        userEmail,
        to: sentTo,
        cc: sentCc,
        subject: subject,
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
    } catch (dbError) {
      console.error('[Email History DB] Failed to save email history:', dbError);
      // Don't fail the email send if DB save fails
    }
    
    return res.json({
      success: true,
      message: isTestMode ? 'Email sent only to you (test mode).' : 'Email sent successfully',
      messageId: info.messageId,
      recipients: sentTo,
      isTestMode: !!isTestMode
    });
    
  } catch (error) {
    // AUDIT: Log email send failure
    // Use JIRA email if available, otherwise 'unknown' for logging
    const logEmail = (req.jiraUser && (req.jiraUser.emailAddress || req.jiraUser.email)) 
      ? (req.jiraUser.emailAddress || req.jiraUser.email)
      : 'unknown';
    const toEmails = req.body?.emailRecipients ? 
      parseEmailRecipients(req.body.emailRecipients) : [];
    
    logger.email.failed(
      logEmail,
      toEmails.length > 0 ? toEmails : [logEmail],
      req.body?.emailSubject || 'NDB Status Update',
      error,
      req.body?.jiraKey || null,
      null, // releaseVersions
      {
        username,
        ip: userIp,
        userAgent,
        errorCode: error.code,
        errorResponseCode: error.responseCode
      }
    );
    
    const errorMessage = error.response?.data?.error || error.message || 'Failed to send email';
    return res.status(500).json({
      success: false,
      error: errorMessage,
      message: error.message
    });
  }
};
