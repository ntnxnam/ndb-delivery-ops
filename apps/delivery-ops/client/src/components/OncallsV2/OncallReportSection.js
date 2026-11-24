import React, { useState } from 'react';

function parseEmails(raw) {
  return String(raw || '').split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
}

export default function OncallReportSection({ teamId, timeframe, busy, error, onPreview, onSend, onDownload }) {
  const [toInput, setToInput] = useState('ndb-exec-updates@nutanix.com');
  const [previewHtml, setPreviewHtml] = useState('');
  const [sendMsg, setSendMsg] = useState('');

  const runPreview = async () => {
    setSendMsg('');
    try {
      const data = await onPreview({ to: parseEmails(toInput) });
      setPreviewHtml(data?.html || '');
      if (Array.isArray(data?.to) && data.to.length) setToInput(data.to.join(', '));
    } catch {
      setPreviewHtml('');
    }
  };
  const runSend = async () => {
    setSendMsg('');
    try {
      const data = await onSend({ to: parseEmails(toInput) });
      const ccNote = (data?.cc || []).length ? ` (CC ${(data.cc || []).length})` : '';
      setSendMsg(`Sent: ${data?.subject || 'report'} → ${(data?.to || []).join(', ')}${ccNote}`);
    } catch {}
  };
  const runDownload = async () => {
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
    } catch {}
  };

  return (
    <section style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 16, margin: '16px 0', background: 'var(--surface)' }}>
      <h3 style={{ margin: '0 0 4px' }}>Report — Download & Email</h3>
      <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--muted)' }}>
        HTML email reuses Outstanding report pattern: heroes/health/taxonomy + ticket tables with JQL proof links. Timeframe <strong>{timeframe}</strong> and team <strong>{teamId}</strong> are baked into subject + HTML. To: ndb-exec-updates@ · CC: ndb-tech-leads@, ndb-managers@.
      </p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 8 }}>
        <label style={{ flex: '1 1 260px', fontSize: 12 }}>To <input type="text" value={toInput} onChange={(e) => setToInput(e.target.value)} placeholder="ndb-exec-updates@nutanix.com" style={{ width: '100%', padding: '6px 8px', marginTop: 4, border: '1px solid var(--border)', borderRadius: 6 }} /></label>
        <button type="button" className="oc-btn" onClick={runDownload} disabled={busy} title="Download standalone HTML report (uses cached preview when available)">
          {busy ? 'Working…' : 'Download Report'}
        </button>
        <button type="button" className="oc-btn" onClick={runPreview} disabled={busy}> {busy ? 'Working…' : 'Preview'} </button>
        <button type="button" className="oc-btn oc-btn-primary" onClick={runSend} disabled={busy || !parseEmails(toInput).length}> Send Email </button>
      </div>
      {error ? <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p> : null}
      {sendMsg ? <p style={{ color: 'var(--success)', fontSize: 12 }}>{sendMsg}</p> : null}
      {previewHtml ? (
        <details open style={{ marginTop: 12 }}>
          <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Preview (HTML email)</summary>
          <div style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 12, marginTop: 8, background: '#fff', overflow: 'auto', maxHeight: 600 }} dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </details>
      ) : null}
    </section>
  );
}
