import React, { useEffect, useMemo, useRef } from 'react';
import { AboutInferenceBanner, AboutLine, jiraHref, linkify, ticketHref } from './OncallsParts';
import { useOncallBlurbs } from '../../hooks/useOncallBlurbs';
import { useOncallSlice } from '../../hooks/useOncallSlice';

const MODE_TO_VIEW = {
  needInfo: 'Need Info',
  waiting: 'Waiting for Customer',
  closedInWindow: 'Closed in window',
  duds: 'Duds',
  ndbGaps: 'NDB gaps',
  otherTeamGaps: 'Other-team gaps',
  thLinked: 'TH linked',
  bugs: 'Bugs',
  improvements: 'Improvements',
  other: 'Other',
  throughput: 'Throughput',
  mttr: 'MTTR sample',
  open: 'Open OnCalls',
  agedOpen: 'Aged open',
  p0Open: 'P0 open',
  p1Open: 'P1 open',
};

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

function normStatus(s) {
  return String(s || '').trim().toLowerCase();
}

function buildSeedModes(agedDays = 14, gapMeta = null) {
  const isP0 = (p) => /blocker|\bp0\b/i.test(String(p || ''));
  const isP1 = (p) => /critical|\bp1\b/i.test(String(p || ''));
  // gapMeta sets for view-specific filtering — each drill gets its own intelligence packet
  const gapSets = gapMeta
    ? {
        duds: new Set(gapMeta.dudsKeys || []),
        ndbGaps: new Set(gapMeta.ndbGapsKeys || []),
        otherTeamGaps: new Set(gapMeta.otherTeamGapsKeys || []),
        thLinked: new Set(gapMeta.ndbSubKeys?.thLinked || []),
        bugs: new Set(gapMeta.ndbSubKeys?.bugs || []),
        improvements: new Set(gapMeta.ndbSubKeys?.improvements || []),
        other: new Set(gapMeta.ndbSubKeys?.other || []),
      }
    : null;
  const byGapSet = (setName) => (r) => {
    if (!gapSets) return true;
    const set = gapSets[setName];
    if (!set || set.size === 0) return false;
    return set.has(r.key);
  };
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
    // V2 workflow — view-specific status filtering (own intelligence packet per hero drill)
    needInfo: {
      title: 'Need Info',
      match: (r) => normStatus(r.status) === 'need info',
      lead: (n, past) => `${n} OnCall(s) in Need Info${past ? ' when closed' : ' — waiting for reporter details; chase info'} .`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
      appendGap: false,
    },
    waiting: {
      title: 'Waiting for Customer',
      match: (r) => normStatus(r.status) === 'waiting for customer',
      lead: (n, past) => `${n} OnCall(s) in Waiting for Customer${past ? ' when closed' : ' — customer action pending; nudge to close loop'}.`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
      appendGap: false,
    },
    closedInWindow: {
      title: 'Closed in window',
      match: () => true,
      lead: (n) => `${n} OnCall(s) closed in selected window.`,
      jiraProof: 'Open matching OnCalls in JIRA ↗',
      appendGap: false,
    },
    // V2 taxonomy — tickets filtered via gapMeta per view (own context window per hero drill)
    duds: { title: 'Duds — no fix', match: byGapSet('duds'), lead: (n) => `${n} dud(s) — duplicate / Won't Do / Cannot Reproduce / no linked fix.`, jiraProof: 'Open matching OnCalls in JIRA ↗', appendGap: false },
    ndbGaps: { title: 'NDB gaps', match: byGapSet('ndbGaps'), lead: (n) => `${n} NDB gap(s) — linked fix in NDB project family.`, jiraProof: 'Open matching OnCalls in JIRA ↗', appendGap: false },
    otherTeamGaps: { title: 'Other-team gaps', match: byGapSet('otherTeamGaps'), lead: (n) => `${n} other-team gap(s) — linked fix outside NDB; externalize.`, jiraProof: 'Open matching OnCalls in JIRA ↗', appendGap: false },
    thLinked: { title: 'TH linked (NDB)', match: byGapSet('thLinked'), lead: (n) => `${n} NDB gap(s) with TechHelp linked.`, jiraProof: 'Open matching OnCalls in JIRA ↗', appendGap: false },
    bugs: { title: 'Bugs (NDB)', match: byGapSet('bugs'), lead: (n) => `${n} NDB gap(s) linked to bug type.`, jiraProof: 'Open matching OnCalls in JIRA ↗', appendGap: false },
    improvements: { title: 'Improvements (NDB)', match: byGapSet('improvements'), lead: (n) => `${n} NDB gap(s) linked to improvement/story.`, jiraProof: 'Open matching OnCalls in JIRA ↗', appendGap: false },
    other: { title: 'Other NDB gaps', match: byGapSet('other'), lead: (n) => `${n} remaining NDB gap(s).`, jiraProof: 'Open matching OnCalls in JIRA ↗', appendGap: false },
    // Health heroes — resolved-in-window sample (past scope), JQL from pulse
    throughput: { title: 'Throughput', match: () => true, lead: (n) => `${n} OnCall(s) resolved in window — throughput sample.`, jiraProof: 'Open matching OnCalls in JIRA ↗', appendGap: false },
    mttr: { title: 'MTTR sample', match: () => true, lead: (n) => `${n} OnCall(s) in MTTR sample (resolved in window).`, jiraProof: 'Open matching OnCalls in JIRA ↗', appendGap: false },
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
  gapMeta = null,
  timeframe = null,
  aiSlice: aiSliceProp = null,
  aiSliceState: aiSliceStateProp = null,
  aiSliceError: aiSliceErrorProp = null,
  aiSliceView: aiSliceViewProp = null,
  onClose,
}) {
  const closeRef = useRef(null);
  const past = scope === 'past';
  const linkedSpec = LINKED_MODES[mode];
  const seedModes = useMemo(() => buildSeedModes(agedDays, gapMeta), [agedDays, gapMeta]);
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

  // AI slice — view-specific 2-liner per drill (each PathDrill mode = own intelligence packet)
  // Parent may manage via props (OncallsV2Page); otherwise hook fetches directly — minimal-arch: no fetch in component
  const viewLabel = MODE_TO_VIEW[mode] || mode || 'Need Info';
  const needsSlice = Boolean(mode && oncallKeys.length);
  const useHookSlice = aiSliceStateProp == null && aiSliceProp == null;
  const {
    slice: hookSlice,
    loading: hookSliceLoading,
    error: hookSliceError,
  } = useOncallSlice({
    teamId,
    view: viewLabel,
    keys: oncallKeys,
    timeframe: timeframe || '2Q',
    enabled: useHookSlice && needsSlice,
  });
  const effectiveSlice = aiSliceProp ?? hookSlice;
  const effectiveSliceState = aiSliceStateProp ?? (hookSliceLoading ? 'loading' : hookSliceError ? 'error' : hookSlice ? 'done' : 'idle');
  const effectiveSliceError = aiSliceErrorProp ?? hookSliceError;
  const effectiveSliceView = aiSliceViewProp ?? mode;

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
            {effectiveSliceState === 'loading' && effectiveSliceView === mode && (
              <p className="oc-muted" style={{ marginTop: 6 }}>
                Generating AI slice for {viewLabel}…
              </p>
            )}
            {effectiveSliceState === 'error' && effectiveSliceView === mode && (
              <p className="oc-error" style={{ marginTop: 6 }}>
                {effectiveSliceError}
              </p>
            )}
            {effectiveSliceState === 'done' && effectiveSliceView === mode && effectiveSlice && (
              <div
                className="oc-slice-ai"
                style={{
                  marginTop: 8,
                  padding: '8px 10px',
                  background: 'var(--surface-raised)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  whiteSpace: 'pre-wrap',
                  fontSize: 'var(--fs-small)',
                }}
              >
                <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--muted)', marginBottom: 4 }}>AI summary <span title="AI generated" aria-label="AI generated">✨</span></div>
                {String(effectiveSlice)
                  .split('\n')
                  .map((line, idx) => (
                    <div key={idx}>{linkify(line, jiraBase)}</div>
                  ))}
              </div>
            )}
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
                  <th scope="col">OnCall · status · about <span title="AI generated" aria-label="AI generated">✨</span></th>
                  <th scope="col">Linked {linkedSpec.linkedNoun}</th>
                  <th scope="col">OnCall comments</th>
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
                  <th scope="col">OnCall (customer)</th>
                  <th scope="col">Owner</th>
                  <th scope="col">{past ? 'Cycle' : 'Age'}</th>
                  <th scope="col">Status</th>
                  <th scope="col">About <span title="AI generated" aria-label="AI generated">✨</span></th>
                  <th scope="col">Comments</th>
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
