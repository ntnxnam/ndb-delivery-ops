import React, { useState, useCallback, useMemo } from 'react';
import { useTeamDetect } from '../../hooks/useTeamDetect';
import DetectedConfig from './DetectedConfig';

export function slugifyTeamId(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
}

const fieldLabel = { display: 'block', fontSize: '14px', fontWeight: 500, marginBottom: '4px' };
const input = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '6px 10px',
  fontSize: '14px',
  border: '1px solid #d1d5db',
  borderRadius: '4px',
};
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
const chipRemove = { cursor: 'pointer', fontWeight: 700, marginLeft: '2px' };

// Known components across ENG + horizontals — used for autocomplete suggestions (Atlas suggests based on first input)
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

function ChipInput({ value, onChange, placeholder, suggestions = [] }) {
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
  return (
    <div style={{ border: '1px solid #d1d5db', borderRadius: '4px', padding: '4px', minHeight: '34px', background: 'white' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }}>
        {value.map(v => (
          <span key={v} style={chipStyle}>{v}<span style={chipRemove} onClick={() => removeChip(v)}>×</span></span>
        ))}
        <input
          value={inputVal}
          onChange={e => { setInputVal(e.target.value); setShowSug(true); }}
          onFocus={() => setShowSug(true)}
          onBlur={() => setTimeout(() => setShowSug(false), 150)}
          onKeyDown={onKeyDown}
          placeholder={value.length === 0 ? placeholder : ''}
          style={{ border: 'none', outline: 'none', fontSize: '14px', flex: '1 0 120px', minWidth: '80px', padding: '4px' }}
        />
      </div>
      {showSug && filtered.length > 0 && (
        <div style={{ borderTop: '1px solid #e5e7eb', marginTop: '4px', maxHeight: '120px', overflowY: 'auto' }}>
          {filtered.map(s => (
            <div key={s} onMouseDown={() => addChip(s)} style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '13px', background: value.includes(s) ? '#f3f4f6' : 'white' }}>{s}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function summary(team) {
  const comps = Object.keys(team.featureComponents || {});
  const cal = team.sprintCalendar;
  return [
    `Project ${team.projectKey || team.custom_project_key || '—'}`,
    `board ${team.boardId || '—'}`,
    cal ? `S1 ${cal.s1StartIso} · ${cal.sprintDays}d` : 'no sprint calendar',
    comps.length ? `components ${comps.join(', ')}` : team.components ? `components ${team.components.join(', ')}` : 'no components',
  ].join(' · ');
}

function esc(v) { return String(v).replace(/"/g, '\\"'); }
function dedupeTrim(arr) { const seen = new Set(); const out = []; for (const v of arr) { const s = String(v||'').trim(); if (!s) continue; const k = s.toLowerCase(); if (seen.has(k)) continue; seen.add(k); out.push(s); } return out; }
function buildPreview({ isShared, customKey, components, contactRows }) {
  const comps = dedupeTrim(components.filter(Boolean));
  if (comps.length === 0) return '(add at least one component to preview)';
  const shared = 'ENG, FEAT, SDL, TECHPUBS, SR, LEG, NDBECO';
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
  const customKeys = dedupeTrim(String(customKey||'').split(/[,;]+/).map(s=>s.trim().toUpperCase()).filter(Boolean));
  const custom = customKeys.length ? customKeys.join(', ') : 'ERA';
  return `(project in (${custom}) OR (project in (${shared}) AND (${inner})))`;
}

export default function TeamForm({ initialTeam = null, onSave, onCancel }) {
  const editMode = Boolean(initialTeam);
  const { detected, detecting, detectError, calendarLoading, detect, loadProject, loadBoardCalendar } = useTeamDetect();
  const [name, setName] = useState(initialTeam?.name || '');
  const [teamId, setTeamId] = useState(initialTeam?.id || '');
  const [idTouched, setIdTouched] = useState(editMode);
  const [isShared, setIsShared] = useState(initialTeam?.is_shared_project ?? true);
  const [customKey, setCustomKey] = useState(initialTeam?.custom_project_key || initialTeam?.projectKey === 'ENG' ? '' : (initialTeam?.custom_project_key || initialTeam?.projectKey || ''));
  const [components, setComponents] = useState(initialTeam?.components || Object.keys(initialTeam?.featureComponents || {}) || []);
  const [leaderDLs, setLeaderDLs] = useState(initialTeam?.leader_outlook_dls || []);
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
    boardId: initialTeam?.boardId || null,
    sprintCalendar: initialTeam?.sprintCalendar || null,
    calendarError: '',
    calendarManual: false,
    components: Object.keys(initialTeam?.featureComponents || {}),
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');

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

  const canSave = Boolean(name.trim() && teamId && components.length > 0 && (!isShared ? customKey.trim() : true) && selection.sprintCalendar) && !saving;

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    const contacts = {};
    for (const r of CONTACT_ROWS) {
      if (contactRows[r.key].entries.length) contacts[r.key] = contactRows[r.key];
    }
    const payload = {
      name: name.trim(),
      is_shared_project: isShared,
      custom_project_key: isShared ? null : customKey.trim().toUpperCase(),
      components,
      leader_outlook_dls: leaderDLs,
      contacts,
      boardId: selection.boardId,
      sprintCalendar: selection.sprintCalendar,
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

  // Keep sprint calendar detection for board
  const runDetectForBoard = useCallback(async () => {
    const pk = isShared ? 'ENG' : customKey.trim().split(',')[0].trim().toUpperCase();
    if (!pk) return;
    const out = await loadProject(pk, name);
    if (!out?.board) return;
    setSelection(prev => ({
      ...prev,
      projectKey: pk,
      boardId: out.board.boardId || null,
      sprintCalendar: out.board.sprintCalendar || null,
      calendarError: out.board.calendarError || '',
      calendarManual: !out.board.sprintCalendar,
    }));
  }, [isShared, customKey, name, loadProject]);

  return (
    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 16px' }}>{editMode ? `Edit ${initialTeam.name}` : 'Add team'}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label htmlFor="team-name" style={fieldLabel}>Team Name *</label>
          <input id="team-name" style={input} value={name} onChange={e => handleName(e.target.value)} placeholder="NDB, DR" />
        </div>
        <div>
          <label htmlFor="team-code" style={fieldLabel}>Team code</label>
          <input id="team-code" style={{ ...input, backgroundColor: editMode ? '#f3f4f6' : 'white' }} value={teamId} readOnly={editMode} onChange={e => { setIdTouched(true); setTeamId(slugifyTeamId(e.target.value)); }} />
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
          <input id="custom-project" style={input} value={customKey} onChange={e => setCustomKey(e.target.value)} placeholder="ERA" />
        </div>
      )}

      <div style={{ marginBottom: '12px' }}>
        <label style={fieldLabel}>Components * (validated across ENG + FEAT/SDL/TECHPUBS/SR/LEG/NDBECO)</label>
        <ChipInput value={components} onChange={setComponents} placeholder="Type component and press Enter, or pick suggestion" suggestions={KNOWN_COMPONENTS} />
        <p style={{ fontSize: '11px', color: '#6b7280', margin: '4px 0 0' }}>Atlas suggests based on first input. Same list used for ENG + horizontal projects.</p>
      </div>

      <div style={{ marginBottom: '12px' }}>
        <label style={fieldLabel}>Leadership Outlook DL(s) (comma-separated emails)</label>
        <ChipInput value={leaderDLs} onChange={setLeaderDLs} placeholder="team-ndb-leads@nutanix.com, era-managers@nutanix.com" suggestions={[]} />
      </div>

      <div style={{ marginBottom: '12px', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '12px' }}>
        <h3 style={{ fontSize: '14px', fontWeight: 600, margin: '0 0 8px' }}>Role / Function Contacts (Jira handles or DLs)</h3>
        <p style={{ fontSize: '11px', color: '#6b7280', margin: '0 0 8px' }}>Each row: type handles/DLs comma-separated, tick DL if row entries are DLs (→ membersOf), else handles.</p>
        {CONTACT_ROWS.map(row => (
          <div key={row.key} style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: '8px', alignItems: 'center', marginBottom: '6px' }}>
            <div>
              <label style={{ fontSize: '12px', fontWeight: 500 }}>{row.label}</label>
              <ChipInput value={contactRows[row.key].entries} onChange={v => handleContactChange(row.key, v)} placeholder={`Add ${row.label} handles/DLs`} suggestions={[]} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', marginTop: '16px' }}>
              <input type="checkbox" checked={contactRows[row.key].isDL} onChange={() => handleContactToggle(row.key)} /> DL
              <span style={{ color: '#6b7280' }} title={contactRows[row.key].isDL ? 'Will use membersOf("DL")' : 'Will use assignee in (handle)'}>{contactRows[row.key].isDL ? '→ membersOf' : '→ handle'}</span>
            </label>
          </div>
        ))}
      </div>

      <div style={{ marginBottom: '12px', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '6px', padding: '10px' }}>
        <div style={{ fontSize: '12px', fontWeight: 600, marginBottom: '4px' }}>Auto-generated Base JQL (preview)</div>
        <div style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all', background: 'white', padding: '8px', borderRadius: '4px', border: '1px solid #e5e7eb' }}>{previewJql}</div>
        <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px' }}>Saved as <code>base_jql</code> + <code>baseFilter</code> (compat). Rest of app reads it unchanged.</div>
      </div>

      <div style={{ marginBottom: '12px', borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <button type="button" onClick={runDetectForBoard} disabled={detecting} style={button(detecting ? '#9ca3af' : '#2563eb')}>{detecting ? 'Detecting…' : 'Detect Board Calendar'}</button>
          <span style={{ fontSize: '12px', color: '#6b7280' }}>Fills sprint board + calendar from project key.</span>
        </div>
        {detectError && <div role="alert" style={{ color: '#dc2626', fontSize: '13px', marginTop: '6px' }}>{detectError}</div>}
        {editMode && !detected && <div style={{ fontSize: '12px', color: '#374151', marginTop: '6px' }}>Current: {summary(initialTeam)}</div>}
        <DetectedConfig detected={detected} selection={selection} calendarLoading={calendarLoading} onSelectProject={() => {}} onSelectBoard={() => {}} onManualCalendar={v => setSelection(p => ({ ...p, sprintCalendar: v }))} onToggleComponent={() => {}} onUnselectAll={() => {}} />
      </div>

      {saveError && <div role="alert" style={{ color: '#dc2626', fontSize: '14px', marginTop: '8px' }}>{saveError}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
        <button type="button" onClick={onCancel} style={button('#f3f4f6', '#374151')}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={!canSave} style={button(canSave ? '#16a34a' : '#9ca3af')} title={!canSave ? 'Fill Team Name, Components, Custom Project (if Not Shared), and detect board calendar' : ''}>{saving ? 'Saving…' : editMode ? 'Save changes' : 'Create team'}</button>
      </div>
    </div>
  );
}
