import React, { useEffect, useState } from 'react';

function parseEmails(raw) {
  return String(raw || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

function normalizeDefaultTo(v) {
  if (Array.isArray(v)) return v.filter(Boolean).join(', ');
  return String(v || '').trim();
}

export default function OncallReportSection({ teamId, timeframe, busy, error, onPreview, onSend, defaultTo }) {
  const [toInput, setToInput] = useState(() => normalizeDefaultTo(defaultTo));
  const [localError, setLocalError] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [sendMsg, setSendMsg] = useState('');

  useEffect(() => {
    const next = normalizeDefaultTo(defaultTo);
    if (next && !toInput) setToInput(next);
  }, [defaultTo]); // eslint-disable-line react-hooks/exhaustive-deps

  const runPreview = async () => {
    setSendMsg('');
    setLocalError('');
    try {
      const data = await onPreview({ to: parseEmails(toInput) });
      setPreviewHtml(data?.html || '');
      if (Array.isArray(data?.to) && data.to.length) setToInput(data.to.join(', '));
    } catch (e) {
      setPreviewHtml('');
      setLocalError(e?.message || String(e) || 'Preview failed');
    }
  };
  const runSend = async () => {
    setSendMsg('');
    setLocalError('');
    try {
      const data = await onSend({ to: parseEmails(toInput) });
      const ccNote = (data?.cc || []).length ? ` (CC ${(data.cc || []).length})` : '';
      setSendMsg(`Sent: ${data?.subject || 'report'} → ${(data?.to || []).join(', ')}${ccNote}`);
    } catch (e) {
      setLocalError(e?.message || String(e) || 'Send failed');
    }
  };
  const runDownload = async () => {
    setLocalError('');
    try {
      let html = previewHtml;
      if (!html) {
        const data = await onPreview({ to: parseEmails(toInput) });
        html = data?.html || '';
        if (html) setPreviewHtml(html);
      }
      if (!html) return;
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `OnCalls-${teamId || 'team'}-${timeframe}-${new Date().toISOString().slice(0, 10)}.html`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setLocalError(e?.message || String(e) || 'Download failed');
    }
  };

  const displayError = error || localError;
  return (
    <section className="ocv2-report-section">
      <h3 className="ocv2-report-title">Report — Download & Email</h3>
      <p className="ocv2-report-desc">
        HTML email reuses Outstanding report pattern: heroes/health/taxonomy + ticket tables with JQL proof links. Timeframe <strong>{timeframe}</strong> and team <strong>{teamId}</strong> are baked into subject + HTML. Recipient defaults from server (team DL).
      </p>
      <p id="oc-report-hint" className="ocv2-report-hint">To: primary DL · CC: leads/managers (server-owned CC)</p>
      <div className="ocv2-report-actions">
        <label htmlFor="oc-report-to" className="ocv2-report-label">To <input id="oc-report-to" type="text" value={toInput} onChange={(e) => setToInput(e.target.value)} placeholder="team DL" aria-describedby="oc-report-hint" className="ocv2-report-input" /></label>
        <button type="button" className="oc-btn" onClick={runDownload} disabled={busy} title="Download standalone HTML report (uses cached preview when available)">
          {busy ? 'Working…' : 'Download Report'}
        </button>
        <button type="button" className="oc-btn" onClick={runPreview} disabled={busy}> {busy ? 'Working…' : 'Preview'} </button>
        <button type="button" className="oc-btn oc-btn-primary" onClick={runSend} disabled={busy || !parseEmails(toInput).length}> Send Email </button>
      </div>
      {displayError ? <p role="alert" aria-live="assertive" className="ocv2-report-error">{displayError}</p> : null}
      {sendMsg ? <p role="status" aria-live="polite" className="ocv2-report-success">{sendMsg}</p> : null}
      {previewHtml ? (
        <details open className="ocv2-report-preview">
          <summary className="ocv2-report-preview-summary">Preview (HTML email)</summary>
          <div className="ocv2-report-preview-body" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </details>
      ) : null}
    </section>
  );
}
