/**
 * OnCall gap taxonomy — pure helpers for classifying closed stacks.
 * Product-agnostic: NDB detection via cfg.onCallProject/techHelpProjects/onCallProject prefix.
 */

const { cell, keysInJql, andParts, escapeLinkedIssuesOfInner, oncallSeedJql } = require('./oncallConfigResolve');

const DUD_RESOLUTIONS = new Set(['duplicate', "won't do", "wont do", 'cannot reproduce', 'invalid', 'cannotreproduce', 'won`t do']);

function isDudResolution(resolution) {
  if (!resolution) return false;
  const norm = String(resolution).trim().toLowerCase();
  return DUD_RESOLUTIONS.has(norm);
}

/**
 * Classify closed stacks into duds / ndbGaps / otherTeamGaps.
 * @param {Array} closedStacks - stacks from classifyStacksFromIssues (must have .key, .resolution, .linked, .summary, .component)
 * @param {object} cfg - runtime config (onCallProject, techHelpProjects, engFixProjects, etc.)
 * @returns {{ duds: {keys:string[], stacks:Array}, ndbGaps: {keys:string[], stacks:Array}, otherTeamGaps: {keys:string[], stacks:Array} }}
 */
function classifyGapBuckets(closedStacks, cfg) {
  const stacks = Array.isArray(closedStacks) ? closedStacks : [];
  const duds = [];
  const ndbGaps = [];
  const otherTeamGaps = [];

  const onCallProjectUpper = String(cfg.onCallProject || 'OnCall').toUpperCase();
  // ndb detection: linked projectKey starts with NDB or component contains NDB; also engFixProjects includes NDB-prefixed
  // Keep product-agnostic: we treat onCallProject-derived prefix as NDB signal.
  // For generic detection, check linked projectKey against onCallProject/techHelpProjects not — instead use NDB prefix directly
  // as per requirement: linked projectKey startsWith NDB or component contains NDB.
  // But allow config override: if engFixProjects provided, treat those as NDB candidates.
  // Product-agnostic: derive gap prefixes from config (engFixProjects) with tenant fallback via cfg.gapProjectPrefixes or onCallProject family
  const ndbProjectPrefixes = Array.isArray(cfg.gapProjectPrefixes) && cfg.gapProjectPrefixes.length
    ? cfg.gapProjectPrefixes.map((p) => String(p).toUpperCase())
    : (cfg.engFixProjects || []).length
      ? (cfg.engFixProjects || []).map((p) => String(p).toUpperCase())
      : (String(cfg.teamId || '').toLowerCase() === 'ndb' ? ['NDB', 'NDB-', 'ERA'] : ['NDB', 'NDB-']); // NDB team uses ERA project for fixes — include ERA, else product-agnostic
  const engProjectsUpper = (cfg.engFixProjects || []).map((p) => String(p).toUpperCase()).filter(Boolean);

  for (const s of stacks) {
    const resolution = s.resolution || s.fields?.resolution?.name || null;
    const linked = s.linked || s.engFixes || s.techHelp ? [...(s.linked || []), ...(s.engFixes || []), ...(s.techHelp || [])] : (s.linked || []);
    // Deduplicate linked by key
    const linkedDedup = [];
    const seen = new Set();
    for (const l of (s.linked || linked || [])) {
      if (!l || !l.key) continue;
      if (seen.has(l.key)) continue;
      seen.add(l.key);
      linkedDedup.push(l);
    }
    const effectiveLinked = linkedDedup.length ? linkedDedup : (s.linked || []);
    const hasLinkedFix = effectiveLinked.some((l) => l && l.key);

    // Dud if resolution in dud set OR no linked fix (customer env misconfig etc.)
    const dudByResolution = isDudResolution(resolution);
    const dudByNoLink = !hasLinkedFix;
    if (dudByResolution || dudByNoLink) {
      duds.push(s);
      continue;
    }

    // NDB gaps: linked projectKey starts with NDB or component contains NDB
    const isNdbLinked = effectiveLinked.some((l) => {
      const pk = String(l.projectKey || l.key?.split('-')[0] || '').toUpperCase();
      const component = String(l.component || s.component || s.components || '').toUpperCase();
      if (ndbProjectPrefixes.some((p) => pk.startsWith(p))) return true;
      if (component.includes('NDB')) return true;
      if (engProjectsUpper.length && engProjectsUpper.includes(pk)) return true;
      // also if onCallProjectUpper is NDB-like, treat linked to same family
      if (onCallProjectUpper === pk) return false; // OnCall itself not NDB gap
      if (onCallProjectUpper.startsWith('NDB') && pk.startsWith(onCallProjectUpper)) return true;
      return false;
    });

    if (isNdbLinked) {
      ndbGaps.push(s);
    } else {
      otherTeamGaps.push(s);
    }
  }

  return {
    duds: { keys: duds.map((x) => x.key).filter(Boolean), stacks: duds },
    ndbGaps: { keys: ndbGaps.map((x) => x.key).filter(Boolean), stacks: ndbGaps },
    otherTeamGaps: { keys: otherTeamGaps.map((x) => x.key).filter(Boolean), stacks: otherTeamGaps },
  };
}

