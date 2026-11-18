/**
 * Weekly Skim — ADHD one-screen multi-release email skim.
 * PDF-shaped table (Projects | Date | Key Content | Risks/Status) + visual RAG.
 * Sibling of Release Brief (deep dive). Does not replace Brief.
 */

import React, { useCallback, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageLoading } from '../shared/components/PageLoading';
import { useTeam } from '../contexts/TeamContext';
import { useJiraConfig } from '../utils/jiraConfig';
import { downloadPDF } from '../utils/downloadUtils';
import { useWeeklySkim } from './hooks/useWeeklySkim';
import {
  copyWeeklySkimHtml,
  downloadWeeklySkimHtml,
} from './services/weeklySkimService';
import { jiraSearchUrl } from './services/releaseBriefService';
import { RELEASE_TYPE_CHIPS } from './utils/releaseTypeUtils';
import './WeeklySkimPage.css';

function fmtGa(ga) {
  if (!ga) return '—';
  try {
    const d = new Date(ga);
    if (Number.isNaN(d.getTime())) return String(ga);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return String(ga);
  }
}

function CountPill({ metric, jiraBaseUrl, label, tone }) {
  if (metric?.count == null) return null;
  const href = jiraSearchUrl(jiraBaseUrl, metric.jql);
  const className = `ws-pill ws-pill--${tone || 'neutral'}`;
  if (!href) {
    return (
      <span className={className}>
        {label} {metric.count}
      </span>
    );
  }
  // v1: no in-app sample → count is JIRA proof (no redundant Open in JIRA hint).
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      title={`Open ${label} in JIRA`}
      aria-label={`Open ${label} (${metric.count}) in JIRA`}
    >
      {label} {metric.count}
    </a>
  );
}

function RagStrip({ rows }) {
  const ok = (rows || []).filter((r) => !r.error);
  if (!ok.length) return null;
  return (
    <div className="ws-rag-strip" aria-label="Release health strip">
      {ok.map((r) => (
        <Link
          key={r.release}
          to={`/release/${encodeURIComponent(r.release)}/brief`}
          className={`ws-rag-card ws-rag-card--${(r.rag || 'unknown').toLowerCase()}`}
          title={r.pulse || r.release}
        >
          <span className="ws-rag-card__rag">{r.rag || '?'}</span>
          <span className="ws-rag-card__name">{r.release.replace(/^NDB-/, '')}</span>
        </Link>
      ))}
    </div>
  );
}

