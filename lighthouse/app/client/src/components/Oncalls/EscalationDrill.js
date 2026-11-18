import React, { useEffect, useMemo, useRef } from 'react';
import { AboutInferenceBanner, AboutLine, jiraHref, ticketHref } from './OncallsParts';
import { useOncallBlurbs } from '../../hooks/useOncallBlurbs';

function CommentsCell({ comments, loading, error }) {
  if (!Array.isArray(comments)) {
    if (loading) return <span className="oc-muted">Loading comments…</span>;
    if (error) return <span className="oc-error">Comments unavailable</span>;
    return <span className="oc-muted">Loading comments…</span>;
  }
  if (!comments.length) {
    return <span className="oc-muted">No recent comments</span>;
  }
  return (
    <div className="oc-drill-comments">
      {comments.map((c, i) => (
        <div key={`${c.author}-${c.created || i}`} className="oc-drill-comment">
          <div className="oc-drill-comment-meta">
            {c.author || 'Unknown'}
            {c.ageDays != null ? ` · ${c.ageDays}d ago` : ''}
          </div>
          <div className="oc-drill-comment-body">{c.body || '—'}</div>
        </div>
      ))}
    </div>
  );
}

const FILTERS = {
  stillOpen: {
    title: 'Customer wait — KPI still open',
    match: (r) => r.stillOpen,
  },
  resolved: {
    title: 'Field tickets done',
    match: (r) => !r.stillOpen,
  },
  withEscalation: {
    title: 'Reached escalation KPI',
    match: () => true,
  },
};

/**
 * Cost ladder for field escalations (lower = more expensive).
 * Top CFD > Top CFI > Non-Top CFD > Non-Top CFI > other.
 * Names come from config; ranking is pattern-based only.
 */
function kpiCostRank(kpiName) {
  const n = String(kpiName || '').toLowerCase();
  const isTop = /\btop\b/.test(n) && !/\bnon[- ]?top\b/.test(n);
  const isCfd = /\bcfd\b/.test(n);
  const isCfi = /\bcfi\b/.test(n);
  if (isTop && isCfd) return 0;
  if (isTop && isCfi) return 1;
  if (!isTop && isCfd) return 2;
  if (!isTop && isCfi) return 3;
  return 4;
}

function kpiBadgeClass(kpiName) {
  const rank = kpiCostRank(kpiName);
  if (rank === 0) return 'oc-badge oc-badge-kpi-top-cfd';
  if (rank === 1) return 'oc-badge oc-badge-kpi-top-cfi';
  if (rank <= 3) return 'oc-badge oc-badge-kpi-nontop';
  return 'oc-badge';
}

/**
 * Expand OnCall rows → one pair per linked KPI ticket × KPI name.
 * Leader skim: KPI badge → field ticket → which OnCall seeded it.
 */
function buildPairs(oncallRows) {
  const pairs = [];
  for (const r of oncallRows || []) {
    for (const link of r.linked || []) {
      const names = link.kpiNames?.length ? link.kpiNames : r.kpiNames || ['KPI'];
      for (const kpiName of names) {
        pairs.push({
          id: `${r.oncallKey}:${link.key}:${kpiName}`,
          kpiName,
          costRank: kpiCostRank(kpiName),
          kpiKey: link.key,
          kpiSummary: link.summary || '',
          kpiStatus: link.status || '—',
          stillOpen: Boolean(link.stillOpen),
          daysOpenSoFar: link.daysOpenSoFar ?? r.daysOpenSoFar,
          daysToResolve: link.daysToResolve ?? r.daysToResolve,
          oncallKey: r.oncallKey,
          oncallStatus: r.oncallStatus,
          oncallAssignee: r.oncallAssignee,
          oncallSummary: r.oncallSummary,
        });
      }
    }
  }
  return pairs;
}

function sortPairs(pairs, mode) {
  return [...pairs].sort((a, b) => {
    if (a.costRank !== b.costRank) return a.costRank - b.costRank;
    if (mode === 'stillOpen') {
      return (b.daysOpenSoFar ?? 0) - (a.daysOpenSoFar ?? 0);
    }
    if (mode === 'resolved') {
      return (b.daysToResolve ?? 0) - (a.daysToResolve ?? 0);
    }
    if (a.stillOpen !== b.stillOpen) return a.stillOpen ? -1 : 1;
    return (b.daysOpenSoFar ?? b.daysToResolve ?? 0) - (a.daysOpenSoFar ?? a.daysToResolve ?? 0);
  });
}

function chaseLead(mode, pairs, oncallCount, kpiNames) {
  const n = pairs.length;
  const names = kpiNames?.length ? kpiNames.join(', ') : 'CFD/CFI';
  if (!n) return `No field escalations into ${names} in this window.`;
  const openN = pairs.filter((p) => p.stillOpen).length;
  if (mode === 'stillOpen') {
    const longest = pairs.reduce(
      (a, b) => ((a.daysOpenSoFar ?? 0) >= (b.daysOpenSoFar ?? 0) ? a : b),
      pairs[0]
    );
    return `${n} open field ticket(s) from ${oncallCount} OnCall(s). Costliest first (Top CFD → Top CFI → …). Longest wait: ${longest.daysOpenSoFar ?? '—'}d (${longest.kpiName} ${longest.kpiKey} ← ${longest.oncallKey}).`;
  }
  if (mode === 'resolved') {
    return `${n} done field ticket(s) from ${oncallCount} OnCall(s). Sorted by cost, then days to clear.`;
  }
  return `${oncallCount} OnCall(s) reached ${names} → ${n} field ticket pair(s). ${openN} still open. Sorted most expensive first — OnCalls that become Top CFD are the costliest.`;
}

