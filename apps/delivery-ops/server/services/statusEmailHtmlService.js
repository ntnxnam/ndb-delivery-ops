/**
 * Build sanitized HTML for Status Sender weekly email (/api/email/send).
 * Route handler orchestrates auth/CC/SMTP; this module owns markup only.
 */

const { formatContentForEmail } = require('../utils/emailFormatter');
const {
  renderAiRiskSummaryEmailSection,
  renderSprintGanttEmailSection,
} = require('../utils/sprintGanttEmail');
const { escapeHtml, safeHttpUrl, sanitizeEmailHtml } = require('../utils/emailHtmlSanitize');
const { renderIssueBreakdownEmailHtml } = require('../utils/issueBreakdownEmailHtml');
const releaseVersionsEmailConfig = require('../config/releaseVersionsEmailConfig.json');
const {
  resolveReleaseGaDate,
  resolveReleaseCcDate,
  buildGateVsActualRows,
} = require('../utils/gateActualsUtils');
const { getFieldId, getFieldValue } = require('../utils/jiraFieldsConfig');

const JIRA_KEY_RE = /^[A-Z][A-Z0-9]+-\d+$/i;

function safeJiraKey(key) {
  const k = String(key || '').trim();
  return JIRA_KEY_RE.test(k) ? k : '';
}

const EXTRA_EMAIL_FIELDS = [
  [getFieldId('cgChecklistLink'), 'Link to CG checklist'],
  [getFieldId('pgChecklistLink'), 'Link to PG checklist'],
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
        ? renderSafeLink(value.url, value.display || 'Link')
        : (value.display || 'Not Set');
      return `<td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 12.5%; font-size: 0.9375rem;">${escapeHtml(name)}</td><td style="padding: 8px; border: 1px solid #1a1a1a; width: 12.5%; font-size: 0.9375rem; background-color: ${bg}; font-weight: ${weight};">${typeof display === 'string' && display.includes('<a ') ? display : escapeHtml(display)}</td>`;
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
  const risk = getFieldValue(jiraData, 'riskIndicator');
  const assessment = getFieldValue(jiraData, 'riskAssessment');
  const path = getFieldValue(jiraData, 'pathToGreen');
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
  if (!raw || raw === 'N/A') return { version: null, ecDate: null, gaDate: null, ccDate: null, cfg: null };
  const version = String(raw).split(',')[0].trim();
  const cfg = releaseVersionsEmailConfig.releaseGateDates?.[version];
  return {
    version,
    ecDate: cfg?.ecDate || null,
    gaDate: resolveReleaseGaDate(cfg),
    ccDate: resolveReleaseCcDate(cfg),
    cfg,
  };
}

