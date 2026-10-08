/**
 * Email Service
 * 
 * Handles email-related operations:
 * - SMTP transporter creation via nodemailer (Secure eMail Relay with STARTTLS + auth)
 * - Email HTML generation
 * - Email recipient parsing and normalization
 */

const { createEmailConnector } = require('../utils/emailClient');
const path = require('path');
const emailConfig = require('../config/emailConfig.json');
const { formatContentForEmail } = require('../utils/emailFormatter');
const { normalizeToUsername, usernameToEmail } = require('./userService');
const { generateGanttChartHTML } = require('../utils/ganttChartEmailGenerator');

let _email;

/**
 * Create (or return cached) SMTP connector configured for the
 * Nutanix Secure eMail Relay (STARTTLS on port 587 with AD SMTP service account auth).
 */
async function getEmailConnector() {
  // Force recreation if credentials changed (for dev/testing)
  if (_email && process.env.NODE_ENV !== 'production') {
    const currentUser = process.env.SMTP_USER;
    const currentPass = process.env.SMTP_PASS;
    if (_email._lastUser !== currentUser || _email._lastPass !== currentPass) {
      console.log('[EmailService] Credentials changed, recreating transporter');
      _email = null;
    }
  }
  if (_email) return _email;

  const smtpConfig = emailConfig.smtp || {};
  const host = process.env.SMTP_HOST || smtpConfig.host || 'secure-mailrelay.corp.nutanix.com';
  const port = parseInt(process.env.SMTP_PORT || smtpConfig.port || '587', 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const transportOptions = {
    host,
    port,
    secure: false,
    requireTLS: true,
    tls: { 
      minVersion: 'TLSv1.2',
      // In production, be more lenient with TLS to handle different SMTP servers
      rejectUnauthorized: process.env.NODE_ENV === 'production' ? false : true
    },
    connectionTimeout: 30000,
    greetingTimeout: 15000,
    socketTimeout: 60000,
    debug: process.env.NODE_ENV !== 'production', // Reduce debug in production
    logger: process.env.NODE_ENV !== 'production'
  };

  if (user && pass) {
    transportOptions.auth = { user, pass };
  } else if (process.env.NODE_ENV === 'production') {
    console.error('[EmailService] PRODUCTION: SMTP_USER and/or SMTP_PASS not set in .env. Email will likely fail. Set both in server/.env (see .env.example).');
  }

  console.log(`[EmailService] Creating SMTP transporter → ${host}:${port} (STARTTLS, auth=${!!transportOptions.auth})`);
  _email = await createEmailConnector(transportOptions);
  _email._lastUser = user;
  _email._lastPass = pass;
  return _email;
}

/**
 * Default From address for relay compliance (service account).
 * Override not recommended for corporate SMTP relay.
 */
function getDefaultFromAddress() {
  const smtpConfig = emailConfig.smtp || {};
  return process.env.SMTP_FROM || smtpConfig.from || 'smtp.ndb.team@nutanix.com';
}

/**
 * Send email via nodemailer transporter.
 * From is always forced to the service account (getDefaultFromAddress) for relay compliance.
 * Auth uses SMTP_USER / SMTP_PASS from env (same account). Callers may set replyTo only.
 * In production, implements fallback for relay access issues.
 */
async function sendEmailDirect(mailOptions) {
  // Always overwrite — never allow a caller From that is not the SMTP service account.
  mailOptions.from = getDefaultFromAddress();
  const email = await getEmailConnector();
  
  try {
    const info = await email.send(mailOptions);
    console.log('[EmailService] Email sent:', info.messageId);
    return {
      messageId: info.messageId,
      accepted: info.accepted || [],
      rejected: info.rejected || []
    };
  } catch (error) {
    // Check for relay access denied error (works in any environment, not just production)
    const isRelayError = error.message && (
      error.message.includes('Relay access denied') ||
      error.message.includes('554 5.7.1') ||
      error.message.includes('all recipients were rejected')
    );
    
    console.log(`[EmailService] NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
    console.log(`[EmailService] Error detected: ${error.message}`);
    console.log(`[EmailService] Is relay error: ${isRelayError}`);
    
    if (isRelayError) {
      console.warn('[EmailService] 🔄 Relay access denied detected, attempting fallback SMTP configurations...');
      console.warn('[EmailService] Original error:', error.message);
      try {
        return await tryFallbackSMTP(mailOptions, error);
      } catch (fallbackError) {
        console.error('[EmailService] ❌ All fallback attempts failed');
        throw fallbackError;
      }
    }
    throw error;
  }
}

/**
 * Try alternative SMTP configurations for production relay issues
 */
async function tryFallbackSMTP(mailOptions, originalError) {
  console.log('[EmailService] 🔧 Starting fallback SMTP configuration attempts...');
  
  // Prefer the configured service account (SMTP_USER / SMTP_PASS) on alternate hosts/ports.
  const envUser = process.env.SMTP_USER;
  const envPass = process.env.SMTP_PASS;
  const envAuth = envUser && envPass ? { user: envUser, pass: envPass } : null;

  const fallbackConfigs = [
    {
      name: 'Secure relay port 25 (same service account)',
      host: process.env.SMTP_HOST || 'secure-mailrelay.corp.nutanix.com',
      port: 25,
      secure: false,
      requireTLS: false,
      auth: envAuth
    },
    {
      name: 'Corporate Mail Server (same service account)',
      host: 'mailrelay.corp.nutanix.com',
      port: 25,
      secure: false,
      requireTLS: false,
      auth: envAuth
    },
    {
      name: 'Exchange Server (same service account)',
      host: 'exchange.corp.nutanix.com',
      port: 25,
      secure: false,
      requireTLS: false,
      auth: envAuth
    }
  ];

  for (let i = 0; i < fallbackConfigs.length; i++) {
    const config = fallbackConfigs[i];
    try {
      console.log(`[EmailService] 🔄 Attempt ${i + 1}/${fallbackConfigs.length}: ${config.name} (${config.host}:${config.port})`);
      
      const transportConfig = {
        host: config.host,
        port: config.port,
        secure: config.secure,
        requireTLS: config.requireTLS,
        tls: { 
          minVersion: 'TLSv1.2',
          rejectUnauthorized: false
        },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 30000,
        debug: false
      };
      
      if (config.auth) {
        transportConfig.auth = config.auth;
        console.log(`[EmailService]   - Using authentication: ${config.auth.user}`);
      } else {
        console.log(`[EmailService]   - No authentication (relay mode)`);
      }

      const fallbackEmail = await createEmailConnector(transportConfig);
      const info = await fallbackEmail.send(mailOptions);
      
      console.log(`[EmailService] ✅ SUCCESS! ${config.name} worked!`);
      console.log(`[EmailService] Message ID: ${info.messageId}`);
      console.log(`[EmailService] 💡 PERMANENT FIX: Update your production .env with:`);
      console.log(`[EmailService]    SMTP_HOST=${config.host}`);
      console.log(`[EmailService]    SMTP_PORT=${config.port}`);
      if (config.auth) {
        console.log(`[EmailService]    SMTP_USER=${config.auth.user}`);
        console.log(`[EmailService]    SMTP_PASS=<your_password>`);
      } else {
        console.log(`[EmailService]    # Remove SMTP_USER and SMTP_PASS for no-auth relay`);
      }
      
      return {
        messageId: info.messageId,
        accepted: info.accepted || [],
        rejected: info.rejected || []
      };
    } catch (fallbackError) {
      console.warn(`[EmailService] ❌ ${config.name} failed: ${fallbackError.message}`);
    }
  }

  // If all fallbacks fail, throw the original error
  console.error('[EmailService] 💥 All fallback SMTP configurations failed');
  console.error('[EmailService] Original error was:', originalError.message);
  throw originalError;
}

