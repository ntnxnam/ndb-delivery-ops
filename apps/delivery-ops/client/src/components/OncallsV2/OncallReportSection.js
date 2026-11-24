import React, { useState } from 'react';

function parseEmails(raw) {
  return String(raw || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

export default function OncallReportSection({ teamId, timeframe, busy, error, onPreview, onSend }) {
  const [toInput, setToInput] = useState('ndb-exec-updates@nutanix.com');
  const [localError, setLocalError] = useState('');
  const [previewHtml, setPreviewHtml] = useState('');
  const [sendMsg, setSendMsg] = useState('');

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
    <section className="ocv2-report-section" style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', margin: 'var(--space-4) 0', background: 'var(--surface)' }}>
      <h3 style={{ margin: '0 0 4px' }}>Report — Download & Email</h3>
      <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-small)', color: 'var(--muted)' }}>
        HTML email reuses Outstanding report pattern: heroes/health/taxonomy + ticket tables with JQL proof links. Timeframe <strong>{timeframe}</strong> and team <strong>{teamId}</strong> are baked into subject + HTML. Recipient defaults from server (team DL).
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 8 }}>
        <label htmlFor="oc-report-to" style={{ flex: '1 1 260px', fontSize: 'var(--fs-small)' }}>To <input id="oc-report-to" type="text" value={toInput} onChange={(e) => setToInput(e.target.value)} placeholder="ndb-exec-updates@nutanix.com" aria-describedby="oc-report-hint" style={{ width: '100%', padding: '6px 8px', marginTop: 4, border: '1px solid var(--border)', borderRadius: 6 }} /></label>
        <button type="button" className="oc-btn" onClick={runDownload} disabled={busy} title="Download standalone HTML report (uses cached preview when available)">
          {busy ? 'Working…' : 'Download Report'}
        </button>
        <button type="button" className="oc-btn" onClick={runPreview} disabled={busy}> {busy ? 'Working…' : 'Preview'} </button>
        <button type="button" className="oc-btn oc-btn-primary" onClick={runSend} disabled={busy || !parseEmails(toInput).length}> Send Email </button>
      </div>
      {displayError ? <p role="alert" aria-live="polite" style={{ color: 'var(--danger)', fontSize: 12 }}>{displayError}</p> : null}
      {sendMsg ? <p role="status" aria-live="polite" style={{ color: 'var(--success)', fontSize: 12 }}>{sendMsg}</p> : null}
      {previewHtml ? (
        <details open style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Preview (HTML email)</summary>
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginTop: 8, background: 'var(--surface-raised)', overflow: 'auto', maxHeight: 600 }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </details>
      ) : null}
    </section>
  );
}
