/**
 * dependencyViewService — read-only Dependency View overview (Q1–Q7).
 * No JIRA mutates. JQL builders match agent-pack/context/domain/cross-team-dependencies.md.
 */
const fs = require('fs');
const path = require('path');
const { runSearchByJql } = require('../utils/jiraSearchByJql');
const { getJira } = require('../utils/jiraClient');
const { getTeamById, loadTeamBoardConfig, normalizeTeamId } = require('../utils/teamConfig');
const jiraFieldsConfig = require('../config/jiraFieldsConfig.json');

const CONFIG_PATH = path.join(__dirname, '../config/dependencyViewConfig.json');
const RELEASE_CFG_PATH = path.join(__dirname, '../config/releaseVersionsEmailConfig.json');
const RELEASE_COMMIT_FIELD =
  jiraFieldsConfig?.fields?.indicators?.releaseCommit?.id || 'customfield_11061';
const CODE_COMPLETE_FIELD =
  jiraFieldsConfig?.fields?.checkpointDates?.codeComplete?.id || 'customfield_11067';
const COMMIT_GATE_FIELD =
  jiraFieldsConfig?.fields?.checkpointDates?.commitGate?.id || 'customfield_35863';
const PROMOTION_GATE_FIELD =
  jiraFieldsConfig?.fields?.checkpointDates?.promotionGate?.id || 'customfield_35864';
const EPIC_LINK_FIELD =
  jiraFieldsConfig?.fields?.relationships?.epicLink?.id || 'customfield_10361';
const PARENT_LINK_FIELD =
  jiraFieldsConfig?.fields?.relationships?.parentLink?.id || 'customfield_20363';
/** Sprint custom fields — 10020/10021 from config; 10360 is Nutanix board sprint. */
const SPRINT_FIELD_IDS = [
  jiraFieldsConfig?.fields?.agile?.sprint?.id || 'customfield_10020',
  jiraFieldsConfig?.fields?.agile?.sprints?.id || 'customfield_10021',
  'customfield_10360',
];
/** Extra search fields so sprint/CC are always present even if config drifts. */
const DEPENDENCY_EXTRA_FIELDS = ['issuelinks', ...SPRINT_FIELD_IDS, CODE_COMPLETE_FIELD, 'duedate'];

/** Wider project type wins when merging inferred signals. */
const EW_SPAN_RANK = { global_ew: 3, nutanix_ew: 2, ndb_ew: 1, team_internal: 0 };

function isoDay(value) {
  if (value == null || value === '') return null;
  const s = typeof value === 'string' ? value : String(value);
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function addDaysIso(iso, days) {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function issueTypeFlags(issueType) {
  const upper = String(issueType || '').toUpperCase();
  const isPortfolio =
    upper.includes('X-FEAT') ||
    upper.includes('CAPABILITY') ||
    upper.includes('FEATURE') ||
    upper.includes('INITIATIVE');
  const isEpic = !isPortfolio && upper.includes('EPIC');
  return { upper, isPortfolio, isEpic };
}

/**
 * Parse sprint id / name / endDate from raw JIRA sprint custom fields.
 * GreenHopper strings often embed endDate=… so we can avoid an API round-trip.
 */
function parseSprintFromRaw(raw) {
  let bestId = null;
  let bestName = null;
  let bestEnd = null;

  const consider = (item) => {
    if (item == null) return;
    if (typeof item === 'number' && !Number.isNaN(item)) {
      bestId = item;
      return;
    }
    if (typeof item === 'object') {
      if (item.id != null) bestId = Number(item.id);
      if (item.name) bestName = String(item.name);
      const end = isoDay(item.endDate || item.enddate);
      if (end) bestEnd = end;
      return;
    }
    if (typeof item === 'string') {
      const idMatches = [...item.matchAll(/id=(\d+)/g)];
      if (idMatches.length) bestId = Number(idMatches[idMatches.length - 1][1]);
      const nameM = item.match(/name=([^,\]]+)/);
      if (nameM) bestName = nameM[1].trim();
      const endM = item.match(/endDate=([^,\]]+)/);
      if (endM && endM[1] && !/<null>/i.test(endM[1])) {
        const end = isoDay(endM[1]);
        if (end) bestEnd = end;
      }
      if (/^\d+$/.test(item.trim())) bestId = Number(item.trim());
    }
  };

  for (const fid of SPRINT_FIELD_IDS) {
    const v = raw[fid];
    if (v == null) continue;
    if (Array.isArray(v)) v.forEach(consider);
    else consider(v);
  }

  return {
    sprintId: bestId != null && !Number.isNaN(bestId) ? bestId : null,
    sprintName: bestName || null,
    sprintEndDate: bestEnd || null,
  };
}

/**
 * Tile target date per Nutanix hierarchy:
 * - Feature / Initiative / X-FEAT / Capability → Code Complete
 * - Epic → Due Date
 * - Task / Bug / etc → Due Date, else sprint end (inferred)
 */
function resolveTargetDate(raw, issueType, sprintHint = {}) {
  const { isPortfolio, isEpic } = issueTypeFlags(issueType);
  const due = isoDay(raw.duedate);
  const cc = isoDay(raw[CODE_COMPLETE_FIELD]);
  const sprintEnd = sprintHint.sprintEndDate || null;
  const sprintName = sprintHint.sprintName || null;
  const sprintId = sprintHint.sprintId || null;

  if (isPortfolio) {
    return {
      targetDate: cc,
      targetDateSource: cc ? 'code_complete' : null,
      targetDateLabel: 'Code Complete',
      sprintId,
      sprintName,
      sprintEndDate: sprintEnd,
    };
  }
  if (isEpic) {
    return {
      targetDate: due,
      targetDateSource: due ? 'due_date' : null,
      targetDateLabel: 'Due date',
      sprintId,
      sprintName,
      sprintEndDate: sprintEnd,
    };
  }
  if (due) {
    return {
      targetDate: due,
      targetDateSource: 'due_date',
      targetDateLabel: 'Due date',
      sprintId,
      sprintName,
      sprintEndDate: sprintEnd,
    };
  }
  if (sprintEnd) {
    return {
      targetDate: sprintEnd,
      targetDateSource: 'sprint_end',
      targetDateLabel: 'Sprint end',
      sprintId,
      sprintName,
      sprintEndDate: sprintEnd,
    };
  }
  return {
    targetDate: null,
    targetDateSource: null,
    targetDateLabel: null,
    sprintId,
    sprintName,
    sprintEndDate: null,
  };
}

/**
 * Nutanix hierarchy-aware start/end for Gantt bars.
 * Start: ticket start if present, else release EC (NOT created — created pins ancient FEATs to the left).
 * End: gate dates / due date by issue type. No fabricated created+14 bars.
 *
 * @param {object} raw
 * @param {string} issueType
 * @param {{ ecDate?: string|null, gaDate?: string|null }} [releaseCtx]
 * @param {{ sprintEndDate?: string|null }} [sprintHint]
 */