/**
 * Wrap pre-rendered table HTML with notes and legend
 * 
 * @param {string} selectedVersion - Selected release version
 * @param {string} tableHTML - Pre-rendered table HTML from frontend
 * @param {string} lowlights - Lowlights content (HTML)
 * @param {string} highlights - Highlights content (HTML)
 * @param {string} callToAction - Call to action content (HTML)
 * @returns {string} - Complete HTML with notes, table, and legend
 */
function wrapReleaseVersionsEmailHTML(selectedVersion, tableHTML, lowlights = '', highlights = '', callToAction = '', ganttConfig = null, items = null, jiraBaseUrl = 'https://jira.nutanix.com', ganttChartImageData = null) {
  // Load email config for notes
  let emailConfig;
  try {
    emailConfig = require(path.join(__dirname, '../config/releaseVersionsEmailConfig.json'));
  } catch (err) {
    console.error('Error loading releaseVersionsEmailConfig.json:', err);
    emailConfig = {
      emailNotes: {
        highlights: { include: true, order: 1, label: 'Highlights' },
        lowlights: { include: true, order: 2, label: 'Lowlights' },
        callToAction: { include: true, order: 3, label: 'Call to Action' }
      }
    };
  }
  
  let html = `<div style="margin-bottom: 20px; padding: 12px; background-color: #f8f9fa; border-left: 4px solid #0066cc; border-radius: 4px;">
    <p style="font-size: 13px; color: #495057; margin: 0; font-weight: 600;">Selected Release Version:</p>
    <p style="font-size: 13px; color: #212529; margin: 4px 0 0 0;">${selectedVersion}</p>
  </div>`;
  
  // Calculate days to CCM, CG, PG, and GA milestone gates
  if (ganttConfig) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    /**
     * Parse gates from ganttConfig for a given key prefix/matcher.
     * Supports both array values (ccm1Gate) and single object values (commitGate1, ga1).
     * @param {function} keyMatcher - returns true if the config key belongs to this gate type
     * @param {function} numberExtractor - extracts a sortable gate number from the key
     */
    const parseGates = (keyMatcher, numberExtractor) => {
      const gates = [];
      Object.keys(ganttConfig).forEach(key => {
        if (!keyMatcher(key)) return;
        const gate = ganttConfig[key];
        if (!gate) return;

        const processEntry = (g, fallbackNumber) => {
          if (!g || !g.date) return;
          try {
            const gateDate = new Date(g.date);
            gateDate.setHours(0, 0, 0, 0);
            if (!isNaN(gateDate.getTime())) {
              gates.push({
                number: numberExtractor(key) || fallbackNumber,
                days: Math.ceil((gateDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)),
                date: g.date
              });
            }
          } catch (e) {
            console.error(`Error parsing gate date for ${key}:`, e);
          }
        };

        if (Array.isArray(gate)) {
          gate.forEach((g, idx) => processEntry(g, String(idx + 1)));
        } else {
          processEntry(gate, numberExtractor(key));
        }
      });
      gates.sort((a, b) => (parseInt(a.number) || 0) - (parseInt(b.number) || 0));
      return gates;
    };

    // CCM gates: keys like ccm1Gate, ccm2Gate (array values)
    const ccmGates = parseGates(
      key => key.startsWith('ccm') && key.includes('Gate'),
      key => key.replace('ccm', '').replace('Gate', '')
    );

    // Commit Gate (CG): keys like commitGate1, commitGate2 (single object values)
    const cgGates = parseGates(
      key => key.startsWith('commitGate') && /\d+$/.test(key),
      key => key.replace('commitGate', '')
    );

    // Promotion Gate (PG): keys like promotionGate1, promotionGate2 (single object values)
    const pgGates = parseGates(
      key => key.startsWith('promotionGate') && /\d+$/.test(key),
      key => key.replace('promotionGate', '')
    );

    // General Availability (GA): keys like ga1, ga2 (single object values)
    const gaGates = parseGates(
      key => /^ga\d+$/.test(key),
      key => key.replace('ga', '')
    );

    const milestoneGroups = [
      { gates: ccmGates, title: 'Code Complete Milestone Dates:', label: 'Code Complete Met', color: '#0066cc', bg: '#e7f3ff' },
      { gates: cgGates,  title: 'Commit Gate Milestone Dates:',   label: 'Commit Gate Met',   color: '#e65100', bg: '#fff3e0' },
      { gates: pgGates,  title: 'Promotion Gate Milestone Dates:', label: 'Promotion Gate Met', color: '#6a1b9a', bg: '#f3e5f5' },
      { gates: gaGates,  title: 'General Availability Milestone Dates:', label: 'GA',          color: '#1b5e20', bg: '#e8f5e9' }
    ];

    const activeMilestones = milestoneGroups.filter(m => m.gates.length > 0);
    if (activeMilestones.length > 0) {
      html += `<div style="margin-bottom: 20px; padding: 12px; background-color: #e7f3ff; border-left: 4px solid #0066cc; border-radius: 4px;">`;
      activeMilestones.forEach((milestone, idx) => {
        html += `
        <p style="font-size: 13px; color: #495057; margin: ${idx > 0 ? '10px' : '0'} 0 4px 0; font-weight: 600;">${milestone.title}</p>
        <div style="font-size: 13px; color: #212529; line-height: 1.8;">
          ${milestone.gates.map(gate =>
            `Number of Days to ${milestone.label} ${gate.number} = ${gate.days}`
          ).join('<br>')}
        </div>`;
      });
      html += `</div>`;
    }
  }
  
  // Get email notes config
  const emailNotesConfig = emailConfig.emailNotes || {
    highlights: { include: true, order: 1, label: 'Highlights' },
    lowlights: { include: true, order: 2, label: 'Lowlights' },
    callToAction: { include: true, order: 3, label: 'Call to Action' }
  };
  
  // Collect all notes with their config
  const notes = [
    { key: 'highlights', value: highlights, config: emailNotesConfig.highlights },
    { key: 'lowlights', value: lowlights, config: emailNotesConfig.lowlights },
    { key: 'callToAction', value: callToAction, config: emailNotesConfig.callToAction }
  ].filter(note => note.config && note.config.include !== false && note.value && note.value.trim());
  
  // Sort notes by order
  notes.sort((a, b) => (a.config.order || 999) - (b.config.order || 999));
  
  // Add notes sections at the top (before table)
  notes.forEach((note, index) => {
    const formattedContent = formatContentForEmail(note.value);
    html += `<div style="margin-bottom: 2rem; padding: 1rem; background-color: #ffffff; border: 1px solid #1a1a1a; border-radius: 0;">
      <h3 style="margin-top: 0; margin-bottom: 0.75rem; font-size: 0.9375rem; font-weight: 500; color: #1a1a1a;">${index + 1}. ${note.config.label || note.key}</h3>
      <div style="font-size: 0.9375rem; line-height: 1.6; color: #1a1a1a;">
        ${formattedContent}
      </div>
    </div>`;
  });
  
  // Add Gantt chart image if available (prefer image over HTML table)
  if (ganttChartImageData) {
    html += `<div style="margin: 20px 0; padding: 15px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px;">
      <h3 style="margin-top: 0; margin-bottom: 12px; font-size: 1rem; font-weight: 600; color: #1a1a1a;">
        Gantt Chart: ${selectedVersion} (Committed Projects Only)
      </h3>
      <img src="${ganttChartImageData}" alt="Gantt Chart" style="max-width: 100%; height: auto; border: 1px solid #dee2e6; border-radius: 4px;" />
    </div>`;
  } else if (ganttConfig && items && Array.isArray(items) && items.length > 0) {
    try {
      const ganttChartHTML = generateGanttChartHTML({
        ganttConfig,
        selectedVersion,
        items,
        jiraBaseUrl
      });
      if (ganttChartHTML) {
        html += ganttChartHTML;
      }
    } catch (error) {
      console.error('Error generating Gantt chart for email:', error);
      // Continue without Gantt chart if generation fails
    }
  }
  
  // Add pre-rendered table HTML from frontend
  html += tableHTML;
  
  // Add legend
  html += `<div style="margin-top: 30px; padding: 15px; background-color: #f8f9fa; border: 1px solid #dee2e6; border-radius: 4px;">
    <h4 style="margin-top: 0; margin-bottom: 12px; font-size: 13px; font-weight: 600; color: #495057;">Legend:</h4>
    <div style="font-size: 11px; line-height: 1.8;">
      <div><strong>Code Complete Date with Colored Background:</strong> Feature has extension label (<code>&lt;release&gt;-&lt;ddmmyyyy&gt;-code-complete-extention-recieved</code>). Different extension dates are shown with different colors (e.g., 28feb2026 = one color, 13mar2026 = different color).</div>
      <div><strong>Red Row Border:</strong> Status Update Date is empty or older than 10 days</div>
      <div><strong>Date Format:</strong> Current date in <span style="color: #28a745; font-weight: 600;">green</span>, historical dates with <span style="text-decoration: line-through; color: #999;">strikethrough</span>, separated by →</div>
      <div><strong>Risk Indicator:</strong> Color-coded background (Red/Yellow/Green) or yellow for "Not Set"</div>
    </div>
  </div>`;
  
  return html;
}