export default function WeeklySkimPage() {
  const { selectedTeam } = useTeam();
  const { jiraBaseUrl } = useJiraConfig();
  const jiraToken = localStorage.getItem('jiraToken') || '';
  const username = localStorage.getItem('username') || '';
  const productId = selectedTeam?.id || 'ndb';
  const previewRef = useRef(null);
  const [exportMsg, setExportMsg] = useState('');
  const [exporting, setExporting] = useState(false);

  const {
    filteredVersions,
    loadingVersions,
    versionsError,
    releaseType,
    setReleaseType,
    selected,
    toggleRelease,
    selectAllFiltered,
    clearSelected,
    payload,
    loading,
    error,
    progress,
    generate,
  } = useWeeklySkim({ productId, jiraToken, username });

  const onCopy = useCallback(async () => {
    if (!payload) return;
    try {
      await copyWeeklySkimHtml(payload, { jiraBaseUrl });
      setExportMsg('HTML copied — paste into Outlook');
      setTimeout(() => setExportMsg(''), 3000);
    } catch (e) {
      setExportMsg(e.message || 'Copy failed');
    }
  }, [payload, jiraBaseUrl]);

  const onDownloadHtml = useCallback(() => {
    if (!payload) return;
    downloadWeeklySkimHtml(payload, { jiraBaseUrl });
    setExportMsg('HTML downloaded');
    setTimeout(() => setExportMsg(''), 2500);
  }, [payload, jiraBaseUrl]);

  const onDownloadPdf = useCallback(async () => {
    if (!payload || !previewRef.current) return;
    setExporting(true);
    try {
      await downloadPDF(previewRef, 'Weekly-Skim');
      setExportMsg('PDF downloaded');
      setTimeout(() => setExportMsg(''), 2500);
    } catch (e) {
      setExportMsg(e.message || 'PDF failed');
    } finally {
      setExporting(false);
    }
  }, [payload]);

  return (
    <div className="ws-page">
      <header className="ws-header">
        <div>
          <h1 className="ws-title">Weekly Skim</h1>
          <p className="ws-sub">
            R&amp;D-weekly shape, skim density. Deep dive:{' '}
            <Link to="/release/brief">Release Brief</Link>.
          </p>
        </div>
      </header>

      <section className="ws-controls" aria-label="Release type and selection">
        <div className="ws-chips" role="group" aria-label="Release type">
          {RELEASE_TYPE_CHIPS.map((chip) => (
            <button
              key={chip.id}
              type="button"
              className={`ws-chip${releaseType === chip.id ? ' ws-chip--active' : ''}`}
              onClick={() => setReleaseType(chip.id)}
              title={chip.hint}
            >
              {chip.label}
            </button>
          ))}
        </div>

        <div className="ws-select-row">
          <span className="ws-label">Releases</span>
          <button type="button" className="ws-linkish" onClick={selectAllFiltered}>
            All
          </button>
          <button type="button" className="ws-linkish" onClick={clearSelected}>
            None
          </button>
        </div>

        {loadingVersions && <PageLoading inline message="Loading versions…" />}
        {versionsError && <p className="ws-error">{versionsError}</p>}

        <div className="ws-release-list">
          {filteredVersions.length === 0 && !loadingVersions ? (
            <p className="ws-muted">No releases in this type.</p>
          ) : (
            filteredVersions.map((v) => {
              const name = typeof v === 'string' ? v : v.name;
              const checked = selected.includes(name);
              return (
                <label key={name} className="ws-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggleRelease(name)}
                  />
                  <span>{name}</span>
                </label>
              );
            })
          )}
        </div>

        <div className="ws-actions">
          <button
            type="button"
            className="ws-btn ws-btn--primary"
            disabled={loading || !selected.length || !jiraToken}
            onClick={generate}
          >
            {loading ? 'Generating…' : 'Generate skim'}
          </button>
          {progress && <span className="ws-muted">{progress}</span>}
          {error && <span className="ws-error">{error}</span>}
        </div>
      </section>

      {payload && (
        <>
          <div className="ws-preview" ref={previewRef}>
            <h2 className="ws-preview-title">NDB Weekly Skim</h2>
            <p className="ws-muted ws-gen">
              Generated{' '}
              {payload.generatedAt
                ? new Date(payload.generatedAt).toLocaleString()
                : '—'}
            </p>

            <RagStrip rows={payload.rows} />

            <div className="ws-this-week">
              <div className="ws-section-label">THIS WEEK</div>
              <p>{payload.thisWeek}</p>
            </div>

            <div className="ws-chase">
              <div className="ws-section-label">CHASE</div>
              {(payload.chase || []).length === 0 ? (
                <p className="ws-muted">No chase items this week.</p>
              ) : (
                <ol>
                  {payload.chase.map((c, i) => (
                    <li key={`${c.release}-${i}`}>
                      <span className="ws-muted">{c.release}</span> — {c.text}
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <table className="ws-table">
              <thead>
                <tr>
                  <th>Projects</th>
                  <th>Release Date</th>
                  <th>Key Content</th>
                  <th>Risks / Status</th>
                </tr>
              </thead>
              <tbody>
                {(payload.rows || []).map((r) =>
                  r.error ? (
                    <tr key={r.release}>
                      <td>
                        <Link to={`/release/${encodeURIComponent(r.release)}/brief`}>
                          {r.release}
                        </Link>
                      </td>
                      <td colSpan={3}>
                        <div className="ws-error">{r.error}</div>
                        {(r.open?.count != null ||
                          r.p0?.count != null ||
                          r.mustFix?.count != null) && (
                          <div className="ws-pills" style={{ marginTop: '0.35rem' }}>
                            <CountPill
                              metric={r.open}
                              jiraBaseUrl={jiraBaseUrl}
                              label="Open"
                              tone="neutral"
                            />
                            <CountPill
                              metric={r.p0}
                              jiraBaseUrl={jiraBaseUrl}
                              label="P0"
                              tone={r.p0?.count > 0 ? 'danger' : 'neutral'}
                            />
                            <CountPill
                              metric={r.mustFix}
                              jiraBaseUrl={jiraBaseUrl}
                              label="Must-fix"
                              tone={r.mustFix?.count > 0 ? 'warn' : 'neutral'}
                            />
                          </div>
                        )}
                      </td>
                    </tr>
                  ) : (
                    <tr key={r.release}>
                      <td>
                        <Link
                          to={`/release/${encodeURIComponent(r.release)}/brief`}
                          title="Open Release Brief"
                        >
                          {r.release}
                        </Link>
                      </td>
                      <td>{fmtGa(r.ga)}</td>
                      <td className="ws-key-content">{r.keyContent || '—'}</td>
                      <td>
                        <div className="ws-risks">
                          <span
                            className={`ws-rag ws-rag--${(r.rag || 'unknown').toLowerCase()}`}
                          >
                            {r.rag || '—'}
                          </span>
                          <div className="ws-pills">
                            <CountPill
                              metric={r.open}
                              jiraBaseUrl={jiraBaseUrl}
                              label="Open"
                              tone="neutral"
                            />
                            <CountPill
                              metric={r.p0}
                              jiraBaseUrl={jiraBaseUrl}
                              label="P0"
                              tone={r.p0?.count > 0 ? 'danger' : 'neutral'}
                            />
                            <CountPill
                              metric={r.mustFix}
                              jiraBaseUrl={jiraBaseUrl}
                              label="Must-fix"
                              tone={r.mustFix?.count > 0 ? 'warn' : 'neutral'}
                            />
                          </div>
                          {r.pulse ? (
                            <div className="ws-pulse-line">{r.pulse}</div>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  )
                )}
              </tbody>
            </table>
          </div>

          <div className="ws-export">
            <button type="button" className="ws-btn" onClick={onCopy}>
              Copy HTML
            </button>
            <button type="button" className="ws-btn" onClick={onDownloadHtml}>
              Download HTML
            </button>
            <button
              type="button"
              className="ws-btn"
              onClick={onDownloadPdf}
              disabled={exporting}
            >
              {exporting ? 'PDF…' : 'Download PDF'}
            </button>
            {exportMsg && <span className="ws-muted">{exportMsg}</span>}
          </div>
        </>
      )}
    </div>
  );
}