function resolveIssueTimeline(raw, issueType, releaseCtx = {}, sprintHint = {}) {
  const { isPortfolio, isEpic } = issueTypeFlags(issueType);
  const created = isoDay(raw.created);
  const updated = isoDay(raw.updated);
  const due = isoDay(raw.duedate);
  const cc = isoDay(raw[CODE_COMPLETE_FIELD]);
  const cg = isoDay(raw[COMMIT_GATE_FIELD]);
  const pg = isoDay(raw[PROMOTION_GATE_FIELD]);
  const releaseEc = isoDay(releaseCtx.ecDate);
  const releaseGa = isoDay(releaseCtx.gaDate);
  const sprintEnd = isoDay(sprintHint.sprintEndDate);

  let endDate = null;
  if (isPortfolio) {
    // Display hierarchy prefers Code Complete; timeline still allows CG/PG as fallthrough
    endDate = cc || pg || cg || due;
  } else if (isEpic) {
    endDate = due || cc || pg;
  } else {
    endDate = due || sprintEnd;
  }

  // Hierarchy: prefer release EC as start fallback — never invent from created alone
  let startDate = releaseEc || null;
  let barKind = 'range';

  if (isPortfolio || isEpic) {
    if (endDate && startDate && startDate > endDate) {
      startDate = addDaysIso(endDate, -14);
      barKind = 'estimated';
    } else if (endDate && !startDate) {
      startDate = addDaysIso(endDate, -14);
      barKind = 'estimated';
    } else if (!endDate && startDate && releaseGa) {
      endDate = releaseGa;
      barKind = 'estimated';
    } else if (!endDate && !startDate) {
      barKind = 'undated';
    } else if (!endDate && startDate) {
      // Have EC but no gate/due — do not draw a fake 14-day stub from EC
      barKind = 'undated';
      startDate = null;
    }
  } else {
    // Stories/tasks/bugs: due date, else sprint end (inferred)
    if (endDate && !due && sprintEnd && endDate === sprintEnd) {
      barKind = 'sprint_inferred';
    }
    if (endDate && startDate && startDate > endDate) {
      startDate = addDaysIso(endDate, -7);
      if (barKind !== 'sprint_inferred') barKind = 'estimated';
    } else if (endDate && !startDate) {
      startDate = addDaysIso(endDate, -7);
      if (barKind !== 'sprint_inferred') barKind = 'estimated';
    } else if (!endDate) {
      barKind = 'undated';
      startDate = null;
    }
  }

  const isMilestone = startDate && endDate && startDate === endDate;
  if (isMilestone && barKind !== 'sprint_inferred') barKind = 'milestone';

  return {
    startDate,
    endDate,
    barKind,
    dateFields: {
      created,
      updated,
      due,
      codeComplete: cc,
      commitGate: cg,
      promotionGate: pg,
      releaseEc,
      sprintEnd,
      releaseGa,
    },
  };
}

function linkedIssueSummary(side) {
  if (!side) return '';
  return side.fields?.summary || side.summary || '';
}

function linkedIssueLabels(side) {
  const labels = side?.fields?.labels || side?.labels;
  return Array.isArray(labels) ? labels : [];
}

function linkedIssueProject(side) {
  const fromFields = side?.fields?.project?.key || side?.project?.key;
  if (fromFields) return String(fromFields).toUpperCase();
  const key = side?.key || '';
  const m = String(key).match(/^([A-Z][A-Z0-9_]+)-/i);
  return m ? m[1].toUpperCase() : '';
}

function linkedIssueStatus(side) {
  if (!side) return '';
  const s = side.fields?.status || side.status;
  if (!s) return '';
  return typeof s === 'string' ? s : s.name || '';
}

function linkedIssueType(side) {
  if (!side) return '';
  const t = side.fields?.issuetype || side.issuetype;
  if (!t) return '';
  return typeof t === 'string' ? t : t.name || '';
}

function mapIssueLinks(issuelinks) {
  if (!Array.isArray(issuelinks)) return [];
  const out = [];
  issuelinks.forEach((link) => {
    const typeName = link?.type?.name || '';
    const pushSide = (side, direction, typeLabel) => {
      if (!side?.key) return;
      out.push({
        key: side.key,
        summary: linkedIssueSummary(side),
        labels: linkedIssueLabels(side),
        project: linkedIssueProject(side),
        status: linkedIssueStatus(side),
        issueType: linkedIssueType(side),
        direction,
        type: typeLabel || typeName || direction,
        typeName,
      });
    };
    if (link?.outwardIssue?.key) {
      pushSide(link.outwardIssue, 'outward', link.type?.outward || typeName || 'outward');
    }
    if (link?.inwardIssue?.key) {
      pushSide(link.inwardIssue, 'inward', link.type?.inward || typeName || 'inward');
    }
  });
  return out;
}

function issueKeyToProject(key) {
  const m = String(key || '').match(/^([A-Z][A-Z0-9_]+)-/i);
  return m ? m[1].toUpperCase() : '';
}

function hierarchyKeyFromField(value) {
  if (!value) return null;
  if (typeof value === 'string') {
    const s = value.trim();
    return s || null;
  }
  if (typeof value === 'object') {
    if (value.key) return String(value.key);
    if (value.value) return hierarchyKeyFromField(value.value);
  }
  return null;
}

function extractHierarchyRefs(raw) {
  const parentKey = raw.parent?.key || null;
  const epicRaw = raw[EPIC_LINK_FIELD];
  const parentLinkRaw = raw[PARENT_LINK_FIELD];
  return {
    parentKey: parentKey || null,
    epicKey: hierarchyKeyFromField(epicRaw),
    parentLinkKey: hierarchyKeyFromField(parentLinkRaw),
  };
}

/** One level up: Parent Link (portfolio) → Epic Link → JIRA parent. */
function immediateParentKey(iss) {
  if (!iss) return null;
  return iss.parentLinkKey || iss.epicKey || iss.parentKey || null;
}

function slimAncestor(iss) {
  if (!iss?.key) return null;
  return {
    key: iss.key,
    summary: iss.summary || '',
    status: iss.status || '',
    issueType: iss.issueType || '',
    project: iss.project || '',
    targetDate: iss.targetDate || null,
    targetDateSource: iss.targetDateSource || null,
    targetDateLabel: iss.targetDateLabel || null,
  };
}

/**
 * Walk Parent Link / Epic / parent upward (any depth) and attach
 * ancestorChain: [top-level, …, linked ticket] on each seed issue.
 */
async function enrichAncestorChains(token, sections, cfg, jiraBaseUrl, releaseCtx) {
  const seeds = collectSectionIssues(sections);
  if (!seeds.length) return;

  const cache = new Map();
  seeds.forEach((iss) => {
    if (iss?.key) cache.set(iss.key, iss);
  });

  let pending = new Set();
  seeds.forEach((iss) => {
    const p = immediateParentKey(iss);
    if (p && !cache.has(p)) pending.add(p);
  });

  for (let round = 0; round < 6 && pending.size > 0; round++) {
    const batch = [...pending].slice(0, 100);
    pending = new Set();
    const jql = `key in (${batch.join(', ')})`;
    try {
      const fetched = await searchSection(
        token,
        jql,
        { source: 'ancestor' },
        cfg,
        jiraBaseUrl,
        releaseCtx
      );
      (fetched.issues || []).forEach((iss) => {
        if (!iss?.key) return;
        cache.set(iss.key, iss);
        const p = immediateParentKey(iss);
        if (p && !cache.has(p)) pending.add(p);
      });
    } catch (err) {
      console.warn('[dependencyView] ancestor fetch failed:', err.message || err);
      break;
    }
  }

  seeds.forEach((iss) => {
    if (!iss?.key) return;
    const bottomUp = [];
    let key = iss.key;
    const seen = new Set();
    while (key && !seen.has(key)) {
      seen.add(key);
      const node = cache.get(key);
      if (!node) {
        bottomUp.push({
          key,
          summary: key,
          status: '',
          issueType: '',
          project: '',
          targetDate: null,
          targetDateSource: null,
          targetDateLabel: null,
        });
        break;
      }
      bottomUp.push(slimAncestor(node));
      key = immediateParentKey(node);
    }
    // Top-level first → linked ticket last
    iss.ancestorChain = bottomUp.reverse();
  });
}

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
}

function writeConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, `${JSON.stringify(cfg, null, 2)}\n`, 'utf8');
}

