/**
 * OnCalls → CFD/CFI (configured KPI) escalation analysis.
 */

const { getJira, searchPages } = require('../utils/jiraClient');
const { loadKpiConfigSync, getKpisForTeam } = require('../utils/teamConfig');
const { resolveKpiJql } = require('./kpiService');
const { mapLinkedIssues, daysAgo, daysBetween } = require('./ticketNarrativeService');
const {
  andParts,
  cell,
  keysInJql,
  oncallSeedJql,
  linkedIntoJql,
  escapeLinkedIssuesOfInner,
} = require('./oncallConfigResolve');

/**
 * Filter-style Open-in-JIRA proof for escalation heroes (not key in (...)).
 * Seed window ∩ linkedIssuesOf(CFD|CFI KPI union [± open/done]).
 */
function buildEscalationProofJqls({
  windowJql,
  kpiJqls,
  withEscalationKeys,
  resolvedKeys,
  stillOpenKeys,
  openStatusJql,
  doneStatusJql,
}) {
  const openCat = openStatusJql || 'statusCategory != Done';
  const doneCat = doneStatusJql || 'statusCategory = Done';
  const union =
    kpiJqls && kpiJqls.length
      ? kpiJqls.map((j) => `(${j})`).join(' OR ')
      : null;

  if (!union) {
    return {
      withEscalation: keysInJql(withEscalationKeys),
      resolved: keysInJql(resolvedKeys),
      stillOpen: keysInJql(stillOpenKeys),
    };
  }

  const openInner = `(${union}) AND (${openCat})`;
  const doneInner = `(${union}) AND (${doneCat})`;
  return {
    withEscalation: linkedIntoJql(windowJql, union),
    stillOpen: linkedIntoJql(windowJql, openInner),
    // Cleared ≈ linked to a done KPI ticket and not linked to any still-open KPI ticket
    resolved: andParts(
      linkedIntoJql(windowJql, doneInner),
      `issueFunction not in linkedIssuesOf("${escapeLinkedIssuesOfInner(openInner)}")`
    ),
  };
}

async function countOrFallback(token, jql, fallback) {
  if (!jql) return fallback;
  try {
    const jira = await getJira(token);
    return await jira.searchCount(jql);
  } catch (_) {
    return fallback;
  }
}

/**
 * Team KPIs that count as escalation targets (name matches oncallConfig.escalation.kpiNamePattern).
 */
