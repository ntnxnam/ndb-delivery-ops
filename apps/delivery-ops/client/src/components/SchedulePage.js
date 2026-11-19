import React, { useEffect, useState, useCallback } from 'react';
import './SchedulePage.css';

const SKILLS = ['tpm-execution','tpm-at-release','tpm-post-release','tpm-overall','tpm-report'];
const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const TZS = ['UTC','Asia/Kolkata','America/Los_Angeles','America/New_York','Europe/London'];

function emptyForm() {
  return { name:'', skill:SKILLS[0], productId:'ndb', release:'', dayOfWeek:1, hour:7, minute:0, tz:'Asia/Kolkata', enabled:true, deferAfterPg:false, to:'', cc:'', cron:'' };
}

export default function SchedulePage() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [showForm, setShowForm] = useState(false);
  const [msg, setMsg] = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/config/schedules');
      const j = await r.json();
      setSchedules(j.schedules || []);
    } catch (e) { setMsg(e.message); }
    setLoading(false);
  }, []);
  useEffect(() => { fetchList(); }, [fetchList]);

  const headers = () => {
    const h = { 'Content-Type':'application/json' };
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
    const payload = {
      name: f.name, skill: f.skill,
      tpmScope: { productId: f.productId, release: f.release },
      tz: f.tz, enabled: f.enabled, deferAfterPg: f.deferAfterPg, to: f.to, cc: f.cc,
      schedule: f.cron ? { cron: f.cron, tz: f.tz } : { dayOfWeek: Number(f.dayOfWeek), hour: Number(f.hour), minute: Number(f.minute), tz: f.tz },
    };
    return payload;
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
      setMsg(editing ? 'Updated' : 'Created');
      setShowForm(false); setEditing(null); setForm(emptyForm());
      fetchList();
    } catch (err) { setMsg(err.message); }
  }

  function startEdit(s) {
    setEditing(s.id);
    const sc = s.schedule || {};
    setForm({
      name: s.name||'', skill: s.skill||SKILLS[0],
      productId: s.tpmScope?.productId||'ndb', release: s.tpmScope?.release||'',
      dayOfWeek: sc.dayOfWeek ?? 1, hour: sc.hour ?? 7, minute: sc.minute ?? 0,
      tz: s.tz||'Asia/Kolkata', enabled: s.enabled!==false, deferAfterPg: !!s.deferAfterPg,
      to: s.to||'', cc: s.cc||'', cron: sc.cron||'',
    });
    setShowForm(true);
  }

  async function toggleEnabled(s) {
    try {
      const r = await fetch(`/api/config/schedules/${s.id}`, { method:'PUT', headers: headers(), body: JSON.stringify({ enabled: !s.enabled }) });
      if (!r.ok) throw new Error('Toggle failed');
      fetchList();
    } catch (e) { setMsg(e.message); }
  }
  async function del(id) {
    if (!window.confirm('Delete this schedule?')) return;
    await fetch(`/api/config/schedules/${id}`, { method:'DELETE', headers: headers() });
    fetchList();
  }

  if (loading) return <div className="schedule-page"><p>Loading…</p></div>;

  return (
    <div className="schedule-page">
      <h1>Schedules — TPM digest</h1>
      <div className="sched-toolbar">
        <button onClick={() => { setEditing(null); setForm(emptyForm()); setShowForm(v=>!v); }}>{showForm ? 'Close' : '+ New schedule'}</button>
        <span className="sched-when">What runs when — {schedules.length} schedule(s)</span>
        {msg && <span style={{marginLeft:8,fontSize:12}}>{msg}</span>}
      </div>

      {showForm && (
        <form className="sched-form" onSubmit={handleSave}>
          <label>Name<input value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="NDB morning digest" required /></label>
          <label>Skill<select value={form.skill} onChange={e=>setForm({...form,skill:e.target.value})}>{SKILLS.map(s=><option key={s} value={s}>{s}</option>)}</select></label>
          <label>Product<input value={form.productId} onChange={e=>setForm({...form,productId:e.target.value})} placeholder="ndb" required /></label>
          <label>Release<input value={form.release} onChange={e=>setForm({...form,release:e.target.value})} placeholder="NDB-3.0" required /></label>
          <label>Day<select value={form.dayOfWeek} onChange={e=>setForm({...form,dayOfWeek:e.target.value})}>{DAYS.map((d,i)=><option key={i} value={i}>{d}</option>)}</select></label>
          <label>Hour<input type="number" min="0" max="23" value={form.hour} onChange={e=>setForm({...form,hour:e.target.value})} /></label>
          <label>Minute<input type="number" min="0" max="59" value={form.minute} onChange={e=>setForm({...form,minute:e.target.value})} /></label>
          <label>TZ<select value={form.tz} onChange={e=>setForm({...form,tz:e.target.value})}>{TZS.map(t=><option key={t} value={t}>{t}</option>)}</select></label>
          <label>To<input value={form.to} onChange={e=>setForm({...form,to:e.target.value})} placeholder="team@example.com" /></label>
          <label>CC<input value={form.cc} onChange={e=>setForm({...form,cc:e.target.value})} placeholder="cc@example.com" /></label>
          <label>Cron (optional, overrides day/hour/minute)<input value={form.cron} onChange={e=>setForm({...form,cron:e.target.value})} placeholder="0 7 * * 1" /></label>
          <label><span><input type="checkbox" checked={form.enabled} onChange={e=>setForm({...form,enabled:e.target.checked})} /> Enabled</span></label>
          <label><span><input type="checkbox" checked={form.deferAfterPg} onChange={e=>setForm({...form,deferAfterPg:e.target.checked})} /> Defer after PG</span></label>
          <div className="full"><button type="submit">{editing ? 'Update' : 'Create'}</button> <button type="button" onClick={()=>setShowForm(false)}>Cancel</button></div>
        </form>
      )}

      <table className="sched-table">
        <thead><tr><th>Name</th><th>Skill</th><th>Scope</th><th>When</th><th>To</th><th>Last run</th><th>Status</th><th /></tr></thead>
        <tbody>
          {schedules.length===0 && <tr><td colSpan={8} style={{textAlign:'center',color:'#6c757d'}}>No schedules yet — create one above or via chat: “schedule the digest for NDB at 7am IST”.</td></tr>}
          {schedules.map(s=>(
            <tr key={s.id}>
              <td>{s.name || '—'}</td>
              <td>{s.skill}</td>
              <td>{s.tpmScope?.productId}/{s.tpmScope?.release}</td>
              <td><span className="sched-when">{s.when}</span> <span className={`sched-badge ${s.enabled?'on':'off'}`}>{s.enabled?'ON':'OFF'}</span></td>
              <td>{s.to || '—'}</td>
              <td>{s.lastRun ? new Date(s.lastRun).toLocaleString() : '—'}</td>
              <td>{s.lastStatus || '—'}</td>
              <td>
                <button onClick={()=>startEdit(s)}>Edit</button>{' '}
                <button onClick={()=>toggleEnabled(s)}>{s.enabled?'Pause':'Resume'}</button>{' '}
                <button onClick={()=>del(s.id)}>Delete</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