function buildGapCells(buckets, cfg) {
  const seed = cfg ? oncallSeedJql(cfg) : null;
  // Cells use key in (...) JQLs for exact proof; fallback to null if empty
  const toCell = (arr) => {
    const keys = Array.isArray(arr) ? arr : (arr.keys || []);
    if (!keys.length) return cell(0, null);
    return cell(keys.length, keysInJql(keys));
  };
  return {
    duds: toCell(buckets.duds?.keys || buckets.duds),
    ndbGaps: toCell(buckets.ndbGaps?.keys || buckets.ndbGaps),
    otherTeamGaps: toCell(buckets.otherTeamGaps?.keys || buckets.otherTeamGaps),
  };
}

/**
 * NDB sub-gap drill: split ndbGaps by linked issuetype/project into thLinked/bugs/improvements/other
 */
function classifyNdbSubGaps(ndbStacks, cfg) {
  const stacks = Array.isArray(ndbStacks) ? ndbStacks : (ndbStacks.stacks || ndbStacks.keys ? [] : []);
  // Accept buckets.ndbGaps object
  const list = Array.isArray(ndbStacks) ? ndbStacks : (ndbStacks.stacks || []);
  const thLinked = [];
  const bugs = [];
  const improvements = [];
  const other = [];

  const techHelpUpper = (cfg.techHelpProjects || ['TH', 'TechHelp']).map((p) => String(p).toUpperCase());

  for (const s of list) {
    const linked = s.linked || s.engFixes || [];
    const allLinked = s.linked ? s.linked : [...(s.techHelp || []), ...(s.engFixes || []), ...(s.techPubs || [])];
    const hasTH = (s.techHelp && s.techHelp.length) || allLinked.some((l) => techHelpUpper.includes(String(l.projectKey || l.key?.split('-')[0] || '').toUpperCase()));
    const linkedTypes = allLinked.map((l) => String(l.issueType || l.issuetype || '').toLowerCase());
    const isBug = linkedTypes.some((t) => t.includes('bug'));
    const isImprovement = linkedTypes.some((t) => t.includes('improvement') || t.includes('story') || t.includes('task'));

    if (hasTH) thLinked.push(s);
    else if (isBug) bugs.push(s);
    else if (isImprovement) improvements.push(s);
    else other.push(s);
  }

  // Fallback: if all in other but we have ndbGaps, distribute by issuetype field of linked or OnCall
  return {
    thLinked: { keys: thLinked.map((x) => x.key).filter(Boolean), stacks: thLinked },
    bugs: { keys: bugs.map((x) => x.key).filter(Boolean), stacks: bugs },
    improvements: { keys: improvements.map((x) => x.key).filter(Boolean), stacks: improvements },
    other: { keys: other.map((x) => x.key).filter(Boolean), stacks: other },
  };
}

function buildNdbSubCells(sub, cfg) {
  const toCell = (arr) => {
    const keys = Array.isArray(arr) ? arr : (arr.keys || []);
    if (!keys.length) return cell(0, null);
    return cell(keys.length, keysInJql(keys));
  };
  return {
    thLinked: toCell(sub.thLinked?.keys || sub.thLinked),
    bugs: toCell(sub.bugs?.keys || sub.bugs),
    improvements: toCell(sub.improvements?.keys || sub.improvements),
    other: toCell(sub.other?.keys || sub.other),
  };
}

module.exports = {
  classifyGapBuckets,
  buildGapCells,
  classifyNdbSubGaps,
  buildNdbSubCells,
  isDudResolution,
  DUD_RESOLUTIONS,
};
