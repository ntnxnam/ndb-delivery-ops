/**
 * KPI Pulse — reusable last-N-quarter analytics for any KPI baseJql.
 * Heroes, weekly created/resolved series, MTTR, status dwell aggregates.
 * Does not hard-code KPI names or rewrite page filters — only composes date clauses.
 */

const { getJira, searchPages } = require('../utils/jiraClient');
const {
  lastNQuartersWindow,
  weekBucketsInRange,
} = require('../utils/nutanixQuarters');
const {
  fetchTicketNarrativeBundle,
  daysBetween,
} = require('./ticketNarrativeService');
const logger = require('../utils/logger');

const DEFAULT_AGED_DAYS = 14;
const DEFAULT_SAMPLE_CAP = 40;
const DEFAULT_ISSUE_FETCH = 500;
const DEFAULT_OPEN_JQL = 'statusCategory != Done';

function cell(count, jql) {
  return { count: count == null ? 0 : count, jql: jql || null };
}

function wrapBase(baseJql) {
  const base = String(baseJql || '').trim();
  if (!base) throw new Error('baseJql is required for buildPulse');
  return `(${base})`;
}

function andJql(...parts) {
  return parts.filter(Boolean).join(' AND ');
}

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedAsc.length) - 1)
  );
  return sortedAsc[idx];
}

