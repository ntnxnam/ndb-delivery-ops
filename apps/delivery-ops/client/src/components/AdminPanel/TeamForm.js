import React, { useState, useCallback, useMemo } from 'react';
import { useTeamDetect } from '../../hooks/useTeamDetect';

export function slugifyTeamId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

const fieldLabel = { display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '4px' };
const fieldError = { fontSize: '12px', color: '#dc2626', margin: '4px 0 0' };
const input = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 10px',
  fontSize: '14px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
};
const inputError = { ...input, borderColor: '#fca5a5', backgroundColor: '#fef2f2' };
const button = (bg, color = 'white') => ({
  padding: '6px 14px',
  minHeight: '2rem',
  backgroundColor: bg,
  color,
  border: 'none',
  borderRadius: '6px',
  fontSize: '14px',
  cursor: 'pointer',
});
const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '4px',
  background: '#e0e7ff',
  color: '#3730a3',
  borderRadius: '12px',
  padding: '2px 8px',
  fontSize: '12px',
  margin: '2px',
};
const chipRemove = { cursor: 'pointer', fontWeight: 700, marginLeft: '4px', padding: '2px 6px', minWidth: '24px', minHeight: '24px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '8px' };

// Known components across ENG + horizontals — used for autocomplete suggestions
const KNOWN_COMPONENTS = [
  'NDB', 'Era', 'ERA', 'NDB Databases', 'NDB Service',
  'NDB-API-Infra', 'NDB-Backup-Restore', 'NDB-CP-Availability',
  'DB Migration', 'NDB-IAM', 'NDB-UI', 'Platform',
  'Era-MSSQL', 'Era-Platform',
  'Cerebro', 'Xi-DR', 'DR', 'DR-Backup',
  'Infrastructure', 'MSP-PC', 'MSP-SMSP', 'LCM-Framework',
  'NKP - Konvoy', 'NDK-Dev', 'NDK-Blocks-Sync',
];

const CONTACT_ROWS = [
  { key: 'team', label: 'Team' },
  { key: 'serv_team', label: 'Serv team' },
  { key: 'doc_team', label: 'Doc Team' },
  { key: 'security_team', label: 'Security team' },
  { key: 'legal', label: 'Legal' },
  { key: 'documentation', label: 'Documentation' },
  { key: 'trade_compliance', label: 'Trade Compliance' },
  { key: 'others', label: 'Others' },
];

function ChipInput({ value, onChange, placeholder, suggestions = [], error }) {
  const [inputVal, setInputVal] = useState('');
  const [showSug, setShowSug] = useState(false);
  const filtered = useMemo(() => {
    const q = inputVal.toLowerCase().trim();
    if (!q) return suggestions.slice(0, 8);
    return suggestions.filter(s => s.toLowerCase().includes(q) && !value.includes(s)).slice(0, 8);
  }, [inputVal, value, suggestions]);

  const addChip = (chip) => {
    const vals = String(chip).split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
    const next = [...value];
    for (const v of vals) if (!next.includes(v)) next.push(v);
    onChange(next);
    setInputVal('');
    setShowSug(false);
  };
  const removeChip = (chip) => onChange(value.filter(v => v !== chip));
  const onKeyDown = (e) => {
    if ((e.key === 'Enter' || e.key === ',') && inputVal.trim()) {
      e.preventDefault();
      addChip(inputVal.trim());
    } else if (e.key === 'Backspace' && !inputVal && value.length) {
      removeChip(value[value.length - 1]);
    }
  };
  const onPaste = (e) => {
    const text = e.clipboardData.getData('text');
    if (text && /[,;\n]/.test(text)) {
      e.preventDefault();
      addChip(text);
    }
  };
  const onBlurAdd = () => {
    if (inputVal.trim()) addChip(inputVal.trim());
    setTimeout(() => setShowSug(false), 150);
  };
  return (
    <div style={{ border: `1px solid ${error ? '#fca5a5' : '#d1d5db'}`, borderRadius: '4px', padding: '4px', minHeight: '34px', background: error ? '#fef2f2' : 'white' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        {value.map(v => (
          <span key={v} style={chipStyle}>{v}<span role="button" tabIndex={0} aria-label={`Remove ${v}`} style={chipRemove} onClick={() => removeChip(v)} onKeyDown={(e) => e.key === 'Enter' && removeChip(v)}>×</span></span>
        ))}
        <input
          value={inputVal}
          onChange={e => { setInputVal(e.target.value); setShowSug(true); }}
          onFocus={() => setShowSug(true)}
          onBlur={onBlurAdd}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={value.length === 0 ? placeholder : ''}
          aria-label={placeholder}
          style={{ border: 'none', outline: 'none', fontSize: '14px', flex: '1 0 120px', minWidth: '80px', padding: '4px' }}
        />
      </div>
      {showSug && filtered.length > 0 && (
        <div role="listbox" style={{ borderTop: '1px solid #e5e7eb', marginTop: '4px', maxHeight: '120px', overflowY: 'auto' }}>
          {filtered.map(s => (
            <div key={s} role="option" onMouseDown={() => addChip(s)} style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '13px', background: value.includes(s) ? '#f3f4f6' : 'white' }}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function summary(team) {
  const comps = team.components || Object.keys(team.featureComponents || {});
  const cal = team.sprintCalendar;
  return [
    `Project ${team.projectKey || team.custom_project_key || '—'}`,
    `board ${team.boardId || '—'}`,
    cal ? `S1 ${cal.s1StartIso} · ${cal.sprintDays}d` : 'no sprint calendar',
    comps.length ? `components ${comps.join(', ')}` : 'no components',
  ].join(' · ');
}

function parseComponentsFromJql(jql) {
  if (!jql || typeof jql !== 'string') return [];
  // Match component in (...) handling quoted strings with commas
  const m = jql.match(/component\s+in\s*\(([^)]+)\)/i);
  if (!m) return [];
  const raw = m[1];
  // Split respecting quoted values: "NDB Databases" stays together
  const parts = [];
  let cur = '';
  let inQuote = false;
  let escapeNext = false;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (escapeNext) { cur += ch; escapeNext = false; continue; }
    if (ch === '\\') { escapeNext = true; cur += ch; continue; }
    if (ch === '"') { inQuote = !inQuote; cur += ch; continue; }
    if (ch === ',' && !inQuote) { parts.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts.map(s => s.trim().replace(/^"|"$/g, '').replace(/\\"/g, '"')).filter(Boolean);
}
function esc(v) { return String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function dedupeTrim(arr) { const seen = new Set(); const out = []; for (const v of arr) { const s = String(v || '').trim(); if (!s) continue; const k = s.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(s); } return out; }
function initialComponentsFor(team) {
  if (!team) return [];
  if (Array.isArray(team.components) && team.components.length) return team.components;
  const fromJql = parseComponentsFromJql(team.baseFilter || team.base_jql || team.baseJql || '');
  if (fromJql.length) return fromJql;
  if (team.featureComponents && typeof team.featureComponents === 'object') {
    const keys = Object.keys(team.featureComponents);
    if (keys.length) return keys;
  }
  return [];
}
function formatJql(jql) {
  if (!jql || jql.startsWith('(add ')) return jql;
  let out = String(jql);
  out = out.replace(/\s+OR\s+/g, '\nOR\n');
  out = out.replace(/\s+AND\s+/g, '\nAND\n');
  out = out.replace(/\(\s*/g, '(\n  ');
  out = out.replace(/\s*\)/g, '\n)');
  out = out.replace(/,\s*/g, ', ');
  const lines = out.split('\n');
  let indent = 0;
  const formatted = lines.map(l => {
    const t = l.trim();
    if (!t) return '';
    if (t === ')') indent = Math.max(0, indent - 1);
    const res = '  '.repeat(indent) + t;
    if (t.endsWith('(')) indent += 1;
    return res;
  }).filter(l => l !== '').join('\n');
  return formatted;
}

function buildPreview({ isShared, customKey, components, contactRows }) {
  const comps = dedupeTrim(components.filter(Boolean));
  if (comps.length === 0) return '(add at least one component to preview)';
  const shared = 'ENG, FEAT, ONCALL, TH, SDL, TECHPUBS, SR, LEG, ACP, LBDR';
  const innerParts = [];
  innerParts.push(`component in (${comps.map(c => /\s/.test(c) || c.includes('"') ? `"${esc(c)}"` : c).join(', ')})`);
  innerParts.push(`"primary component" in (${comps.map(c => `"${esc(c)}"`).join(', ')})`);
  const dl = [];
  const handles = [];
  for (const r of Object.values(contactRows)) {
    if (!r || !r.entries) continue;
    if (r.isDL) dl.push(...dedupeTrim(r.entries).map(v => `membersOf("${esc(v)}")`));
    else handles.push(...dedupeTrim(r.entries));
  }
  const assignee = [...dl, ...handles];
  if (assignee.length) innerParts.push(`assignee in (${assignee.join(', ')})`);
  innerParts.push(`issuetype in ("Era Oncall", "ERA Oncall")`);
  const inner = innerParts.join(' OR ');
  if (isShared) return `project in (${shared}) AND (${inner})`;
  const customKeys = dedupeTrim(String(customKey || '').split(/[,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean));
  const custom = customKeys.length ? customKeys.join(', ') : 'ERA';
  return `(project in (${custom}) OR (project in (${shared}) AND (${inner})))`;
}

export default function TeamForm({ initialTeam = null, onSave, onCancel }) {
  const editMode = Boolean(initialTeam);
  const { detecting, detectError, calendarLoading, loadProject, loadBoardCalendar } = useTeamDetect();
  const [name, setName] = useState(initialTeam?.name || '');
  const [teamId, setTeamId] = useState(initialTeam?.id || '');
  const [idTouched, setIdTouched] = useState(editMode);
  const [isShared, setIsShared] = useState(() => {
    if (initialTeam?.is_shared_project !== undefined) return initialTeam.is_shared_project;
    if (initialTeam?.custom_project_key) return false;
    if (initialTeam?.projectKey && initialTeam.projectKey !== 'ENG') return false;
    return true;
  });
  const [customKey, setCustomKey] = useState(() => {
    if (initialTeam?.custom_project_key) return initialTeam.custom_project_key;
    if (initialTeam?.projectKey && initialTeam.projectKey !== 'ENG') return initialTeam.projectKey;
    return '';
  });
  const [components, setComponents] = useState(() => initialComponentsFor(initialTeam));
  const [leaderDLs, setLeaderDLs] = useState(initialTeam?.leader_outlook_dls || []);
  const [baseFilter, setBaseFilter] = useState(initialTeam?.baseFilter || initialTeam?.base_jql || '');
  const [contactRows, setContactRows] = useState(() => {
    const init = {};
    for (const r of CONTACT_ROWS) {
      const existing = initialTeam?.contacts?.[r.key];
      if (existing) init[r.key] = { entries: existing.entries || [], isDL: Boolean(existing.isDL) };
      else init[r.key] = { entries: [], isDL: false };
    }
    return init;
  });
  const [selection, setSelection] = useState({
    projectKey: initialTeam?.projectKey || initialTeam?.custom_project_key?.split(',')[0]?.trim() || '',
    boardId: initialTeam?.boardId != null ? String(initialTeam.boardId) : '',
    sprintCalendar: initialTeam?.sprintCalendar || null,
    calendarError: '',
    calendarManual: false,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [triedSave, setTriedSave] = useState(false);
  const [copyOk, setCopyOk] = useState(false);

  const handleName = (value) => {
    setName(value);
    if (!idTouched) setTeamId(slugifyTeamId(value));
  };

  const handleContactChange = (key, entries) => {
    setContactRows(prev => ({ ...prev, [key]: { ...prev[key], entries } }));
  };
  const handleContactToggle = (key) => {
    setContactRows(prev => ({ ...prev, [key]: { ...prev[key], isDL: !prev[key].isDL } }));
  };

  const previewJql = buildPreview({ isShared, customKey, components, contactRows });

  // Keep baseFilter in sync with preview unless user has manually edited it
  const [baseFilterTouched, setBaseFilterTouched] = useState(false);
  React.useEffect(() => { if (!baseFilterTouched) setBaseFilter(previewJql); }, [previewJql]); // eslint-disable-line react-hooks/exhaustive-deps
  React.useEffect(() => { // re-init if initialTeam changes (edit switch)
    setComponents(initialComponentsFor(initialTeam));
    setBaseFilter(initialTeam?.baseFilter || initialTeam?.base_jql || '');
    setBaseFilterTouched(false);
    setContactRows(() => {
      const init = {};
      for (const r of CONTACT_ROWS) {
        const existing = initialTeam?.contacts?.[r.key];
        if (existing) init[r.key] = { entries: existing.entries || [], isDL: Boolean(existing.isDL) };
        else init[r.key] = { entries: [], isDL: false };
      }
      return init;
    });
    setSelection({
      projectKey: initialTeam?.projectKey || initialTeam?.custom_project_key?.split(',')[0]?.trim() || '',
      boardId: initialTeam?.boardId != null ? String(initialTeam.boardId) : '',
      sprintCalendar: initialTeam?.sprintCalendar || null,
      calendarError: '',
      calendarManual: false,
    });
  }, [initialTeam?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const nameError = triedSave && !name.trim() ? 'Team name is required' : '';
  const compError = triedSave && components.length === 0 ? 'Add at least one component' : '';
  const customError = triedSave && !isShared && !customKey.trim() ? 'Custom project key is required' : '';
  const boardError = triedSave && !selection.boardId ? '' : ''; // board optional per spec, warn only

  const canSave = Boolean(name.trim() && teamId && components.length > 0 && (!isShared ? customKey.trim() : true)) && !saving;

  const handleSave = async () => {
    setTriedSave(true);
    if (!canSave) {
      setSaveError('Fix the highlighted fields before saving.');
      return;
    }
    setSaving(true);
    setSaveError('');
    const contacts = {};
    for (const r of CONTACT_ROWS) {
      contacts[r.key] = contactRows[r.key];
    }
    const boardIdNum = selection.boardId ? Number(String(selection.boardId).trim()) : null;
    const payload = {
      name: name.trim(),
      is_shared_project: isShared,
      custom_project_key: isShared ? null : customKey.trim().toUpperCase(),
      components,
      leader_outlook_dls: leaderDLs,
      contacts,
      boardId: Number.isInteger(boardIdNum) && boardIdNum > 0 ? boardIdNum : null,
      sprintCalendar: selection.sprintCalendar,
      baseFilter: baseFilter.trim() || previewJql,
      base_jql: baseFilter.trim() || previewJql,
      projectKey: isShared ? 'ENG' : customKey.trim().split(',')[0].toUpperCase(),
    };
    if (!editMode) payload.id = teamId;
    // Keep legacy fields for compat
    payload.projectKey = isShared ? 'ENG' : customKey.trim().split(',')[0].toUpperCase();
    try {
      await onSave(payload, editIdRef);
    } catch (err) {
      setSaveError(err.message || 'Failed to save team');
    } finally {
      setSaving(false);
    }
  };

  const editIdRef = editMode ? initialTeam.id : null;

  const copyPreview = async () => {
    try { await navigator.clipboard.writeText(previewJql); setCopyOk(true); setTimeout(() => setCopyOk(false), 2000); } catch (_) { /* ignore */ }
  };

  // Keep sprint calendar detection for board
  const runDetectForBoard = useCallback(async () => {
    const pk = isShared ? 'ENG' : customKey.trim().split(',')[0].trim().toUpperCase();
    if (!pk) return;
    const out = await loadProject(pk, name);
    if (!out?.board) return;
    setSelection(prev => ({
      ...prev,
      projectKey: pk,
      boardId: out.board.boardId != null ? String(out.board.boardId) : prev.boardId,
      sprintCalendar: out.board.sprintCalendar || prev.sprintCalendar,
      calendarError: out.board.calendarError || '',
      calendarManual: !out.board.sprintCalendar,
    }));
  }, [isShared, customKey, name, loadProject]);

  return (
    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 16px' }}>{editMode ? `Edit ${initialTeam.name}` : 'Add team'}</h2>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', marginBottom: '12px' }}>
        <div style={{ flex: '2 1 240px', minWidth: '200px' }}>
          <label htmlFor="team-name" style={fieldLabel}>Team Name *</label>
          <input id="team-name" aria-required="true" aria-invalid={Boolean(nameError)} style={nameError ? inputError : input} value={name} onChange={e => handleName(e.target.value)} placeholder="NDB, DR" />
          {nameError && <div style={fieldError}>{nameError}</div>}
        </div>
        <div style={{ flex: '1 1 160px', minWidth: '140px' }}>
          <label htmlFor="team-code" style={fieldLabel}>Team code</label>
          <input id="team-code" aria-label="Team code" style={{ ...input, backgroundColor: editMode ? '#f3f4f6' : 'white' }} value={teamId} readOnly={editMode} onChange={e => { setIdTouched(true); setTeamId(slugifyTeamId(e.target.value)); }} />
          <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>{editMode ? 'Code cannot be changed after creation' : 'Auto-generated from name'}</div>
        </div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={fieldLabel}>Project Type *</label>
        <div style={{ display: 'flex', gap: '16px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}><input type="radio" checked={isShared} onChange={() => setIsShared(true)} /> Shared Project</label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '14px' }}><input type="radio" checked={!isShared} onChange={() => setIsShared(false)} /> Not Shared / Custom Project</label>
        </div>
      </div>

      {!isShared && (
        <div style={{ marginBottom: '12px' }}>
          <label htmlFor="custom-project" style={fieldLabel}>Custom Project Key * (comma-separated for multiple, e.g. ERA, NDBECO)</label>
          <input id="custom-project" aria-required="true" aria-invalid={Boolean(customError)} style={customError ? inputError : input} value={customKey} onChange={e => setCustomKey(e.target.value)} placeholder="ERA" />
          {customError && <div style={fieldError}>{customError}</div>}
        </div>
      )}

      <div style={{ marginBottom: '12px' }}>
        <label style={fieldLabel}>Components * (validated across ENG + FEAT/ONCALL/TH/SDL/TECHPUBS/SR/LEG/ACP/LBDR)</label>
        <ChipInput value={components} onChange={setComponents} placeholder="Type component and press Enter, or pick suggestion" suggestions={KNOWN_COMPONENTS} error={Boolean(compError)} />
        {compError ? <div style={fieldError}>{compError}</div> : <p style={{ fontSize: '11px', color: '#6b7280', margin: '4px 0 0' }}>Press Enter or comma to add. Paste comma-separated. Suggestions from Atlas.</p>}
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={fieldLabel}>Leadership Outlook DL(s) — for emails, not JQL</label>
        <ChipInput value={leaderDLs} onChange={setLeaderDLs} placeholder="team-ndb-leads@nutanix.com, era-managers@nutanix.com" suggestions={[]} />
        <p style={{ fontSize: '11px', color: '#6b7280', margin: '4px 0 0' }}>Optional. For report distribution only — does not affect JQL.</p>
      </div>

      <div style={{ marginBottom: '12px', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '12px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px' }}>Role / Function Contacts — affects JQL assignee</h3>
        <p style={{ fontSize: '11px', color: '#6b7280', margin: '0 0 8px' }}>Each row → <code>assignee in (membersOf("DL") OR handle)</code> inner OR with <code>component</code> / <code>"primary component"</code> / <code>issuetype</code>. Tick DL for distribution lists.</p>
        {CONTACT_ROWS.map(row => (
          <div key={row.key} style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
            <div style={{ flex: '1 1 220px', minWidth: '200px' }}>
              <label htmlFor={`contact-${row.key}`} style={{ fontSize: '12px', fontWeight: 500 }}>{row.label}</label>
              <ChipInput value={contactRows[row.key].entries} onChange={v => handleContactChange(row.key, v)} placeholder={`Add ${row.label} handles/DLs`} suggestions={[]} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', flex: '0 0 120px' }}>
              <input id={`contact-${row.key}-dl`} type="checkbox" checked={contactRows[row.key].isDL} onChange={() => handleContactToggle(row.key)} /> DL
              <span style={{ color: '#6b7280' }} title={contactRows[row.key].isDL ? 'Will use membersOf("DL")' : 'Will use assignee in (handle)'}>{contactRows[row.key].isDL ? '→ membersOf' : '→ handle'}</span>
            </label>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '4px' }}>
          <div style={{ fontSize: '12px', fontWeight: 600 }}>Auto-generated Base JQL (preview)</div>
          <button type="button" onClick={copyPreview} style={button(copyOk ? '#15803d' : '#e5e7eb', copyOk ? 'white' : '#374151')}>{copyOk ? 'Copied!' : 'Copy'}</button>
        </div>
        <pre style={{ fontFamily: 'monospace', fontSize: '12px', background: 'white', padding: '8px', borderRadius: '4px', border: '1px solid #e5e7eb', whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowX: 'auto', maxHeight: '240px', margin: 0 }}>{formatJql(previewJql)}</pre>
        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Saved as <code>base_jql</code> + <code>baseFilter</code> (compat). Rest of app reads it unchanged.</div>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label htmlFor="team-base-filter" style={fieldLabel}>Base Filter (editable override)</label>
        <textarea id="team-base-filter" rows={3} aria-label="Base Filter" style={{ ...input, fontFamily: 'monospace', fontSize: '12px' }} value={baseFilter} onChange={e => { setBaseFilter(e.target.value); setBaseFilterTouched(true); }} placeholder='project in (ENG,FEAT...) AND (component in (...))' />
        <p style={{ fontSize: '11px', color: '#6b7280', margin: '4px 0 0' }}>Defaults to preview. Edit only to override. <button type="button" onClick={() => { setBaseFilter(previewJql); setBaseFilterTouched(false); }} style={{ padding: 0, border: 'none', background: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '11px' }}>Reset to preview</button></p>
      </div>

      <div style={{ marginBottom: '12px', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '12px' }}>
        <label style={fieldLabel}>Sprint Board — for full team</label>
        <p style={{ fontSize: '11px', color: '#6b7280', margin: '0 0 8px' }}>One board number + sprint duration + base date (S1 start) applies to whole team.</p>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input aria-label="Sprint board ID" style={{ ...input, flex: '1 1 120px' }} value={selection.boardId} onChange={e => setSelection(p => ({ ...p, boardId: e.target.value.replace(/[^0-9]/g, '') }))} placeholder="Board #" inputMode="numeric" />
          <input aria-label="Sprint duration days" type="number" min="1" max="90" style={{ ...input, flex: '0 0 110px' }} value={selection.sprintCalendar?.sprintDays || ''} onChange={e => setSelection(p => ({ ...p, sprintCalendar: p.sprintCalendar ? { ...p.sprintCalendar, sprintDays: Number(e.target.value) || 21 } : { s1StartIso: new Date().toISOString().slice(0,10), sprintDays: Number(e.target.value) || 21 } }))} placeholder="21 days" />
          <input aria-label="Base date S1 start" type="date" style={{ ...input, flex: '0 0 150px' }} value={selection.sprintCalendar?.s1StartIso || ''} onChange={e => setSelection(p => ({ ...p, sprintCalendar: { s1StartIso: e.target.value, sprintDays: p.sprintCalendar?.sprintDays || 21 } }))} />
          <button type="button" onClick={async () => {
            const id = selection.boardId;
            if (!id) return;
            const out = await loadBoardCalendar(id);
            setSelection(p => ({ ...p, sprintCalendar: out?.sprintCalendar || null, calendarError: out?.calendarError || '', calendarManual: !out?.sprintCalendar }));
          }} disabled={!selection.boardId || calendarLoading} style={button(!selection.boardId || calendarLoading ? '#9ca3af' : '#0ea5e9')}>{calendarLoading ? 'Loading…' : 'Load Calendar'}</button>
          <button type="button" onClick={runDetectForBoard} disabled={detecting} style={button(detecting ? '#9ca3af' : '#2563eb')}>{detecting ? 'Detecting…' : 'Auto-detect from project'}</button>
        </div>
        <p style={{ fontSize: '11px', color: '#6b7280', margin: '4px 0 0' }}>Enter board number from Jira Agility board URL, or auto-detect from project key.</p>
        {detectError && <div role="alert" style={{ color: '#dc2626', fontSize: '13px', marginTop: '6px' }}>{detectError}</div>}
        {selection.calendarError && <div role="alert" style={{ color: '#b45309', fontSize: '12px', marginTop: '6px' }}>{selection.calendarError}</div>}
        {selection.sprintCalendar && <div style={{ fontSize: '12px', color: '#065f46', marginTop: '6px', background: '#ecfdf5', padding: '6px 8px', borderRadius: '4px' }}>S1 {selection.sprintCalendar.s1StartIso} · {selection.sprintCalendar.sprintDays} days</div>}
        {!selection.sprintCalendar && selection.calendarManual && <div style={{ fontSize: '12px', color: '#92400e', marginTop: '6px' }}>Could not detect calendar — fill manually below or check board ID.</div>}
        {editMode && <div style={{ fontSize: '12px', color: '#374151', marginTop: '6px' }}>Current: {summary(initialTeam)}</div>}
      </div>

      {saveError && <div role="alert" style={{ color: '#dc2626', fontSize: '14px', marginTop: '8px', background: '#fef2f2', border: '1px solid #fca5a5', padding: '8px', borderRadius: '4px' }}>{saveError}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
        <button type="button" onClick={onCancel} style={button('#f3f4f6', '#374151')}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={!canSave || saving} style={{ ...button((!canSave || saving) ? '#9ca3af' : '#15803d'), opacity: (!canSave || saving) ? 0.9 : 1 }} title={!canSave && triedSave ? 'Fix highlighted fields' : ''}>{saving ? 'Saving…' : editMode ? 'Save changes' : 'Create team'}</button>
      </div>
    </div>
  );
}