const DEFAULT_LINK_TYPE_PRESETS = [
  '',
  'is blocked by',
  'blocks',
  'relates to',
  'has to be done after',
  'is needed for',
  'depends on',
  'is depended by',
];

/** Substrings matched case-insensitively against link type name / inward / outward */
const DEFAULT_IGNORED_LINK_TYPE_PATTERNS = ['clone', 'cloner', 'duplicat'];

function normalizeWishlistConfig(raw = {}) {
  const labelSuffix = String(raw.labelSuffix || 'wishlist').trim() || 'wishlist';
  let partnerLabelSuffixes = Array.isArray(raw.partnerLabelSuffixes)
    ? raw.partnerLabelSuffixes.map((s) => String(s || '').trim()).filter(Boolean)
    : [];
  if (!partnerLabelSuffixes.length) partnerLabelSuffixes = ['dependency'];
  const linkRaw = raw.linkTypeFilter;
  const linkTypeFilter =
    linkRaw == null || String(linkRaw).trim() === '' ? null : String(linkRaw).trim();
  let linkTypePresets = Array.isArray(raw.linkTypePresets)
    ? raw.linkTypePresets.map((s) => (s == null ? '' : String(s)))
    : [...DEFAULT_LINK_TYPE_PRESETS];
  if (!linkTypePresets.includes('')) linkTypePresets = ['', ...linkTypePresets];
  let ignoredLinkTypePatterns = Array.isArray(raw.ignoredLinkTypePatterns)
    ? raw.ignoredLinkTypePatterns.map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
    : [...DEFAULT_IGNORED_LINK_TYPE_PATTERNS];
  if (!ignoredLinkTypePatterns.length) {
    ignoredLinkTypePatterns = [...DEFAULT_IGNORED_LINK_TYPE_PATTERNS];
  }
  return {
    labelSuffix,
    partnerLabelSuffixes,
    linkTypeFilter,
    linkTypePresets,
    ignoredLinkTypePatterns,
    notes: raw.notes != null ? String(raw.notes) : undefined,
  };
}

/**
 * Persist wishlist settings to dependencyViewConfig.json.
 * Only wishlist keys are patched; rest of config unchanged.
 * @param {{ linkTypeFilter?: string|null, labelSuffix?: string, partnerLabelSuffixes?: string[] }} patch
 */
function saveWishlistConfig(patch = {}) {
  const cfg = loadConfig();
  const current = normalizeWishlistConfig(cfg.wishlist || {});
  const next = normalizeWishlistConfig({
    ...current,
    ...(patch.linkTypeFilter !== undefined ? { linkTypeFilter: patch.linkTypeFilter } : {}),
    ...(patch.labelSuffix !== undefined ? { labelSuffix: patch.labelSuffix } : {}),
    ...(patch.partnerLabelSuffixes !== undefined
      ? { partnerLabelSuffixes: patch.partnerLabelSuffixes }
      : {}),
    ...(patch.ignoredLinkTypePatterns !== undefined
      ? { ignoredLinkTypePatterns: patch.ignoredLinkTypePatterns }
      : {}),
    notes: current.notes,
  });
  cfg.wishlist = {
    ...next,
    ...(next.notes ? { notes: next.notes } : {}),
  };
  writeConfig(cfg);
  return next;
}

function getWishlistConfig() {
  return normalizeWishlistConfig(loadConfig().wishlist || {});
}