function resolveEscalationKpis(teamId, cfg) {
  const pattern = new RegExp(cfg.escalation?.kpiNamePattern || 'CFD|CFI', 'i');
  try {
    const kpiTeams = loadKpiConfigSync();
    const { kpis } = getKpisForTeam(kpiTeams, teamId || cfg.teamId);
    return (kpis || [])
      .filter((k) => k && k.name && pattern.test(k.name) && !/oncalls?/i.test(k.name))
      .map((k) => ({ id: k.id, name: k.name, baseQuery: k.baseQuery }));
  } catch (_) {
    return [];
  }
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/**
 * OnCalls that link into CFD/CFI (or other configured) KPI tickets,
 * with time-to-resolve = OnCall.created → linked KPI ticket.resolutiondate.
 */
async function buildEscalationAnalysis(token, cfg) {
  const targets = resolveEscalationKpis(cfg.teamId, cfg);
  if (!targets.length) {
    return {
      enabled: false,
      reason: `No KPIs for this team match “${cfg.escalation.kpiNamePattern}” (see oncallConfig.escalation.kpiNamePattern).`,
      kpis: [],
      summary: null,
      rows: [],
    };
  }

  const lookback = cfg.escalation.lookbackDays;
  const maxFetch = cfg.escalation.maxOncallsFetch;
  // OnCall seeds only (+ recently resolved) — TH union is for KPI heroes, not escalation rows
  const windowJql = andParts(
    oncallSeedJql(cfg),
    `(${cfg.openStatusJql} OR resolved >= -${lookback}d)`
  );

  const oncalls = await searchPages(
    token,
    windowJql,
    'key,summary,status,priority,assignee,created,updated,resolutiondate,issuelinks',
    { pageSize: 100, maxTotal: maxFetch, timeoutMs: 60000, delayMs: 150 }
  );

  const stacks = [];
  const linkedKeySet = new Set();
  for (const issue of oncalls) {
    const f = issue.fields || {};
    const linked = mapLinkedIssues(f.issuelinks, cfg).filter(
      (l) => l.role !== 'oncall' && l.role !== 'techhelp' && l.role !== 'knowledge'
    );
    if (!linked.length) continue;
    linked.forEach((l) => linkedKeySet.add(l.key));
    stacks.push({
      key: issue.key,
      summary: f.summary || '',
      status: f.status?.name || 'unknown',
      priority: f.priority?.name || null,
      assignee: f.assignee?.displayName || f.assignee?.name || 'Unassigned',
      created: f.created || null,
      resolutiondate: f.resolutiondate || null,
      linked,
    });
  }

  if (!linkedKeySet.size) {
    return {
      enabled: true,
      kpis: targets.map((t) => ({ id: t.id, name: t.name, baseQuery: t.baseQuery })),
      windowJql,
      summary: {
        oncallsScanned: oncalls.length,
        withEscalationLink: 0,
        resolvedEscalations: 0,
        openEscalations: 0,
        medianDaysToResolve: null,
        p90DaysToResolve: null,
      },
      rows: [],
      cells: {
        withEscalation: cell(0, null),
        resolved: cell(0, null),
        stillOpen: cell(0, null),
      },
    };
  }

  // Resolve each KPI filter → match linked keys that fall in that KPI
  const linkedKeys = [...linkedKeySet];
  const keyToKpis = new Map(); // key → [{name, baseQuery}]
  const kpiIssueMeta = new Map(); // key → { status, resolutiondate, summary, priority }
  const kpiWarnings = [];
  const resolvedKpiJqls = []; // for filter-style Open-in-JIRA proof

  for (const t of targets) {
    let kpiJql;
    try {
      kpiJql = await resolveKpiJql(t.baseQuery, token, null);
    } catch (err) {
      kpiWarnings.push(`${t.name}: ${err.message || String(err)}`);
      continue;
    }
    if (!kpiJql) {
      kpiWarnings.push(`${t.name}: empty JQL after resolve`);
      continue;
    }
    resolvedKpiJqls.push(kpiJql);

    // Chunk key lists to keep JQL under size limits
    const chunkSize = 80;
    for (let i = 0; i < linkedKeys.length; i += chunkSize) {
      const chunk = linkedKeys.slice(i, i + chunkSize);
      const jql = andParts(keysInJql(chunk), `(${kpiJql})`);
      if (!jql) continue;
      let hits = [];
      try {
        hits = await searchPages(
          token,
          jql,
          'key,summary,status,priority,resolutiondate,created',
          { pageSize: 100, maxTotal: chunk.length, timeoutMs: 45000, delayMs: 100 }
        );
      } catch (_) {
        continue;
      }
      for (const hit of hits) {
        const k = hit.key;
        const f = hit.fields || {};
        if (!keyToKpis.has(k)) keyToKpis.set(k, []);
        keyToKpis.get(k).push({ id: t.id, name: t.name, baseQuery: t.baseQuery });
        if (!kpiIssueMeta.has(k)) {
          kpiIssueMeta.set(k, {
            key: k,
            summary: f.summary || '',
            status: f.status?.name || 'unknown',
            priority: f.priority?.name || null,
            resolutiondate: f.resolutiondate || null,
            created: f.created || null,
          });
        }
      }
    }
  }

  const rows = [];
  const oncallKeysWithEsc = [];
  const resolvedOncallKeys = [];
  const openOncallKeys = [];
  const daysResolved = [];

  for (const oc of stacks) {
    const matchedLinks = oc.linked
      .map((l) => {
        const kpis = keyToKpis.get(l.key);
        if (!kpis || !kpis.length) return null;
        const meta = kpiIssueMeta.get(l.key) || {};
        const resolvedAt = meta.resolutiondate || null;
        const days = resolvedAt
          ? daysBetween(oc.created, resolvedAt)
          : daysAgo(oc.created);
        const stillOpen = !resolvedAt;
        return {
          key: l.key,
          kpiNames: [...new Set(kpis.map((k) => k.name))],
          status: meta.status || l.status,
          summary: meta.summary || l.summary,
          priority: meta.priority,
          resolutiondate: resolvedAt,
          daysToResolve: stillOpen ? null : days,
          daysOpenSoFar: stillOpen ? days : null,
          stillOpen,
        };
      })
      .filter(Boolean);

    if (!matchedLinks.length) continue;

    oncallKeysWithEsc.push(oc.key);
    const resolvedLinks = matchedLinks.filter((m) => !m.stillOpen && m.daysToResolve != null);
    const openLinks = matchedLinks.filter((m) => m.stillOpen);
    // Any still-open KPI link → customer wait ongoing (do not hide behind a sibling resolve)
    const hasOpenEscalation = openLinks.length > 0;
    let primary = null;
    if (hasOpenEscalation) {
      primary = openLinks.reduce((a, b) =>
        (a.daysOpenSoFar ?? 0) >= (b.daysOpenSoFar ?? 0) ? a : b
      );
      openOncallKeys.push(oc.key);
    } else if (resolvedLinks.length) {
      primary = resolvedLinks.reduce((a, b) =>
        (a.daysToResolve ?? Infinity) <= (b.daysToResolve ?? Infinity) ? a : b
      );
      daysResolved.push(primary.daysToResolve);
      resolvedOncallKeys.push(oc.key);
    }

    rows.push({
      oncallKey: oc.key,
      oncallSummary: oc.summary,
      oncallStatus: oc.status,
      oncallPriority: oc.priority,
      oncallAssignee: oc.assignee,
      oncallCreated: oc.created,
      linked: matchedLinks,
      primaryLinkedKey: primary?.key || matchedLinks[0].key,
      kpiNames: [...new Set(matchedLinks.flatMap((m) => m.kpiNames))],
      daysToResolve: hasOpenEscalation ? null : primary?.daysToResolve ?? null,
      daysOpenSoFar: hasOpenEscalation ? primary?.daysOpenSoFar ?? null : null,
      stillOpen: hasOpenEscalation,
      partialResolved: hasOpenEscalation && resolvedLinks.length > 0,
    });
  }

  rows.sort((a, b) => {
    if (a.stillOpen !== b.stillOpen) return a.stillOpen ? -1 : 1;
    const da = a.daysOpenSoFar ?? a.daysToResolve ?? 0;
    const db = b.daysOpenSoFar ?? b.daysToResolve ?? 0;
    return db - da;
  });

  const sortedDays = [...daysResolved].sort((a, b) => a - b);

  const proofJql = buildEscalationProofJqls({
    windowJql,
    kpiJqls: resolvedKpiJqls,
    withEscalationKeys: oncallKeysWithEsc,
    resolvedKeys: resolvedOncallKeys,
    stillOpenKeys: openOncallKeys,
    openStatusJql: cfg.openStatusJql,
    doneStatusJql: cfg.doneStatusJql,
  });

  // Counts follow the filter-style proof so Open in JIRA matches the tile
  const withEscalationCount = await countOrFallback(
    token,
    proofJql.withEscalation,
    oncallKeysWithEsc.length
  );
  const stillOpenCount = await countOrFallback(
    token,
    proofJql.stillOpen,
    openOncallKeys.length
  );
  const resolvedCount = await countOrFallback(
    token,
    proofJql.resolved,
    resolvedOncallKeys.length
  );

  return {
    enabled: true,
    clock: cfg.escalation.clock,
    lookbackDays: lookback,
    kpis: targets.map((t) => ({ id: t.id, name: t.name, baseQuery: t.baseQuery })),
    windowJql,
    warnings: kpiWarnings.length ? kpiWarnings : undefined,
    summary: {
      oncallsScanned: oncalls.length,
      withEscalationLink: withEscalationCount,
      resolvedEscalations: resolvedCount,
      openEscalations: stillOpenCount,
      medianDaysToResolve: median(daysResolved),
      p90DaysToResolve: percentile(sortedDays, 90),
    },
    cells: {
      withEscalation: cell(withEscalationCount, proofJql.withEscalation),
      resolved: cell(resolvedCount, proofJql.resolved),
      stillOpen: cell(stillOpenCount, proofJql.stillOpen),
    },
    rows,
  };
}

module.exports = {
  resolveEscalationKpis,
  buildEscalationAnalysis,
  buildEscalationProofJqls,
  percentile,
  median,
};
