/**
 * SyncHubPage — user-facing data sync control panel.
 *
 * One action: fetch data from JIRA + rebuild bundle.
 * The user chooses which releases to force-refetch (blank = use cache for the rest).
 * No "Reset Bundle" / "Full Reset" / "Refresh from Disk" — these are
 * implementation details that should never be exposed to a TPM or RM.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTeamDataset } from '../hooks/useTeamDataset';
import { useTeam } from '../contexts/TeamContext';

// ─── helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusIcon(status) {
  switch (status) {
    case 'queued':    return '⏳';
    case 'cache_hit': return '💾';
    case 'fetching':  return '⬇️';
    case 'changelog': return '📋';
    case 'done':      return '✅';
    case 'error':     return '❌';
    default:          return '•';
  }
}

// ─── component ────────────────────────────────────────────────────────────────

export default function SyncHubPage() {
  const { selectedTeam } = useTeam();
  const {
    bundle,
    bundleMeta,
    isSyncing,
    syncProgress,
    syncError,
    triggerSync,
    isReady,
  } = useTeamDataset();

  const [forceInput, setForceInput] = useState('');
  const [forceAll, setForceAll] = useState(false);
  const [skipChangelog, setSkipChangelog] = useState(false);
  const [localLog, setLocalLog] = useState([]);
  const [syncErrors, setSyncErrors] = useState(null); // { release: [errorString, ...] }
  const [focusedReleases, setFocusedReleases] = useState(null); // set when force-refetching specific releases
  const logEndRef = useRef(null);

  // Auto-scroll progress log as new events arrive.
  useEffect(() => {
    if (syncProgress.length > 0 || localLog.length > 0) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [syncProgress, localLog]);

  const addLocalLog = (msg) =>
    setLocalLog((prev) => [...prev, { ts: new Date().toISOString(), msg }]);

  const handleSync = useCallback(async () => {
    const forceReleases = forceInput
      .split(',')
      .map((r) => r.trim())
      .filter(Boolean);

    // Track which releases are "in focus" so the log can hide cache-hit noise.
    setFocusedReleases(forceAll || forceReleases.length === 0 ? null : new Set(forceReleases));
    setSyncErrors(null);

    if (forceAll) {
      addLocalLog('▶ Force Full Re-Sync — ignoring all caches, re-fetching every release from JIRA…');
    } else if (forceReleases.length) {
      addLocalLog(`▶ Sync Now — force-refetching: ${forceReleases.join(', ')}`);
    } else {
      addLocalLog('▶ Sync Now — using cache where available, fetching any missing releases…');
    }

    await triggerSync({
      forceReleases,
      forceAll,
      skipChangelog,
      onProgress: (event) => {
        // Collect errors from the final 'done' event for the error rollup card.
        if (event.type === 'done' && event.errors && Object.keys(event.errors).length > 0) {
          setSyncErrors(event.errors);
        }
        // Also capture bucket-level errors streamed during fetching.
        if (event.status === 'error' && event.release && event.detail) {
          setSyncErrors((prev) => {
            const next = { ...(prev || {}) };
            if (!next[event.release]) next[event.release] = [];
            if (!next[event.release].includes(event.detail)) {
              next[event.release] = [...next[event.release], event.detail];
            }
            return next;
          });
        }
      },
    });
  }, [triggerSync, forceInput, forceAll, skipChangelog]);

  const productId = selectedTeam?.productId || 'ndb';

  return (
    <div className="sync-hub">
      <div className="sync-hub__header">
        <h1 className="sync-hub__title">Data Sync Hub</h1>
        <p className="sync-hub__subtitle">
          Centralised JIRA data cache for <strong>{selectedTeam?.name || productId.toUpperCase()}</strong>.
          Sync once; every page reads from the bundle — no repeated JIRA fetches.
        </p>
      </div>

      {/* ── Status card ──────────────────────────────────────────────────── */}
      <div className="sync-hub__status-card">
        <h2 className="sync-hub__section-title">Bundle Status</h2>
        {isReady ? (
          <div className="sync-hub__stats">
            <div className="sync-hub__stat">
              <span className="sync-hub__stat-label">Last synced</span>
              <span className="sync-hub__stat-value">{formatDate(bundleMeta?.lastSyncIso)}</span>
            </div>
            <div className="sync-hub__stat">
              <span className="sync-hub__stat-label">Tickets cached</span>
              <span className="sync-hub__stat-value sync-hub__stat-value--accent">
                {(bundleMeta?.numTickets ?? bundle?.length ?? 0).toLocaleString()}
              </span>
            </div>
            <div className="sync-hub__stat">
              <span className="sync-hub__stat-label">Releases</span>
              <span className="sync-hub__stat-value">{bundleMeta?.numReleases ?? '—'}</span>
            </div>
            <div className="sync-hub__stat">
              <span className="sync-hub__stat-label">Schema</span>
              <span className="sync-hub__stat-value sync-hub__stat-value--mono">
                {bundleMeta?.schemaVersion ?? '—'}
              </span>
            </div>
          </div>
        ) : (
          <div className="sync-hub__empty-state">
            <span className="sync-hub__empty-icon">📭</span>
            <p>No bundle cached yet. Run a sync below to fetch data from JIRA.</p>
          </div>
        )}

        {isReady && bundleMeta?.releases?.length > 0 && (
          <div className="sync-hub__releases">
            <span className="sync-hub__stat-label">Covered releases</span>
            <div className="sync-hub__release-tags">
              {bundleMeta.releases.map((r) => (
                <span key={r} className="sync-hub__release-tag">{r}</span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* ── Sync Controls — single action ────────────────────────────────── */}
      <div className="sync-hub__controls-card">
        <h2 className="sync-hub__section-title">Sync Controls</h2>

        <div className="sync-hub__control-row">
          <label className="sync-hub__label" htmlFor="force-releases">
            Force-refetch releases
            <span className="sync-hub__hint">
              Comma-separated, e.g. NDB-2.11, NDB-2.10 — leave blank to use cached data for all releases
            </span>
          </label>
          <input
            id="force-releases"
            className="sync-hub__input"
            type="text"
            placeholder="NDB-2.11, NDB-2.10 …"
            value={forceInput}
            onChange={(e) => setForceInput(e.target.value)}
            disabled={isSyncing || forceAll}
          />
        </div>

        <div className="sync-hub__control-row sync-hub__control-row--checkbox">
          <label className="sync-hub__checkbox-label sync-hub__checkbox-label--danger">
            <input
              type="checkbox"
              checked={forceAll}
              onChange={(e) => {
                setForceAll(e.target.checked);
                if (e.target.checked) setForceInput('');
              }}
              disabled={isSyncing}
            />
            Force full re-sync
            <span className="sync-hub__hint">
              ignores all per-release caches — re-fetches every release from JIRA.
              Use after a data-model change or when the local data feels stale.
            </span>
          </label>
        </div>

        <div className="sync-hub__control-row sync-hub__control-row--checkbox">
          <label className="sync-hub__checkbox-label">
            <input
              type="checkbox"
              checked={skipChangelog}
              onChange={(e) => setSkipChangelog(e.target.checked)}
              disabled={isSyncing}
            />
            Skip changelog enrichment
            <span className="sync-hub__hint">faster; skips Closed Date derivation for Bug/Improvement tickets</span>
          </label>
        </div>

        <div className="sync-hub__action-row">
          <button
            className="sync-hub__btn sync-hub__btn--primary"
            onClick={handleSync}
            disabled={isSyncing}
          >
            {isSyncing ? (
              <>
                <span className="sync-hub__btn-spinner" aria-hidden="true" />
                Syncing…
              </>
            ) : (
              '⟳  Sync Now'
            )}
          </button>
        </div>

        {syncError && (
          <div className="sync-hub__error" role="alert">
            <strong>Sync failed:</strong> {syncError}
          </div>
        )}
      </div>

      {/* ── Error rollup card — shown after sync if any bucket failed ──────── */}
      {syncErrors && Object.keys(syncErrors).length > 0 && (
        <div className="sync-hub__error-card" role="alert">
          <h2 className="sync-hub__section-title sync-hub__section-title--error">
            ❌ Sync completed with errors
            <span className="sync-hub__log-count">{Object.keys(syncErrors).length} release(s)</span>
          </h2>
          <div className="sync-hub__error-list">
            {Object.entries(syncErrors).map(([rel, msgs]) => (
              <div key={rel} className="sync-hub__error-item">
                <div className="sync-hub__error-item-release">{rel}</div>
                <ul className="sync-hub__error-item-msgs">
                  {(Array.isArray(msgs) ? msgs : [msgs]).map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Progress / activity log ───────────────────────────────────────── */}
      {(localLog.length > 0 || syncProgress.length > 0) && (
        <div className="sync-hub__log-card">
          <h2 className="sync-hub__section-title">
            Activity Log
            {focusedReleases && (
              <span className="sync-hub__log-focus-badge">
                showing: {[...focusedReleases].join(', ')}
              </span>
            )}
            <span className="sync-hub__log-count">{localLog.length + syncProgress.length} events</span>
          </h2>

          {/* Per-release live status grid — shows latest state of each release at a glance */}
          {(() => {
            const releaseState = {};
            for (const ev of syncProgress) {
              if (!ev.release || ev.release === '__meta__') continue;
              releaseState[ev.release] = ev;
            }
            const entries = Object.entries(releaseState);
            if (entries.length === 0) return null;
            const doneCount = entries.filter(([, ev]) => ev.status === 'done' || ev.status === 'cache_hit').length;
            const errCount  = entries.filter(([, ev]) => ev.status === 'error').length;
            return (
              <div className="sync-hub__release-grid">
                <div className="sync-hub__release-grid-summary">
                  <span>{doneCount} / {entries.length} releases complete</span>
                  {errCount > 0 && <span className="sync-hub__release-grid-err">{errCount} with errors</span>}
                </div>
                <div className="sync-hub__release-chips">
                  {entries.sort(([a], [b]) => a.localeCompare(b)).map(([rel, ev]) => (
                    <div
                      key={rel}
                      className={`sync-hub__release-chip sync-hub__release-chip--${ev.status || 'info'}`}
                      title={ev.detail || ''}
                    >
                      <span className="sync-hub__chip-icon">{statusIcon(ev.status)}</span>
                      <span className="sync-hub__chip-name">{rel}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="sync-hub__log" role="log" aria-live="polite" aria-label="Sync activity">
            {localLog.map((entry, i) => (
              <div key={`local-${i}`} className="sync-hub__log-row sync-hub__log-row--local">
                <span className="sync-hub__log-icon" aria-hidden="true">ℹ</span>
                <span className="sync-hub__log-release sync-hub__log-release--dim">client</span>
                <span className="sync-hub__log-detail">{entry.msg}</span>
              </div>
            ))}
            {syncProgress
              // Hide queued events — they only feed the chip grid.
              .filter((ev) => !(ev.status === 'queued' && ev.release && ev.release !== '__meta__'))
              // When specific releases are force-refetched, hide cache-hit
              // noise for other releases so the focused release events aren't buried.
              .filter((ev) => {
                if (!focusedReleases) return true;
                if (!ev.release || ev.release === '__meta__') return true;
                // Always show errors, done events, and meta events regardless.
                if (ev.status === 'error' || ev.type === 'done' || ev.type === 'start' || ev.type === 'preflight') return true;
                // Hide cache_hit events for releases not in the focused set.
                if (ev.status === 'cache_hit' && !focusedReleases.has(ev.release)) return false;
                return true;
              })
              .map((event, i) => (
                <div
                  key={`sse-${i}`}
                  className={`sync-hub__log-row sync-hub__log-row--${event.status || event.type || 'info'}`}
                >
                  <span className="sync-hub__log-icon" aria-hidden="true">
                    {event.type === 'done'      ? '🎉'
                    : event.type === 'start'    ? '🚀'
                    : event.type === 'preflight'? '🔌'
                    : event.type === 'error'    ? '❌'
                    : statusIcon(event.status)}
                  </span>
                  <span className="sync-hub__log-release">
                    {event.release && event.release !== '__meta__' ? event.release : '—'}
                  </span>
                  <span className="sync-hub__log-detail">
                    {event.message || event.detail || ''}
                  </span>
                </div>
              ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      <style>{`
        .sync-hub {
          max-width: 860px;
          margin: 0 auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 20px;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          color: #212529;
        }

        .sync-hub__header { margin-bottom: 4px; }

        .sync-hub__title {
          margin: 0 0 6px;
          font-size: 22px;
          font-weight: 700;
          color: #1a1a2e;
        }

        .sync-hub__subtitle {
          margin: 0;
          font-size: 14px;
          color: #6c757d;
          line-height: 1.5;
        }

        .sync-hub__status-card,
        .sync-hub__controls-card,
        .sync-hub__log-card {
          background: #fff;
          border: 1px solid #dee2e6;
          border-radius: 10px;
          padding: 20px 24px;
        }

        .sync-hub__section-title {
          margin: 0 0 16px;
          font-size: 15px;
          font-weight: 600;
          color: #343a40;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .sync-hub__stats {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
          gap: 14px;
          margin-bottom: 16px;
        }

        .sync-hub__stat {
          display: flex;
          flex-direction: column;
          gap: 4px;
          padding: 12px 16px;
          background: #f8f9fa;
          border-radius: 8px;
          border: 1px solid #e9ecef;
        }

        .sync-hub__stat-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: #868e96;
        }

        .sync-hub__stat-value {
          font-size: 18px;
          font-weight: 700;
          color: #212529;
        }

        .sync-hub__stat-value--accent { color: #2f9e44; }

        .sync-hub__stat-value--mono {
          font-size: 13px;
          font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
          color: #495057;
        }

        .sync-hub__releases { display: flex; flex-direction: column; gap: 8px; }

        .sync-hub__release-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          margin-top: 4px;
        }

        .sync-hub__release-tag {
          font-size: 12px;
          font-weight: 500;
          padding: 3px 10px;
          border-radius: 20px;
          background: #e7f5ff;
          color: #1971c2;
          border: 1px solid #74c0fc;
        }

        .sync-hub__empty-state {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
          padding: 28px 16px;
          color: #868e96;
          text-align: center;
        }

        .sync-hub__empty-icon { font-size: 40px; }

        .sync-hub__empty-state p { margin: 0; font-size: 14px; }

        /* Controls */
        .sync-hub__control-row {
          display: flex;
          flex-direction: column;
          gap: 6px;
          margin-bottom: 16px;
        }

        .sync-hub__control-row--checkbox { flex-direction: row; align-items: flex-start; }

        .sync-hub__label {
          font-size: 13px;
          font-weight: 600;
          color: #343a40;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .sync-hub__hint {
          font-size: 11px;
          font-weight: 400;
          color: #868e96;
        }

        .sync-hub__checkbox-label {
          font-size: 13px;
          font-weight: 500;
          color: #495057;
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
          flex-wrap: wrap;
        }

        .sync-hub__checkbox-label--danger { color: #e67700; }
        .sync-hub__checkbox-label--danger input[type="checkbox"]:checked { accent-color: #e67700; }

        .sync-hub__checkbox-label input[type="checkbox"] { cursor: pointer; }

        .sync-hub__input {
          padding: 8px 12px;
          border: 1px solid #ced4da;
          border-radius: 6px;
          font-size: 14px;
          color: #212529;
          background: #fff;
          transition: border-color 0.15s;
          max-width: 460px;
        }

        .sync-hub__input:focus {
          outline: none;
          border-color: #339af0;
          box-shadow: 0 0 0 3px rgba(51, 154, 240, 0.15);
        }

        .sync-hub__input:disabled { background: #f8f9fa; color: #868e96; }

        .sync-hub__action-row {
          display: flex;
          gap: 10px;
          align-items: center;
          flex-wrap: wrap;
          margin-top: 4px;
        }

        .sync-hub__btn {
          display: flex;
          align-items: center;
          gap: 7px;
          padding: 9px 18px;
          border-radius: 7px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          border: none;
          transition: all 0.15s;
          white-space: nowrap;
        }

        .sync-hub__btn:disabled { opacity: 0.55; cursor: not-allowed; }

        .sync-hub__btn--primary {
          background: #1971c2;
          color: #fff;
        }

        .sync-hub__btn--primary:not(:disabled):hover { background: #1864ab; }

        .sync-hub__btn--secondary {
          background: #f1f3f5;
          color: #495057;
          border: 1px solid #dee2e6;
        }

        .sync-hub__btn--secondary:not(:disabled):hover { background: #e9ecef; }

        .sync-hub__btn-spinner {
          display: inline-block;
          width: 13px;
          height: 13px;
          border: 2px solid rgba(255, 255, 255, 0.4);
          border-top-color: #fff;
          border-radius: 50%;
          animation: sync-hub-spin 0.8s linear infinite;
        }

        @keyframes sync-hub-spin { to { transform: rotate(360deg); } }

        .sync-hub__error {
          margin-top: 12px;
          padding: 10px 14px;
          border-radius: 7px;
          background: #fff5f5;
          border: 1px solid #ffc9c9;
          color: #c92a2a;
          font-size: 13px;
        }

        /* Error rollup card */
        .sync-hub__error-card {
          background: #fff5f5;
          border: 1.5px solid #ffa8a8;
          border-radius: 10px;
          padding: 18px 24px;
        }
        .sync-hub__section-title--error { color: #c92a2a; }
        .sync-hub__error-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-top: 4px;
        }
        .sync-hub__error-item {
          background: #fff;
          border: 1px solid #ffc9c9;
          border-radius: 7px;
          padding: 10px 14px;
        }
        .sync-hub__error-item-release {
          font-size: 13px;
          font-weight: 700;
          color: #c92a2a;
          margin-bottom: 6px;
        }
        .sync-hub__error-item-msgs {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .sync-hub__error-item-msgs li {
          font-size: 12px;
          font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
          color: #862e2e;
        }

        /* Focus badge on Activity Log header */
        .sync-hub__log-focus-badge {
          font-size: 11px;
          font-weight: 500;
          color: #1864ab;
          background: #e7f5ff;
          border: 1px solid #a5d8ff;
          border-radius: 10px;
          padding: 2px 8px;
        }

        /* Progress log */
        .sync-hub__log-count {
          font-size: 12px;
          font-weight: 400;
          color: #868e96;
        }

        /* Per-release live status grid */
        .sync-hub__release-grid {
          margin-bottom: 14px;
          padding: 12px 14px;
          background: #f8f9fa;
          border: 1px solid #e9ecef;
          border-radius: 8px;
        }
        .sync-hub__release-grid-summary {
          font-size: 12px;
          font-weight: 600;
          color: #495057;
          margin-bottom: 8px;
          display: flex;
          gap: 12px;
          align-items: center;
        }
        .sync-hub__release-grid-err { color: #c92a2a; }
        .sync-hub__release-chips {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        .sync-hub__release-chip {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
          border: 1px solid transparent;
          cursor: default;
        }
        .sync-hub__release-chip--queued {
          background: #f1f3f5; border-color: #ced4da; color: #868e96;
        }
        .sync-hub__release-chip--done, .sync-hub__release-chip--cache_hit {
          background: #ebfbee; border-color: #b2f2bb; color: #2b8a3e;
        }
        .sync-hub__release-chip--fetching {
          background: #fff9db; border-color: #ffe066; color: #e67700;
        }
        .sync-hub__release-chip--changelog {
          background: #e7f5ff; border-color: #a5d8ff; color: #1864ab;
        }
        .sync-hub__release-chip--error {
          background: #fff5f5; border-color: #ffc9c9; color: #c92a2a;
        }
        .sync-hub__release-chip--cache_hit {
          background: #e7f5ff; border-color: #a5d8ff; color: #1864ab;
        }
        .sync-hub__chip-icon { font-size: 10px; }
        .sync-hub__chip-name { letter-spacing: 0.02em; }

        .sync-hub__log {
          max-height: 360px;
          overflow-y: auto;
          border: 1px solid #e9ecef;
          border-radius: 7px;
          background: #1e1e2e;
          padding: 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .sync-hub__log-row {
          display: grid;
          grid-template-columns: 20px 120px 1fr;
          gap: 10px;
          align-items: baseline;
          font-size: 12px;
          font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace;
          padding: 3px 4px;
          border-radius: 4px;
          color: #cdd3de;
        }

        .sync-hub__log-row--done     { color: #a9e34b; }
        .sync-hub__log-row--start    { color: #e9ecef; font-style: italic; }
        .sync-hub__log-row--preflight{ color: #adb5bd; font-style: italic; }
        .sync-hub__log-row--error    { color: #ff8787; }
        .sync-hub__log-row--cache_hit{ color: #74c0fc; }
        .sync-hub__log-row--fetching { color: #ffd43b; }
        .sync-hub__log-row--changelog{ color: #74c0fc; }
        .sync-hub__log-row--local    { color: #adb5bd; font-style: italic; }

        .sync-hub__log-icon  { text-align: center; font-style: normal; }
        .sync-hub__log-release { color: #74c0fc; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .sync-hub__log-release--dim { color: #6c757d; }
        .sync-hub__log-detail  { color: inherit; word-break: break-word; }

        @media (max-width: 600px) {
          .sync-hub { padding: 16px; }
          .sync-hub__log-row { grid-template-columns: 20px 80px 1fr; gap: 6px; }
        }
      `}</style>
    </div>
  );
}
