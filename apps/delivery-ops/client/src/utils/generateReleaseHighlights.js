/**
 * generateReleaseHighlights
 *
 * Produces exec-level HTML for the three Highlights / Lowlights / Call-to-Action
 * Quill editors in ReleaseVersionTab. Auto-populated after items load.
 *
 * Design principles:
 *   • Highlights  = counts-only snapshot (scannable in seconds, no item names)
 *   • Lowlights   = named items only for reds (with one-line reason); yellows grouped
 *   • Call to Action = max ~5 verb-first action items, one line each
 *
 * Fields used:
 *   customfield_23560  — Risk Indicator  ("Green - On Track", "Yellow - …", "Red - …")
 *   customfield_23073  — Status Update text (mined for risk reason)
 *   customfield_45660  — Status Update Date
 *   customfield_11067  — Code Complete Date
 *   customfield_13861  — FS/DS Done Date
 *   customfield_11068  — Test Plan Date
 *   customfield_35863  — Commit Gate Ready Estimation Date
 *   customfield_35864  — Promotion Gate Ready Estimation Date
 *   item.priority      — "Blocker - P0", "Critical - P1", "Major - P2", etc.
 *   item.status        — "Code Complete Met", "Execute Commit", …
 *   item.summary       — feature title
 *   item.key           — JIRA key
 *   item.assignee      — owner name
 *
 * @param {Object} items          - { commit: [...], longTermFunded: [...] }
 * @param {string} selectedVersion - e.g. "NDB-2.11"
 * @param {string} jiraBaseUrl     - e.g. "https://jira.nutanix.com"
 * @returns {{ highlightsHtml: string, lowlightsHtml: string, callToActionHtml: string }}
 */
