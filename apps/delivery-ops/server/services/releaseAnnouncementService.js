/**
 * releaseAnnouncementService — generate and send release announcement draft
 * to the logged-in user when a release is marked Released.
 *
 * AI path: uses naiService.generateReleaseAnnouncement with RELEASE_ANNOUNCEMENT_SYSTEM_PROMPT.
 * Fallback path: deterministic HTML template matching the NDB-2.11 sample shape.
 * Never blocks the release-finalize flow — errors are swallowed and returned as { error }.
 */
const path = require('path');
const fs = require('fs');
const { getJira } = require('../utils/jiraClient');
const { loadTeamBoardConfig, getTeamById } = require('../utils/teamConfig');
const { sendEmailDirect } = require('./emailService');
const { usernameToEmail } = require('./userService');

const EMAIL_CONFIG_PATH = path.join(__dirname, '../config/releaseVersionsEmailConfig.json');

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function loadReleaseConfig() {
  try {
    delete require.cache[require.resolve(EMAIL_CONFIG_PATH)];
    const raw = fs.readFileSync(EMAIL_CONFIG_PATH, 'utf8');
    return raw && raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function resolveTeamForRelease(version, teamId) {
  if (teamId) {
    const t = getTeamById(teamId);
    if (t) return t;
  }
  const cfg = loadTeamBoardConfig();
  const teams = cfg.teams || [];
  for (const tm of teams) {
    const prefixes = tm.releasePrefixes || [];
    for (const p of prefixes) {
      if (version.startsWith(p)) return tm;
    }
  }
  const def = cfg.defaultTeamId && getTeamById(cfg.defaultTeamId);
  return def || teams[0] || null;
}

function extractGaDate(releaseCfg) {
  if (!releaseCfg) return null;
  // GA fields are ga1, ga2, ... ; find the last solid one, else last present
  const gaKeys = Object.keys(releaseCfg).filter((k) => /^ga\d+$/.test(k));
  if (!gaKeys.length) return null;
  gaKeys.sort((a, b) => parseInt(a.slice(2), 10) - parseInt(b.slice(2), 10));
  // Prefer solid
  const solid = [...gaKeys].reverse().find((k) => releaseCfg[k]?.style === 'solid' && releaseCfg[k]?.date);
  if (solid) return releaseCfg[solid].date;
  const last = [...gaKeys].reverse().find((k) => releaseCfg[k]?.date);
  return last ? releaseCfg[last].date : null;
}

async function fetchReleaseFeatures(version, jiraToken) {
  if (!jiraToken) return [];
  try {
    const jira = await getJira(jiraToken);
    const v = String(version).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const jql = `fixVersion = "${v}" AND issuetype in (Feature, Initiative, Epic, Story)`;
    const res = await jira.get('/rest/api/2/search', {
      params: { jql, maxResults: 80, fields: 'key,summary,issuetype,status,components' },
      timeout: 15000,
    });
    const issues = res.data?.issues || [];
    return issues.map((i) => ({
      key: i.key,
      summary: i.fields?.summary || '',
      status: i.fields?.status?.name || '',
      component: (i.fields?.components && i.fields.components[0]?.name) || '',
      issuetype: i.fields?.issuetype?.name || '',
    }));
  } catch (e) {
    // Non-fatal — fallback will handle empty list
    console.warn('[releaseAnnouncement] fetchReleaseFeatures failed:', e.message);
    return [];
  }
}

function buildFallbackHtml({ version, product, teamName, gaDate, features, partnerTeams }) {
  const partners = partnerTeams || 'UX, Security, Legal, Docs, and Serviceability';
  const prod = product || version.split(/[- ]/)[0] || 'Product';
  const team = teamName || prod;

  // Group features into simple buckets for fallback (if we have them)
  // Otherwise emit placeholder mirroring NDB-2.11 thematic buckets
  let highlightsHtml = '';
  if (Array.isArray(features) && features.length) {
    // Naive grouping: try to infer theme from summary keywords
    const buckets = new Map();
    function bucketFor(summary) {
      const s = String(summary).toLowerCase();
      if (/encrypt|audit|tde|thales|sharing|access|security|compliance/.test(s)) return 'Strengthening Security & Compliance';
      if (/postgres|replication|wal|cluster|scaling|ha|disaster|failover/.test(s)) return 'Advancing PostgreSQL Resilience';
      if (/mysql|mongodb|oracle|backup|restore|shard|dataguard|time machine|pitr/.test(s)) return 'Frictionless Operations for DBAs';
      if (/diagnostic|bundle|upgrade|precheck|readiness|log/.test(s)) return 'Streamlined Experience for IT Admins & SREs';
      return 'Additional Enhancements';
    }
    for (const f of features.slice(0, 40)) {
      const bucket = bucketFor(f.summary);
      if (!buckets.has(bucket)) buckets.set(bucket, []);
      const text = escapeHtml(String(f.summary).slice(0, 140));
      buckets.get(bucket).push(`<li>${text}</li>`);
    }
    const bucketOrder = [
      'Strengthening Security & Compliance',
      'Advancing PostgreSQL Resilience',
      'Frictionless Operations for DBAs',
      'Streamlined Experience for IT Admins & SREs',
      'Additional Enhancements',
    ];
    for (const name of bucketOrder) {
      const items = buckets.get(name);
      if (!items || !items.length) continue;
      highlightsHtml += `<h3>${escapeHtml(name)}</h3><ul>${items.join('')}</ul>`;
    }
    // If bucketing produced nothing (edge), flat list
    if (!highlightsHtml) {
      const flat = features.slice(0, 20).map((f) => `<li>${escapeHtml(f.summary)}</li>`).join('');
      highlightsHtml = `<ul>${flat}</ul>`;
    }
  } else {
    // No JIRA data — emit NDB-2.11 shaped placeholder so reviewer/editor has a starting point
    highlightsHtml = `
      <p><em>Highlights below are placeholders derived from the NDB-2.11 example. Replace with this release's actual capabilities (sourced from JIRA fixVersion or release notes).</em></p>
      <h3>Strengthening Security &amp; Compliance</h3>
      <ul>
        <li>Native Database Encryption (TDE) for MySQL and EDB Postgres, integrated with Thales CipherTrust Manager</li>
        <li>NDB Audit Management — centralized audit logging across all engines, forwarded to Prism Central</li>
        <li>Entity Sharing for databases and clones — Manage and Full access levels for delegated administration without Super Admin privileges</li>
      </ul>
      <h3>Advancing PostgreSQL Resilience</h3>
      <ul>
        <li>PostgreSQL Disaster Recovery — native DR for PostgreSQL HA clusters using streaming replication and WAL archiving, with switchover/failover support</li>
        <li>WAL Archival to Objects Store — a more scalable alternative to volume-group based archival</li>
        <li>Cluster Scaling — add/remove nodes for PostgreSQL (and SQL Server) HA clusters with zero downtime or reprovisioning</li>
      </ul>
      <h3>Frictionless Operations for DBAs</h3>
      <ul>
        <li>MySQL HA Backup and Restore — Time Machine support extended to MySQL HA, including PITR</li>
        <li>MongoDB Sharded Cluster Scale-Out — add shards or mongos instances with zero downtime</li>
        <li>Oracle Data Guard — IP address selection for DR configuration, now from the web console</li>
      </ul>
      <h3>Streamlined Experience for IT Admins &amp; SREs</h3>
      <ul>
        <li>Enhanced Diagnostic Bundles — selectable log categories and time-range scoping</li>
        <li>Upgrade Readiness Prechecks — proactive validation of control plane and DB servers before upgrade</li>
      </ul>`;
  }

  const gaLine = gaDate ? `<p><b>GA:</b> ${escapeHtml(gaDate)}</p>` : '';

  return `
<div style="font-family:Arial,sans-serif;max-width:700px;margin:0 auto;color:#212529;line-height:1.6">
  <p>Hello! 🎉</p>
  <p>We are thrilled to announce the official release of <b>${escapeHtml(prod)}-${escapeHtml(version.replace(prod + '-', '').replace(prod + ' ', ''))}</b>!</p>
  <p>Bringing this release to market over the last several months has been a massive undertaking, and we are incredibly proud of the value these new capabilities will bring to our enterprise customers. <b>${escapeHtml(prod)}-${escapeHtml(version)}</b> is packed with highly anticipated features designed to solve complex challenges, strengthen security, and streamline operations.</p>
  <p>A huge congratulations and thank you to the core ${escapeHtml(team)} Team, as well as our incredible partners in ${escapeHtml(partners)}. It took a true village to deliver this with such high quality!</p>
  ${gaLine}
  <h2>Release Highlights</h2>
  ${highlightsHtml}
  <h3>Useful Links</h3>
  <ul>
    <li>Downloads: ${escapeHtml(product)} Downloads Portal</li>
    <li>Release Notes: ${escapeHtml(version)} Release Notes</li>
    <li>TOI Links: ${escapeHtml(version)} TOIs on Confluence</li>
    <li>Support Channel: For sales inquiries and general questions, please post in #ndb.</li>
  </ul>
  <h3>User Guides:</h3>
  <ul>
    <li>${escapeHtml(product)} Overall</li>
    <li>MySQL Management Guide</li>
    <li>Oracle Management Guide</li>
    <li>MongoDB Management Guide</li>
    <li>PostgreSQL Management Guide</li>
    <li>SQL Server Management Guide</li>
    <li>MariaDB Management Guide</li>
  </ul>
  <p>Thank you again to everyone who contributed to making this release a success!</p>
  <p>Best,<br>Team ${escapeHtml(prod)}</p>
  <p style="font-size:12px;color:#6c757d">(If we have inadvertently missed someone in this email, please share)</p>
</div>`;
}

/**
 * Generate announcement HTML (AI-first, deterministic fallback).
 * Exported for testing / preview without sending.
 */
async function generateAnnouncementHtml({ version, teamId, jiraToken, usefulLinks, userGuides, partnerTeams }) {
  const team = resolveTeamForRelease(version, teamId);
  const product = team?.branding?.shortName || team?.name || String(version).split(/[- ]/)[0] || 'NDB';
  const teamName = team?.name || product;
  const cfg = loadReleaseConfig();
  const releaseCfg = (cfg.releaseGateDates || {})[version] || null;
  const gaDate = extractGaDate(releaseCfg);
  const features = await fetchReleaseFeatures(version, jiraToken);

  let html = null;
  let aiUsed = false;
  let aiError = null;

  try {
    // eslint-disable-next-line global-require
    const { generateReleaseAnnouncement } = require('./naiService');
    html = await generateReleaseAnnouncement({
      version,
      product,
      teamName,
      gaDate,
      features,
      usefulLinks: usefulLinks || {},
      userGuides: userGuides || [],
      partnerTeams: partnerTeams || null,
    });
    aiUsed = true;
  } catch (e) {
    aiError = e.message;
    console.warn('[releaseAnnouncement] AI generation failed, using fallback:', e.message);
  }

  if (!html || !String(html).trim()) {
    html = buildFallbackHtml({ version, product, teamName, gaDate, features, partnerTeams });
    aiUsed = false;
  }

  return { html, aiUsed, aiError, featureCount: features.length, product, teamName, gaDate, teamId: team?.id || null };
}

/**
 * Send announcement draft to the logged-in user.
 * Never throws — returns { sent } or { error/skipped }.
 */
async function sendAnnouncementDraft({ version, username, teamId, jiraToken, usefulLinks, userGuides, partnerTeams }) {
  if (!username) {
    return { skipped: true, reason: 'no username — cannot send draft' };
  }
  const email = usernameToEmail(username);
  if (!email) {
    return { skipped: true, reason: `cannot derive email for username "${username}"` };
  }

  const todayDate = new Date().toISOString().slice(0, 10);
  let gen;
  try {
    gen = await generateAnnouncementHtml({ version, teamId, jiraToken, usefulLinks, userGuides, partnerTeams });
  } catch (e) {
    return { error: `announcement generation failed: ${e.message}` };
  }

  const team = resolveTeamForRelease(version, teamId);
  const product = gen.product || team?.branding?.shortName || String(version).split(/[- ]/)[0] || 'Product';

  const subject = `[DRAFT] Announcing ${product} ${version} — Official Release is Live 🎉`;
  const draftNotice = `<div style="background:#fff3cd;border:1px solid #ffc107;padding:10px 12px;margin-bottom:16px;font-family:Arial,sans-serif;font-size:13px;border-radius:4px;">⚠️ <b>DRAFT</b> — This is an auto-generated announcement draft for <b>${escapeHtml(version)}</b>. Please review, edit, and forward to your distribution list. Generated on ${escapeHtml(todayDate)} for ${escapeHtml(username)} (${escapeHtml(email)}).<br><span style="color:#6c757d">AI ${gen.aiUsed ? 'generated' : 'fallback template'} • ${gen.featureCount} feature(s) from JIRA fixVersion • GA ${escapeHtml(gen.gaDate || 'TBD')}</span></div>`;

  const finalHtml = draftNotice + gen.html;

  try {
    const info = await sendEmailDirect({ to: email, subject, html: finalHtml });
    return {
      sent: true,
      to: email,
      subject,
      messageId: info.messageId,
      aiUsed: gen.aiUsed,
      aiError: gen.aiError || null,
      featureCount: gen.featureCount,
      gaDate: gen.gaDate,
    };
  } catch (e) {
    console.warn('[releaseAnnouncement] sendEmailDirect failed:', e.message);
    return { error: e.message, to: email, subject, aiUsed: gen.aiUsed, featureCount: gen.featureCount };
  }
}

module.exports = {
  generateAnnouncementHtml,
  sendAnnouncementDraft,
  buildFallbackHtml,
  fetchReleaseFeatures,
  extractGaDate,
  resolveTeamForRelease,
};