/**
 * Right-side drill: pair list (KPI badge · field ticket · linked OnCall).
 */
export default function EscalationDrill({
  mode,
  rows,
  jiraBase,
  jql,
  cellCount,
  kpiNames,
  teamId,
  seedStacks,
  onClose,
}) {
  const spec = FILTERS[mode] || FILTERS.stillOpen;
  const closeRef = useRef(null);

  const filteredOncalls = useMemo(() => {
    return (rows || []).filter(spec.match);
  }, [rows, spec]);

  const pairs = useMemo(
    () => sortPairs(buildPairs(filteredOncalls), mode),
    [filteredOncalls, mode]
  );

  const oncallCount = filteredOncalls.length;
  const total = cellCount != null ? cellCount : oncallCount;
  const truncated = oncallCount < total;

  const oncallKeys = useMemo(
    () => filteredOncalls.map((r) => r.oncallKey).filter(Boolean),
    [filteredOncalls]
  );
  const { blurbs, loading: blurbsLoading, error: blurbsError } = useOncallBlurbs({
    teamId,
    keys: oncallKeys,
    enabled: Boolean(mode && oncallKeys.length),
    seedStacks,
  });

  useEffect(() => {
    if (!mode) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [mode, onClose]);

  if (!mode) return null;

  const jiraUrl = jiraHref(jiraBase, jql);
  const lead = chaseLead(mode, pairs, oncallCount, kpiNames);

  return (
    <div
      className="oc-drill-overlay open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oc-drill-title"
      aria-describedby="oc-drill-lead"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="oc-drill-panel">
        <div className="oc-drill-head">
          <div>
            <h3 id="oc-drill-title">
              {spec.title} · {total} OnCall{total === 1 ? '' : 's'} · {pairs.length} pair
              {pairs.length === 1 ? '' : 's'}
            </h3>
            <p id="oc-drill-lead" className="oc-story oc-story-tight oc-drill-lead">
              {lead}
            </p>
          </div>
          <button type="button" className="oc-btn" ref={closeRef} onClick={onClose} aria-label="Close drill panel">
            Close ✕
          </button>
        </div>

        <p className="oc-drill-stats">
          {truncated ? (
            <span className="oc-muted">
              Showing {oncallCount} of {total} OnCalls in-panel ·{' '}
            </span>
          ) : null}
          {blurbsLoading ? <span className="oc-muted">Loading OnCall context… · </span> : null}
          {jiraUrl ? (
            <a href={jiraUrl} target="_blank" rel="noopener noreferrer">
              Open matching OnCalls in JIRA ↗
            </a>
          ) : null}
        </p>
        <AboutInferenceBanner keys={oncallKeys} blurbs={blurbs} loading={blurbsLoading} />

        {pairs.length === 0 ? (
          <p className="oc-muted">No field-escalation pairs in this bucket for the current window.</p>
        ) : (
          <div className="oc-table-wrap oc-drill-table-wrap">
            <table className="oc-table">
              <thead>
                <tr>
                  <th>KPI</th>
                  <th>Field ticket (CFD / CFI)</th>
                  <th>Linked from OnCall</th>
                  <th>Owner</th>
                  <th>Wait / resolve</th>
                  <th>OnCall comments</th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <span className={kpiBadgeClass(p.kpiName)} title={`Escalation KPI: ${p.kpiName}`}>
                        {p.kpiName}
                      </span>
                    </td>
                    <td>
                      <div className="oc-drill-oncall-line">
                        <a href={ticketHref(jiraBase, p.kpiKey)} target="_blank" rel="noopener noreferrer">
                          {p.kpiKey}
                        </a>
                        <span
                          className={`oc-badge ${p.stillOpen ? 'oc-badge-open' : 'oc-badge-done'}`}
                          title="JIRA workflow status"
                        >
                          {p.kpiStatus || '—'}
                        </span>
                      </div>
                      {p.kpiSummary ? <div className="oc-muted">{p.kpiSummary}</div> : null}
                    </td>
                    <td>
                      <div className="oc-drill-oncall-line">
                        <a href={ticketHref(jiraBase, p.oncallKey)} target="_blank" rel="noopener noreferrer">
                          {p.oncallKey}
                        </a>
                        <span className="oc-badge oc-badge-oncall-status" title="OnCall status">
                          {blurbs[p.oncallKey]?.status || p.oncallStatus || '—'}
                        </span>
                      </div>
                      <AboutLine
                        about={blurbs[p.oncallKey]?.about}
                        pathHint={blurbs[p.oncallKey]?.pathHint}
                        loading={blurbsLoading && !blurbs[p.oncallKey]?.about && !blurbs[p.oncallKey]?.pathHint}
                      />
                    </td>
                    <td>{p.oncallAssignee || '—'}</td>
                    <td>
                      {p.stillOpen
                        ? `${p.daysOpenSoFar ?? '—'}d waiting`
                        : `${p.daysToResolve ?? '—'}d to clear`}
                    </td>
                    <td>
                      <CommentsCell
                        comments={blurbs[p.oncallKey]?.comments}
                        loading={blurbsLoading}
                        error={blurbsError}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
