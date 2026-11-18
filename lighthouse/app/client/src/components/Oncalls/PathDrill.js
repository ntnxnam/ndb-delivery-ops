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

function OnCallCell({ oc, past, blurb, jiraBase, loading }) {
  const status = blurb?.status || oc.status || '—';
  return (
    <div className="oc-drill-kpi-row">
      <div className="oc-drill-oncall-line">
        <a href={ticketHref(jiraBase, oc.key)} target="_blank" rel="noopener noreferrer">
          {oc.key}
        </a>
        <span className="oc-badge oc-badge-oncall-status" title="OnCall status">
          {status}
        </span>
        <span className="oc-muted">
          · {oc.assignee || 'Unassigned'}
          {past
            ? oc.cycleDays != null
              ? ` · ${oc.cycleDays}d cycle`
              : ''
            : oc.ageDays != null
              ? ` · ${oc.ageDays}d open`
              : ''}
        </span>
      </div>
      <AboutLine
        about={blurb?.about}
        pathHint={blurb?.pathHint}
        loading={loading && !blurb?.about && !blurb?.pathHint}
      />
    </div>
  );
}

function linkedList(row, field, keysField) {
  const objs = row[field];
  if (Array.isArray(objs) && objs.length && typeof objs[0] === 'object') return objs;
  return (row[keysField] || []).map((key) => ({ key, status: '—', summary: '' }));
}

function hasLinks(row, field, keysField) {
  return linkedList(row, field, keysField).length > 0;
}

/**
 * OnCall-primary rows for linked path modes (mirrors EscalationDrill).
 * Never group many OnCalls under one eng/TH ticket — that falsely reads as
 * "ERA-X is blocking these OnCalls". Each row = one OnCall → its linked ticket(s).
 */
function linkedOncallRows(tickets, field, keysField, { past } = {}) {
  return [...(tickets || [])]
    .filter((oc) => hasLinks(oc, field, keysField))
    .map((oc) => ({
      key: oc.key,
      summary: oc.summary,
      assignee: oc.assignee,
      ageDays: oc.ageDays,
      cycleDays: oc.cycleDays,
      priority: oc.priority,
      status: oc.status,
      linked: linkedList(oc, field, keysField),
    }))
    .sort((a, b) => {
      const da = past ? a.cycleDays ?? a.ageDays ?? 0 : a.ageDays ?? 0;
      const db = past ? b.cycleDays ?? b.ageDays ?? 0 : b.ageDays ?? 0;
      return db - da;
    });
}

const LINKED_MODES = {
  withTechHelp: {
    title: 'TechHelp linked',
    linkedNoun: 'TechHelp',
    field: 'techHelp',
    keysField: 'techHelpKeys',
    jiraProof: 'Open matching OnCalls in JIRA ↗',
  },
  withEng: {
    title: 'Eng / docs linked',
    linkedNoun: 'eng/docs',
    field: 'engFixes',
    keysField: 'engFixKeys',
    jiraProof: 'Open matching OnCalls in JIRA ↗',
  },
  withTechPubs: {
    title: 'TechPubs linked',
    linkedNoun: 'TechPubs',
    field: 'techPubs',
    keysField: 'techPubsKeys',
    jiraProof: 'Open matching OnCalls in JIRA ↗',
  },
};

