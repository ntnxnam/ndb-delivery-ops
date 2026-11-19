/**
 * tpmStageService — lifecycle stage derivation for TPM reports.
 * Product-agnostic (D1): no hardcoded product strings, gates matched case-insensitively.
 */

const STAGE_ORDER = ['execution', 'release', 'postRelease', 'overall'];

/**
 * Classify a gate key into a bucket for stage thresholds.
 * @param {string} key - gate key from releaseGateDates (e.g. "ccm1Gate", "commitGate1", "ga1")
 * @returns {'code'|'commit'|'promotion'|'ga'|null}
 */
function classifyGate(key) {
  const k = String(key || '').toLowerCase();
  if (!k) return null;
  if (k.includes('ccm') || k.includes('codecomplete') || (k.includes('code') && !k.includes('promotion') && !k.includes('commit'))) return 'code';
  if (k.includes('commit')) return 'commit';
  if (k.includes('promotion')) return 'promotion';
  if (k === 'ga' || k.startsWith('ga') || k.includes('_ga') || k.includes('-ga') || k.includes('generalavailability') || /\bga\b/.test(k)) return 'ga';
  // fallback: keys like ga1, ga2, gaDate
  if (/^ga\d*/.test(k)) return 'ga';
  return null;
}

/**
 * Parse a gate value into an ISO date string or null.
 * Supports: gate as { date: "YYYY-MM-DD" } or plain string "YYYY-MM-DD" or ecDate string.
 * @param {*} val
 * @returns {string|null} YYYY-MM-DD or null
 */