async function runCounts(token, queries, concurrency = 6) {
  const jira = await getJira(token);
  const keys = Object.keys(queries);
  const results = {};
  const errors = {};
  let idx = 0;

  async function worker() {
    while (idx < keys.length) {
      const i = idx;
      idx += 1;
      const k = keys[i];
      const jql = queries[k];
      if (!jql) {
        results[k] = 0;
        continue;
      }
      try {
        results[k] = await jira.searchCount(jql);
      } catch (err) {
        errors[k] = err.message || String(err);
        results[k] = 0;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  return { results, errors };
}

/** Terminal / Done-family statuses — exclude from “where work stalls” dwell. */
const TERMINAL_STATUS_RE = /^(closed|resolved|done|cancelled|canceled|complete|completed)$/i;

function isTerminalStatus(name) {
  return TERMINAL_STATUS_RE.test(String(name || '').trim());
}

function buildStory({ net, createdN, resolvedN, mttrMedian, agedOpen, agedOpenDays, topDwell, openNow }) {
  const catchUp =
    net > 0
      ? `Catching up — resolved ${resolvedN} vs created ${createdN} (${net > 0 ? '+' : ''}${net}).`
      : net < 0
        ? `Falling behind — created ${createdN} vs resolved ${resolvedN} (net ${net}).`
        : `Inflow matches outflow (${createdN} created / ${resolvedN} resolved).`;
  const wait =
    mttrMedian != null ? ` Typical wait ${mttrMedian}d to resolve.` : '';
  const stuck =
    agedOpen > 0
      ? ` ${agedOpen} still open ≥${agedOpenDays}d.`
      : openNow > 0
        ? ` ${openNow} open now.`
        : '';
  const dwell =
    topDwell?.status != null
      ? ` Work stalls longest in “${topDwell.status}” (${topDwell.medianDays}d med).`
      : '';
  return `${catchUp}${wait}${stuck}${dwell}`.trim();
}

/**
 * @param {Array} series
 * @param {{ outflowMode?: 'transitions' | 'resolutiondate' }} [opts]
 */
function seriesCaption(series, opts = {}) {
  if (!series?.length) return null;
  const outflowMode = opts.outflowMode || 'transitions';
  let createdLead = 0;
  let closedLead = 0;
  let flowTotal = 0;
  for (const s of series) {
    const c = s.created?.count ?? 0;
    const closedN = s.closed?.count ?? 0;
    const toResN = s.toResolved?.count ?? 0;
    const resN = s.resolved?.count ?? 0;
    // Chart bars: Closed + →Resolved. Caption may use resolutiondate when
    // transitions are all-zero (OnCall filters often lack changelog hits).
    const out =
      outflowMode === 'resolutiondate'
        ? resN
        : closedN + toResN > 0
          ? closedN + toResN
          : resN;
    flowTotal += c + closedN + toResN + resN;
    if (c > out) createdLead += 1;
    else if (out > c) closedLead += 1;
  }
  if (flowTotal === 0) {
    return `No creates or completions in this window (${series.length} weeks) — open stock may pre-date the window.`;
  }
  const closedWord =
    outflowMode === 'resolutiondate' ? 'Done (resolution date)' : 'Closed';
  if (closedLead > createdLead) {
    return `${closedWord} ahead of created in ${closedLead} of ${series.length} weeks.`;
  }
  if (createdLead > closedLead) {
    return `Created ahead of ${closedWord.toLowerCase()} in ${createdLead} of ${series.length} weeks.`;
  }
  return `Created and ${closedWord.toLowerCase()} roughly even across ${series.length} weeks.`;
}

/** Inclusive ISO date + N calendar days → YYYY-MM-DD (UTC). */
function addDaysIso(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Week-bounded status transition JQL (Nutanix changelog).
 * Prefer after/before (exclusive end) — same pattern as retroService / more
 * reliable than `during` with some filter-scoped queries.
 */
function statusChangedDuring(base, statusName, fromIso, toIsoInclusive) {
  const before = addDaysIso(toIsoInclusive, 1);
  return andJql(
    base,
    `status changed to "${statusName}" after "${fromIso}" before "${before}"`
  );
}

/** → Resolved: resolution was set in range (dev sign-off / TBV entry). */
function resolvedInRange(base, fromIso, toIsoInclusive) {
  return andJql(base, `resolved >= "${fromIso}"`, `resolved <= "${toIsoInclusive}"`);
}

/**
 * Build pulse analytics for a KPI filter.
 *
 * @param {object} opts
 * @param {string} opts.token — JIRA PAT
 * @param {string} opts.baseJql — page KPI base query (unmodified)
 * @param {{ start?: string, end?: string }} [opts.window] — override ISO dates
 * @param {number} [opts.quarterCount=2]
 * @param {number} [opts.agedOpenDays=14]
 * @param {number} [opts.sampleCap=40] — changelog sample for status dwell
 * @param {number} [opts.maxIssueFetch=500]
 * @param {string} [opts.openStatusJql]
 * @param {{ p0?: boolean, p1?: boolean, tbv?: boolean }} [opts.optionalHeroes]
 * @param {{ summary?: string|null, generatedAt?: string|null, citations?: string[] }} [opts.productImpact]
 */
async function buildPulse(opts = {}) {
  const token = opts.token;
  if (!token) throw new Error('token is required for buildPulse');

  const base = wrapBase(opts.baseJql);
  const quarterCount = opts.quarterCount == null ? 2 : opts.quarterCount;
  const win =
    opts.window?.start && opts.window?.end
      ? {
          start: opts.window.start,
          end: opts.window.end,
          label: opts.window.label || `${opts.window.start} → ${opts.window.end}`,
          quarters: opts.window.quarters || [],
        }
      : lastNQuartersWindow(quarterCount);
  const { start, end } = win;
  const agedOpenDays = opts.agedOpenDays || DEFAULT_AGED_DAYS;
  const openStatusJql = opts.openStatusJql || DEFAULT_OPEN_JQL;
  const sampleCap = opts.sampleCap || DEFAULT_SAMPLE_CAP;
  const maxFetch = opts.maxIssueFetch || DEFAULT_ISSUE_FETCH;
  const optional = opts.optionalHeroes || {};

  const openJql = andJql(base, openStatusJql);
  const createdWindowJql = andJql(base, `created >= "${start}"`, `created <= "${end}"`);
  const resolvedWindowJql = andJql(base, `resolved >= "${start}"`, `resolved <= "${end}"`);
  const agedOpenJql = andJql(openJql, `created <= -${agedOpenDays}d`);

  const countQueries = {
    openNow: openJql,
    createdWindow: createdWindowJql,
    resolvedWindow: resolvedWindowJql,
    agedOpen: agedOpenJql,
  };
  if (optional.p0) countQueries.p0Open = andJql(openJql, 'priority = "Blocker - P0"');
  if (optional.p1) countQueries.p1Open = andJql(openJql, 'priority = "Critical - P1"');
  if (optional.tbv) {
    countQueries.tbv = andJql(base, 'status = Resolved', 'resolution is not EMPTY');
  }

  const buckets = weekBucketsInRange(start, end);
  for (const b of buckets) {
    const keyC = `c_${b.weekStart}`;
    const keyR = `r_${b.weekStart}`; // hero / MTTR: resolutiondate in week
    const keyToRes = `toRes_${b.weekStart}`;
    const keyClosed = `closed_${b.weekStart}`;
    countQueries[keyC] = andJql(base, `created >= "${b.weekStart}"`, `created <= "${b.weekEnd}"`);
    countQueries[keyR] = resolvedInRange(base, b.weekStart, b.weekEnd);
    // Chart trilogy (changelog — resolutiondate undercounts Closed weeks):
    //   Created     — created in week
    //   → Resolved  — status changed to Resolved in week (dev → TBV)
    //   → Closed    — status changed to Closed in week (QA sign-off)
    countQueries[keyToRes] = statusChangedDuring(base, 'Resolved', b.weekStart, b.weekEnd);
    countQueries[keyClosed] = statusChangedDuring(base, 'Closed', b.weekStart, b.weekEnd);
  }

  const { results: counts, errors } = await runCounts(token, countQueries);

  // If transition queries all failed, retry once with unquoted status names
  // (some Nutanix filters reject quoted status names in changed-clauses).
  const transitionKeys = buckets.flatMap((b) => [
    `toRes_${b.weekStart}`,
    `closed_${b.weekStart}`,
  ]);
  const allTransitionErrored =
    transitionKeys.length > 0 && transitionKeys.every((k) => errors[k]);
  if (allTransitionErrored) {
    const retry = {};
    for (const b of buckets) {
      const before = addDaysIso(b.weekEnd, 1);
      retry[`toRes_${b.weekStart}`] = andJql(
        base,
        `status changed to Resolved after "${b.weekStart}" before "${before}"`
      );
      retry[`closed_${b.weekStart}`] = andJql(
        base,
        `status changed to Closed after "${b.weekStart}" before "${before}"`
      );
    }
    const { results: retryCounts, errors: retryErrors } = await runCounts(token, retry);
    for (const k of Object.keys(retryCounts)) {
      counts[k] = retryCounts[k];
      countQueries[k] = retry[k];
      delete errors[k];
      if (retryErrors[k]) errors[k] = retryErrors[k];
    }
  }

  // OnCall / filter scopes often return 0 for `status changed to …` while
  // resolutiondate still has the Done signal (hero Resolved tile). When every
  // transition week is empty but resolutiondate is not, drive →Closed bars from
  // resolutiondate so the chart matches the hero.
  let transitionSum = 0;
  let resolutionSum = 0;
  for (const b of buckets) {
    transitionSum +=
      (counts[`toRes_${b.weekStart}`] || 0) + (counts[`closed_${b.weekStart}`] || 0);
    resolutionSum += counts[`r_${b.weekStart}`] || 0;
  }
  const outflowMode =
    transitionSum === 0 && resolutionSum > 0 ? 'resolutiondate' : 'transitions';

  // Point-in-time = weekly bucket. Cumulative = running sum of those buckets
  // (display) + range JQL from window start → weekEnd (click-through).
  let runCreated = 0;
  let runResolved = 0;
  let runToResolved = 0;
  let runClosed = 0;
  const series = buckets.map((b) => {
    const c = counts[`c_${b.weekStart}`] || 0;
    const r = counts[`r_${b.weekStart}`] || 0;
    let toRes = counts[`toRes_${b.weekStart}`] || 0;
    let closedN = counts[`closed_${b.weekStart}`] || 0;
    let toResJql = countQueries[`toRes_${b.weekStart}`];
    let closedJql = countQueries[`closed_${b.weekStart}`];
    if (outflowMode === 'resolutiondate') {
      // →Resolved stays 0 (no TBV transition). →Closed = Done by resolutiondate.
      toRes = 0;
      closedN = r;
      closedJql = countQueries[`r_${b.weekStart}`];
    }
    runCreated += c;
    runResolved += r;
    runToResolved += toRes;
    runClosed += closedN;
    return {
      weekStart: b.weekStart,
      weekEnd: b.weekEnd,
      created: cell(c, countQueries[`c_${b.weekStart}`]),
      resolved: cell(r, countQueries[`r_${b.weekStart}`]),
      toResolved: cell(toRes, toResJql),
      closed: cell(closedN, closedJql),
      createdCumulative: cell(
        runCreated,
        andJql(base, `created >= "${start}"`, `created <= "${b.weekEnd}"`)
      ),
      resolvedCumulative: cell(
        runResolved,
        resolvedInRange(base, start, b.weekEnd)
      ),
      toResolvedCumulative: cell(
        runToResolved,
        statusChangedDuring(base, 'Resolved', start, b.weekEnd)
      ),
      closedCumulative: cell(
        runClosed,
        outflowMode === 'resolutiondate'
          ? resolvedInRange(base, start, b.weekEnd)
          : statusChangedDuring(base, 'Closed', start, b.weekEnd)
      ),
    };
  });

  // MTTR sample: fetch resolved-in-window issues (created + resolutiondate)
  let mttrDays = [];
  let resolvedIssues = [];
  let mttrTruncated = false;
  try {
    resolvedIssues = await searchPages(
      token,
      `${resolvedWindowJql} ORDER BY resolved DESC`,
      'summary,status,created,resolutiondate,priority,issuetype',
      { pageSize: 100, maxTotal: maxFetch, timeoutMs: 45000, delayMs: 200 }
    );
    const resolvedTotal = counts.resolvedWindow || 0;
    mttrTruncated = resolvedTotal > resolvedIssues.length;
    for (const issue of resolvedIssues) {
      const f = issue.fields || issue;
      const days = daysBetween(f.created, f.resolutiondate);
      if (days != null) mttrDays.push(days);
    }
  } catch (err) {
    errors.mttrFetch = err.message || String(err);
    logger.jira.warning('kpiPulse', `MTTR fetch failed: ${err.message}`);
  }

  const sortedMttr = [...mttrDays].sort((a, b) => a - b);
  const mttrMedian = median(mttrDays);
  const mttrP90 = percentile(sortedMttr, 90);

  // Status dwell: changelog sample — exclude terminal statuses (post-close parking time)
  const sampleKeys = resolvedIssues
    .slice(0, sampleCap)
    .map((i) => i.key)
    .filter(Boolean);
  const dwellTotals = {};
  let dwellSamplesOk = 0;
  await Promise.all(
    sampleKeys.map(async (key) => {
      try {
        const bundle = await fetchTicketNarrativeBundle(key, token, {});
        const by = bundle?.dwell?.dwellByStatus || {};
        let any = false;
        for (const [status, days] of Object.entries(by)) {
          if (isTerminalStatus(status)) continue;
          if (typeof days !== 'number') continue;
          if (!dwellTotals[status]) dwellTotals[status] = [];
          dwellTotals[status].push(days);
          any = true;
        }
        if (any) dwellSamplesOk += 1;
      } catch (err) {
        errors[`dwell_${key}`] = err.message || String(err);
      }
    })
  );

  const statusDwell = Object.entries(dwellTotals)
    .map(([status, arr]) => ({
      status,
      medianDays: median(arr),
      sampleSize: arr.length,
      jql: null, // median days ≠ current status= population
    }))
    .filter((r) => r.medianDays != null)
    .sort((a, b) => (b.medianDays || 0) - (a.medianDays || 0));

  const topDwell = statusDwell[0] || null;
  const createdN = counts.createdWindow || 0;
  const resolvedN = counts.resolvedWindow || 0;
  const net = resolvedN - createdN;
  const netLabel = net > 0 ? `+${net}` : String(net);
  const openNowN = counts.openNow || 0;
  const agedN = counts.agedOpen || 0;

  const heroes = {
    openNow: cell(openNowN, openJql),
    createdWindow: cell(createdN, createdWindowJql),
    resolvedWindow: cell(resolvedN, resolvedWindowJql),
    // Derived delta — not clickable (number ≠ a single JQL result set)
    netBurn: {
      count: net,
      createdCount: createdN,
      resolvedCount: resolvedN,
      jql: null,
      label: netLabel,
    },
    mttrMedian: {
      count: mttrMedian,
      unit: 'days',
      jql: resolvedWindowJql, // sample provenance (resolved in window)
      sampleSize: mttrDays.length,
      truncated: mttrTruncated,
    },
    mttrP90: {
      count: mttrP90,
      unit: 'days',
      jql: resolvedWindowJql,
      sampleSize: mttrDays.length,
      truncated: mttrTruncated,
    },
    agedOpen: cell(agedN, agedOpenJql),
    topDwellStatus: topDwell
      ? {
          status: topDwell.status,
          count: topDwell.medianDays,
          unit: 'days',
          sampleSize: topDwell.sampleSize,
          jql: null, // median dwell ≠ current status filter
        }
      : { status: null, count: null, unit: 'days', sampleSize: 0, jql: null },
  };
  if (optional.p0) heroes.p0Open = cell(counts.p0Open, countQueries.p0Open);
  if (optional.p1) heroes.p1Open = cell(counts.p1Open, countQueries.p1Open);
  if (optional.tbv) heroes.tbv = cell(counts.tbv, countQueries.tbv);

  const story = buildStory({
    net,
    createdN,
    resolvedN,
    mttrMedian,
    agedOpen: agedN,
    agedOpenDays,
    topDwell,
    openNow: openNowN,
  });

  const productImpact = opts.productImpact || {
    summary: null,
    generatedAt: null,
    citations: [],
  };

  return {
    window: {
      start,
      end,
      label: win.label,
      quarters: (win.quarters || []).map((q) => q.label || `${q.quarter}`),
      quarterDetails: win.quarters || [],
    },
    story,
    seriesCaption: seriesCaption(series, { outflowMode }),
    seriesOutflowMode: outflowMode,
    heroes,
    series,
    mttr: {
      medianDays: mttrMedian,
      p90Days: mttrP90,
      sampleSize: mttrDays.length,
      truncated: mttrTruncated,
      jql: resolvedWindowJql,
    },
    statusDwell,
    productImpact: {
      summary: productImpact.summary ?? null,
      generatedAt: productImpact.generatedAt ?? null,
      citations: Array.isArray(productImpact.citations) ? productImpact.citations : [],
    },
    asOf: new Date().toISOString(),
    baseJql: String(opts.baseJql).trim(),
    agedOpenDays,
    dwellSampleSize: dwellSamplesOk,
    errors: Object.keys(errors).length ? errors : undefined,
  };
}

module.exports = {
  buildPulse,
  wrapBase,
  andJql,
  cell,
  median,
  percentile,
  statusChangedDuring,
  seriesCaption,
};
