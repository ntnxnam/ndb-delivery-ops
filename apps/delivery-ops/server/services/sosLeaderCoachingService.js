/**
 * SoS-by-leader coaching — deterministic LEADER_PACKET from Feature/Initiative
 * items + gate/breakdown/history, then NAI asks (release + sprint context).
 */

const { generateSosLeaderCoaching } = require('./naiService');
const logger = require('../utils/logger');

const STALE_STATUS_DAYS = 14;
const DAY_MS = 86400000;

const DONE_FAMILY = new Set([
  'closed', 'done', 'cg met', 'commit gate met', 'pg met', 'promotion gate met', 'shipped',
]);
const OPEN_EXCLUDE = new Set(['closed', 'cancelled', 'done', 'promotion gate met', 'shipped']);

const KTLO_PATTERNS = [
  /\bcve\b/i,
  /\boncall\b/i,
  /\bon-call\b/i,
  /\bsystem\s*test\b/i,
  /\bsmokes?\b/i,
  /\bprecommits?\b/i,
  /-deferred$/i,
  /-long-term-funded$/i,
];

const PHASE_RANK = {
  backlog: 0,
  open: 1,
  'to do': 1,
  'in progress': 2,
  coding: 2,
  'code complete': 3,
  'cc met': 3,
  'commit gate met': 4,
  'cg met': 4,
  'promotion gate met': 5,
  'pg met': 5,
  shipped: 6,
  closed: 6,
  resolved: 3,
};

function daysSinceIso(iso) {
  if (!iso) return null;
  const t = Date.parse(String(iso).slice(0, 10));
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / DAY_MS);
}

function riskWord(raw) {
  const v = String(typeof raw === 'string' ? raw : (raw?.value || '')).split(/\s+/)[0];
  if (v === 'Red' || v === 'Yellow' || v === 'Green') return v;
  return 'NotSet';
}

function isOpen(item) {
  return !OPEN_EXCLUDE.has(String(item?.status || '').toLowerCase());
}

function isDoneFamily(item) {
  return DONE_FAMILY.has(String(item?.status || '').toLowerCase());
}

function linkEmpty(val) {
  if (val == null) return true;
  const s = String(val).trim();
  return !s || /^n\/?a$/i.test(s) || /^team_?na$/i.test(s) || s === '-';
}

function textEmpty(val) {
  if (val == null) return true;
  const s = typeof val === 'string' ? val : (val?.value || val?.content || JSON.stringify(val));
  return !String(s || '').trim() || /^n\/?a$/i.test(String(s).trim());
}

function labelBlob(item) {
  const labels = item.labels || [];
  const comps = item.components || [];
  const pc = item.primaryComponent;
  const pcStr = pc ? [pc.parent, pc.child].filter(Boolean).join(' ') : '';
  return [...labels, ...comps, pcStr, item.labelsString || ''].join(' ');
}

function matchesKtlo(item) {
  const blob = labelBlob(item);
  return KTLO_PATTERNS.some((re) => re.test(blob));
}

function isP0(item) {
  const p = String(item?.priority || '').toLowerCase();
  return p.includes('p0') || p === 'blocker' || p === 'highest';
}

function isMustFix(item) {
  const labels = (item.labels || []).map((l) => String(l).toLowerCase());
  return labels.some((l) => l.includes('mustfix') || l.includes('must-fix'));
}

function resolveGateContext(gateData) {
  const todayMs = Date.parse(new Date().toISOString().slice(0, 10));
  const gates = (gateData?.gates || [])
    .filter((g) => g?.iso && g?.kind)
    .map((g) => {
      const iso = String(g.iso).slice(0, 10);
      const t = Date.parse(iso);
      const daysFromToday = Number.isNaN(t) ? null : Math.round((t - todayMs) / DAY_MS);
      const kind = String(g.kind).toUpperCase();
      const phaseRank = kind === 'CC' ? 3 : kind === 'CG' ? 4 : kind === 'PG' ? 5 : kind === 'GA' ? 6 : 2;
      return {
        kind,
        label: g.label || kind,
        iso,
        daysFromToday,
        phaseRank,
        statusName: kind === 'CG' ? 'Commit Gate Met' : kind === 'PG' ? 'Promotion Gate Met' : kind,
      };
    });
  const past = gates
    .filter((g) => {
      const t = Date.parse(g.iso);
      return !Number.isNaN(t) && t <= todayMs;
    })
    .sort((a, b) => Date.parse(b.iso) - Date.parse(a.iso))[0] || null;
  const next = gates
    .filter((g) => {
      const t = Date.parse(g.iso);
      return !Number.isNaN(t) && t > todayMs;
    })
    .sort((a, b) => Date.parse(a.iso) - Date.parse(b.iso))[0] || null;
  return { pastGate: past, nextGate: next };
}

