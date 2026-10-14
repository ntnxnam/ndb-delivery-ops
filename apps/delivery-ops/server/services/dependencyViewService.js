/**
 * dependencyViewService — read-only Dependency View overview (Q1–Q7).
 * No JIRA mutates. JQL builders match agent-pack/context/domain/cross-team-dependencies.md.
 */
const fs = require('fs');
const path = require('path');
const { runSearchByJql } = require('../utils/jiraSearchByJql');
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

/**
 * Nutanix hierarchy-aware start/end for Gantt bars.
 * Start: ticket start if present, else release EC (NOT created — created pins ancient FEATs to the left).
 * End: gate dates / due date by issue type. No fabricated created+14 bars.
 *
 * @param {object} raw
 * @param {string} issueType
 * @param {{ ecDate?: string|null, gaDate?: string|null }} [releaseCtx]
 */
function resolveIssueTimeline(raw, issueType, releaseCtx = {}) {
  const upper = String(issueType || '').toUpperCase();
  const created = isoDay(raw.created);
  const updated = isoDay(raw.updated);
  const due = isoDay(raw.duedate);
  const cc = isoDay(raw[CODE_COMPLETE_FIELD]);
  const cg = isoDay(raw[COMMIT_GATE_FIELD]);
  const pg = isoDay(raw[PROMOTION_GATE_FIELD]);
  const releaseEc = isoDay(releaseCtx.ecDate);
  const releaseGa = isoDay(releaseCtx.gaDate);

  const isPortfolio =
    upper.includes('X-FEAT') ||
    upper.includes('CAPABILITY') ||
    upper.includes('FEATURE') ||
    upper.includes('INITIATIVE');
  const isEpic = upper.includes('EPIC');

  let endDate = null;
  if (isPortfolio) {
    endDate = pg || cg || cc || due;
  } else if (isEpic) {
    endDate = due || cc || pg;
  } else {
    endDate = due;
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
    // Stories/tasks/bugs: due-date based; optional short estimate only when due exists
    if (endDate && startDate && startDate > endDate) {
      startDate = addDaysIso(endDate, -7);
      barKind = 'estimated';
    } else if (endDate && !startDate) {
      startDate = addDaysIso(endDate, -7);
      barKind = 'estimated';
    } else if (!endDate) {
      barKind = 'undated';
      startDate = null;
    }
  }

  const isMilestone = startDate && endDate && startDate === endDate;
  if (isMilestone) barKind = 'milestone';

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
      releaseGa,
    },
  };
}

function linkedIssueSummary(side) {
  if (!side) return '';
  return side.fields?.summary || side.summary || '';
}

function mapIssueLinks(issuelinks) {
  if (!Array.isArray(issuelinks)) return [];
  const out = [];
  issuelinks.forEach((link) => {
    const typeName = link?.type?.name || '';
    if (link?.outwardIssue?.key) {
      out.push({
        key: link.outwardIssue.key,
        summary: linkedIssueSummary(link.outwardIssue),
        direction: 'outward',
        type: link.type?.outward || typeName || 'outward',
        typeName,
      });
    }
    if (link?.inwardIssue?.key) {
      out.push({
        key: link.inwardIssue.key,
        summary: linkedIssueSummary(link.inwardIssue),
        direction: 'inward',
        type: link.type?.inward || typeName || 'inward',
        typeName,
      });
    }
  });
  return out;
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
 * Q6 — ask vs committed, plus evidence for the UI.
 * Committed if real fixVersion (not denylist) and/or Release Commit field = Commit.
 * @returns {{ state: 'committed'|'ask', via: 'fixVersion'|'release_commit_field'|'both'|null, fixVersions: string[], releaseCommit: string|null }}
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
  const commitFlag = /^commit$/i.test(releaseCommit || '');
  let via = null;
  if (hasRealFv && commitFlag) via = 'both';
  else if (hasRealFv) via = 'fixVersion';
  else if (commitFlag) via = 'release_commit_field';
  return {
    state: hasRealFv || commitFlag ? 'committed' : 'ask',
    via,
    fixVersions: commitFixVersions,
    releaseCommit,
  };
}

function isCommitted(issue, nonCommitFixVersions) {
  return classifyCommit(issue, nonCommitFixVersions).state === 'committed';
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
    label: 'NDB EW',
    jiraLabel: 'ndb-ew',
    short: 'NDB',
    hint: 'Type of project: Within NDB (label ndb-ew).',
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
 * Partnership = JIRA issue link; Companionship = under our epic / companion hierarchy.
 */
function resolveOperationMode(source) {
  const src = String(source || '');
  if (src.startsWith('partnership')) {
    return {
      id: 'partnership',
      label: 'Partnership',
      hint: 'Linked via JIRA issue link (blocks / is blocked by).',
    };
  }
  if (src.startsWith('companion')) {
    return {
      id: 'companionship',
      label: 'Companionship',
      hint: 'Their tickets sit under our epics / companion root (Parent Link hierarchy).',
    };
  }
  if (src.startsWith('wishlist')) {
    return {
      id: 'wishlist',
      label: 'Wishlist discovery',
      hint: 'Found via wishlist / train-dep labels — not Partnership or Companionship mode.',
    };
  }
  if (src === 'labels') {
    return {
      id: 'labels',
      label: 'Train labels',
      hint:
        'Discovery callout on our tickets (ndb-*-dependency / ndb-*-asks). Not Mode and not Span (*-ew).',
    };
  }
  return { id: 'unknown', label: 'Unknown', hint: '' };
}

/**
 * Span = type of project from EW JIRA labels only (not influence / hop count).
 * global-ew | nutanix-ew | ndb-ew | (none → team_internal).
 * Never use train-dep / asks / wishlist labels here — those are Discovery on our tickets.
 */
function classifyEwSpan(labels, cfg) {
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
        source: 'jira_label',
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
  const timeline = resolveIssueTimeline(raw, issueType, releaseCtx);
  const links = mapIssueLinks(raw.issuelinks);
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
    commitVia: commit.via,
    commitFixVersions: commit.fixVersions,
    releaseCommit: commit.releaseCommit,
    startDate: timeline.startDate,
    endDate: timeline.endDate,
    barKind: timeline.barKind,
    dateFields: timeline.dateFields,
    links,
  };
}

async function searchSection(token, jql, meta, cfg, jiraBaseUrl, releaseCtx = {}) {
  const compact = jql.replace(/\s+/g, ' ').trim();
  let issues = [];
  let error = null;
  try {
    const result = await runSearchByJql(token, compact, 200, { extraFields: ['issuelinks'] });
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

  return {
    teamId: effectiveTeamId,
    teamName: team?.name || effectiveTeamId,
    release: effectiveRelease,
    releases: cfg.releases || [],
    jiraBaseUrl,
    asOf: new Date().toISOString(),
    alignedTrain,
    ndbGates,
    partnerCatalog: cfg.partnerCatalog || [],
    spans: spanCatalog(cfg),
    modesOfOperation: cfg.modesOfOperation || {
      partnership: 'JIRA issue links (blocks / is blocked by)',
      companionship: 'Their tickets under our epics / companion root hierarchy',
    },
    spanTaxonomy: cfg.spanTaxonomy || null,
    sections: {
      partnershipBlockedBy,
      partnershipBlocks,
      trainLabels,
      wishlist,
      wishlistLinked,
      wishlistUnlinked,
      partnerOrphans,
      companions,
    },
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