function formatEmailGateDate(date) {
  if (!date) return 'Not Set';
  const day = String(date.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day}/${months[date.getMonth()]}/${date.getFullYear()}`;
}

/** One table: Prescribed vs Actual paired bars (days from EC). */
function renderGateDatesChartSection(jiraData, workItems) {
  if (!jiraData) return '';
  const { version, ecDate: ecRaw, gaDate: gaRaw, ccDate: ccRaw } = resolveEcDateForJiraData(jiraData);
  const ecDate = parseEmailDisplayDate(ecRaw);
  if (!ecDate) {
    return `
            <h2>Gates vs Actuals</h2>
            <p style="font-size: 0.875rem; background: #fff3cd; padding: 8px; border: 1px solid #1a1a1a;">EC date is required as the timeline start${version ? ` (no EC in release config for ${version})` : ''}.</p>
    `;
  }

  const { rows, notes, ecLabel } = buildGateVsActualRows(jiraData, ecRaw, gaRaw, workItems, ccRaw);
  if (!rows.length) {
    return `
            <h2>Gates vs Actuals</h2>
            <p style="font-size: 0.875rem; background: #fff3cd; padding: 8px; border: 1px solid #1a1a1a;">EC is ${ecLabel}, but no gate or actual dates to plot yet.</p>
    `;
  }

  const totalSpan = Math.max(
    1,
    ...rows.map((r) => Math.max(
      r.gateSet ? (r.gateOffset || 0) + (r.gateDuration || 0) + (r.gateDuration2 || 0) : 0,
      r.actualSet ? (r.actualOffset || 0) + (r.actualDuration || 0) : 0
    ))
  );

  const body = rows.map((r) => {
    const gateLeft = r.gateSet ? Math.round((r.gateOffset / totalSpan) * 100) : 0;
    const gateW = r.gateSet ? Math.max(2, Math.round((r.gateDuration / totalSpan) * 100)) : 0;
    const gate2W = r.hasTicketSegment
      ? Math.max(2, Math.round(((r.gateDuration2 || 0) / totalSpan) * 100))
      : 0;
    const actualLeft = r.actualSet ? Math.round((r.actualOffset / totalSpan) * 100) : 0;
    const actualW = r.actualSet ? Math.max(2, Math.round((r.actualDuration / totalSpan) * 100)) : 0;
    const gateColor = r.gateInverted ? '#dc3545' : '#6c757d';
    const gate2Color = r.gateInverted ? '#e57373' : '#adb5bd';
    const actualColor = r.actualInverted ? '#dc3545' : '#1f77b4';
    const gateSpan = r.gateSet
      ? (r.gateInverted ? `${Math.abs(r.gateDaySpan)}d inv` : `${r.gateDaySpan}d`)
      : '';
    const actualSpan = r.actualSet
      ? (r.actualInverted ? `${Math.abs(r.actualDaySpan)}d inv` : `${r.actualDaySpan}d`)
      : '';
    return `
                <tr>
                  <td style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; width: 16%; font-weight: 600;">${r.label}</td>
                  <td style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; width: 22%;">${r.gateDateLabel}${gateSpan ? ` (${gateSpan})` : ''}</td>
                  <td style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; width: 22%;">${r.actualDateLabel}${actualSpan ? ` (${actualSpan})` : ''}${r.partial ? ' *' : ''}</td>
                  <td style="padding: 6px 8px; border: 1px solid #1a1a1a; width: 40%;">
                    <div style="background: #f1f3f5; height: 10px; width: 100%; position: relative; margin-bottom: 3px;">
                      ${r.gateSet ? `<div style="position: absolute; left: ${gateLeft}%; width: ${gateW}%; background: ${gateColor}; height: 10px;" title="Prescribed"></div>` : ''}
                      ${r.hasTicketSegment ? `<div style="position: absolute; left: ${gateLeft + gateW}%; width: ${gate2W}%; background: ${gate2Color}; height: 10px;" title="Ticket CC"></div>` : ''}
                    </div>
                    <div style="background: #f1f3f5; height: 10px; width: 100%; position: relative;">
                      ${r.actualSet ? `<div style="position: absolute; left: ${actualLeft}%; width: ${actualW}%; background: ${actualColor}; height: 10px;" title="Actual"></div>` : ''}
                    </div>
                  </td>
                </tr>`;
  }).join('');

  return `
            <h2>Gates vs Actuals</h2>
            <p style="font-size: 0.8125rem; margin: 0 0 8px;">Days from <strong>EC ${formatEmailGateDate(ecDate)}</strong>${version ? ` · ${version}` : ''} · grey = Prescribed · blue = Actual · CC Prescribed = release gate + ticket date</p>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 8px;">
              <thead>
                <tr>
                  <th style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; text-align: left;">Phase</th>
                  <th style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; text-align: left;">Prescribed</th>
                  <th style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; text-align: left;">Actual</th>
                  <th style="padding: 6px 8px; border: 1px solid #1a1a1a; font-size: 0.8125rem; text-align: left;">Timeline</th>
                </tr>
              </thead>
              <tbody>${body}
              </tbody>
            </table>
            <p style="font-size: 0.75rem; color: #666; margin-top: 0;">CC Actual = first coding start → last coding finish (Task/Unit Test; not Bug/Improvement) · CG/PG Actual = latest closed · GA needs everything closed${!Array.isArray(workItems) ? ' · work items not provided' : ''}${notes.length ? ` · ${notes.join('; ')}` : ''}</p>
  `;
}


function renderSafeLink(url, display) {
  const href = safeHttpUrl(url);
  const label = escapeHtml(display || 'Link');
  if (!href) return label;
  return `<a href="${href}" style="color: #0065ff; text-decoration: none;" rel="noopener noreferrer">${label}</a>`;
}

/**
 * @param {object} opts
 * @returns {string} full sanitized HTML document
 */
function buildStatusEmailHtml({
  additionalDetails,
  aiSummary,
  jiraKey,
  jiraData,
  epics,
  workItems,
  issueBreakdown,
  sprintGanttData,
}) {
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
      emailHtml += renderGateDatesChartSection(jiraData, workItems);
    }
    
    // Add JIRA data if provided - match UI table format
    if (jiraData) {
      const jiraBaseUrl = 'https://jira.nutanix.com';
      const keyForUrl = safeJiraKey(jiraKey || jiraData.key);
      const jiraUrl = keyForUrl ? `${jiraBaseUrl}/browse/${encodeURIComponent(keyForUrl)}` : '';
      
      emailHtml += `
            <h2>JIRA Ticket Information</h2>
            
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 15px;">
              <tbody>
                <tr>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 6%; font-size: 0.9375rem;">Key</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 10%; font-size: 0.9375rem;">
                    ${jiraUrl ? `<a href="${jiraUrl}" style="color: #0065ff; text-decoration: none;" rel="noopener noreferrer">${escapeHtml(jiraKey || jiraData.key || 'N/A')}</a>` : escapeHtml(jiraKey || jiraData.key || 'N/A')}
                  </td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 8%; font-size: 0.9375rem;">Summary</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 25%; font-size: 0.9375rem;">${escapeHtml(jiraData.summary || 'N/A')}</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 7%; font-size: 0.9375rem;">Status</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 12%; font-size: 0.9375rem;">${escapeHtml(jiraData.status || 'N/A')}</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 9%; font-size: 0.9375rem;">Fix Version</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 13%; font-size: 0.9375rem;">${escapeHtml(jiraData.fixVersions || 'N/A')}</td>
                </tr>
                <tr>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; font-weight: 600; width: 6%; font-size: 0.9375rem;">Labels</td>
                  <td style="padding: 10px; border: 1px solid #1a1a1a; width: 94%; font-size: 0.9375rem;" colspan="7">${escapeHtml(jiraData.labels || 'N/A')}</td>
                </tr>
      `;
      
      // Date fields row (fixed order): Requirements Done → FS/DS → Test Plan → Code Complete → CG → PG
      const DATE_ROW_FIELDS = [
        { field: getFieldValue(jiraData, 'requirementsDone'), fallback: 'Rqmnts Done Date' },
        { field: getFieldValue(jiraData, 'fsdsDone'), fallback: 'FS/DS Done Date' },
        { field: getFieldValue(jiraData, 'testPlan'), fallback: 'Test Plan Date' },
        { field: getFieldValue(jiraData, 'codeComplete'), fallback: 'Code Complete Date' },
        { field: getFieldValue(jiraData, 'commitGate'), fallback: 'Commit Gate Ready Estimation Date' },
        { field: getFieldValue(jiraData, 'promotionGate'), fallback: 'Promotion Gate Ready Estimation Date' },
      ];
      emailHtml += `
                <tr>
      `;
      for (const { field, fallback } of DATE_ROW_FIELDS) {
        const raw = field && field.value;
        const value = raw && raw !== 'N/A' && raw !== 'NA' && raw !== 'Not Set' ? raw : 'Not Set';
        const unset = value === 'Not Set';
        emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 8.33%; font-size: 0.9375rem;">${escapeHtml((field && field.name) || fallback)}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 8.33%; font-size: 0.9375rem; background-color: ${unset ? '#fff3cd' : 'transparent'}; font-weight: ${unset ? '600' : 'normal'};">${escapeHtml(value)}</td>
        `;
      }
      emailHtml += `
                </tr>
      `;
      
      const extraEmailCells = renderExtraEmailCells(jiraData);
      if (extraEmailCells) {
        emailHtml += `
                <tr>
                  ${extraEmailCells}
                </tr>
        `;
      }

      // Links row: requirementsLink, designDocLink, testPlanLink, tcmsLink (TCMS)
      if (getFieldValue(jiraData, 'requirementsLink')) {
        emailHtml += `
                <tr>
        `;
        const linkColWidth = '12.5%';
        if (getFieldValue(jiraData, 'requirementsLink')) {
          const field14463 = getFieldValue(jiraData, 'requirementsLink');
          const field14463Name = field14463.name || 'Link to Requirements';
          const field14463Value = field14463.value || {};
          const field14463Bg = field14463Value.type === 'notSet' ? '#fff3cd' : 'transparent';
          const field14463Weight = field14463Value.type === 'notSet' ? '600' : 'normal';
          const field14463Display = field14463Value.type === 'link' 
            ? renderSafeLink(field14463Value.url, field14463Value.display || 'Link')
            : escapeHtml(field14463Value.display || 'Not Set');
          
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: ${linkColWidth}; font-size: 0.9375rem;">${escapeHtml(field14463Name)}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: ${linkColWidth}; font-size: 0.9375rem; background-color: ${field14463Bg}; font-weight: ${field14463Weight};">${field14463Display}</td>
          `;
        }
        if (getFieldValue(jiraData, 'designDocLink')) {
          const field14464 = getFieldValue(jiraData, 'designDocLink');
          const field14464Name = field14464.name || 'Link to Design Doc';
          const field14464Value = field14464.value || {};
          const field14464Bg = field14464Value.type === 'notSet' ? '#fff3cd' : 'transparent';
          const field14464Weight = field14464Value.type === 'notSet' ? '600' : 'normal';
          const field14464Display = field14464Value.type === 'link' 
            ? renderSafeLink(field14464Value.url, field14464Value.display || 'Link')
            : escapeHtml(field14464Value.display || 'Not Set');
          
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: ${linkColWidth}; font-size: 0.9375rem;">${escapeHtml(field14464Name)}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: ${linkColWidth}; font-size: 0.9375rem; background-color: ${field14464Bg}; font-weight: ${field14464Weight};">${field14464Display}</td>
          `;
        }
        if (getFieldValue(jiraData, 'testPlanLink')) {
          const field14465 = getFieldValue(jiraData, 'testPlanLink');
          const field14465Name = field14465.name || 'Link to Test Plan';
          const field14465Value = field14465.value || {};
          const field14465Bg = field14465Value.type === 'notSet' ? '#fff3cd' : 'transparent';
          const field14465Weight = field14465Value.type === 'notSet' ? '600' : 'normal';
          const field14465Display = field14465Value.type === 'link' 
            ? renderSafeLink(field14465Value.url, field14465Value.display || 'Link')
            : escapeHtml(field14465Value.display || 'Not Set');
          
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: ${linkColWidth}; font-size: 0.9375rem;">${escapeHtml(field14465Name)}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: ${linkColWidth}; font-size: 0.9375rem; background-color: ${field14465Bg}; font-weight: ${field14465Weight};">${field14465Display}</td>
          `;
        }
        if (getFieldValue(jiraData, 'tcmsLink')) {
          const field31460 = getFieldValue(jiraData, 'tcmsLink');
          const field31460Name = field31460.name || 'TCMS Link';
          const field31460Value = field31460.value || {};
          const field31460Bg = field31460Value.type === 'notSet' ? '#fff3cd' : 'transparent';
          const field31460Weight = field31460Value.type === 'notSet' ? '600' : 'normal';
          const field31460Display = field31460Value.type === 'link'
            ? renderSafeLink(field31460Value.url, field31460Value.display || 'Link')
            : escapeHtml(field31460Value.display || 'Not Set');
          emailHtml += `
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: ${linkColWidth}; font-size: 0.9375rem;">${escapeHtml(field31460Name)}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: ${linkColWidth}; font-size: 0.9375rem; background-color: ${field31460Bg}; font-weight: ${field31460Weight};">${field31460Display}</td>
          `;
        }
        
        emailHtml += `
                </tr>
        `;
      }
      
      // Status Update row: statusUpdate, statusUpdateDate
      if (getFieldValue(jiraData, 'statusUpdate')) {
        if (getFieldValue(jiraData, 'statusUpdate')) {
          const statusUpdate = getFieldValue(jiraData, 'statusUpdate');
          const statusUpdateName = statusUpdate.name || 'Status Update';
          emailHtml += `
                <tr>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 30%; font-size: 0.9375rem;">${escapeHtml(statusUpdateName)}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 70%; font-size: 0.9375rem;">${formatContentForEmail(statusUpdate.value || 'N/A')}</td>
                </tr>
          `;
        }
        
        if (getFieldValue(jiraData, 'statusUpdateDate')) {
          const statusUpdateDate = getFieldValue(jiraData, 'statusUpdateDate');
          const statusUpdateDateName = statusUpdateDate.name || 'Status Update Last Updated Date';
          const statusUpdateDateValue = statusUpdateDate.value && statusUpdateDate.value !== 'N/A' && statusUpdateDate.value !== 'NA' && statusUpdateDate.value !== 'Not Set'
            ? statusUpdateDate.value
            : 'Not Set';
          emailHtml += `
                <tr>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; font-weight: 600; width: 30%; font-size: 0.9375rem;">${escapeHtml(statusUpdateDateName)}</td>
                  <td style="padding: 8px; border: 1px solid #1a1a1a; width: 70%; font-size: 0.9375rem;">${escapeHtml(statusUpdateDateValue)}</td>
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
      // Calculate total epics + authenticity link (exact key set shown)
      const totalEpics = epics.reduce((total, feature) => total + (feature.childEpics?.length || 0), 0);
      const epicKeys = [];
      epics.forEach((feature) => {
        (feature.childEpics || []).forEach((epic) => {
          const k = safeJiraKey(epic?.key);
          if (k) epicKeys.push(k);
        });
      });
      const jiraSearchBase = 'https://jira.nutanix.com/issues/?jql=';
      const totalEpicsJql = epicKeys.length > 0 ? `key in (${epicKeys.join(', ')})` : '';
      const totalEpicsUrl = totalEpicsJql
        ? `${jiraSearchBase}${encodeURIComponent(totalEpicsJql)}`
        : '';
      const totalEpicsLabel = totalEpicsUrl
        ? `<a href="${totalEpicsUrl}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(totalEpicsJql)}">${escapeHtml(totalEpics)}</a>`
        : escapeHtml(totalEpics);
      
      emailHtml += `
            <h2>Epics</h2>
            <p style="margin-bottom: 15px; font-size: 0.8125rem; color: #666666;">Total Epics: ${totalEpicsLabel}</p>
            <div style="overflow-x: auto; max-width: 800px;">
            <table style="min-width: 720px;">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Issue Type</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Resolution</th>
                  <th>Assignee</th>
                  <th>QA Contact</th>
                  <th>Due Date</th>
                  <th>Fix Version</th>
                </tr>
              </thead>
              <tbody>
      `;
      
      epics.forEach((feature, featureIndex) => {
        const bgColor = featureIndex % 2 === 0 ? '#ffffff' : '#fafafa';
        const featureKeySafe = safeJiraKey(feature.key);
        const featureKeyDisplay = escapeHtml(feature.key || 'N/A');
        const featureUrl = featureKeySafe
          ? `https://jira.nutanix.com/browse/${encodeURIComponent(featureKeySafe)}`
          : '';
        const featureKeyCell = featureUrl
          ? `<a href="${featureUrl}">${featureKeyDisplay}</a>`
          : featureKeyDisplay;
        
        // Feature/Initiative row
        emailHtml += `
                <tr style="background-color: ${bgColor};">
                  <td><span style="margin-right: 8px;">-</span>${featureKeyCell}</td>
                  <td>${escapeHtml(feature.issueType || 'Feature')}</td>
                  <td>${escapeHtml(feature.summary || 'N/A')}</td>
                  <td>${escapeHtml(feature.status || 'N/A')}</td>
                  <td>${escapeHtml(feature.resolution || 'N/A')}</td>
                  <td>${escapeHtml(feature.assignee || 'N/A')}</td>
                  <td>${escapeHtml(getFieldValue(feature, 'qaContact')?.value || 'Not Set')}</td>
                  <td>${escapeHtml(feature.duedate || 'Not Set')}</td>
                  <td>${escapeHtml(feature.fixVersions || 'N/A')}</td>
                </tr>
        `;
        
        // Child Epics
        if (feature.childEpics && feature.childEpics.length > 0) {
          feature.childEpics.forEach((epic) => {
            const epicKeySafe = safeJiraKey(epic.key);
            const epicKeyDisplay = escapeHtml(epic.key || 'N/A');
            const epicUrl = epicKeySafe
              ? `https://jira.nutanix.com/browse/${encodeURIComponent(epicKeySafe)}`
              : '';
            const epicKeyCell = epicUrl
              ? `<a href="${epicUrl}">${epicKeyDisplay}</a>`
              : epicKeyDisplay;
            emailHtml += `
                <tr style="background-color: ${bgColor};">
                  <td style="padding-left: 2rem;"><span style="margin-right: 8px;">--</span>${epicKeyCell}</td>
                  <td>${escapeHtml(epic.issueType || 'Epic')}</td>
                  <td>${escapeHtml(epic.summary || 'N/A')}</td>
                  <td>${escapeHtml(epic.status || 'N/A')}</td>
                  <td>${escapeHtml(epic.resolution || 'N/A')}</td>
                  <td>${escapeHtml(epic.assignee || 'N/A')}</td>
                  <td>${escapeHtml(getFieldValue(epic, 'qaContact')?.value || 'Not Set')}</td>
                  <td>${escapeHtml(epic.duedate || 'Not Set')}</td>
                  <td>${escapeHtml(epic.fixVersions || 'N/A')}</td>
                </tr>
            `;
          });
        }
      });
      
      emailHtml += `
              </tbody>
            </table>
            </div>
      `;
    }
    
    // Compact issue-type × status table (replaces tall stacked-bar + legend layout).
    emailHtml += renderIssueBreakdownEmailHtml(issueBreakdown);

    emailHtml += renderSprintGanttEmailSection(sprintGanttData);
    
    emailHtml += `
            <div class="footer">
              <p>This is an automated status update email.</p>
            </div>
          </div>
        </body>
      </html>
    `;
    

    return sanitizeEmailHtml(emailHtml);
}

module.exports = {
  buildStatusEmailHtml,
  safeJiraKey,
  escapeHtml,
  safeHttpUrl,
};