function statusPhaseRank(status) {
  return PHASE_RANK[String(status || '').toLowerCase()] ?? 1;
}

function shortSummary(summary, max = 72) {
  const s = String(summary || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function bucketKeys(keys, keySummaries = {}, limit = 12) {
  const uniq = [...new Set((keys || []).filter(Boolean))];
  const sliced = uniq.slice(0, limit);
  return {
    count: uniq.length,
    keys: sliced,
    // Human-readable cites for prompts / rule Asks (summary first).
    examples: sliced.map((k) => {
      const sum = shortSummary(keySummaries[k]);
      return sum ? `"${sum}" (${k})` : k;
    }),
  };
}

function exampleCite(bucket, n = 3) {
  const ex = bucket?.examples || [];
  if (ex.length) return ex.slice(0, n).join('; ');
  return (bucket?.keys || []).slice(0, n).join(', ');
}

/**
 * Build deterministic LEADER_PACKET for one eng leader.
 */
function buildLeaderPacket({
  leaderId,
  leaderName,
  role,
  items = [],
  gateDataByRelease = {},
  breakdownDataMap = {},
  checkpointHistory = {},
  expectedManagerNames = [],
}) {
  const list = (items || []).filter((i) => i?.key);
  const keySummaries = {};
  for (const i of list) {
    keySummaries[i.key] = shortSummary(i.summary || i.fields?.summary);
  }
  const releases = [...new Set(
    list.flatMap((i) => String(i.fixVersions || '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s && s !== 'N/A'))
  )].sort();

  const blockers = [];
  const redRag = [];
  const pastGateLagging = [];
  const datesPastNextGate = [];
  const collateralGaps = [];
  const riskNotSet = [];
  const staleStatus = [];
  const missingPathToGreen = [];
  const missingCgPg = [];
  const ktlo = [];
  const ownershipGaps = [];
  const tbvKeys = [];
  let outstandingDev = 0;
  let outstandingTest = 0;

  // Sprint mix
  const sprintByName = {};
  let activeSprint = 0;
  let closedSprint = 0;
  let noSprint = 0;

  for (const item of list) {
    const st = String(item.sprintState || '').toLowerCase();
    const sn = item.sprintName || '(none)';
    if (!item.sprintName) noSprint += 1;
    else if (st === 'active') activeSprint += 1;
    else if (st === 'closed') closedSprint += 1;
    sprintByName[sn] = (sprintByName[sn] || 0) + 1;

    if (isP0(item) && isOpen(item)) blockers.push(item.key);
    if (isMustFix(item) && isOpen(item)) blockers.push(item.key);

    const rag = riskWord(item.customfield_23560);
    if (rag === 'Red' && isOpen(item)) redRag.push(item.key);

    const versions = String(item.fixVersions || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    for (const v of versions) {
      const { pastGate, nextGate } = resolveGateContext(gateDataByRelease[v]);
      if (pastGate && isOpen(item) && statusPhaseRank(item.status) < pastGate.phaseRank) {
        pastGateLagging.push(item.key);
      }
      if (nextGate && nextGate.daysFromToday != null && nextGate.daysFromToday <= 14 && isOpen(item)) {
        const cg = item.customfield_35863;
        const pg = item.customfield_35864;
        const cc = item.customfield_11067;
        const prereq = nextGate.kind === 'PG' ? pg || cg : nextGate.kind === 'CG' ? cc || cg : cc;
        if (prereq && String(prereq).slice(0, 10) > nextGate.iso) {
          datesPastNextGate.push(item.key);
        }
      }
    }

    if (isDoneFamily(item)) {
      if (
        linkEmpty(item.customfield_14463)
        || linkEmpty(item.customfield_14464)
        || linkEmpty(item.customfield_14465)
      ) {
        collateralGaps.push(item.key);
      }
    }

    if (isOpen(item) && rag === 'NotSet') riskNotSet.push(item.key);
    const age = daysSinceIso(item.customfield_45660);
    if (isOpen(item) && (age == null || age >= STALE_STATUS_DAYS)) staleStatus.push(item.key);
    if (isOpen(item) && (rag === 'Yellow' || rag === 'Red')) {
      if (textEmpty(item.customfield_47780) || textEmpty(item.customfield_55664)) {
        missingPathToGreen.push(item.key);
      }
    }
    if (isOpen(item) && (!item.customfield_35863 || !item.customfield_35864)) {
      missingCgPg.push(item.key);
    }

    if (isOpen(item) && matchesKtlo(item)) ktlo.push(item.key);

    if (!item.assigneeManager && expectedManagerNames.length > 0) {
      ownershipGaps.push(item.key);
    }

    const bd = breakdownDataMap[item.key];
    if (bd) {
      const stats = bd.overallStats || {};
      const rem = Number(bd.outstandingCount
        ?? ((stats.toDo || 0) + (stats.inProgress || 0) + (stats.blocked || 0) + (stats.other || 0))) || 0;
      outstandingDev += rem;
      const tbv = Number(stats.resolved || bd.tbv || 0) || 0;
      if (tbv > 0) tbvKeys.push(item.key);
    }

    if (String(item.status || '').toLowerCase() === 'resolved') tbvKeys.push(item.key);
  }

  // Ad-hoc crowding proxy: high remaining children under a FEAT (≥8 outstanding)
  const adhocKeys = list
    .filter((i) => {
      const bd = breakdownDataMap[i.key];
      if (!bd) return false;
      const stats = bd.overallStats || {};
      const rem = Number(bd.outstandingCount
        ?? ((stats.toDo || 0) + (stats.inProgress || 0) + (stats.blocked || 0) + (stats.other || 0))) || 0;
      return rem >= 8;
    })
    .map((i) => i.key);

  // Also treat OnCall-labeled open FEATs as ad-hoc pressure
  for (const item of list) {
    if (isOpen(item) && /\boncall\b|\bon-call\b/i.test(labelBlob(item))) {
      adhocKeys.push(item.key);
    }
  }

  const dateMoves7d = [];
  const weekAgo = Date.now() - 7 * DAY_MS;
  for (const item of list) {
    const moves = checkpointHistory[item.key]?.dateMoves || [];
    for (const m of moves) {
      if (!m?.changedAt) continue;
      const t = new Date(m.changedAt).getTime();
      if (!Number.isNaN(t) && t >= weekAgo) {
        dateMoves7d.push(item.key);
        break;
      }
    }
  }

  const tbvBucket = bucketKeys(tbvKeys, keySummaries);
  const packet = {
    leaderId: leaderId || null,
    leaderName: leaderName || 'Leader',
    role: role || null,
    releasesTouched: releases,
    itemCount: list.length,
    keySummaries,
    buckets: {
      blockers: bucketKeys(blockers, keySummaries),
      gateRisk: {
        pastGateLagging: bucketKeys(pastGateLagging, keySummaries),
        redRag: bucketKeys(redRag, keySummaries),
        datesPastNextGate: bucketKeys(datesPastNextGate, keySummaries),
        dateMoves7d: bucketKeys(dateMoves7d, keySummaries),
      },
      collateralGaps: bucketKeys(collateralGaps, keySummaries),
      hygiene: {
        riskNotSet: bucketKeys(riskNotSet, keySummaries),
        staleStatus: bucketKeys(staleStatus, keySummaries),
        missingPathToGreen: bucketKeys(missingPathToGreen, keySummaries),
        missingCgPg: bucketKeys(missingCgPg, keySummaries),
      },
      ktlo: bucketKeys(ktlo, keySummaries),
      adhoc: bucketKeys(adhocKeys, keySummaries),
      execution: {
        outstandingDev,
        outstandingTest,
        tbvCount: tbvBucket.count,
        keys: tbvBucket.keys,
        examples: tbvBucket.examples,
      },
      ownershipGaps: bucketKeys(ownershipGaps, keySummaries),
    },
    sprint: {
      byName: Object.entries(sprintByName)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([name, count]) => ({ name, count })),
      activeCount: activeSprint,
      closedCount: closedSprint,
      noSprintCount: noSprint,
    },
  };

  return packet;
}

/**
 * Collect VALID TICKET KEYS from packet buckets.
 */
function collectValidKeys(packet) {
  const keys = [];
  const seen = new Set();
  const push = (arr) => {
    for (const k of arr || []) {
      if (k && !seen.has(k)) { seen.add(k); keys.push(k); }
    }
  };
  const b = packet.buckets || {};
  push(b.blockers?.keys);
  push(b.gateRisk?.pastGateLagging?.keys);
  push(b.gateRisk?.redRag?.keys);
  push(b.gateRisk?.datesPastNextGate?.keys);
  push(b.gateRisk?.dateMoves7d?.keys);
  push(b.collateralGaps?.keys);
  push(b.hygiene?.riskNotSet?.keys);
  push(b.hygiene?.staleStatus?.keys);
  push(b.hygiene?.missingPathToGreen?.keys);
  push(b.hygiene?.missingCgPg?.keys);
  push(b.ktlo?.keys);
  push(b.adhoc?.keys);
  push(b.execution?.keys);
  push(b.ownershipGaps?.keys);
  return keys;
}

/**
 * Generate coaching asks for one leader. Returns { asks, text, packet, generatedAt }.
 */
async function generateLeaderCoaching(input) {
  const packet = buildLeaderPacket(input);
  const validKeys = collectValidKeys(packet);
  logger.info(
    `[sos-leader-coaching] ${packet.leaderName}: ${packet.itemCount} items, ${validKeys.length} keys`
  );
  try {
    const result = await generateSosLeaderCoaching({ packet, validKeys });
    return {
      asks: result.asks,
      text: result.text,
      packet,
      validKeys,
      source: 'ai',
      generatedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn(`[sos-leader-coaching] NAI failed for ${packet.leaderName}: ${err.message}`);
    const asks = buildRuleBasedAsks(packet);
    return {
      asks,
      text: formatAsksText(packet.leaderName, asks),
      packet,
      validKeys,
      source: 'rules',
      generatedAt: new Date().toISOString(),
      error: err.message,
    };
  }
}

function buildRuleBasedAsks(packet) {
  const asks = [];
  const name = packet.leaderName;
  const b = packet.buckets || {};
  const push = (ask, why, urgency) => {
    if (asks.length >= 5) return;
    asks.push({
      ask,
      why,
      owner: name,
      urgency,
    });
  };

  if (b.blockers?.count > 0) {
    push(
      `Clear ${b.blockers.count} open P0/must-fix item(s) in your org this week`,
      `${b.blockers.count} blockers e.g. ${exampleCite(b.blockers)}`,
      'P0'
    );
  }
  if (b.gateRisk?.pastGateLagging?.count > 0) {
    push(
      'Pull past-gate lagging FEATs to the expected phase or re-plan dates',
      `${b.gateRisk.pastGateLagging.count} lagging e.g. ${exampleCite(b.gateRisk.pastGateLagging)}`,
      'P0'
    );
  }
  if (b.hygiene?.staleStatus?.count > 0) {
    push(
      'Drive status-update refresh on stale Features/Initiatives (≥14d)',
      `${b.hygiene.staleStatus.count} stale e.g. ${exampleCite(b.hygiene.staleStatus)}`,
      'P1'
    );
  }
  if (b.collateralGaps?.count > 0) {
    push(
      'Close collateral gaps (Requirements / Design / Test Plan) on done/gate-cleared work',
      `${b.collateralGaps.count} gaps e.g. ${exampleCite(b.collateralGaps)}`,
      'P1'
    );
  }
  if (b.ktlo?.count > 0) {
    push(
      'Staff under-attended KTLO (CVE/OnCall/System Test/deferred) items',
      `${b.ktlo.count} KTLO e.g. ${exampleCite(b.ktlo)}`,
      'P1'
    );
  }
  if (b.adhoc?.count > 0) {
    push(
      'Contain ad-hoc / Direct-Ticket pressure crowding committed FEAT work',
      `${b.adhoc.count} crowded e.g. ${exampleCite(b.adhoc)}`,
      'P2'
    );
  }
  if (!asks.length) {
    push(
      'No leadership asks this cycle for this org — keep current discipline',
      'clean packet',
      'P2'
    );
  }
  return asks;
}

function formatAsksText(leaderName, asks) {
  const lines = (asks || []).map((a, i) => {
    return `${i + 1}. Ask: ${a.ask} | Why: ${a.why} | Owner: ${a.owner} | Urgency: ${a.urgency}`;
  });
  return `## Asks for ${leaderName}\n\n${lines.join('\n')}`;
}

module.exports = {
  buildLeaderPacket,
  collectValidKeys,
  generateLeaderCoaching,
  buildRuleBasedAsks,
  formatAsksText,
  shortSummary,
  exampleCite,
};
