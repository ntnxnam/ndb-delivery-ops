import React, { useEffect, useState, useCallback } from 'react';
import './SchedulePage.css';

const SKILLS = ['tpm-execution', 'tpm-at-release', 'tpm-post-release', 'tpm-overall', 'tpm-report'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const TZS = ['UTC', 'Asia/Kolkata', 'America/Los_Angeles', 'America/New_York', 'Europe/London'];

function emptyForm() {
  return { name: '', skill: SKILLS[0], productId: 'ndb', release: '', dayOfWeek: 1, hour: 7, minute: 0, tz: 'Asia/Kolkata', enabled: true, deferAfterPg: false, to: '', cc: '', cron: '' };
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState('');
  const [msgKind, setMsgKind] = useState('info');
  const [testingId, setTestingId] = useState(null);
  const [testingForm, setTestingForm] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/config/schedules');
      const j = await r.json();
      setSchedules(j.schedules || []);
    } catch (e) { setMsg(e.message); setMsgKind('error'); }
    setLoading(false);
  }, []);
  useEffect(() => { fetchList(); }, [fetchList]);

  const headers = () => {
    const h = { 'Content-Type': 'application/json' };
    try {
      const raw = localStorage.getItem('auth');
      if (raw) {
        const a = JSON.parse(raw);
        if (a.token) h.Authorization = `Bearer ${a.token}`;
        if (a.username) h['x-username'] = a.username;
      }
    } catch {}
    const u = localStorage.getItem('username');
    if (u && !h['x-username']) h['x-username'] = u;
    return h;
  };

  function formToPayload(f) {
    return {
      name: f.name, skill: f.skill,
      tpmScope: { productId: f.productId, release: f.release },
      tz: f.tz, enabled: f.enabled, deferAfterPg: f.deferAfterPg, to: f.to, cc: f.cc,
      schedule: f.cron ? { cron: f.cron, tz: f.tz } : { dayOfWeek: Number(f.dayOfWeek), hour: Number(f.hour), minute: Number(f.minute), tz: f.tz },
    };
  }

  async function handleSave(e) {
    e.preventDefault();
    const payload = formToPayload(form);
    try {
      const url = editing ? `/api/config/schedules/${editing}` : '/api/config/schedules';
      const method = editing ? 'PUT' : 'POST';
      const r = await fetch(url, { method, headers: headers(), body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Save failed');
      setMsg(editing ? 'Updated' : 'Created'); setMsgKind('success');
      setShowForm(false); setEditing(null); setForm(emptyForm()); setTestResult(null);
      fetchList();
    } catch (err) { setMsg(err.message); setMsgKind('error'); }
  }

  async function handleTestForm() {
    setTestingForm(true); setTestResult(null);
    const payload = formToPayload(form);
    try {
      const r = await fetch('/api/config/schedules/test-preview', { method: 'POST', headers: headers(), body: JSON.stringify(payload) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Test failed');
      setTestResult({ ...j, source: 'preview' });
    } catch (err) { setTestResult({ ok: false, error: err.message, checks: [], preview: null, testedAt: new Date().toISOString(), source: 'preview' }); }
    setTestingForm(false);
  }

  async function handleTest(id) {
    setTestingId(id); setTestResult(null);
    try {
      const r = await fetch(`/api/config/schedules/${id}/test`, { method: 'POST', headers: headers(), body: JSON.stringify({}) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Test failed');
      setTestResult({ ...j, source: id });
      setMsg(j.ok ? 'Test passed — schedule is valid' : 'Test found issues — see details below'); setMsgKind(j.ok ? 'success' : 'warning');
    } catch (err) { setTestResult({ ok: false, error: err.message, checks: [], preview: null, testedAt: new Date().toISOString(), source: id }); setMsg(err.message); setMsgKind('error'); }
    setTestingId(null);
  }

  function startEdit(s) {
    setEditing(s.id);
    const sc = s.schedule || {};
    setForm({
      name: s.name || '', skill: s.skill || SKILLS[0],
      productId: s.tpmScope?.productId || 'ndb', release: s.tpmScope?.release || '',
      dayOfWeek: sc.dayOfWeek ?? 1, hour: sc.hour ?? 7, minute: sc.minute ?? 0,
      tz: s.tz || 'Asia/Kolkata', enabled: s.enabled !== false, deferAfterPg: !!s.deferAfterPg,
      to: s.to || '', cc: s.cc || '', cron: sc.cron || '',
    });
    setShowForm(true); setTestResult(null);
  }

  function startCreate() {
    setEditing(null); setForm(emptyForm()); setShowForm((v) => !v); setTestResult(null);
  }

  async function toggleEnabled(s) {
    try {
      const r = await fetch(`/api/config/schedules/${s.id}`, { method: 'PUT', headers: headers(), body: JSON.stringify({ enabled: !s.enabled }) });
      if (!r.ok) throw new Error('Toggle failed');
      setMsg(s.enabled ? 'Paused' : 'Resumed'); setMsgKind('info');
      fetchList();
    } catch (e) { setMsg(e.message); setMsgKind('error'); }
  }
  async function del(id) {
    if (!window.confirm('Delete this schedule?')) return;
    await fetch(`/api/config/schedules/${id}`, { method: 'DELETE', headers: headers() });
    setMsg('Deleted'); setMsgKind('info');
    fetchList();
  }

  if (loading) return <div className="schedule-page"><div className="page-empty"><div className="ds-skeleton ds-skeleton--card" style={{ width: '100%', maxWidth: '30rem', margin: 'var(--space-6) auto' }} /></div></div>;

  return (
    <div className="schedule-page">
      <div className="page-header">
        <div className="page-header__titles">
          <h1 className="page-header__title">Schedules</h1>
          <p className="page-header__subtitle">TPM digest — automated reports. “What runs when” for {schedules.length} schedule{schedules.length !== 1 ? 's' : ''}.</p>
        </div>
        <div className="page-header__actions">
          <button type="button" className="ds-btn ds-btn--secondary" onClick={fetchList}>Refresh</button>
          <button type="button" className="ds-btn ds-btn--primary" onClick={startCreate}>{showForm ? 'Close form' : '+ New schedule'}</button>
        </div>
      </div>

      {msg && <div className={`page-error ${msgKind === 'success' ? 'page-success' : msgKind === 'warning' ? 'page-warning' : ''}`} role="status">{msg}</div>}

      <div className="stat-row" style={{ marginBottom: 'var(--space-4)' }}>
        <div className="stat-card"><div className="stat-card__label">Total</div><div className="stat-card__value">{schedules.length}</div><div className="stat-card__caption">Configured schedules</div></div>
        <div className="stat-card"><div className="stat-card__label">Active</div><div className="stat-card__value">{schedules.filter((s) => s.enabled).length}</div><div className="stat-card__caption">Will run on next tick</div></div>
        <div className="stat-card"><div className="stat-card__label">Paused</div><div className="stat-card__value">{schedules.filter((s) => !s.enabled).length}</div><div className="stat-card__caption">Disabled</div></div>
      </div>

      {showForm && (
        <div className="ds-section">
          <div className="ds-section__header">
            <h2 className="ds-section__title">{editing ? 'Edit schedule' : 'New schedule'}</h2>
            <span className="ds-muted-label">Dry-run test does not send emails</span>
          </div>
          <div className="ds-section__body">
            <form className="sched-form sched-form--ds" onSubmit={handleSave}>
              <label className="ds-label">Name<input className="ds-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="NDB morning digest" required /></label>
              <label className="ds-label">Skill<select className="ds-input" value={form.skill} onChange={(e) => setForm({ ...form, skill: e.target.value })}>{SKILLS.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
              <label className="ds-label">Product<input className="ds-input" value={form.productId} onChange={(e) => setForm({ ...form, productId: e.target.value })} placeholder="ndb" required /></label>
              <label className="ds-label">Release<input className="ds-input" value={form.release} onChange={(e) => setForm({ ...form, release: e.target.value })} placeholder="NDB-3.0" required /></label>
              <label className="ds-label">Day<select className="ds-input" value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>{DAYS.map((d, i) => <option key={i} value={i}>{d}</option>)}</select></label>
              <label className="ds-label">Hour<input className="ds-input" type="number" min="0" max="23" value={form.hour} onChange={(e) => setForm({ ...form, hour: e.target.value })} /></label>
              <label className="ds-label">Minute<input className="ds-input" type="number" min="0" max="59" value={form.minute} onChange={(e) => setForm({ ...form, minute: e.target.value })} /></label>
              <label className="ds-label">TZ<select className="ds-input" value={form.tz} onChange={(e) => setForm({ ...form, tz: e.target.value })}>{TZS.map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
              <label className="ds-label">To<input className="ds-input" value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} placeholder="team@example.com" /></label>
              <label className="ds-label">CC<input className="ds-input" value={form.cc} onChange={(e) => setForm({ ...form, cc: e.target.value })} placeholder="cc@example.com" /></label>
              <label className="ds-label" style={{ gridColumn: '1 / -1' }}>Cron (optional, overrides day/hour/minute)<input className="ds-input" value={form.cron} onChange={(e) => setForm({ ...form, cron: e.target.value })} placeholder="0 7 * * 1" /></label>
              <label className="ds-label sched-form__check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Enabled</label>
              <label className="ds-label sched-form__check"><input type="checkbox" checked={form.deferAfterPg} onChange={(e) => setForm({ ...form, deferAfterPg: e.target.checked })} /> Defer after PG</label>
              <div className="full sched-form__actions">
                <button type="submit" className="ds-btn ds-btn--primary">{editing ? 'Update' : 'Create'}</button>
                <button type="button" className="ds-btn ds-btn--secondary" onClick={() => setShowForm(false)}>Cancel</button>
                <button type="button" className="ds-btn ds-btn--ghost" onClick={handleTestForm} disabled={testingForm}>{testingForm ? 'Testing…' : 'Test (dry-run)'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {testResult && (
        <div className="ds-section sched-test-result">
          <div className="ds-section__header">
            <h2 className="ds-section__title">Test result — {testResult.ok ? 'looks good' : 'needs attention'}</h2>
            <div className="ds-section__actions">
              <span className={`ds-badge ${testResult.ok ? 'ds-badge--success' : 'ds-badge--warning'}`}>{testResult.ok ? 'Pass' : 'Check'}</span>
              <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" onClick={() => setTestResult(null)}>Dismiss</button>
            </div>
          </div>
          <div className="ds-section__body">
            {testResult.error && <div className="page-error">{testResult.error}</div>}
            {testResult.preview && (
              <div className="sched-test-preview">
                <div className="ds-row sched-test-preview__row">
                  <span className="ds-pill ds-pill--accent">{testResult.preview.skill}</span>
                  <span className="ds-pill ds-pill--muted">{testResult.preview.tpmScope?.productId} / {testResult.preview.tpmScope?.release}</span>
                  <span className="ds-pill ds-pill--muted">{testResult.preview.when}</span>
                  {testResult.preview.wouldSkip && <span className="ds-pill ds-pill--warning">Would skip — {testResult.preview.wouldSkipReason}</span>}
                </div>
                <div className="sched-test-meta">
                  <span><strong>To:</strong> {testResult.preview.to || '—'}</span>
                  <span><strong>CC:</strong> {testResult.preview.cc || '—'}</span>
                  <span className="sched-when">Tested {testResult.testedAt ? new Date(testResult.testedAt).toLocaleString() : 'now'} · source: {testResult.source}</span>
                </div>
                {testResult.warnings?.length > 0 && <div className="page-warning" style={{ marginTop: 'var(--space-3)' }}>{testResult.warnings.join(' ')}</div>}
              </div>
            )}
            {testResult.checks?.length > 0 && (
              <div className="table-wrap" style={{ marginTop: 'var(--space-3)' }}>
                <table>
                  <thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead>
                  <tbody>
                    {testResult.checks.map((c) => (
                      <tr key={c.id}>
                        <td>{c.label}</td>
                        <td><span className={`ds-badge ${c.ok ? 'ds-badge--success' : 'ds-badge--danger'}`}>{c.ok ? 'OK' : 'Fail'}</span></td>
                        <td className="sched-when" style={{ wordBreak: 'break-all' }}>{c.detail}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="ds-section">
        <div className="ds-section__header">
          <h2 className="ds-section__title">All schedules</h2>
          <span className="ds-muted-label">{schedules.length} total</span>
        </div>
        <div className="ds-section__body ds-section__body--flush">
          <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
            <table>
              <thead><tr><th>Name</th><th>Skill</th><th>Scope</th><th>When</th><th>To</th><th>Last run</th><th>Status</th><th style={{ minWidth: 180 }} /></tr></thead>
              <tbody>
                {schedules.length === 0 && <tr><td colSpan={8}><div className="ds-empty"><p className="ds-empty__title">No schedules yet</p><p className="ds-empty__hint">Create one above or via chat: “schedule the digest for NDB at 7am IST”.</p></div></td></tr>}
                {schedules.map((s) => (
                  <tr key={s.id}>
                    <td style={{ fontWeight: 600 }}>{s.name || '—'}</td>
                    <td><span className="ds-badge ds-badge--info">{s.skill}</span></td>
                    <td className="sched-when">{s.tpmScope?.productId}/{s.tpmScope?.release}</td>
                    <td><span className="sched-when">{s.when}</span> <span className={`ds-badge ${s.enabled ? 'ds-badge--success' : 'ds-badge--neutral'}`}>{s.enabled ? 'ON' : 'OFF'}</span></td>
                    <td className="sched-when">{s.to || '—'}</td>
                    <td className="sched-when">{s.lastRun ? new Date(s.lastRun).toLocaleString() : '—'}</td>
                    <td><span className={`ds-badge ${s.lastStatus === 'success' ? 'ds-badge--success' : s.lastStatus === 'error' ? 'ds-badge--danger' : s.lastStatus === 'skipped' ? 'ds-badge--warning' : 'ds-badge--neutral'}`}>{s.lastStatus || '—'}</span></td>
                    <td>
                      <span style={{ display: 'inline-flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                        <button type="button" className="ds-btn ds-btn--secondary ds-btn--sm" onClick={() => handleTest(s.id)} disabled={testingId === s.id}>{testingId === s.id ? 'Testing…' : 'Test'}</button>
                        <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" onClick={() => startEdit(s)}>Edit</button>
                        <button type="button" className="ds-btn ds-btn--ghost ds-btn--sm" onClick={() => toggleEnabled(s)}>{s.enabled ? 'Pause' : 'Resume'}</button>
                        <button type="button" className="ds-btn ds-btn--danger ds-btn--sm" onClick={() => del(s.id)}>Delete</button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