function loadReleaseGates() {
  try {
    return JSON.parse(fs.readFileSync(RELEASE_CFG_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function jiraSearchUrl(base, jql) {
  const root = String(base || 'https://jira.nutanix.com').replace(/\/+$/, '');
  return `${root}/issues/?jql=${encodeURIComponent(jql)}`;
}

/** Q1 — Companion hierarchy under a root project ticket */
function buildCompanionHierarchyJql(rootKey) {
  return [
    `key = ${rootKey}`,
    `OR "Parent Link" = ${rootKey}`,
    `OR issueFunction in issuesInEpics("\\"Parent Link\\" = ${rootKey} and type = Epic")`,
  ].join('\n');
}

/** Q2 — External / non-NDB-owned slice */
function buildCompanionExternalJql(rootKey, scopeGroups) {
  const members = (scopeGroups || [])
    .map((g) => `membersOf("${g}")`)
    .join(', ');
  return [
    '(',
    `  key = ${rootKey}`,
    `  OR "Parent Link" = ${rootKey}`,
    `  OR issueFunction in issuesInEpics("\\"Parent Link\\" = ${rootKey} and type = Epic")`,
    ')',
    'AND (',
    '  project != ERA',
    `  OR assignee not in (${members})`,
    ')',
  ].join('\n');
}

/** Q3 — Partnership: I wait on them */
function buildPartnershipBlockedByJql(release) {
  return `issueFunction in linkedIssuesOf("fixVersion = ${release}", "is blocked by")`;
}

/** Q4 — Partnership: they wait on me */
function buildPartnershipBlocksJql(release) {
  return `issueFunction in linkedIssuesOf("fixVersion = ${release}", "blocks")`;
}

/** Q5 — Train label discovery */
function buildTrainLabelsJql(trainSlug) {
  return `labels in ("ndb-${trainSlug}-dependency", "ndb-${trainSlug}-asks")`;
}

/** Release slug for wishlist labels: NDB-3.1 → 3.1 */
function releaseToWishlistSlug(release) {
  return String(release || '')
    .replace(/^NDB-/i, '')
    .trim()
    .toLowerCase();
}

function wishlistLabel(releaseSlug, suffix = 'wishlist') {
  return `ndb-${releaseSlug}-${suffix}`;
}

function partnerDepLabels(trainSlug, suffixes = ['dependency']) {
  return (suffixes || ['dependency']).map((s) => `"ndb-${trainSlug}-${s}"`);
}

/**
 * Q7a — Wishlist items (NDB side, pre-commit).
 * labels = "ndb-{releaseSlug}-wishlist"
 */
function buildWishlistJql(releaseSlug, labelSuffix = 'wishlist') {
  return `labels = "${wishlistLabel(releaseSlug, labelSuffix)}"`;
}

/**
 * Q7b — Issues linked from wishlist (any / configurable link type).
 * linkTypeFilter null/empty → omit 2nd arg (all link types — easy to tighten later).
 */
function buildWishlistLinkedJql(releaseSlug, { labelSuffix = 'wishlist', linkTypeFilter = null } = {}) {
  const inner = `labels = \\"${wishlistLabel(releaseSlug, labelSuffix)}\\"`;
  const type = linkTypeFilter && String(linkTypeFilter).trim();
  if (type) {
    return `issueFunction in linkedIssuesOf("${inner}", "${type}")`;
  }
  return `issueFunction in linkedIssuesOf("${inner}")`;
}

/**
 * Q7c — Wishlist with no issue links (forgotten link).
 */
function buildWishlistUnlinkedJql(releaseSlug, labelSuffix = 'wishlist') {
  return `${buildWishlistJql(releaseSlug, labelSuffix)} AND issueFunction not in hasLinks()`;
}

/**
 * Q7d — Partner train-dep labeled but not linked to any wishlist item.
 */
function buildPartnerOrphanJql(
  releaseSlug,
  trainSlug,
  { wishlistSuffix = 'wishlist', partnerSuffixes = ['dependency'] } = {}
) {
  const partnerIn = partnerDepLabels(trainSlug, partnerSuffixes).join(', ');
  const wl = wishlistLabel(releaseSlug, wishlistSuffix);
  return `labels in (${partnerIn}) AND issueFunction not in linkedIssuesOf("labels = \\"${wl}\\"")`;
}

function selectOptionValue(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'object') return String(field.value || field.name || '');
  return String(field);
}

/**
 * Q6 — commitment nature + hygiene (dependency_rule.md §§5–6).
 * Clean ⇔ Release Commit ∈ {Commit, Stretch} AND real fixVersion (not denylist).
 * @returns {{
 *   state: 'clean'|'ask',
 *   nature: 'Commit'|'Stretch'|null,
 *   via: 'fixVersion'|'release_commit_field'|'both'|null,
 *   fixVersions: string[],
 *   releaseCommit: string|null,
 *   hygiene: 'partner_missing_fixversion'|'partner_missing_release_commit'|null
 * }}
 */
function classifyCommit(issue, nonCommitFixVersions) {
  const denylist = new Set(
    (nonCommitFixVersions || []).map((v) => String(v).trim().toLowerCase())
  );
  const fvs = issue.fixVersions || [];
  const names = (Array.isArray(fvs) ? fvs : [])
    .map((v) => (typeof v === 'string' ? v : v?.name))
    .filter(Boolean);
  const commitFixVersions = names.filter((n) => !denylist.has(String(n).trim().toLowerCase()));
  const hasRealFv = commitFixVersions.length > 0;
  const releaseCommitRaw = selectOptionValue(issue[RELEASE_COMMIT_FIELD]);
  const releaseCommit = releaseCommitRaw.trim() || null;
  let nature = null;
  if (/^commit$/i.test(releaseCommit || '')) nature = 'Commit';
  else if (/^stretch$/i.test(releaseCommit || '')) nature = 'Stretch';
  const hasNature = Boolean(nature);
  let via = null;
  if (hasRealFv && hasNature) via = 'both';
  else if (hasRealFv) via = 'fixVersion';
  else if (hasNature) via = 'release_commit_field';
  let hygiene = null;
  if (hasNature && !hasRealFv) hygiene = 'partner_missing_fixversion';
  else if (hasRealFv && !hasNature) hygiene = 'partner_missing_release_commit';
  return {
    state: hasRealFv && hasNature ? 'clean' : 'ask',
    nature,
    via,
    fixVersions: commitFixVersions,
    releaseCommit,
    hygiene,
  };
}

function isCommitted(issue, nonCommitFixVersions) {
  return classifyCommit(issue, nonCommitFixVersions).state === 'clean';
}

const DEFAULT_SPANS = [
  {
    id: 'global_ew',
    label: 'Global EW',
    jiraLabel: 'global-ew',
    short: 'Global',
    hint: 'Type of project: Global engineering work (label global-ew).',
  },
  {
    id: 'nutanix_ew',
    label: 'Nutanix EW',
    jiraLabel: 'nutanix-ew',
    short: 'Nutanix',
    hint: 'Type of project: Within Nutanix, outside NDB (label nutanix-ew).',
  },
  {
    id: 'ndb_ew',
    label: 'Peer NDB',
    jiraLabel: 'ndb-ew',
    short: 'Peer NDB',
    hint: 'Peer NDB teams (still NDB) — cross-team within NDB; label ndb-ew.',
  },
  {
    id: 'team_internal',
    label: 'Team internal',
    jiraLabel: null,
    short: 'Team',
    hint: 'No global-ew / nutanix-ew / ndb-ew label — treated as team-internal.',
  },
];

/** Widest EW label wins if multiple are present. */
const EW_LABEL_PRIORITY = ['global-ew', 'nutanix-ew', 'ndb-ew'];

function spanCatalog(cfg) {
  return Array.isArray(cfg?.spans) && cfg.spans.length ? cfg.spans : DEFAULT_SPANS;
}

function spanRow(cfg, id) {
  return spanCatalog(cfg).find((s) => String(s.id) === String(id)) || null;
}

/**
 * Mode of operation from how the ticket entered the payload.
 * Dependency = JIRA issue link; Partnership = FEAT/Initiative → Epic hierarchy.
 * Legacy section sources still use partnership* / companion* keys — remap labels here.
 */
function resolveOperationMode(source) {
  const src = String(source || '');
  if (src.startsWith('partnership')) {
    return {
      id: 'dependency',
      label: 'Dependency',
      hint: 'JIRA issue link (blocks / is blocked by).',
    };
  }
  if (src.startsWith('companion')) {
    return {
      id: 'partnership',
      label: 'Partnership',
      hint: 'Multi-team delivery via FEAT / Initiative → Epic hierarchy (Parent Link).',
    };
  }
  if (src.startsWith('wishlist')) {
    return {
      id: 'wishlist',
      label: 'Wishlist',
      hint: 'NDB wishlist / linked partners — discovery, not Mode.',
    };
  }
  if (src === 'labels') {
    return {
      id: 'train_ask',
      label: 'Train ask',
      hint: 'Train ask label on their ticket (ndb-*-ask / -asks / -dependency). Not Mode, not project type.',
    };
  }
  return { id: 'unknown', label: 'Unknown', hint: '' };
}

/**
 * Span from EW JIRA labels only (not train ask / wishlist).
 * global-ew | nutanix-ew | ndb-ew | (none → team_internal).
 */
function classifyEwSpan(labels, cfg, source = 'jira_label') {
  const labelSet = new Set(
    (Array.isArray(labels) ? labels : []).map((l) => String(l || '').trim().toLowerCase())
  );
  const priority =
    Array.isArray(cfg?.spanTaxonomy?.priority) && cfg.spanTaxonomy.priority.length
      ? cfg.spanTaxonomy.priority
      : EW_LABEL_PRIORITY;

  for (const jiraLabel of priority) {
    if (!labelSet.has(String(jiraLabel).toLowerCase())) continue;
    const row = spanCatalog(cfg).find(
      (s) => String(s.jiraLabel || '').toLowerCase() === String(jiraLabel).toLowerCase()
    );
    if (row) {
      return {
        id: row.id,
        label: row.label,
        short: row.short || row.label,
        jiraLabel: row.jiraLabel || jiraLabel,
        hint: row.hint,
        source,
      };
    }
  }

  const team = spanRow(cfg, 'team_internal') || DEFAULT_SPANS[3];
  return {
    id: team.id,
    label: team.label,
    short: team.short || team.label || 'Team',
    jiraLabel: null,
    hint: team.hint,
    source: 'no_ew_label',
  };
}

function spanInfoFromRow(row, source) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    short: row.short || row.label,
    jiraLabel: row.jiraLabel || null,
    hint: row.hint,
    source,
  };
}

function widerSpanInfo(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  const ra = EW_SPAN_RANK[a.id] || 0;
  const rb = EW_SPAN_RANK[b.id] || 0;
  return ra >= rb ? a : b;
}

function projectKeyList(arr) {
  return (Array.isArray(arr) ? arr : []).map((s) => String(s).trim().toUpperCase()).filter(Boolean);
}

/** ERA (and optional FEAT / NDB*) = home NDB. Everything else in an epic tree → nutanix-ew. */
function isEraHomeProject(projectKey, cfg) {
  const pk = String(projectKey || '').trim().toUpperCase();
  if (!pk) return false;
  if (pk === 'ERA') return true;
  const hints = cfg.projectSpanHints || {};
  const ndbKeys = projectKeyList(hints.ndb?.length ? hints.ndb : ['ERA']);
  // Peer NDB project keys only — FEAT / NDB* stay home; ENG/NCN/… do not.
  if (ndbKeys.includes(pk)) return true;
  if (pk.startsWith('NDB')) return true;
  return false;
}

/**
 * Park by JIRA project key.
 * ERA / NDB home → peer NDB; ENG, NCN, and any other non-ERA project → nutanix-ew.
 */
function spanFromProjectKey(projectKey, cfg) {
  const pk = String(projectKey || '').trim().toUpperCase();
  if (!pk) return null;
  const hints = cfg.projectSpanHints || {};
  const globalKeys = projectKeyList(hints.global);

  if (globalKeys.includes(pk)) {
    return spanInfoFromRow(spanRow(cfg, 'global_ew'), 'inferred_project');
  }
  if (isEraHomeProject(pk, cfg)) {
    return spanInfoFromRow(spanRow(cfg, 'ndb_ew'), 'inferred_project');
  }
  // ENG, NCN, and anything other than ERA/NDB home → Nutanix EW
  return spanInfoFromRow(spanRow(cfg, 'nutanix_ew'), 'inferred_project');
}

/**
 * Group payload issues by epic (epic link, or the Epic ticket itself).
 * Collect every project key on the epic and on children under that epic.
 */
function buildEpicProjectClusters(issues) {
  const clusters = new Map(); // epicKey → Set(projectKey)

  const add = (epicKey, projectKey) => {
    if (!epicKey) return;
    const ek = String(epicKey);
    if (!clusters.has(ek)) clusters.set(ek, new Set());
    const pk = String(projectKey || '').trim().toUpperCase() || issueKeyToProject(ek);
    if (pk) clusters.get(ek).add(pk);
  };

  (issues || []).forEach((iss) => {
    if (!iss?.key) return;
    const type = String(iss.issueType || '').toLowerCase();
    const epicKey =
      iss.epicKey ||
      (type === 'epic' ? iss.key : null) ||
      (iss.parentKey && String(iss.parentKey));

    if (iss.epicKey) {
      add(iss.epicKey, iss.project);
      add(iss.epicKey, issueKeyToProject(iss.epicKey));
      add(iss.epicKey, issueKeyToProject(iss.key));
    }
    if (type === 'epic') {
      add(iss.key, iss.project);
      add(iss.key, issueKeyToProject(iss.key));
    }
    // Children often only have parentKey pointing at the Epic
    if (iss.parentKey) {
      add(iss.parentKey, iss.project);
      add(iss.parentKey, issueKeyToProject(iss.parentKey));
      add(iss.parentKey, issueKeyToProject(iss.key));
    }
    // Linked tickets under the same epic key in the payload
    (iss.links || []).forEach((link) => {
      if (!link?.key) return;
      if (iss.epicKey) add(iss.epicKey, link.project || issueKeyToProject(link.key));
      if (type === 'epic') add(iss.key, link.project || issueKeyToProject(link.key));
    });
  });

  return clusters;
}

/** True if epic (or any child in payload) involves ENG/NCN/anything other than ERA home. */
function epicClusterImpliesNutanix(epicKey, clusters, cfg) {
  if (!epicKey) return false;
  const projects = clusters.get(String(epicKey));
  if (!projects || !projects.size) {
    const pk = issueKeyToProject(epicKey);
    return pk ? !isEraHomeProject(pk, cfg) : false;
  }
  for (const pk of projects) {
    if (!isEraHomeProject(pk, cfg)) return true;
  }
  return false;
}

function tagIssuesEw(issues, cfg) {
  (issues || []).forEach((iss) => {
    iss.operationMode = resolveOperationMode(iss.source);
    iss.spanInfo = classifyEwSpan(iss.labels, cfg);
    iss.span = iss.spanInfo.id;
  });
  return issues;
}

function tagSectionEw(section, cfg) {
  if (!section?.issues?.length) return section;
  tagIssuesEw(section.issues, cfg);
  return section;
}

function collectSectionIssues(sections) {
  const out = [];
  const push = (sec) => {
    if (Array.isArray(sec?.issues)) out.push(...sec.issues);
  };
  push(sections.partnershipBlockedBy);
  push(sections.partnershipBlocks);
  push(sections.trainLabels);
  push(sections.wishlist);
  push(sections.wishlistLinked);
  push(sections.wishlistUnlinked);
  push(sections.partnerOrphans);
  push(sections.waitRoots);
  push(sections.blockerHops);
  (sections.companions || []).forEach((c) => {
    push(c.hierarchy);
    push(c.external);
  });
  (sections.earlyCalls || []).forEach((bundle) => {
    const s = bundle?.sections || {};
    push(s.trainLabels);
    push(s.wishlist);
    push(s.wishlistLinked);
    push(s.wishlistUnlinked);
    push(s.partnerOrphans);
  });
  return out;
}

/**
 * When a ticket has no *-ew label, park it using:
 * 1) Own JIRA project — ERA/FEAT/NDB* always Peer NDB (never “upgraded” to nutanix
 *    just because the same FEAT is also blocked by ENG/NCN).
 * 2) For non-home tickets only: EW labels on links, epic/children mix (ENG/NCN → nutanix),
 *    parent project keys, then own project.
 *
 * Bug example: FEAT-19454 is blocked by ENG-* and ERA-67814. ERA/FEAT must stay Peer NDB;
 * only the ENG blockers park as Nutanix EW.
 */
function enrichSpansFromLinksAndProjects(sections, cfg) {
  const issues = collectSectionIssues(sections);
  if (!issues.length) return;

  tagIssuesEw(issues, cfg);

  const byKey = new Map();
  issues.forEach((iss) => {
    if (iss?.key) byKey.set(String(iss.key), iss);
  });

  const epicClusters = buildEpicProjectClusters(issues);
  const nutanixSpan = () => spanInfoFromRow(spanRow(cfg, 'nutanix_ew'), 'inferred_epic_non_era');
  const ndbSpan = () => spanInfoFromRow(spanRow(cfg, 'ndb_ew'), 'inferred_project');

  for (let round = 0; round < 3; round += 1) {
    let changed = false;
    issues.forEach((iss) => {
      if (!iss || iss.span !== 'team_internal') return;

      // Hard rule: ticket lives in ERA/FEAT/NDB* → Peer NDB. Sibling ENG blockers
      // on the same FEAT must not recolor this ticket as Nutanix EW.
      const ownProject = String(iss.project || issueKeyToProject(iss.key) || '').toUpperCase();
      if (isEraHomeProject(ownProject, cfg)) {
        const home = ndbSpan();
        iss.spanInfo = home;
        iss.span = home.id;
        changed = true;
        return;
      }

      let best = null;
      let inferSource = null;

      (iss.links || []).forEach((link) => {
        const linkProject = link.project || issueKeyToProject(link.key);
        // Only inherit EW *labels* from linked tickets — never inherit a sibling's
        // nutanix park just because ENG is also linked on the same parent.
        if (Array.isArray(link.labels) && link.labels.length) {
          const fromLabels = classifyEwSpan(link.labels, cfg, 'inferred_link');
          if (fromLabels.id !== 'team_internal') {
            best = widerSpanInfo(best, fromLabels);
            inferSource = 'inferred_link';
            return;
          }
        }
        const linked = byKey.get(link.key);
        if (linked && linked.spanInfo?.source === 'jira_label' && linked.span !== 'team_internal') {
          best = widerSpanInfo(best, { ...linked.spanInfo, source: 'inferred_link' });
          inferSource = 'inferred_link';
          return;
        }
        // Non-home ticket linked only to ENG/NCN with no labels → nutanix hint
        if (linkProject && !isEraHomeProject(linkProject, cfg)) {
          best = widerSpanInfo(best, nutanixSpan());
          inferSource = inferSource || 'inferred_link_project';
        }
      });

      // Epic / children mix: ENG/NCN involved → nutanix (for non-home tickets only)
      const epicRefs = [];
      if (iss.epicKey) epicRefs.push(iss.epicKey);
      if (String(iss.issueType || '').toLowerCase() === 'epic') epicRefs.push(iss.key);
      if (iss.parentKey) epicRefs.push(iss.parentKey);
      epicRefs.forEach((ref) => {
        if (epicClusterImpliesNutanix(ref, epicClusters, cfg)) {
          best = widerSpanInfo(best, nutanixSpan());
          inferSource = 'inferred_epic_non_era';
        }
      });

      [iss.parentKey, iss.epicKey, iss.parentLinkKey].filter(Boolean).forEach((refKey) => {
        const refProject = issueKeyToProject(refKey);
        // Parent in ERA/FEAT does not force nutanix; parent in ENG does.
        if (refProject && !isEraHomeProject(refProject, cfg)) {
          best = widerSpanInfo(best, nutanixSpan());
          inferSource = inferSource || 'inferred_parent_project';
          return;
        }
        const parent = byKey.get(refKey);
        if (
          parent &&
          parent.spanInfo?.source === 'jira_label' &&
          parent.span &&
          parent.span !== 'team_internal'
        ) {
          best = widerSpanInfo(best, { ...parent.spanInfo, source: 'inferred_parent' });
          inferSource = inferSource || 'inferred_parent';
        }
      });

      if (!best || best.id === 'team_internal') {
        const fromOwn = spanFromProjectKey(ownProject, cfg);
        if (fromOwn) {
          best = fromOwn;
          inferSource = 'inferred_project';
        }
      }

      if (best && best.id !== 'team_internal') {
        iss.spanInfo = {
          ...best,
          source: inferSource || best.source || 'inferred',
        };
        iss.span = iss.spanInfo.id;
        changed = true;
      }
    });
    if (!changed) break;
  }
}

function mapIssue(raw, { direction = null, source = null } = {}, cfg, releaseCtx = {}) {
  const status = raw.status?.name || raw.status || '';
  const issueType = raw.issuetype?.name || raw.issuetype || '';
  const project = raw.project?.key || (raw.key ? String(raw.key).split('-')[0] : '');
  const assignee =
    raw.assignee?.displayName || raw.assignee?.name || raw.assignee?.emailAddress || '';
  const labels = Array.isArray(raw.labels) ? raw.labels : [];
  const fixVersions = (raw.fixVersions || [])
    .map((v) => (typeof v === 'string' ? v : v?.name))
    .filter(Boolean);
  const commit = classifyCommit(raw, cfg.nonCommitFixVersions);
  const sprintHint = parseSprintFromRaw(raw);
  const target = resolveTargetDate(raw, issueType, sprintHint);
  const timeline = resolveIssueTimeline(raw, issueType, releaseCtx, sprintHint);
  const links = mapIssueLinks(raw.issuelinks);
  const hierarchy = extractHierarchyRefs(raw);
  const spanInfo = classifyEwSpan(labels, cfg);
  const operationMode = resolveOperationMode(source);
  return {
    key: raw.key,
    summary: raw.summary || '',
    status,
    issueType,
    project,
    assignee,
    labels,
    fixVersions,
    span: spanInfo.id,
    spanInfo,
    operationMode,
    direction,
    source,
    commitState: commit.state,
    commitNature: commit.nature,
    commitVia: commit.via,
    commitFixVersions: commit.fixVersions,
    releaseCommit: commit.releaseCommit,
    commitHygiene: commit.hygiene,
    startDate: timeline.startDate,
    endDate: timeline.endDate || target.targetDate,
    barKind: timeline.barKind,
    dateFields: timeline.dateFields,
    targetDate: target.targetDate,
    targetDateSource: target.targetDateSource,
    targetDateLabel: target.targetDateLabel,
    sprintId: target.sprintId,
    sprintName: target.sprintName,
    sprintEndDate: target.sprintEndDate,
    links,
    parentKey: hierarchy.parentKey,
    epicKey: hierarchy.epicKey,
    parentLinkKey: hierarchy.parentLinkKey,
  };
}

/**
 * For work items missing due date: fetch sprint end via Agile API and mark as inferred.
 */
async function enrichIssuesWithSprintEnds(token, sections) {
  const issues = collectSectionIssues(sections);
  const needFetch = issues.filter(
    (iss) =>
      !iss.targetDate &&
      iss.sprintId &&
      !issueTypeFlags(iss.issueType).isPortfolio &&
      !issueTypeFlags(iss.issueType).isEpic
  );
  if (!needFetch.length) return;

  const uniqueIds = [...new Set(needFetch.map((i) => i.sprintId))];
  const sprintCache = new Map();
  let jira;
  try {
    jira = await getJira(token);
  } catch (err) {
    console.warn('[dependencyView] sprint enrich skipped — no JIRA client:', err.message);
    return;
  }

  await Promise.all(
    uniqueIds.map(async (sid) => {
      try {
        const resp = await jira.get(`/rest/agile/1.0/sprint/${sid}`, { timeout: 15000 });
        const data = resp.data || {};
        sprintCache.set(sid, {
          name: data.name || null,
          endDate: isoDay(data.endDate),
          startDate: isoDay(data.startDate),
          state: data.state || null,
        });
      } catch (err) {
        console.warn(`[dependencyView] sprint ${sid} fetch failed:`, err.message || err);
        sprintCache.set(sid, null);
      }
    })
  );

  needFetch.forEach((iss) => {
    const info = sprintCache.get(iss.sprintId);
    if (!info?.endDate) return;
    iss.sprintEndDate = info.endDate;
    iss.sprintName = info.name || iss.sprintName;
    iss.targetDate = info.endDate;
    iss.targetDateSource = 'sprint_end';
    iss.targetDateLabel = 'Sprint end';
    if (!iss.endDate) {
      iss.endDate = info.endDate;
      iss.barKind = 'sprint_inferred';
    }
    if (iss.dateFields) iss.dateFields.sprintEnd = info.endDate;
  });
}

async function searchSection(token, jql, meta, cfg, jiraBaseUrl, releaseCtx = {}) {
  const compact = jql.replace(/\s+/g, ' ').trim();
  let issues = [];
  let error = null;
  try {
    const result = await runSearchByJql(token, compact, 200, {
      extraFields: DEPENDENCY_EXTRA_FIELDS,
    });
    issues = (result.issues || []).map((iss) => mapIssue(iss, meta, cfg, releaseCtx));
  } catch (err) {
    error = err.message || String(err);
    console.warn('[dependencyView] JQL failed:', compact.slice(0, 120), error);
  }
  return {
    jql: compact,
    jiraUrl: jiraSearchUrl(jiraBaseUrl, compact),
    count: issues.length,
    issues,
    ...(error ? { error } : {}),
  };
}

function linkText(link) {
  return `${link?.type || ''} ${link?.typeName || ''}`.toLowerCase();
}

function isDependencyLink(link) {
  const t = linkText(link);
  if (!link?.key) return false;
  if (t.includes('clone') || t.includes('duplicat') || t.includes('relates')) return false;
  return (
    t.includes('block') ||
    t.includes('depend') ||
    t.includes('needed for') ||
    t.includes('has to be done')
  );
}

/**
 * After Q3/Q4, pull (a) our wait-root projects (ERA/FEAT waiting on blockers) and
 * (b) hop-2+ tickets those blockers wait on — so chains like
 * ERA-49565 → FEAT-18273 → FEAT-18696 / ENG-792895 can render.
 * Uses key in (...) only — does not change Q1–Q7.
 */
async function fetchChainContext(token, blockedBySection, blocksSection, cfg, jiraBaseUrl, releaseCtx) {
  const seed = [...(blockedBySection?.issues || []), ...(blocksSection?.issues || [])];
  const have = new Set(seed.map((i) => i.key).filter(Boolean));
  const waiterKeys = new Set();
  const hopKeys = new Set();

  seed.forEach((iss) => {
    (iss.links || []).forEach((link) => {
      if (!isDependencyLink(link) || have.has(link.key)) return;
      const t = linkText(link);
      const pk = issueKeyToProject(link.key) || String(link.project || '').toUpperCase();
      const home = isEraHomeProject(pk, cfg);
      const outwardBlocks =
        link.direction === 'outward' && t.includes('blocks') && !t.includes('blocked by');
      const inwardBlockedBy =
        link.direction === 'inward' &&
        (t.includes('blocked by') || t.includes('is blocked by'));
      const outwardBlockedBy =
        link.direction === 'outward' &&
        (t.includes('blocked by') || t.includes('is blocked by') || t.includes('depend'));
      const inwardBlocks =
        link.direction === 'inward' && t.includes('blocks') && !t.includes('blocked by');

      // Who waits on this seed ticket (our project roots)
      if ((outwardBlocks || inwardBlockedBy) && home) {
        waiterKeys.add(link.key);
        return;
      }
      // Who this seed ticket waits on (next hop)
      if (outwardBlockedBy || inwardBlocks || (!home && isDependencyLink(link))) {
        hopKeys.add(link.key);
      }
    });
  });

  const need = [...new Set([...waiterKeys, ...hopKeys])].filter((k) => !have.has(k)).slice(0, 120);
  if (!need.length) {
    return {
      waitRoots: { issues: [], count: 0, jql: null, jiraUrl: null },
      blockerHops: { issues: [], count: 0, jql: null, jiraUrl: null },
    };
  }

  const jql = `key in (${need.join(', ')})`;
  const fetched = await searchSection(
    token,
    jql,
    { source: 'chain_context', direction: null },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const byKey = new Map((fetched.issues || []).map((i) => [i.key, i]));

  const waitRoots = [...waiterKeys]
    .map((k) => byKey.get(k))
    .filter(Boolean)
    .map((i) => ({ ...i, source: 'wait_root', direction: 'i_wait_on_them' }));
  const blockerHops = [...hopKeys]
    .map((k) => byKey.get(k))
    .filter(Boolean)
    .map((i) => ({ ...i, source: 'blocker_hop', direction: 'i_wait_on_them' }));

  return {
    waitRoots: {
      issues: waitRoots,
      count: waitRoots.length,
      jql: fetched.jql,
      jiraUrl: fetched.jiraUrl,
      ...(fetched.error ? { error: fetched.error } : {}),
    },
    blockerHops: {
      issues: blockerHops,
      count: blockerHops.length,
      jql: fetched.jql,
      jiraUrl: fetched.jiraUrl,
      ...(fetched.error ? { error: fetched.error } : {}),
    },
  };
}

function pickNdbGates(releaseCfg, release) {
  const entry = releaseCfg?.versions?.[release] || releaseCfg?.[release] || {};
  // releaseVersionsEmailConfig nests under top-level keys that are release names
  const gate = releaseCfg?.[release] || entry;
  if (!gate || typeof gate !== 'object') return {};
  const pick = (obj, keys) => {
    const out = {};
    keys.forEach((k) => {
      if (obj[k] != null) out[k] = obj[k];
    });
    return out;
  };
  return pick(gate, [
    'ecDate',
    'ccm1Gate',
    'ccm2Gate',
    'commitGate1',
    'commitGate2',
    'promotionGate1',
    'promotionGate2',
    'ga1',
    'ga2',
    'codeComplete',
    'gaDate',
  ]);
}

function resolveAlignedTrain(cfg, release) {
  const row = cfg.alignedTrains?.[release];
  if (!row) {
    return {
      train: null,
      trainSlug: null,
      status: 'unknown',
      notes: 'No aligned train in dependencyViewConfig',
      partnerVersions: [],
      confluenceUrl: null,
    };
  }
  return { ...row };
}

/**
 * Upcoming / pre-CC releases to surface as early label-based calls
 * (e.g. viewing NDB-3.0 → also show NDB-3.1 ↔ Leto asks/wishlist).
 * Uses existing Q5/Q7 only — no fixVersion partnership (gates may not exist yet).
 */
function listEarlyCallReleases(cfg, selectedRelease) {
  const releases = Array.isArray(cfg.releases) ? cfg.releases : [];
  const out = [];
  releases.forEach((r) => {
    if (r === selectedRelease) return;
    const train = resolveAlignedTrain(cfg, r);
    // Only planned trains (pre-CC/EC) — e.g. NDB-3.1 ↔ Leto while viewing NDB-3.0
    if (String(train.status || '').toLowerCase() !== 'planned') return;
    out.push({
      release: r,
      train: train.train || null,
      trainSlug: train.trainSlug || releaseToWishlistSlug(r),
      status: train.status || null,
      notes: train.notes || null,
    });
  });
  return out;
}

/**
 * Fetch train asks + wishlist for one early/future release (reuse Q5 / Q7a–d).
 */
async function fetchEarlyCallBundle(token, early, cfg, jiraBaseUrl, wlCfg, orphanOpts) {
  const releaseSlug = releaseToWishlistSlug(early.release);
  const trainSlug = early.trainSlug;
  const gates = pickNdbGates(loadReleaseGates(), early.release);
  const releaseCtx = {
    ecDate: gates.ecDate || null,
    gaDate: gates.gaDate || gates.ga2?.date || gates.ga1?.date || null,
  };
  const wlOpts = {
    labelSuffix: wlCfg.labelSuffix,
    linkTypeFilter: wlCfg.linkTypeFilter,
  };

  const trainLabels = await searchSection(
    token,
    buildTrainLabelsJql(trainSlug),
    { source: 'labels', direction: null },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const wishlist = await searchSection(
    token,
    buildWishlistJql(releaseSlug, wlOpts.labelSuffix),
    { source: 'wishlist', direction: 'i_wait_on_them' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const wishlistLinked = await searchSection(
    token,
    buildWishlistLinkedJql(releaseSlug, wlOpts),
    { source: 'wishlist_linked', direction: 'i_wait_on_them' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const wishlistUnlinked = await searchSection(
    token,
    buildWishlistUnlinkedJql(releaseSlug, wlOpts.labelSuffix),
    { source: 'wishlist_unlinked', direction: 'i_wait_on_them' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const partnerOrphans = await searchSection(
    token,
    buildPartnerOrphanJql(releaseSlug, trainSlug, orphanOpts),
    { source: 'wishlist_partner_orphan' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );

  tagSectionEw(trainLabels, cfg);
  tagSectionEw(wishlist, cfg);
  tagSectionEw(wishlistLinked, cfg);
  tagSectionEw(wishlistUnlinked, cfg);
  tagSectionEw(partnerOrphans, cfg);

  return {
    release: early.release,
    train: early.train,
    trainSlug,
    status: early.status,
    notes: early.notes,
    releaseSlug,
    wishlistLabel: wishlistLabel(releaseSlug, wlOpts.labelSuffix),
    trainAskLabels: [
      `ndb-${trainSlug}-dependency`,
      `ndb-${trainSlug}-asks`,
    ],
    ndbGates: {
      ecDate: releaseCtx.ecDate,
      gaDate: releaseCtx.gaDate,
    },
    sections: {
      trainLabels,
      wishlist,
      wishlistLinked,
      wishlistUnlinked,
      partnerOrphans,
    },
  };
}

/**
 * @param {{ token: string, teamId?: string, release?: string }} opts
 */
async function getOverview({ token, teamId, release } = {}) {
  const cfg = loadConfig();
  const board = loadTeamBoardConfig();
  const requested =
    normalizeTeamId(teamId) ||
    normalizeTeamId(cfg.defaultTeamId) ||
    normalizeTeamId(board.defaultTeamId) ||
    'ndb';
  const team = getTeamById(requested) || getTeamById(cfg.defaultTeamId) || getTeamById(board.defaultTeamId);
  const effectiveTeamId = (team && team.id) || requested;
  const effectiveRelease = (release || cfg.defaultRelease || 'NDB-3.0').trim();
  const jiraBaseUrl = process.env.JIRA_BASE_URL || cfg.jiraBaseUrlDefault || 'https://jira.nutanix.com';
  const releaseGatesCfg = loadReleaseGates();
  const ndbGates = pickNdbGates(releaseGatesCfg, effectiveRelease);
  const releaseCtx = {
    ecDate: ndbGates.ecDate || null,
    gaDate: ndbGates.gaDate || ndbGates.ga2?.date || ndbGates.ga1?.date || null,
  };
  const alignedTrain = resolveAlignedTrain(cfg, effectiveRelease);
  const trainSlug = alignedTrain.trainSlug || String(effectiveRelease).replace(/^NDB-/i, '').toLowerCase();

  const partnershipBlockedBy = await searchSection(
    token,
    buildPartnershipBlockedByJql(effectiveRelease),
    { direction: 'i_wait_on_them', source: 'partnership' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const partnershipBlocks = await searchSection(
    token,
    buildPartnershipBlocksJql(effectiveRelease),
    { direction: 'they_wait_on_me', source: 'partnership' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const trainLabels = await searchSection(
    token,
    buildTrainLabelsJql(trainSlug),
    { source: 'labels' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );

  const wlCfg = normalizeWishlistConfig(cfg.wishlist || {});
  const releaseSlug = releaseToWishlistSlug(effectiveRelease);
  const wlOpts = {
    labelSuffix: wlCfg.labelSuffix,
    linkTypeFilter: wlCfg.linkTypeFilter,
  };
  const orphanOpts = {
    wishlistSuffix: wlCfg.labelSuffix,
    partnerSuffixes: wlCfg.partnerLabelSuffixes,
  };

  const wishlist = await searchSection(
    token,
    buildWishlistJql(releaseSlug, wlOpts.labelSuffix),
    { source: 'wishlist', direction: 'i_wait_on_them' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const wishlistLinked = await searchSection(
    token,
    buildWishlistLinkedJql(releaseSlug, wlOpts),
    { source: 'wishlist_linked', direction: 'i_wait_on_them' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const wishlistUnlinked = await searchSection(
    token,
    buildWishlistUnlinkedJql(releaseSlug, wlOpts.labelSuffix),
    { source: 'wishlist_unlinked', direction: 'i_wait_on_them' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  const partnerOrphans = await searchSection(
    token,
    buildPartnerOrphanJql(releaseSlug, trainSlug, orphanOpts),
    { source: 'wishlist_partner_orphan' },
    cfg,
    jiraBaseUrl,
    releaseCtx
  );

  const companionDefs = (cfg.companionRoots || []).filter((r) => {
    if (!r.rootKey) return false;
    if (!Array.isArray(r.releases) || !r.releases.length) return true;
    return r.releases.includes(effectiveRelease);
  });

  const companions = [];
  for (const root of companionDefs) {
    const hierarchy = await searchSection(
      token,
      buildCompanionHierarchyJql(root.rootKey),
      { source: 'companion' },
      cfg,
      jiraBaseUrl,
      releaseCtx
    );
    const external = await searchSection(
      token,
      buildCompanionExternalJql(root.rootKey, cfg.scopeGroups),
      { source: 'companion_external' },
      cfg,
      jiraBaseUrl,
      releaseCtx
    );
    tagSectionEw(hierarchy, cfg);
    tagSectionEw(external, cfg);
    companions.push({
      rootKey: root.rootKey,
      label: root.label || root.rootKey,
      operationMode: resolveOperationMode('companion'),
      hierarchy,
      external,
    });
  }

  tagSectionEw(partnershipBlockedBy, cfg);
  tagSectionEw(partnershipBlocks, cfg);
  tagSectionEw(trainLabels, cfg);
  tagSectionEw(wishlist, cfg);
  tagSectionEw(wishlistLinked, cfg);
  tagSectionEw(wishlistUnlinked, cfg);
  tagSectionEw(partnerOrphans, cfg);

  const chainCtx = await fetchChainContext(
    token,
    partnershipBlockedBy,
    partnershipBlocks,
    cfg,
    jiraBaseUrl,
    releaseCtx
  );
  tagSectionEw(chainCtx.waitRoots, cfg);
  tagSectionEw(chainCtx.blockerHops, cfg);

  const earlyDefs = listEarlyCallReleases(cfg, effectiveRelease);
  const earlyCalls = [];
  for (const early of earlyDefs) {
    try {
      const bundle = await fetchEarlyCallBundle(
        token,
        early,
        cfg,
        jiraBaseUrl,
        wlCfg,
        orphanOpts
      );
      earlyCalls.push(bundle);
    } catch (err) {
      console.warn(
        '[dependencyView] early call bundle failed for',
        early.release,
        err.message || err
      );
      earlyCalls.push({
        release: early.release,
        train: early.train,
        trainSlug: early.trainSlug,
        status: early.status,
        notes: early.notes,
        error: err.message || String(err),
        sections: {},
      });
    }
  }

  const sections = {
    partnershipBlockedBy,
    partnershipBlocks,
    trainLabels,
    wishlist,
    wishlistLinked,
    wishlistUnlinked,
    partnerOrphans,
    companions,
    waitRoots: chainCtx.waitRoots,
    blockerHops: chainCtx.blockerHops,
    earlyCalls,
  };
  enrichSpansFromLinksAndProjects(sections, cfg);
  await enrichIssuesWithSprintEnds(token, sections);
  await enrichAncestorChains(token, sections, cfg, jiraBaseUrl, releaseCtx);

  return {
    teamId: effectiveTeamId,
    teamName: team?.name || effectiveTeamId,
    release: effectiveRelease,
    releases: cfg.releases || [],
    jiraBaseUrl,
    asOf: new Date().toISOString(),
    alignedTrain,
    earlyCalls,
    ndbGates,
    partnerCatalog: cfg.partnerCatalog || [],
    spans: spanCatalog(cfg),
    modesOfOperation: {
      dependency: 'JIRA issue links (blocks / is blocked by)',
      partnership: 'FEAT / Initiative → Epic hierarchy (Parent Link)',
    },
    spanTaxonomy: cfg.spanTaxonomy || null,
    sections,
    wishlistMeta: {
      releaseSlug,
      wishlistLabel: wishlistLabel(releaseSlug, wlOpts.labelSuffix),
      partnerLabels: partnerDepLabels(trainSlug, orphanOpts.partnerSuffixes).map((s) =>
        s.replace(/^"|"$/g, '')
      ),
      linkTypeFilter: wlCfg.linkTypeFilter,
      labelSuffix: wlCfg.labelSuffix,
      partnerLabelSuffixes: wlCfg.partnerLabelSuffixes,
      linkTypePresets: wlCfg.linkTypePresets,
      ignoredLinkTypePatterns: wlCfg.ignoredLinkTypePatterns,
    },
    jqlBuilders: {
      companionHierarchy: 'Q1',
      companionExternal: 'Q2',
      partnershipBlockedBy: 'Q3',
      partnershipBlocks: 'Q4',
      trainLabels: 'Q5',
      commitSignal: 'Q6',
      wishlist: 'Q7a',
      wishlistLinked: 'Q7b',
      wishlistUnlinked: 'Q7c',
      partnerOrphans: 'Q7d',
    },
  };
}

module.exports = {
  getOverview,
  getWishlistConfig,
  saveWishlistConfig,
  buildCompanionHierarchyJql,
  buildCompanionExternalJql,
  buildPartnershipBlockedByJql,
  buildPartnershipBlocksJql,
  buildTrainLabelsJql,
  releaseToWishlistSlug,
  buildWishlistJql,
  buildWishlistLinkedJql,
  buildWishlistUnlinkedJql,
  buildPartnerOrphanJql,
};
