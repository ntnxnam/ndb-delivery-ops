import React, { useState, useCallback } from 'react';
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

function pickComponents(components, existing) {
  const names = components.map((c) => c.name);
  const keep = names.filter((n) => existing.includes(n));
  if (keep.length) return keep;
  const suggested = components.filter((c) => c.suggested).map((c) => c.name);
  return suggested.length ? suggested : names;
}

function summary(team) {
  const comps = Object.keys(team.featureComponents || {});
  const cal = team.sprintCalendar;
  return [
    `Project ${team.projectKey || '—'}`,
    `board ${team.boardId || '—'}`,
    cal ? `S1 ${cal.s1StartIso} · ${cal.sprintDays}d` : 'no sprint calendar',
    comps.length ? `components ${comps.join(', ')}` : 'no components',
  ].join(' · ');
}

function TeamForm({ initialTeam = null, onSave, onCancel }) {
  const editMode = Boolean(initialTeam);
  const { detected, detecting, detectError, calendarLoading, detect, loadProject, loadBoardCalendar } = useTeamDetect();
  const [name, setName] = useState(initialTeam?.name || '');
  const [teamId, setTeamId] = useState(initialTeam?.id || '');
  const [idTouched, setIdTouched] = useState(editMode);
  const [baseFilter, setBaseFilter] = useState(initialTeam?.baseFilter || '');
  const [detectedFilter, setDetectedFilter] = useState(null);
  const [selection, setSelection] = useState({
    projectKey: initialTeam?.projectKey || '',
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

  const runDetect = useCallback(async () => {
    const filter = baseFilter.trim();
    const result = await detect({ baseFilter: filter, name, boardId: selection.boardId });
    if (!result) return;
    setDetectedFilter(filter);
    const components = result.feature?.components || [];
    setSelection((prev) => {
      const sprintCalendar = result.board?.sprintCalendar || prev.sprintCalendar || null;
      const keepComponents = Boolean(result.feature?.error) && components.length === 0;
      return {
        projectKey: result.projectKey || prev.projectKey,
        boardId: result.board?.boardId || prev.boardId || null,
        sprintCalendar,
        calendarError: result.board?.sprintCalendar ? '' : (result.board?.calendarError || ''),
        calendarManual: !sprintCalendar,
        components: keepComponents ? prev.components : pickComponents(components, prev.components),
      };
    });
  }, [baseFilter, name, selection.boardId, detect]);

  const handleProject = useCallback(async (projectKey) => {
    setSelection((prev) => ({
      ...prev,
      projectKey,
      boardId: null,
      sprintCalendar: null,
      calendarError: '',
      calendarManual: false,
    }));
    const out = await loadProject(projectKey, name);
    if (!out?.board) return;
    const componentNames = (out.feature?.components || []).map((component) => component.name);
    setSelection((prev) => (
      prev.projectKey !== projectKey ? prev : {
        ...prev,
        boardId: out.board.boardId || null,
        sprintCalendar: out.board.sprintCalendar || null,
        calendarError: out.board.calendarError || '',
        calendarManual: !out.board.sprintCalendar,
        components: out.feature ? componentNames : prev.components,
      }
    ));
  }, [loadProject, name]);

  const handleBoard = useCallback(async (boardId) => {
    setSelection((prev) => ({
      ...prev,
      boardId: Number(boardId),
      sprintCalendar: null,
      calendarError: '',
      calendarManual: false,
    }));
    const out = await loadBoardCalendar(boardId);
    setSelection((prev) => ({
      ...prev,
      sprintCalendar: out?.sprintCalendar || null,
      calendarError: out?.calendarError || '',
      calendarManual: !out?.sprintCalendar,
    }));
  }, [loadBoardCalendar]);

  const handleManualCalendar = useCallback((sprintCalendar) => {
    setSelection((prev) => ({ ...prev, sprintCalendar }));
  }, []);

  const unselectAllComponents = () => {
    setSelection((prev) => ({ ...prev, components: [] }));
  };

  const toggleComponent = (componentName) => {
    setSelection((prev) => ({
      ...prev,
      components: prev.components.includes(componentName)
        ? prev.components.filter((n) => n !== componentName)
        : [...prev.components, componentName],
    }));
  };

  const filter = baseFilter.trim();
  const filterChanged = !editMode || filter !== (initialTeam.baseFilter || '').trim();
  const needsDetect = filterChanged && (!detected || detectedFilter !== filter);
  const canSave = Boolean(name.trim() && teamId && filter && selection.projectKey && selection.sprintCalendar)
    && !needsDetect && !saving;

  const handleSave = async () => {
    setSaving(true);
    setSaveError('');
    const payload = {
      name: name.trim(),
      baseFilter: filter,
      projectKey: selection.projectKey,
      boardId: selection.boardId,
      sprintCalendar: selection.sprintCalendar,
    };
    if (!editMode) payload.id = teamId;
    if (detected) {
      const groups = detected.feature?.featureComponents || {};
      payload.featureComponents = Object.fromEntries(
        selection.components.filter((n) => groups[n]).map((n) => [n, groups[n]])
      );
    }
    try {
      await onSave(payload, editMode ? initialTeam.id : null);
    } catch (err) {
      setSaveError(err.message || 'Failed to save team');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ backgroundColor: 'white', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '20px' }}>
      <h2 style={{ fontSize: '20px', fontWeight: 600, margin: '0 0 16px' }}>{editMode ? `Edit ${initialTeam.name}` : 'Add team'}</h2>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '12px', marginBottom: '12px' }}>
        <div>
          <label htmlFor="team-name" style={fieldLabel}>Team name</label>
          <input id="team-name" style={input} value={name} onChange={(e) => handleName(e.target.value)} placeholder="e.g. Nutanix Cloud Native" />
        </div>
        <div>
          <label htmlFor="team-code" style={fieldLabel}>Team code</label>
          <input
            id="team-code"
            style={{ ...input, backgroundColor: editMode ? '#f3f4f6' : 'white' }}
            value={teamId}
            readOnly={editMode}
            onChange={(e) => { setIdTouched(true); setTeamId(slugifyTeamId(e.target.value)); }}
          />
        </div>
      </div>

      <label htmlFor="team-base-filter" style={fieldLabel}>Base filter (JQL)</label>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', marginBottom: '6px' }}>
        <textarea
          id="team-base-filter"
          rows={2}
          style={{ ...input, fontFamily: 'monospace' }}
          value={baseFilter}
          onChange={(e) => setBaseFilter(e.target.value)}
          placeholder="filter=NCN-All-Base-Filter and statusCategory!=Done"
        />
        <button type="button" onClick={runDetect} disabled={!filter || detecting} style={button(filter && !detecting ? '#2563eb' : '#9ca3af')}>
          {detecting ? 'Detecting…' : 'Detect'}
        </button>
      </div>
      <p style={{ fontSize: '12px', color: '#6b7280', margin: '0 0 12px' }}>
        Detect fills in the JIRA project, release versions, sprint board and calendar, and components.
      </p>

      {detectError && <div role="alert" style={{ color: '#dc2626', fontSize: '14px', marginBottom: '12px' }}>{detectError}</div>}
      {editMode && !detected && (
        <div style={{ fontSize: '13px', color: '#374151', marginBottom: '12px' }}>Current: {summary(initialTeam)}</div>
      )}

      <DetectedConfig
        detected={detected}
        selection={selection}
        calendarLoading={calendarLoading}
        onSelectProject={handleProject}
        onSelectBoard={handleBoard}
        onManualCalendar={handleManualCalendar}
        onToggleComponent={toggleComponent}
        onUnselectAll={unselectAllComponents}
      />

      {needsDetect && filter && !detecting && (
        <div style={{ fontSize: '13px', color: '#b45309', marginTop: '12px' }}>Run Detect on this base filter before saving.</div>
      )}
      {saveError && <div role="alert" style={{ color: '#dc2626', fontSize: '14px', marginTop: '12px' }}>{saveError}</div>}

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
        <button type="button" onClick={onCancel} style={button('#f3f4f6', '#374151')}>Cancel</button>
        <button type="button" onClick={handleSave} disabled={!canSave} style={button(canSave ? '#16a34a' : '#9ca3af')}>
          {saving ? 'Saving…' : editMode ? 'Save changes' : 'Create team'}
        </button>
      </div>
    </div>
  );
}

export default TeamForm;