export function generateReleaseHighlights(items, selectedVersion, jiraBaseUrl) {
  const commit = items.commit || [];
  const ltf = items.longTermFunded || [];

  // ── Helpers ──────────────────────────────────────────────────────────────────

  const getRisk = (item) => {
    // #region agent log
    const field = item.customfield_23560;
    const fieldType = typeof field;
    const fieldValue = Array.isArray(field) ? field.join(',') : (field && typeof field === 'object' ? JSON.stringify(field) : String(field || ''));
    console.log('[DEBUG bc15bd] getRisk field analysis:', {key: item.key, field, fieldType, fieldValue});
    // #endregion
    
    const raw = fieldValue.toLowerCase();
    if (raw.includes('red')) return 'red';
    if (raw.includes('yellow')) return 'yellow';
    if (raw.includes('green')) return 'green';
    return 'notset';
  };

  const getPriorityOrder = (item) => {
    const p = String(item.priority || '').toLowerCase();
    if (p.includes('p0') || p.includes('blocker')) return 0;
    if (p.includes('p1') || p.includes('critical')) return 1;
    if (p.includes('p2') || p.includes('major')) return 2;
    return 3;
  };

  const getPriorityLabel = (item) => {
    const order = getPriorityOrder(item);
    if (order === 0) return 'P0';
    if (order === 1) return 'P1';
    if (order === 2) return 'P2';
    return item.priority || '';
  };

  const link = (key) =>
    `<a href="${jiraBaseUrl}/browse/${key}" style="color:#0052cc;">${key}</a>`;

  const hasStatusUpdate = (item) => !!item.customfield_45660;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const parseDate = (val) => {
    if (!val) return null;
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  };

  const isDateMissed = (dateVal) => {
    const d = parseDate(dateVal);
    if (!d) return false;
    d.setHours(0, 0, 0, 0);
    return d < today;
  };

  const ccMetStatuses = ['code complete met', 'commit gate met', 'promotion gate met', 'closed'];
  const isCCMet = (item) =>
    ccMetStatuses.some((s) => String(item.status || '').toLowerCase().includes(s));

  /**
   * extractStatusSnippet — pull the most relevant risk/reason sentence from JIRA
   * wiki-markup status text. Returns plain text ≤ 180 chars, or null.
   */
  const extractStatusSnippet = (statusText) => {
    if (!statusText || typeof statusText !== 'string') return null;

    const clean = (s) =>
      s
        .replace(/\{color:[^}]+\}/gi, '')
        .replace(/\{color\}/gi, '')
        .replace(/\{\*\}/g, '')
        .replace(/\{-\}/g, '')
        .replace(/\{\+\}/g, '')
        .replace(/\{_\}/g, '')
        .replace(/\[([^\]|]+)\|[^\]]+\]/g, '$1')
        .replace(/\[([^\]]+)\]/g, '')
        .replace(/\*([^*\n]+)\*/g, '$1')
        .replace(/-([^-\n]{2,}?)-/g, '$1')
        .replace(/_([^_\n]+)_/g, '$1')
        .replace(/\^([^^]+)\^/g, '$1')
        .replace(/~([^~]+)~/g, '$1')
        .replace(/!([^!]+)!/g, '')
        .replace(/\{[^}]+\}/g, '')
        .replace(/\s+/g, ' ')
        .trim();

    const lines = statusText
      .split('\n')
      .map((l) => clean(l.trim()))
      .filter((l) => l.length > 0);

    const riskPatterns = [
      /reason\s+for\s+(red|yellow|risk)/i,
      /reason\s*:/i,
      /^risks?\s*[:/]/i,
      /risks?\s*\/\s*concerns?\s*[:/]/i,
      /concerns?\s*[:/]/i,
      /mitigation\s*[:/]/i,
      /path\s+to\s+green\s*[:/]/i,
      /block(ed|er|ing)\s+(on|by)/i,
      /dependency\s+(on|block)/i,
      /waiting\s+on/i,
      /delayed\s+by/i,
      /team\s+(at|is)\s+\d+%\s+capacity/i,
      /capacity/i,
    ];

    for (const pattern of riskPatterns) {
      for (let idx = 0; idx < lines.length; idx++) {
        const line = lines[idx];
        if (pattern.test(line) && line.length > 15) {
          const isJustLabel = /^(risks?|reason|concern|mitigation|path to green)\s*[:/]?\s*$/i.test(line);
          if (isJustLabel && idx + 1 < lines.length) {
            const next = lines[idx + 1];
            if (next.length > 20) {
              return next.length > 180 ? next.substring(0, 177) + '…' : next;
            }
          }
          const withoutLabel = line
            .replace(/^(reason\s+for\s+(red|yellow|risk)|risks?\s*\/\s*concerns?|risks?|concerns?|mitigation|path\s+to\s+green)\s*[:/]\s*/i, '')
            .trim();
          const snippet = withoutLabel.length > 20 ? withoutLabel : line;
          return snippet.length > 180 ? snippet.substring(0, 177) + '…' : snippet;
        }
      }
    }

    const skipPatterns = [
      /^h[1-6]\./i,
      /^\d{1,2}\/\w+\/\d{4}/,
      /^\[\d{1,2}[- ]\w+[- ]\d{4}\]/,
      /^(requirements|tech design|ux|ui|coding|test plan|testing|compliance|#)\s*[-:]?\s*$/i,
    ];

    for (const line of lines) {
      const isSkip = skipPatterns.some((p) => p.test(line));
      if (!isSkip && line.length > 30) {
        return line.length > 180 ? line.substring(0, 177) + '…' : line;
      }
    }

    return null;
  };

  const dateLabel = today.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });

  // ── Classify ─────────────────────────────────────────────────────────────────

  const classify = (arr) => ({
    reds: arr.filter((i) => getRisk(i) === 'red').sort((a, b) => getPriorityOrder(a) - getPriorityOrder(b)),
    yellows: arr.filter((i) => getRisk(i) === 'yellow').sort((a, b) => getPriorityOrder(a) - getPriorityOrder(b)),
    greens: arr.filter((i) => getRisk(i) === 'green'),
    notSet: arr.filter((i) => getRisk(i) === 'notset'),
    ccMet: arr.filter(isCCMet),
  });

  const com = classify(commit);
  const ltfC = classify(ltf);

  // Date issues: CC date passed but not complete, or FS/DS > Test Plan
  const dateIssues = (arr) =>
    arr.filter((item) => {
      const ccDate = parseDate(item.customfield_11067);
      const ccMissed = ccDate && isDateMissed(item.customfield_11067) && !isCCMet(item);
      const fsdsDate = parseDate(item.customfield_13861);
      const tpDate = parseDate(item.customfield_11068);
      const orderIssue = fsdsDate && tpDate && fsdsDate >= tpDate;
      return ccMissed || orderIssue;
    });

  const comDateIssues = dateIssues(commit);
  const ltfDateIssues = dateIssues(ltf);

  // Stale: red/yellow with no status update date
  const comStale = [...com.reds, ...com.yellows].filter((i) => !hasStatusUpdate(i));
  const ltfStale = [...ltfC.reds, ...ltfC.yellows].filter((i) => !hasStatusUpdate(i));

  // ── HIGHLIGHTS ───────────────────────────────────────────────────────────────
  // Counts-only snapshot — no item names. Exec reads this in 10 seconds.

  let h = '';
  h += `<p><strong>${selectedVersion} Release Highlights — ${dateLabel}</strong></p>`;

  // Helper: render a single-line count row
  const riskLine = (reds, yellows, greens, notSet) => {
    const parts = [];
    if (reds > 0)    parts.push(`🔴 ${reds} Red`);
    if (yellows > 0) parts.push(`🟡 ${yellows} Yellow`);
    if (greens > 0)  parts.push(`✅ ${greens} Green`);
    if (notSet > 0)  parts.push(`⚪ ${notSet} Not Set`);
    return parts.length > 0 ? parts.join(' &nbsp;·&nbsp; ') : '—';
  };

  // Commit section
  h += `<p><strong>Commit (${commit.length} items)</strong></p>`;
  h += `<p style="margin:0 0 4px 0;">${riskLine(com.reds.length, com.yellows.length, com.greens.length, com.notSet.length)}</p>`;
  const comSignals = [];
  if (com.ccMet.length > 0) comSignals.push(`🏁 ${com.ccMet.length} reached Code/Gate Complete`);
  if (comDateIssues.length > 0) comSignals.push(`📅 ${comDateIssues.length} with date issues`);
  if (comStale.length > 0) comSignals.push(`⏰ ${comStale.length} with no status update`);
  if (comSignals.length > 0) {
    h += `<p style="margin:0 0 12px 0; color:#495057; font-size:0.92em;">${comSignals.join(' &nbsp;·&nbsp; ')}</p>`;
  }

  // Long-term-funded section
  h += `<p><strong>Long-term-funded (${ltf.length} items)</strong></p>`;
  h += `<p style="margin:0 0 4px 0;">${riskLine(ltfC.reds.length, ltfC.yellows.length, ltfC.greens.length, ltfC.notSet.length)}</p>`;
  const ltfSignals = [];
  if (ltfC.ccMet.length > 0) ltfSignals.push(`🏁 ${ltfC.ccMet.length} reached Code/Gate Complete`);
  if (ltfDateIssues.length > 0) ltfSignals.push(`📅 ${ltfDateIssues.length} with date issues`);
  if (ltfStale.length > 0) ltfSignals.push(`⏰ ${ltfStale.length} with no status update`);
  if (ltfSignals.length > 0) {
    h += `<p style="margin:0 0 12px 0; color:#495057; font-size:0.92em;">${ltfSignals.join(' &nbsp;·&nbsp; ')}</p>`;
  }

  if (commit.length === 0 && ltf.length === 0) {
    h += `<p style="color:#6c757d;">No items loaded for ${selectedVersion}.</p>`;
  }

  // ── LOWLIGHTS ────────────────────────────────────────────────────────────────
  // Named items for reds (with one-line reason). Yellows grouped as a list.

  let l = '';
  l += `<p><strong>${selectedVersion} Lowlights — ${dateLabel}</strong></p>`;

  const renderReds = (reds, label) => {
    if (reds.length === 0) return '';
    let s = `<p><strong>🔴 ${label} — ${reds.length} item${reds.length > 1 ? 's' : ''} at big risk</strong></p><ul>`;
    reds.forEach((i) => {
      const pl = getPriorityLabel(i);
      const assignee = i.assignee ? ` · ${i.assignee}` : '';
      const snippet = extractStatusSnippet(i.customfield_23073);
      s += `<li><strong>[${pl}]</strong> ${link(i.key)} — ${i.summary} <em style="color:#6c757d;">(${i.status || 'unknown'}${assignee})</em>`;
      if (snippet) s += `<br><span style="color:#5e6c84;font-size:0.92em;">→ ${snippet}</span>`;
      s += `</li>`;
    });
    s += `</ul>`;
    return s;
  };

  const renderYellows = (yellows, label) => {
    if (yellows.length === 0) return '';
    let s = `<p><strong>🟡 ${label} — ${yellows.length} item${yellows.length > 1 ? 's' : ''} at slight risk</strong></p><ul>`;
    yellows.forEach((i) => {
      const snippet = extractStatusSnippet(i.customfield_23073);
      s += `<li>${link(i.key)} — ${i.summary}`;
      if (snippet) s += `<br><span style="color:#5e6c84;font-size:0.92em;">→ ${snippet}</span>`;
      s += `</li>`;
    });
    s += `</ul>`;
    return s;
  };

  const renderNotSet = (notSet, label) => {
    if (notSet.length === 0) return '';
    let s = `<p><strong>⚪ ${label} — ${notSet.length} item${notSet.length > 1 ? 's' : ''} missing risk indicator</strong></p><ul>`;
    notSet.forEach((i) => { s += `<li>${link(i.key)} — ${i.summary}</li>`; });
    s += `</ul>`;
    return s;
  };

  // Commit lowlights
  l += renderReds(com.reds, 'Commit');
  l += renderYellows(com.yellows, 'Commit');
  l += renderNotSet(com.notSet, 'Commit');

  // LTF lowlights
  l += renderReds(ltfC.reds, 'Long-term-funded');
  l += renderYellows(ltfC.yellows, 'Long-term-funded');
  l += renderNotSet(ltfC.notSet, 'Long-term-funded');

  // Date issues callout (only if any exist)
  const allDateIssues = [...comDateIssues, ...ltfDateIssues];
  if (allDateIssues.length > 0) {
    l += `<p><strong>📅 Date issues (${allDateIssues.length} item${allDateIssues.length > 1 ? 's' : ''})</strong></p><ul>`;
    allDateIssues.forEach((i) => {
      const ccDate = parseDate(i.customfield_11067);
      const fsdsDate = parseDate(i.customfield_13861);
      const tpDate = parseDate(i.customfield_11068);
      const reasons = [];
      if (ccDate && isDateMissed(i.customfield_11067) && !isCCMet(i)) {
        reasons.push('Code Complete date has passed');
      }
      if (fsdsDate && tpDate && fsdsDate >= tpDate) {
        reasons.push('FS/DS Done date ≥ Test Plan date');
      }
      l += `<li>${link(i.key)} — ${i.summary} <span style="color:#856404;">(${reasons.join('; ')})</span></li>`;
    });
    l += `</ul>`;
  }

  if (
    com.reds.length === 0 && com.yellows.length === 0 && com.notSet.length === 0 &&
    ltfC.reds.length === 0 && ltfC.yellows.length === 0 && ltfC.notSet.length === 0 &&
    allDateIssues.length === 0
  ) {
    l += `<p>No items at risk. All tracked items are currently on track. ✅</p>`;
  }

  // ── CALL TO ACTION ───────────────────────────────────────────────────────────
  // Verb-first, one line each, max ~5 items. Names only when urgent.

  let c = '';
  c += `<p><strong>${selectedVersion} Call to Action — ${dateLabel}</strong></p>`;
  c += `<ol>`;

  let ctaCount = 0;

  // P0/P1 commit reds — individual, urgent
  const urgentReds = com.reds.filter((i) => getPriorityOrder(i) <= 1);
  urgentReds.forEach((i) => {
    ctaCount++;
    const pl = getPriorityLabel(i);
    const urgency = getPriorityOrder(i) === 0 ? 'IMMEDIATE' : 'URGENT';
    const assignee = i.assignee ? ` (${i.assignee})` : '';
    const snippet = extractStatusSnippet(i.customfield_23073);
    const context = snippet ? ` Context: <em>${snippet}</em>.` : '';
    c += `<li><strong>[${pl} — ${urgency}]</strong> ${link(i.key)}${assignee} — resolve blockers and confirm mitigation + ETA by EOW.${context}</li>`;
  });

  // P2+ commit reds — grouped if more than 2, else individual
  const p2Reds = com.reds.filter((i) => getPriorityOrder(i) >= 2);
  if (p2Reds.length === 1) {
    ctaCount++;
    const i = p2Reds[0];
    const assignee = i.assignee ? ` (${i.assignee})` : '';
    c += `<li><strong>[Red]</strong> ${link(i.key)}${assignee} — clarify risk and share mitigation plan this week.</li>`;
  } else if (p2Reds.length > 1) {
    ctaCount++;
    c += `<li><strong>[Red — ${p2Reds.length} Commit items]</strong> Owners to clarify risk and share mitigation plan this week: ${p2Reds.map((i) => link(i.key)).join(', ')}.</li>`;
  }

  // LTF reds — grouped
  if (ltfC.reds.length > 0) {
    ctaCount++;
    if (ltfC.reds.length === 1) {
      const i = ltfC.reds[0];
      const snippet = extractStatusSnippet(i.customfield_23073);
      const context = snippet ? ` Context: <em>${snippet}</em>.` : '';
      c += `<li><strong>[LTF Red]</strong> ${link(i.key)} — program owner to review timeline and confirm if adjustment is needed.${context}</li>`;
    } else {
      c += `<li><strong>[LTF Red — ${ltfC.reds.length} items]</strong> Program owners to review timelines: ${ltfC.reds.map((i) => link(i.key)).join(', ')}.</li>`;
    }
  }

  // Yellows — grouped by type
  const allYellows = [
    com.yellows.length > 0 ? `${com.yellows.length} Commit` : null,
    ltfC.yellows.length > 0 ? `${ltfC.yellows.length} LTF` : null,
  ].filter(Boolean);
  if (allYellows.length > 0) {
    ctaCount++;
    const allYellowItems = [...com.yellows, ...ltfC.yellows];
    c += `<li><strong>[Yellow — ${allYellows.join(' + ')} items]</strong> Owners to confirm path to green and share mitigation: ${allYellowItems.map((i) => link(i.key)).join(', ')}.</li>`;
  }

  // Date issues
  if (allDateIssues.length > 0) {
    ctaCount++;
    c += `<li><strong>[Date Issues — ${allDateIssues.length} item${allDateIssues.length > 1 ? 's' : ''}]</strong> Review slipped dates and confirm updated ETAs: ${allDateIssues.map((i) => link(i.key)).join(', ')}.</li>`;
  }

  // Hygiene: risk not set (commit + LTF combined)
  const allNotSet = [...com.notSet, ...ltfC.notSet];
  if (allNotSet.length > 0) {
    ctaCount++;
    c += `<li><strong>[Hygiene]</strong> ${allNotSet.length} item${allNotSet.length > 1 ? 's' : ''} missing risk indicator — owners to update JIRA before next sync: ${allNotSet.map((i) => link(i.key)).join(', ')}.</li>`;
  }

  // Stale status updates (commit + LTF combined, only if not already called out above)
  const allStale = [...comStale, ...ltfStale].filter(
    (i) => !urgentReds.some((r) => r.key === i.key) && !p2Reds.some((r) => r.key === i.key)
  );
  if (allStale.length > 0) {
    ctaCount++;
    c += `<li><strong>[Stale]</strong> ${allStale.length} red/yellow item${allStale.length > 1 ? 's' : ''} have no status update date — owners to update JIRA this week: ${allStale.map((i) => link(i.key)).join(', ')}.</li>`;
  }

  if (ctaCount === 0) {
    c += `<li>No immediate actions required. Continue monitoring weekly cadence. ✅</li>`;
  }

  c += `</ol>`;

  return {
    highlightsHtml: h,
    lowlightsHtml: l,
    callToActionHtml: c,
  };
}
