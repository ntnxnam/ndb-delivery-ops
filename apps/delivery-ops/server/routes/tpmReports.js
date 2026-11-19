const express = require('express');
const router = express.Router();
const { validateJiraTokenMiddleware } = require('../middleware/auth/jira');
const { getStageForRelease } = require('../services/tpmStageService');
const { checkKpiAdminAuthorization, usernameToEmail, normalizeToUsername } = require('../services/userService');
const teamBoardConfig = require('../config/teamBoardConfig.json');
const releaseVersionsEmailConfig = require('../config/releaseVersionsEmailConfig.json');

function getUsername(req) {
  return req.headers['x-username'] || req.body?.username || req.query?.username || '';
}

function getUserEmail(req) {
  const raw = req.headers['x-user-email'] || req.body?.userEmail || '';
  if (raw && String(raw).includes('@')) return String(raw).toLowerCase();
  const u = getUsername(req);
  return u ? usernameToEmail(normalizeToUsername(u)) : '';
}

/**
 * Resolve KPI list for a team filtered by lifecyclePhase = stage.
 * Falls back to all KPIs if none match stage (overall).
 */
function getKpisForStage(teamId, stage) {
  let kpiConfig;
  try {
    kpiConfig = require('../config/kpiConfig.json');
  } catch {
    return [];
  }
  const tid = String(teamId || '').trim().toLowerCase() || 'ndb';
  const all = (kpiConfig.teams && kpiConfig.teams[tid]) || [];
  if (!Array.isArray(all) || !all.length) return [];
  if (stage === 'overall') return all.filter((k) => k.lifecyclePhase === 'overall' || !k.lifecyclePhase);
  const matched = all.filter((k) => String(k.lifecyclePhase || '').toLowerCase() === String(stage).toLowerCase());
  return matched.length ? matched : all.filter((k) => !k.lifecyclePhase);
}

function buildReleaseJql(release, baseQuery) {
  const baseFilter = `filter=${release}-All`;
  if (!baseQuery || !String(baseQuery).trim()) return baseFilter;
  let q = String(baseQuery).trim().replace(/\btype\s*=/gi, 'issuetype=');
  if (/^\s*filter\s*=/i.test(q)) return q;
  // Parity with kpiService.buildReleaseKpiCombinedJql: add status != Closed when not already present
  const base = `${baseFilter} AND (${q})`;
  return /\bstatus\s*(!=|not in)\b/i.test(q) ? base : `${base} AND status != Closed`;
}

/**
 * POST /api/tpm/reports/preview
 * Body: { teamId, releaseVersion, today }
 * Auth: Bearer PAT (D40)
 * Returns: { stage, reason, nextGate, gateDates, kpiBreakdown, fetchedAt }
 */
