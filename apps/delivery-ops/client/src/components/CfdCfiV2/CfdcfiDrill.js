import React, { useEffect, useMemo, useRef } from 'react';
import { jiraHref, linkify, ticketHref } from '../Oncalls/OncallsParts';

const MODE_LABELS = {
  open: 'Open CFD/CFI',
  agedOpen: 'Aged open',
  p0Open: 'P0 open',
  p1Open: 'P1 open',
  tbv: 'Awaiting QA',
  closedInWindow: 'Closed in window',
  throughput: 'Throughput',
  mttr: 'MTTR sample',
  p90: 'Slow tail (p90)',
  boomerang: 'Deferred → CFD/CFI boomerang',
  'component:': 'Component',
  'fixVersion:': 'Fix Version',
  'cfdType:': 'Type',
};

function modeTitle(mode) {
  if (!mode) return 'Tickets';
  for (const [k, v] of Object.entries(MODE_LABELS)) {
    if (mode === k || mode.startsWith(k)) return v;
  }
  return mode;
}

function chipFilteredTickets(tickets, mode) {
  if (!mode || !tickets) return tickets || [];
  if (mode.startsWith('component:')) {
    const comp = mode.slice('component:'.length);
    return (tickets || []).filter((t) => (t.components || []).includes(comp));
  }
  if (mode.startsWith('fixVersion:')) {
    const fv = mode.slice('fixVersion:'.length);
    return (tickets || []).filter((t) => (t.fixVersions || []).includes(fv));
  }
  if (mode.startsWith('cfdType:')) {
    const type = mode.slice('cfdType:'.length);
    if (type === 'CFD') return (tickets || []).filter((t) => /bug/i.test(String(t.issueType || '')));
    if (type === 'CFI') return (tickets || []).filter((t) => /improv/i.test(String(t.issueType || '')));
  }
  if (mode === 'agedOpen') {
    // filtered by gapMeta not available — show all open, lead explains
    return tickets || [];
  }
  return tickets || [];
}

function isAgedOpen(t, agedDays) {
  return (t.ageDays ?? 0) >= (agedDays ?? 14);
}

export default function CfdcfiDrill({
  mode,
  tickets,
  jiraBase,
  jql,
  cellCount,
  agedDays = 14,
  gapMeta,
  timeframe,
  aiSlice,
  aiSliceState,
  aiSliceError,
  aiSliceView,
  onClose,
}) {
  const closeRef = useRef(null);

  const filtered = useMemo(() => chipFilteredTickets(tickets, mode), [tickets, mode]);
  const total = cellCount != null ? cellCount : filtered.length;
  const truncated = cellCount != null && filtered.length < cellCount;
  const jiraUrl = jiraHref(jiraBase, jql);
  const title = modeTitle(mode);
  const boomerangMode = mode === 'boomerang' || mode === 'boomerangKeys';

  // For boomerang, derive rows from gapMeta.boomerangKeys
  const boomerangKeys = useMemo(() => {
    if (!boomerangMode) return null;
    return new Set(gapMeta?.boomerangKeys || []);
  }, [boomerangMode, gapMeta]);

  const rows = useMemo(() => {
    if (!mode) return [];
    if (boomerangMode && boomerangKeys) {
      return (tickets || []).filter((t) => boomerangKeys.has(t.key));
    }
    return filtered;
  }, [mode, tickets, filtered, boomerangMode, boomerangKeys]);

  useEffect(() => {
    if (!mode) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prev;
      document.removeEventListener('keydown', onKey);
    };
  }, [mode, onClose]);

  if (!mode) return null;

  return (
    <div className="cf-drill-overlay open" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cf-drill-panel">
        <div className="cf-drill-head">
          <div>
            <h3>{title} · {total}</h3>
            {boomerangMode ? (
              <p className="cf-story">Deferred bugs that came back as customer-facing CFD/CFI — feedback on deferral decisions.</p>
            ) : mode === 'agedOpen' ? (
              <p className="cf-story">Open ≥{agedDays}d — needs owner chase.</p>
            ) : null}
            {aiSliceState === 'loading' && aiSliceView === mode && <p className="cf-muted" style={{ marginTop: 6 }}>Generating AI slice…</p>}
            {aiSliceState === 'error' && aiSliceView === mode && <p className="cf-error" style={{ marginTop: 6 }}>{aiSliceError}</p>}
            {aiSliceState === 'done' && aiSliceView === mode && aiSlice && (
              <div className="cf-slice-ai" style={{ marginTop: 8, padding: '8px 10px', background: '#f5f7ff', border: '1px solid var(--border)', borderRadius: 6, whiteSpace: 'pre-wrap', fontSize: 'var(--fs-small)' }}>
                {String(aiSlice).split('\n').map((line, idx) => <div key={idx}>{linkify(line, jiraBase)}</div>)}
              </div>
            )}
          </div>
          <button type="button" className="cf-btn" ref={closeRef} onClick={onClose} aria-label="Close drill">Close ✕</button>
        </div>

        <p className="cf-drill-stats">
          {truncated ? <span className="cf-muted">Showing {rows.length} of {total} in-panel · </span> : null}
          {jiraUrl ? <a href={jiraUrl} target="_blank" rel="noopener noreferrer">Open in JIRA ↗</a> : null}
        </p>

        {rows.length === 0 ? (
          <p className="cf-muted">No tickets in this bucket for the current sample.</p>
        ) : (
          <div className="cf-table-wrap cf-drill-table-wrap">
            <table className="cf-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Summary</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Assignee</th>
                  <th>Age</th>
                  <th>Components</th>
                  <th>Fix Versions</th>
                  <th>Test Escape</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={isAgedOpen(r, agedDays) ? { background: 'var(--surface-warning, #fffbeb)' } : undefined}>
                    <td><a href={ticketHref(jiraBase, r.key)} target="_blank" rel="noopener noreferrer">{r.key}</a></td>
                    <td className="cf-table-summary">{r.summary || '—'}</td>
                    <td>{r.status || '—'}</td>
                    <td>{r.priority || '—'}</td>
                    <td>{r.assignee || '—'}</td>
                    <td>{r.ageDays != null ? `${r.ageDays}d` : '—'}</td>
                    <td>{(r.components || []).join(', ') || '—'}</td>
                    <td>{(r.fixVersions || []).join(', ') || '—'}</td>
                    <td>{r.cfdcfiFields?.testEscape || r.cfdcfiFields?.rootCause?.slice(0, 60) || '—'}</td>
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