function buildSeedModes(agedDays = 14) {
  const isP0 = (p) => /blocker|\bp0\b/i.test(String(p || ''));
  const isP1 = (p) => /critical|\bp1\b/i.test(String(p || ''));
  return {
    open: {
      title: 'Open OnCalls',
      match: () => true,
      lead: (n) => `${n} open customer OnCall(s) waiting now.`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
      appendGap: false,
    },
    agedOpen: {
      title: 'Aged open',
      match: (r) => (r.ageDays ?? 0) >= agedDays,
      lead: (n) => `${n} OnCall(s) open ≥${agedDays} days.`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
      appendGap: false,
    },
    p0Open: {
      title: 'P0 open',
      match: (r) => isP0(r.priority),
      lead: (n) => `${n} Blocker (P0) OnCall(s) still open.`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
      appendGap: false,
    },
    p1Open: {
      title: 'P1 open',
      match: (r) => isP1(r.priority),
      lead: (n) => `${n} Critical (P1) OnCall(s) still open.`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
      appendGap: false,
    },
    withoutTechHelp: {
      title: 'Need TechHelp',
      match: (r) => !hasLinks(r, 'techHelp', 'techHelpKeys'),
      lead: (n, past) =>
        `${n} OnCall(s) with no TechHelp link${past ? ' when closed' : ' — chase a workaround path'}.`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
    },
    withoutEng: {
      title: 'Need eng / docs',
      // Partial path only: has TechHelp, still missing eng/docs (disjoint from Chase).
      match: (r) =>
        hasLinks(r, 'techHelp', 'techHelpKeys') && !hasLinks(r, 'engFixes', 'engFixKeys'),
      lead: (n, past) =>
        `${n} OnCall(s) with TechHelp but no eng/docs${past ? ' when closed' : ' — workaround exists; still need a fix owner'}.`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
    },
    withoutRemediation: {
      title: 'Chase — no path',
      match: (r) =>
        !hasLinks(r, 'techHelp', 'techHelpKeys') && !hasLinks(r, 'engFixes', 'engFixKeys'),
      lead: (n, past) =>
        `${n} OnCall(s) with neither TechHelp nor eng/docs${past ? ' when closed' : ' — uncovered customer waits'}.`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
    },
  };
}

/**
 * Right-side path drill (Sprint Performance #drill UX).
 * Linked modes: one row per OnCall → its linked TH/eng/TechPubs ticket(s).
 * Gap modes: OnCall seeds with no path.
 */