/**
 * Parse and normalize email recipients
 * Accepts comma-separated list of usernames or emails
 * Normalizes to @nutanix.com email format
 * 
 * @param {string} emailRecipients - Comma-separated list of recipients
 * @returns {Array<string>} - Array of normalized email addresses
 */
function parseEmailRecipients(emailRecipients) {
  if (!emailRecipients) return [];
  
  return emailRecipients.split(',').map(recipient => {
    const trimmed = recipient.trim();
    if (!trimmed) return null;
    
    // If it's already an email, use it (but ensure it's @nutanix.com)
    if (trimmed.includes('@')) {
      if (trimmed.endsWith('@nutanix.com')) {
        return trimmed.toLowerCase();
      }
      // If different domain, extract username and add @nutanix.com
      const username = trimmed.split('@')[0];
      return `${username.toLowerCase()}@nutanix.com`;
    }
    
    // If it's a username, add @nutanix.com
    return `${trimmed.toLowerCase()}@nutanix.com`;
  }).filter(email => email);
}

/**
 * Format date in dd/mmm/yyyy format for email subject
 * 
 * @returns {string} - Formatted date string
 */
function formatDateForEmail() {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const month = monthNames[today.getMonth()];
  const year = today.getFullYear();
  return `${day}/${month}/${year}`;
}

module.exports = {
  createEmailTransporter: getEmailConnector,
  getEmailConnector,
  getDefaultFromAddress,
  sendEmailDirect,
  wrapReleaseVersionsEmailHTML,
  parseEmailRecipients,
  formatDateForEmail
};