router.post('/preview', validateJiraTokenMiddleware, express.json(), async (req, res) => {
  try {
    const { teamId, releaseVersion, today } = req.body || {};
    if (!releaseVersion) return res.status(400).json({ error: 'releaseVersion is required' });
    const tid = teamId || teamBoardConfig.defaultTeamId || 'ndb';
    const gateDatesMap = releaseVersionsEmailConfig.releaseGateDates || {};
    const todayIso = today ? String(today).slice(0, 10) : new Date().toISOString().slice(0, 10);
    const stageInfo = getStageForRelease(releaseVersion, todayIso, gateDatesMap);
    const { stage, reason, nextGate, gateDatesForRelease } = stageInfo;

    const kpis = getKpisForStage(tid, stage);
    const fetchedAt = new Date().toISOString();
    const token = req.jiraToken;
    // Recipients for preview (D26 visibility)
    const previewRecipients = resolveRecipients({ releaseVersion, teamId: tid });

    // Build per-KPI JQLs; fetch counts in parallel (H-5)
    const breakdown = await Promise.all(kpis.map(async (k) => {
      const baseQuery = k.baseQuery || '';
      const jql = buildReleaseJql(releaseVersion, baseQuery);
      let count = null;
      let error = null;
      if (token) {
        try {
          const { getJira } = require('../utils/jiraClient');
          const jira = await getJira(token);
          count = await jira.searchCount(jql);
        } catch (e) {
          error = e.message || 'JIRA count failed';
        }
      }
      return {
        id: k.id,
        name: k.name,
        lifecyclePhase: k.lifecyclePhase || 'overall',
        jql,
        count,
        error,
        citedAt: fetchedAt,
      };
    }));

    res.json({
      teamId: tid,
      releaseVersion,
      today: todayIso,
      stage,
      reason,
      nextGate,
      gateDates: gateDatesForRelease,
      thresholds: stageInfo.thresholds || null,
      kpiBreakdown: breakdown,
      total: breakdown.reduce((s, x) => s + (x.count ?? 0), 0),
      fetchedAt,
      recipients: previewRecipients,
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Preview failed' });
  }
});

/**
 * Resolve email recipients for a release + team.
 * Priority: releaseGateDates[release].devDRIs/qaDRIs → team notificationEmails → requestor only.
 */
function resolveRecipients({ releaseVersion, teamId }) {
  const gateDatesMap = releaseVersionsEmailConfig.releaseGateDates || {};
  const releaseGates = gateDatesMap[releaseVersion] || {};
  const devDRIs = Array.isArray(releaseGates.devDRIs) ? releaseGates.devDRIs : [];
  const qaDRIs = Array.isArray(releaseGates.qaDRIs) ? releaseGates.qaDRIs : [];
  const dribEmails = [...devDRIs, ...qaDRIs].map((u) => {
    const s = String(u).trim();
    return s.includes('@') ? s.toLowerCase() : `${s.toLowerCase()}@nutanix.com`;
  }).filter(Boolean);

  if (dribEmails.length) return { to: dribEmails, cc: [] };

  const team = (teamBoardConfig.teams || []).find((t) => t.id === teamId) || null;
  const mgrEmail = team?.notificationEmails?.managers || null;
  const execEmail = team?.notificationEmails?.exec || null;
  if (mgrEmail) return { to: [mgrEmail], cc: execEmail ? [execEmail] : [] };
  return { to: [], cc: [] };
}

/**
 * POST /api/tpm/reports/send
 * Body: { teamId, releaseVersion, today?, testMode:boolean, subject?, html? }
 * Auth: Bearer PAT (D40). Real send gated to TPM/PortfolioMgr/RM via kpiAdminUsers (D26).
 */
router.post('/send', validateJiraTokenMiddleware, express.json(), async (req, res) => {
  try {
    const { teamId, releaseVersion, today, testMode, subject, html } = req.body || {};
    if (!releaseVersion) return res.status(400).json({ error: 'releaseVersion is required' });
    const tid = teamId || teamBoardConfig.defaultTeamId || 'ndb';
    const isTest = !!testMode;
    const username = getUsername(req);
    const requestorEmail = getUserEmail(req);

    if (!isTest) {
      const { authorized } = checkKpiAdminAuthorization(username, tid);
      if (!authorized) {
        return res.status(403).json({ error: 'Only TPM/Portfolio Manager/RM can send real reports. Use test mode or request access.' });
      }
    }

    // Resolve recipients per D26
    let to = [];
    let cc = [];
    if (isTest) {
      if (!requestorEmail) return res.status(400).json({ error: 'Requestor email missing (X-User-Email header required)' });
      to = [requestorEmail];
      cc = [];
    } else {
      const resolved = resolveRecipients({ releaseVersion, teamId: tid });
      to = resolved.to;
      cc = resolved.cc;
      if (!to.length) {
        return res.status(400).json({ error: 'No recipients resolved for this release/team. Configure devDRIs/qaDRIs or team notificationEmails.' });
      }
    }

    // Build email HTML if not provided: call preview logic to get breakdown
    let emailSubject = subject || `[${releaseVersion}] TPM Report — ${tid}`;
    let emailHtml = html || '';
    if (!emailHtml) {
      const gateDatesMap = releaseVersionsEmailConfig.releaseGateDates || {};
      const todayIso = today ? String(today).slice(0, 10) : new Date().toISOString().slice(0, 10);
      const stageInfo = getStageForRelease(releaseVersion, todayIso, gateDatesMap);
      const kpis = getKpisForStage(tid, stageInfo.stage);
      const fetchedAt = new Date().toISOString();
      const rows = await Promise.all(kpis.map(async (k) => {
        const jql = buildReleaseJql(releaseVersion, k.baseQuery || '');
        let count = '—';
        try {
          const { getJira } = require('../utils/jiraClient');
          const jira = await getJira(req.jiraToken);
          const n = await jira.searchCount(jql);
          count = n != null ? String(n) : '—';
        } catch { /* keep — */ }
        const jiraBase = process.env.JIRA_BASE_URL || 'https://jira.nutanix.com';
        const link = `${jiraBase}/issues/?jql=${encodeURIComponent(jql)}`;
        return `<tr><td style="padding:6px 8px;border:1px solid var(--border)">${k.name}</td><td style="padding:6px 8px;border:1px solid var(--border);text-align:center">${count}</td><td style="padding:6px 8px;border:1px solid var(--border);font-size:12px"><a href="${link}">JQL</a></td><td style="padding:6px 8px;border:1px solid var(--border);font-size:10px;word-break:break-all">${jql.slice(0, 300)}</td></tr>`;
      }));
      emailHtml = `<div style="font-family:var(--font-sans,Arial,sans-serif);max-width:800px">
        <h2>${releaseVersion} — ${stageInfo.stage} stage</h2>
        <p style="color:var(--muted)">Stage: ${stageInfo.stage} — ${stageInfo.reason}${stageInfo.nextGate ? ` · Next: ${stageInfo.nextGate.label} (${stageInfo.nextGate.date})` : ''}</p>
        <p style="color:var(--muted);font-size:12px">Generated at ${fetchedAt} · Cited JQLs below are exact (D10)</p>
        <table style="border-collapse:collapse;width:100%"><thead><tr><th style="padding:6px 8px;border:1px solid var(--border);background:var(--surface)">KPI</th><th style="padding:6px 8px;border:1px solid var(--border);background:var(--surface)">Count</th><th style="padding:6px 8px;border:1px solid var(--border);background:var(--surface)">Link</th><th style="padding:6px 8px;border:1px solid var(--border);background:var(--surface)">Cited JQL</th></tr></thead><tbody>${rows.join('')}</tbody></table>
        <p style="font-size:12px;color:var(--muted)">Team: ${tid} · Release: ${releaseVersion} · Stage: ${stageInfo.stage}</p>
      </div>`;
    }

    const { sendEmailDirect } = require('../services/emailService');
    const info = await sendEmailDirect({
      to: to.join(', '),
      cc: cc.length ? cc.join(', ') : undefined,
      subject: emailSubject,
      html: emailHtml,
    });

    res.json({ success: true, to, cc, messageId: info.messageId, accepted: info.accepted, testMode: isTest });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message || 'Send failed' });
  }
});

module.exports = router;