export default function PathDrill({
  mode,
  tickets,
  jiraBase,
  jql,
  cellCount,
  scope = 'open',
  gapLabel = 'yet',
  agedDays = 14,
  teamId,
  seedStacks,
  onClose,
}) {
  const closeRef = useRef(null);
  const past = scope === 'past';
  const linkedSpec = LINKED_MODES[mode];
  const seedModes = useMemo(() => buildSeedModes(agedDays), [agedDays]);
  const seedSpec = seedModes[mode];

  const linkedRows = useMemo(() => {
    if (!linkedSpec) return [];
    return linkedOncallRows(tickets, linkedSpec.field, linkedSpec.keysField, { past });
  }, [tickets, linkedSpec, past]);

  const seedRows = useMemo(() => {
    if (!seedSpec) return [];
    return [...(tickets || []).filter(seedSpec.match)].sort((a, b) => {
      const da = past ? a.cycleDays ?? a.ageDays ?? 0 : a.ageDays ?? 0;
      const db = past ? b.cycleDays ?? b.ageDays ?? 0 : b.ageDays ?? 0;
      return db - da;
    });
  }, [tickets, seedSpec, past]);

  const isLinked = Boolean(linkedSpec);
  const rows = isLinked ? linkedRows : seedRows;
  const total = cellCount != null ? cellCount : rows.length;
  const truncated = cellCount != null && rows.length < cellCount;
  const proofLabel = (linkedSpec || seedSpec)?.jiraProof || 'Open in JIRA ↗';

  const oncallKeys = useMemo(() => {
    if (isLinked) return linkedRows.map((r) => r.key);
    return seedRows.map((r) => r.key);
  }, [isLinked, linkedRows, seedRows]);

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

  if (!mode || (!linkedSpec && !seedSpec)) return null;

  const jiraUrl = jiraHref(jiraBase, jql);
  const title = seedSpec
    ? seedSpec.appendGap === false
      ? seedSpec.title
      : `${seedSpec.title} ${gapLabel}`.replace(/\s+/g, ' ').trim()
    : linkedSpec.title;

  let lead;
  if (linkedSpec) {
    const uniqueLinked = new Set(linkedRows.flatMap((r) => r.linked.map((l) => l.key))).size;
    lead = `${total} ${past ? 'closed' : 'open'} OnCall(s) with ${linkedSpec.linkedNoun} linked (${uniqueLinked} unique ${linkedSpec.linkedNoun} in this sample). Each row is one OnCall → its linked ticket(s).`;
  } else {
    lead = seedSpec.lead(rows.length, past);
  }

  return (
    <div
      className="oc-drill-overlay open"
      role="dialog"
      aria-modal="true"
      aria-labelledby="oc-path-drill-title"
      aria-describedby="oc-path-drill-lead"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="oc-drill-panel">
        <div className="oc-drill-head">
          <div>
            <h3 id="oc-path-drill-title">
              {title} · {total}
            </h3>
            <p id="oc-path-drill-lead" className="oc-story oc-story-tight oc-drill-lead">
              {lead}
            </p>
          </div>
          <button type="button" className="oc-btn" ref={closeRef} onClick={onClose} aria-label="Close path drill">
            Close ✕
          </button>
        </div>

        <p className="oc-drill-stats">
          {truncated ? (
            <span className="oc-muted">
              Showing {rows.length} of {total} in-panel ·{' '}
            </span>
          ) : null}
          {blurbsLoading ? <span className="oc-muted">Loading OnCall context… · </span> : null}
          {jiraUrl ? (
            <a href={jiraUrl} target="_blank" rel="noopener noreferrer">
              {proofLabel}
            </a>
          ) : null}
        </p>
        <AboutInferenceBanner keys={oncallKeys} blurbs={blurbs} loading={blurbsLoading} />

        {rows.length === 0 ? (
          <p className="oc-muted">No tickets in this path bucket for the current sample.</p>
        ) : isLinked ? (
          <div className="oc-table-wrap oc-drill-table-wrap">
            <table className="oc-table">
              <thead>
                <tr>
                  <th>OnCall · status · about</th>
                  <th>Linked {linkedSpec.linkedNoun}</th>
                  <th>OnCall comments</th>
                </tr>
              </thead>
              <tbody>
                {linkedRows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <OnCallCell
                        oc={r}
                        past={past}
                        blurb={blurbs[r.key]}
                        jiraBase={jiraBase}
                        loading={
                          blurbsLoading && !blurbs[r.key]?.about && !blurbs[r.key]?.pathHint
                        }
                      />
                    </td>
                    <td>
                      {r.linked.map((l) => (
                        <div key={l.key} className="oc-drill-kpi-row">
                          <a href={ticketHref(jiraBase, l.key)} target="_blank" rel="noopener noreferrer">
                            {l.key}
                          </a>
                          <span className="oc-muted"> · {l.status || '—'}</span>
                          {l.summary ? <div className="oc-muted">{l.summary}</div> : null}
                        </div>
                      ))}
                    </td>
                    <td>
                      <CommentsCell
                        comments={blurbs[r.key]?.comments}
                        loading={blurbsLoading}
                        error={blurbsError}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="oc-table-wrap oc-drill-table-wrap">
            <table className="oc-table">
              <thead>
                <tr>
                  <th>OnCall (customer)</th>
                  <th>Owner</th>
                  <th>{past ? 'Cycle' : 'Age'}</th>
                  <th>Status</th>
                  <th>About</th>
                  <th>Comments</th>
                </tr>
              </thead>
              <tbody>
                {seedRows.map((r) => (
                  <tr key={r.key}>
                    <td>
                      <a href={ticketHref(jiraBase, r.key)} target="_blank" rel="noopener noreferrer">
                        {r.key}
                      </a>
                      <div className="oc-muted">{r.summary}</div>
                      <span className="oc-badge">{r.priority || '—'}</span>
                    </td>
                    <td>{r.assignee || '—'}</td>
                    <td>
                      {past
                        ? r.cycleDays != null
                          ? `${r.cycleDays}d`
                          : '—'
                        : r.ageDays != null
                          ? `${r.ageDays}d`
                          : '—'}
                    </td>
                    <td>
                      <span className="oc-badge oc-badge-oncall-status">
                        {blurbs[r.key]?.status || r.status || '—'}
                      </span>
                    </td>
                    <td>
                      <AboutLine
                        about={blurbs[r.key]?.about}
                        pathHint={blurbs[r.key]?.pathHint}
                        loading={
                          blurbsLoading && !blurbs[r.key]?.about && !blurbs[r.key]?.pathHint
                        }
                      />
                    </td>
                    <td>
                      <CommentsCell
                        comments={blurbs[r.key]?.comments}
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