function gateToIsoDate(val) {
  if (!val) return null;
  if (typeof val === 'string') {
    const s = val.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  if (typeof val === 'object' && typeof val.date === 'string') {
    const s = val.date.trim().slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }
  return null;
}

/**
 * Collect earliest / latest date per bucket from a release's gate map.
 * @param {object} gateMap - releaseGateDates[releaseVersion]
 * @returns {{ code:string|null, promotion:string|null, ga:string|null, allDates: Array<{key:string,date:string,bucket:string|null}> }}
 */
function collectThresholds(gateMap) {
  if (!gateMap || typeof gateMap !== 'object') return { code: null, promotion: null, ga: null, allDates: [] };
  const allDates = [];
  for (const [key, val] of Object.entries(gateMap)) {
    const iso = gateToIsoDate(val);
    if (!iso) continue;
    // skip metadata keys that are not gates (include ecDate/preEc/conceptCommit* which are milestones, not gates for nextGate)
    if (['devDRIs', 'qaDRIs', 'dateHistory', 'notes', 'releaseNotes', 'info', '_jira', 'jiraMeta', '_source', '_syncedAt', 'ecDate', 'preEc', 'preCommit'].includes(key) || key.startsWith('conceptCommit')) continue;
    const bucket = classifyGate(key);
    if (!bucket) continue;
    allDates.push({ key, date: iso, bucket });
  }
  allDates.sort((a, b) => a.date.localeCompare(b.date));

  /** earliest date in bucket helper */
  const earliest = (bucket) => {
    const filtered = allDates.filter((d) => d.bucket === bucket);
    if (!filtered.length) return null;
    return filtered.slice().sort((a, b) => a.date.localeCompare(b.date))[0].date;
  };
  // code threshold: earliest code-family gate
  const code = earliest('code');
  // promotion threshold: earliest promotion-family gate
  const promotion = earliest('promotion');
  // ga threshold: earliest ga-family gate
  const ga = earliest('ga');
  return { code, promotion, ga, allDates };
}

/**
 * Normalize "today" input to YYYY-MM-DD.
 * @param {string|Date} today
 * @returns {string|null}
 */
function normalizeToday(today) {
  if (!today) return null;
  if (today instanceof Date && !isNaN(today.getTime())) return today.toISOString().slice(0, 10);
  const s = String(today).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

/**
 * Derive lifecycle stage for a release on a given date.
 *
 * Rules (in order):
 *  - If today < earliest code-family gate → execution (During Release Execution)
 *  - If codeComplete <= today < earliest promotion gate → release (At release)
 *  - If today >= earliest GA gate → postRelease (CFDs/CFIs/OnCalls)
 *  - Else → overall (SLA) as fallback, or when gates are missing.
 *
 * Missing gates fall back gracefully: if code threshold absent, skip that check;
 * if promotion absent but code present, "release" spans code → ga; if ga absent,
 * postRelease is unreachable and we return overall when beyond promotion.
 *
 * @param {string} releaseVersion - e.g. "NDB-2.12"
 * @param {string|Date} today - ISO date or Date instance
 * @param {object} gateDatesMap - releaseGateDates (all releases)
 * @returns {{ stage: 'postRelease'|'execution'|'release'|'overall', reason: string, nextGate: { key:string, date:string, label:string }|null, gateDatesForRelease: object, thresholds: object }}
 */
function getStageForRelease(releaseVersion, today, gateDatesMap) {
  const todayIso = normalizeToday(today);
  const gateDatesForRelease = (gateDatesMap && releaseVersion && gateDatesMap[releaseVersion]) ? gateDatesMap[releaseVersion] : {};
  const { code, promotion, ga, allDates } = collectThresholds(gateDatesForRelease);

  if (!todayIso) {
    return { stage: 'overall', reason: 'Missing or invalid today date — fallback to overall', nextGate: null, gateDatesForRelease, thresholds: { code, promotion, ga } };
  }
  if (!releaseVersion || !gateDatesMap || !gateDatesMap[releaseVersion] || allDates.length === 0) {
    return { stage: 'overall', reason: 'No gate dates for release — fallback to overall', nextGate: null, gateDatesForRelease, thresholds: { code, promotion, ga } };
  }

  // Only solid gates or all — use earliest in each bucket (spec: handle missing gracefully)
  const hasAnyGate = !!(code || promotion || ga);

  /**
   * Next upcoming gate: earliest gate with date >= today.
   */
  function nextGateAfter() {
    const upcoming = allDates.filter((d) => d.date >= todayIso).sort((a, b) => a.date.localeCompare(b.date));
    if (!upcoming.length) return null;
    const g = upcoming[0];
    const raw = gateDatesForRelease[g.key];
    const label = raw && typeof raw === 'object' && raw.label ? raw.label : g.key;
    return { key: g.key, date: g.date, label };
  }

  const nextGate = nextGateAfter();

  // 1. Execution: before code complete
  if (code && todayIso < code) {
    return { stage: 'execution', reason: `today ${todayIso} < codeComplete ${code}`, nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
  }
  // 2. Release: code <= today < promotion (if promotion exists), else code <= today < ga (or code <= today if no later gate)
  if (code && promotion) {
    if (todayIso >= code && todayIso < promotion) {
      return { stage: 'release', reason: `today ${todayIso} in [codeComplete ${code}, promotion ${promotion})`, nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
    }
  } else if (code && !promotion && ga) {
    if (todayIso >= code && todayIso < ga) {
      return { stage: 'release', reason: `today ${todayIso} in [codeComplete ${code}, ga ${ga}) (no promotion gate)`, nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
    }
  } else if (code && !promotion && !ga) {
    if (todayIso >= code) {
      return { stage: 'release', reason: `today ${todayIso} >= codeComplete ${code} (no later gates)`, nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
    }
  }
  // No code gate: use promotion as boundary for execution vs release
  if (!code && promotion && todayIso < promotion) {
    return { stage: 'execution', reason: `today ${todayIso} < promotion ${promotion} (no code gate)`, nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
  }
  if (!code && promotion && todayIso >= promotion) {
    // fall through to postRelease check
  }

  // 3. PostRelease: today >= ga
  if (ga && todayIso >= ga) {
    return { stage: 'postRelease', reason: `today ${todayIso} >= ga ${ga}`, nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
  }

  // 4. Between promotion and ga (or beyond promotion when no ga) → postRelease if ga missing? spec says overall fallback.
  // Spec: "if today >= gaDate → postRelease, else overall as fallback."
  // So gaps between promotion and ga are "release" already handled; if promotion <= today < ga we already handled via release branch.
  // If we got here: either (a) no code gate and today >= promotion but < ga, or (b) promotion missing entirely.
  if (promotion && todayIso >= promotion) {
    if (ga && todayIso < ga) {
      return { stage: 'release', reason: `today ${todayIso} in [promotion ${promotion}, ga ${ga})`, nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
    }
    if (!ga) {
      return { stage: 'overall', reason: `today ${todayIso} >= promotion ${promotion} but no GA — fallback to overall`, nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
    }
  }

  // Fallback: overall
  if (!hasAnyGate) {
    return { stage: 'overall', reason: 'No recognizable gates — fallback to overall', nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
  }
  return { stage: 'overall', reason: `today ${todayIso} does not match execution/release/postRelease — fallback to overall`, nextGate, gateDatesForRelease, thresholds: { code, promotion, ga } };
}

module.exports = { getStageForRelease, classifyGate, collectThresholds, STAGE_ORDER };
