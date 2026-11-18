import React, { useMemo } from 'react';
import { jiraSearchUrl } from '../services/retrospectiveService';
import { ComparisonTrendChart } from './ComparisonTrendChart';

/**
 * ReleaseComparisonTable — cross-release matrix for the retrospective.
 * Rows = metrics (core scorecard + PG bug/improvement verification +
 * one row per team KPI). Columns = compared releases (oldest -> newest).
 *
 * Every numeric cell links to JIRA via the raw JQL carried by each metric
 * (citation-first / jira-authenticity-links.mdc). Bundle-derived counts are
 * offline; KPI rows are live release-scoped counts. This is intentionally
 * dense (audience: tpm).
 */
function fmt(v, suffix = '') {
  if (v == null) return '—';
  return `${v}${suffix}`;
}

function Cell({ display, sub, jql, jiraBaseUrl, delta }) {
  const href = jql ? jiraSearchUrl(jiraBaseUrl, jql) : '';
  return (
    <td className="cmp-cell">
      <div className="cmp-cell-main">
        {href ? (
          <a href={href} target="_blank" rel="noreferrer">{display}</a>
        ) : (
          display
        )}
        {delta}
      </div>
      {sub ? <div className="cmp-cell-sub">{sub}</div> : null}
    </td>
  );
}

function Delta({ curr, prev, lowerIsBetter }) {
  if (typeof curr !== 'number' || typeof prev !== 'number') return null;
  const diff = Math.round((curr - prev) * 10) / 10;
  if (diff === 0) return <span className="cmp-delta cmp-delta--flat">▬</span>;
  const improved = lowerIsBetter ? diff < 0 : diff > 0;
  const cls = improved ? 'cmp-delta--up' : 'cmp-delta--down';
  const arrow = diff > 0 ? '▲' : '▼';
  return <span className={`cmp-delta ${cls}`}>{arrow}{Math.abs(diff)}</span>;
}

export function ReleaseComparisonTable({
  releases = [],
  scorecards = {},
  verifications = {},
  kpiByRelease = {},
  kpiDefs = [],
  jiraBaseUrl = '',
}) {
  // Build rows. Each row: { group, label, lowerIsBetter, cell(release)->{display,sub,jql,num} }
  const rows = useMemo(() => {
    const out = [];

    const push = (group, label, lowerIsBetter, cellFn) =>
      out.push({ group, label, lowerIsBetter, cellFn });

    // ── Core scorecard ──────────────────────────────────────────────
    push('Delivery', 'Task closure', false, (r) => {
      const s = scorecards[r]?.taskClosure;
      if (!s) return null;
      return { display: `${s.pct}%`, sub: `${s.done}/${s.total}`, jql: s.jql, num: s.pct };
    });
    push('Delivery', 'Bugs (total)', true, (r) => {
      const s = scorecards[r]?.bugs;
      if (!s) return null;
      return { display: `${s.total}`, sub: `${s.done} done / ${s.open} open`, jql: s.jql, num: s.total };
    });
    push('Delivery', 'P0 open', true, (r) => {
      const s = scorecards[r]?.p0;
      if (!s) return null;
      return { display: `${s.open}`, sub: `of ${s.total}`, jql: s.jql, num: s.open };
    });
    push('Delivery', 'P1 open', true, (r) => {
      const s = scorecards[r]?.p1;
      if (!s) return null;
      return { display: `${s.open}`, sub: `of ${s.total}`, jql: s.jql, num: s.open };
    });
    push('Delivery', 'Reopen rate', true, (r) => {
      const s = scorecards[r]?.reopen;
      if (!s) return null;
      return { display: `${s.rate}%`, sub: `${s.reopened}/${s.qualityTickets}`, jql: s.jql, num: s.rate };
    });

    // ── PG bug / improvement verification ───────────────────────────
    const verRows = [
      ['bug', 'Bug'],
      ['improvement', 'Improvement'],
    ];
    for (const [key, label] of verRows) {
      push('PG Verification', `${label} unverified @ PG`, true, (r) => {
        const v = verifications[r]?.[key];
        if (!v) return null;
        return { display: fmt(v.unverifiedAtPg), sub: `${v.count} total`, jql: v.jqlUnverified, num: v.unverifiedAtPg };
      });
      push('PG Verification', `${label} verify lag (median d)`, true, (r) => {
        const v = verifications[r]?.[key];
        if (!v) return null;
        return { display: fmt(v.lag?.median, 'd'), sub: `p90 ${fmt(v.lag?.p90, 'd')}`, jql: v.jqlClosed, num: v.lag?.median };
      });
      push('PG Verification', `${label} reopen rate`, true, (r) => {
        const v = verifications[r]?.[key];
        if (!v) return null;
        return { display: `${v.reopenRate}%`, sub: `${v.reopened}/${v.count}`, jql: v.jqlClosed, num: v.reopenRate };
      });
    }

    // ── KPI categories (config-driven) ──────────────────────────────
    for (const kpi of kpiDefs) {
      push('KPI Categories', kpi.name, true, (r) => {
        const res = kpiByRelease[r]?.[kpi.id];
        if (!res || res.error) return null;
        return {
          display: `${res.total}`,
          sub: `${res.done} done / ${res.open} open`,
          jql: res.links?.total,
          num: res.total,
        };
      });
    }

    return out;
  }, [scorecards, verifications, kpiByRelease, kpiDefs]);

  if (!releases.length) return null;

  let lastGroup = null;

  return (
    <div className="cmp-table-wrap">
      <table className="cmp-table">
        <thead>
          <tr>
            <th className="cmp-metric-col">Metric</th>
            {releases.map((r) => (
              <th key={r}>{r}</th>
            ))}
            <th className="cmp-trend-col">Trend</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const cells = releases.map((r) => row.cellFn(r));
            const showGroup = row.group !== lastGroup;
            lastGroup = row.group;
            const points = releases.map((r, i) => ({ release: r, value: cells[i]?.num ?? null }));
            return (
              <React.Fragment key={`${row.group}-${row.label}`}>
                {showGroup ? (
                  <tr className="cmp-group-row">
                    <td colSpan={releases.length + 2}>{row.group}</td>
                  </tr>
                ) : null}
                <tr>
                  <td className="cmp-metric-col">{row.label}</td>
                  {cells.map((c, i) => {
                    if (!c) {
                      return <td key={releases[i]} className="cmp-cell cmp-cell--empty">—</td>;
                    }
                    const prevCell = i > 0 ? cells[i - 1] : null;
                    const delta =
                      prevCell && typeof c.num === 'number' && typeof prevCell.num === 'number' ? (
                        <Delta curr={c.num} prev={prevCell.num} lowerIsBetter={row.lowerIsBetter} />
                      ) : null;
                    return (
                      <Cell
                        key={releases[i]}
                        display={c.display}
                        sub={c.sub}
                        jql={c.jql}
                        jiraBaseUrl={jiraBaseUrl}
                        delta={delta}
                      />
                    );
                  })}
                  <td className="cmp-trend-col">
                    <ComparisonTrendChart points={points} lowerIsBetter={row.lowerIsBetter} />
                  </td>
                </tr>
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="cmp-caption">
        Source: release-dataset per-release bundles (offline) + live release-scoped KPI counts. Deltas compare each release to the one on its left. Green = improved, red = regressed.
      </div>
    </div>
  );
}
