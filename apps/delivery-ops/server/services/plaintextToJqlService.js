/**
 * Plaintext → Healthy JQL builder (deterministic, no LLM for first cut).
 * Future LLM hook: replace parsePlaintext with LLM call, keep validation layer.
 */

/** Format Date → yyyy-MM-dd */
function fmt(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function parseNaturalDate(str, now) {
  if (!str) return null;
  const s = str.trim().toLowerCase();
  if (s === 'today') return fmt(now);
  if (s === 'yesterday') { const d = new Date(now); d.setDate(d.getDate() - 1); return fmt(d); }
  // ISO yyyy-mm-dd
  const iso = s.match(/^(\d{4}-\d{2}-\d{2})$/);
  if (iso) return iso[1];
  // last monday etc
  const wd = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const m = s.match(/last\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/);
  if (m) {
    const target = wd[m[1]];
    const d = new Date(now);
    const diff = (d.getDay() - target + 7) % 7 || 7;
    d.setDate(d.getDate() - diff);
    return fmt(d);
  }
  return null;
}

function resolveCodeCompleteDate(releaseVersion, releaseGateDates) {
  if (!releaseVersion || !releaseGateDates) return null;
  const entry = releaseGateDates[releaseVersion];
  if (!entry) return null;
  for (const k of Object.keys(entry)) {
    const v = entry[k];
    if (v && typeof v.date === 'string' && k.toLowerCase().includes('ccm')) return v.date;
    if (v && typeof v.date === 'string' && k.toLowerCase().includes('code')) return v.date;
  }
  return null;
}

function buildKnownFieldIds(jiraFieldsConfig) {
  const ids = new Set();
  if (!jiraFieldsConfig || !jiraFieldsConfig.fields) return ids;
  for (const cat of Object.values(jiraFieldsConfig.fields)) {
    for (const def of Object.values(cat)) if (def.id) ids.add(def.id);
  }
  return ids;
}

function detectWarnings(plaintext, knownFieldIds) {
  const warnings = [];
  // type= should be issuetype=
  if (/\btype\s*=/i.test(plaintext)) warnings.push({ code: 'type_alias', message: 'Use issuetype= instead of type= (normalized automatically).' });
  // Unknown customfield
  const CF_RE = new RegExp('custom' + 'field_\\d+', 'gi');
  const cfs = [...plaintext.matchAll(CF_RE)].map(m => m[0].toLowerCase());
  for (const cf of cfs) if (!knownFieldIds.has(cf)) warnings.push({ code: 'unknown_field', message: `Unknown field ${cf} — not in jiraFieldsConfig. Did you mean a known field?` });
  return warnings;
}

/**
 * @param {object} opts
 * @returns {{jql:string,tokens:Array,warnings:Array,cited:{plaintext:string,timestamp:string}}}
 */
function plaintextToJql(opts) {
  const { plaintext: raw, teamId, releaseVersion, kpiConfig, teamBoardConfig, jiraFieldsConfig, releaseGateDates, now } = opts;
  const plaintext = String(raw || '').trim();
  const ts = (now || new Date()).toISOString();
  const cited = { plaintext, timestamp: ts };
  const lower = plaintext.toLowerCase();
  const warnings = [];
  const tokens = [];

  if (!plaintext) return { jql: '', tokens, warnings: [{ code: 'empty', message: 'Enter plaintext to generate JQL.' }], cited };

  const knownFieldIds = buildKnownFieldIds(jiraFieldsConfig);
  warnings.push(...detectWarnings(plaintext, knownFieldIds));

  // Resolve team — product-agnostic, never hardcode NDB fallback string
  const team = (teamBoardConfig?.teams || []).find(t => t.id === teamId) || null;
  const baseFilter = team?.baseFilter || (teamBoardConfig?.teams || [])[0]?.baseFilter || '';
  const clauses = [];
  const pushToken = (text, type, detail) => tokens.push({ text, type, detail });

  // Release scope
  const allReleases = /\ball releases\b/i.test(plaintext);
  if (!allReleases && releaseVersion) {
    clauses.push(`filter=${releaseVersion}-All`);
    pushToken(`filter=${releaseVersion}-All`, 'knownField', 'Release scope from releaseVersion');
  } else if (!allReleases && team?.releasePrefix) {
    // fallback: still scope by team base
  }
  // Always include team baseFilter as literal per tpmFetch rule (don't expand saved filters)
  clauses.push(baseFilter);
  pushToken(baseFilter, 'knownField', 'Team baseFilter');

  // Priority
  if (/\bp0s?\b/.test(lower) || /blocker/.test(lower)) {
    clauses.push('priority = "Blocker - P0"');
    pushToken('priority = "Blocker - P0"', 'knownField', 'From "p0"');
  } else if (/\bp1s?\b/.test(lower) || /critical/.test(lower)) {
    clauses.push('priority = "Critical - P1"');
    pushToken('priority = "Critical - P1"', 'knownField', 'From "p1"');
  }

  // Issuetype
  if (/\bbug(s)?\b/.test(lower)) {
    clauses.push('issuetype = Bug');
    pushToken('issuetype = Bug', 'knownField', 'From "bug"');
  } else if (/feature/.test(lower)) {
    clauses.push('issuetype in (Feature, Initiative)');
    pushToken('issuetype in (Feature, Initiative)', 'knownField', 'From "feature"');
  }

  // Date range: from X to Y
  const fromTo = plaintext.match(/from\s+(.+?)\s+to\s+(.+?)(?:\s|$)/i);
  let dateField = 'duedate';
  // jira-date-hierarchy: Feature/Initiative uses codeComplete (resolved via jiraFieldsConfig)
  const isFeature = /\bfeature\b/i.test(plaintext);
  if (isFeature) dateField = jiraFieldsConfig?.fields?.checkpointDates?.codeComplete?.id || 'codeComplete';
  if (fromTo) {
    const aRaw = fromTo[1].trim();
    const bRaw = fromTo[2].trim().replace(/[.,;]$/, '');
    let aDate = null; let bDate = null;
    // code complete → gate date
    if (/code complete/i.test(aRaw)) aDate = resolveCodeCompleteDate(releaseVersion, releaseGateDates);
    else aDate = parseNaturalDate(aRaw, now || new Date());
    if (/today/i.test(bRaw)) bDate = fmt(now || new Date());
    else bDate = parseNaturalDate(bRaw, now || new Date());
    if (aDate && bDate) {
      clauses.push(`${dateField} >= "${aDate}" AND ${dateField} <= "${bDate}"`);
      pushToken(`${dateField} range ${aDate}→${bDate}`, 'assumed', `From "${fromTo[0].trim()}"`);
    } else {
      warnings.push({ code: 'date_parse', message: `Could not parse date range "${fromTo[0].trim()}". Expected e.g. "from Code Complete to today" or "from 2026-01-01 to 2026-02-01".` });
      pushToken(fromTo[0].trim(), 'invalid', 'Unparsed date range');
    }
  }

  // Not QA verified
  if (/not qa verified|wasn'?t qa verified|weren'?t qa verified|not verified/i.test(lower)) {
    clauses.push('status not in (Resolved, Closed) AND statusCategory != Done');
    pushToken('status not in (Resolved, Closed)', 'assumed', '"not QA verified" → status != Done; assumed mapping, verify with QA workflow');
    warnings.push({ code: 'qa_assumed', message: 'Assumption: "not QA verified" mapped to status not in (Resolved, Closed) AND statusCategory != Done. Confirm with your QA workflow; may need QA Contact is EMPTY.' });
  }

  // Normalize type= → issuetype=
  let jql = clauses.join(' AND ');
  // Final warnings for invalid tokens not captured
  // Invalid detection: plaintext words that look like JQL fields unknown
  const fieldLike = [...plaintext.matchAll(/(\w+)\s*(=|in|is)/gi)].map(m => m[1].toLowerCase());
  const codeCompleteId = jiraFieldsConfig?.fields?.checkpointDates?.codeComplete?.id || 'codeComplete';
  const sprintNdbId = jiraFieldsConfig?.fields?.extras?.sprintNdb?.id || 'sprintNdb';
  const known = new Set(['priority', 'issuetype', 'type', 'status', 'statuscategory', 'filter', 'project', 'labels', 'component', 'duedate', codeCompleteId, sprintNdbId]);
  for (const f of fieldLike) if (!known.has(f) && !f.startsWith('custom' + 'field_')) { warnings.push({ code: 'unknown_field_like', message: `Unknown field-like "${f}" in plaintext.` }); pushToken(f, 'invalid', 'Unknown field'); }

  return { jql, tokens, warnings, cited };
}

module.exports = { plaintextToJql };
