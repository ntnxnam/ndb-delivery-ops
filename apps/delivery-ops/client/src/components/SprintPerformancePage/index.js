import React, { useEffect, useState } from 'react';
import { useSprintPerformance } from '../../hooks/useSprintPerformance';

const bar = { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0 10px' };
const btn = { minHeight: '2rem', padding: '0.375rem 0.875rem', border: '1px solid #ced4da', borderRadius: 6, background: '#fff', cursor: 'pointer', fontSize: 13 };
const primary = { ...btn, background: '#1c7ed6', borderColor: '#1c7ed6', color: '#fff' };
const note = { fontSize: 12, color: '#868e96' };

function openBlob(html, file, download) {
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  if (download) {
    const a = document.createElement('a');
    a.href = url;
    a.download = file;
    a.click();
  } else {
    window.open(url, '_blank', 'noopener');
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export default function SprintPerformancePage() {
  const { html, selected, job, loading, error, iframeKey, loadReport, generate, latest } = useSprintPerformance('ndb');
  const [blobUrl, setBlobUrl] = useState('');
  const running = job.state === 'running';

  // Large reports (~2–3MB) truncate when stuffed into iframe srcDoc — heatmaps stay empty
  // because the payload script at the end never runs. Blob URLs carry the full HTML.
  useEffect(() => {
    if (!html) {
      setBlobUrl('');
      return undefined;
    }
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    setBlobUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [html, iframeKey]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 80px)' }}>
      <div style={bar}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Sprint Performance</h2>
        <button type="button" style={primary} onClick={generate} disabled={running}>
          {running ? 'Generating…' : 'Regenerate from JIRA'}
        </button>
        <button type="button" style={btn} onClick={() => loadReport()} disabled={loading} title="Reload the latest report">Reload</button>
        <button type="button" style={btn} disabled={!html} onClick={() => openBlob(html, selected, true)}>Download HTML</button>
        <button type="button" style={btn} disabled={!html} onClick={() => openBlob(html, selected, false)}>Open in new tab</button>
        <span style={note}>
          {running && `Fetching sprints, issues and reporting lines (~4 min) — ${job.progress || ''}`}
          {!running && latest && `Latest · ${latest.window} · updated ${new Date(latest.modifiedAt).toLocaleString()}`}
          {!running && job.state === 'error' && <span style={{ color: '#c92a2a' }}> Last generation failed: {job.error}</span>}
        </span>
      </div>
      {error && <div style={{ color: '#c92a2a', fontSize: 13, marginBottom: 8 }}>{error} <button type="button" style={btn} onClick={() => loadReport()}>Retry</button></div>}
      {!html && !loading && !error && (
        <div style={{ padding: 24, border: '1px dashed #ced4da', borderRadius: 8, color: '#495057' }}>
          No report yet. Click <b>Regenerate from JIRA</b> to build the latest view.
        </div>
      )}
      {loading && !html && <div style={note}>Loading report…</div>}
      {blobUrl && (
        <iframe
          key={iframeKey || selected || 'report'}
          title="Sprint Performance report"
          src={blobUrl}
          sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-downloads"
          allow="clipboard-write"
          style={{ flex: 1, width: '100%', border: '1px solid #dee2e6', borderRadius: 8, background: '#f8f9fa' }}
        />
      )}
    </div>
  );
}
