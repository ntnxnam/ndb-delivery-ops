import React from 'react';

const section = {
  border: '1px solid #e5e7eb',
  borderRadius: '6px',
  padding: '12px',
  backgroundColor: '#f9fafb',
};
const label = { fontSize: '12px', fontWeight: 600, color: '#374151', marginBottom: '6px' };
const muted = { fontSize: '12px', color: '#6b7280' };
const warn = { fontSize: '12px', color: '#b45309' };
const code = {
  display: 'block',
  backgroundColor: '#fff',
  border: '1px solid #e5e7eb',
  padding: '4px 8px',
  borderRadius: '4px',
  fontSize: '12px',
  fontFamily: 'monospace',
  wordBreak: 'break-all',
};
const chip = {
  display: 'inline-block',
  padding: '1px 6px',
  margin: '2px 4px 2px 0',
  borderRadius: '10px',
  backgroundColor: '#e0e7ff',
  color: '#3730a3',
  fontSize: '11px',
};

function ProjectKeyInput({ projectKey, onSelectProject }) {
  const [draft, setDraft] = React.useState(null);
  const shown = draft === null ? (projectKey || '') : draft;
  const commit = () => {
    const raw = String(shown).trim().toUpperCase();
    setDraft(null);
    if (raw && raw !== projectKey) onSelectProject(raw);
  };
  return (
    <label style={{ fontSize: '12px', color: '#374151', marginTop: '8px', display: 'block' }}>
      Project key
      <input
        aria-label="Project key"
        placeholder="e.g. ENG"
        value={shown}
        onChange={(e) => setDraft(e.target.value.toUpperCase())}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        style={{ display: 'block', marginTop: '4px', padding: '4px 8px', fontSize: '14px', width: '140px', textTransform: 'uppercase' }}
      />
    </label>
  );
}

function ProjectSection({ detected, projectKey, onSelectProject }) {
  const known = (detected.projects || []).some((p) => p.key === projectKey);
  return (
    <div style={section}>
      <div style={label}>JIRA project</div>
      <select
        aria-label="JIRA project"
        value={projectKey || ''}
        onChange={(e) => onSelectProject(e.target.value)}
        style={{ padding: '4px 8px', fontSize: '14px' }}
      >
        {projectKey && !known && <option value={projectKey}>{projectKey}</option>}
        {(detected.projects || []).map((p) => (
          <option key={p.key} value={p.key}>
            {`${p.key} — ${p.name} (${p.share === 0 && p.count > 0 ? '<1' : p.share}%)`}
          </option>
        ))}
      </select>
      <ProjectKeyInput projectKey={projectKey} onSelectProject={onSelectProject} />
      <div style={{ ...muted, marginTop: '6px' }}>
        Pick a project from the filter, or type a key such as ENG. That project’s components load either way.
      </div>
    </div>
  );
}

function VersionsSection({ versions, projectKey }) {
  if (versions.error) return <div style={section}><div style={label}>Release versions</div><div style={warn}>{versions.error}</div></div>;
  return (
    <div style={section}>
      <div style={label}>Release versions ({projectKey})</div>
      <div style={muted}>{versions.unreleasedCount} unreleased of {versions.total} total</div>
      <div style={{ marginTop: '4px' }}>
        {versions.unreleased.slice(0, 8).map((v) => <span key={v} style={chip}>{v}</span>)}
        {versions.unreleasedCount > 8 && <span style={muted}>+{versions.unreleasedCount - 8} more</span>}
      </div>
    </div>
  );
}

function ManualCalendar({ onChange }) {
  const [s1StartIso, setS1] = React.useState('');
  const [sprintDays, setDays] = React.useState('');

  const publish = (iso, daysRaw) => {
    const days = Number(daysRaw);
    const isoOk = /^\d{4}-\d{2}-\d{2}$/.test(iso);
    const daysOk = Number.isInteger(days) && days >= 1 && days <= 90;
    onChange(isoOk && daysOk ? { s1StartIso: iso, sprintDays: days } : null);
  };

  return (
    <div style={{ display: 'flex', gap: '12px', marginTop: '8px', flexWrap: 'wrap' }}>
      <label style={{ fontSize: '12px', color: '#374151' }}>
        S1 start date
        <input
          type="date"
          value={s1StartIso}
          onChange={(e) => { setS1(e.target.value); publish(e.target.value, sprintDays); }}
          style={{ display: 'block', marginTop: '4px', padding: '4px 8px', fontSize: '14px' }}
        />
      </label>
      <label style={{ fontSize: '12px', color: '#374151' }}>
        Sprint length (days)
        <input
          type="number"
          min="1"
          max="90"
          value={sprintDays}
          onChange={(e) => { setDays(e.target.value); publish(s1StartIso, e.target.value); }}
          style={{ display: 'block', marginTop: '4px', padding: '4px 8px', fontSize: '14px', width: '140px' }}
        />
      </label>
    </div>
  );
}

function BoardNumberInput({ boardId, onSelectBoard }) {
  const [draft, setDraft] = React.useState(null);
  const shown = draft === null ? (boardId ? String(boardId) : '') : draft;
  const commit = () => {
    const raw = String(shown).trim();
    setDraft(null);
    if (raw && Number(raw) !== Number(boardId)) onSelectBoard(raw);
  };
  return (
    <label style={{ fontSize: '12px', color: '#374151' }}>
      Board number
      <input
        aria-label="Board number"
        type="number"
        min="1"
        placeholder="e.g. 1592"
        value={shown}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
        style={{ display: 'block', marginTop: '4px', padding: '4px 8px', fontSize: '14px', width: '140px' }}
      />
    </label>
  );
}

function BoardSection({ board, boardId, sprintCalendar, calendarError, calendarManual, calendarLoading, onSelectBoard, onManualCalendar }) {
  const [showOther, setShowOther] = React.useState(false);
  const matched = board.boards || [];
  const otherBoards = board.otherBoards || [];
  const boards = showOther ? [...matched, ...otherBoards] : matched;
  const known = boards.some((b) => String(b.id) === String(boardId));
  const needsManual = !calendarLoading && (calendarManual || !sprintCalendar);
  return (
    <div style={section}>
      <div style={label}>Sprint board and calendar</div>
      {boards.length > 0 && (
        <select
          aria-label="Sprint board"
          value={boardId || ''}
          onChange={(e) => onSelectBoard(e.target.value)}
          style={{ padding: '4px 8px', fontSize: '14px', maxWidth: '100%' }}
        >
          {boardId && !known && <option value={boardId}>{`Board #${boardId}`}</option>}
          {boards.map((b) => <option key={b.id} value={b.id}>{`${b.name} (#${b.id})`}</option>)}
        </select>
      )}
      <div style={{ marginTop: boards.length ? '8px' : 0 }}>
        <BoardNumberInput boardId={boardId} onSelectBoard={onSelectBoard} />
      </div>
      {board.matchedOn === 'team' && (
        <div style={{ ...muted, marginTop: '6px' }}>
          Boards for the selected project.
          {otherBoards.length > 0 && (
            <button
              type="button"
              onClick={() => setShowOther((open) => !open)}
              style={{ marginLeft: '6px', padding: 0, border: 'none', background: 'none', color: '#2563eb', fontSize: '12px', cursor: 'pointer' }}
            >
              {showOther ? 'Hide other boards' : `Show ${otherBoards.length} other boards`}
            </button>
          )}
        </div>
      )}
      <div style={{ marginTop: '6px' }}>
        {calendarLoading && <span style={muted}>Reading sprints…</span>}
        {!calendarLoading && sprintCalendar && !calendarManual && (
          <span style={muted}>S1 starts {sprintCalendar.s1StartIso} · {sprintCalendar.sprintDays}-day sprints</span>
        )}
        {!calendarLoading && !sprintCalendar && (
          <span style={warn}>{calendarError || board.error || 'Sprint calendar was not detected. Enter the S1 start date and sprint length.'}</span>
        )}
        {needsManual && <ManualCalendar key={boardId || 'none'} onChange={onManualCalendar} />}
      </div>
    </div>
  );
}

function ComponentsSection({ feature, selected, onToggleComponent, onUnselectAll }) {
  const [query, setQuery] = React.useState('');
  const components = feature.components || [];
  const q = query.trim().toLowerCase();
  const shown = q ? components.filter((c) => c.name.toLowerCase().includes(q)) : components;
  return (
    <div style={{ ...section, gridColumn: '1 / -1' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
        <div style={{ ...label, marginBottom: 0 }}>Components ({feature.projectKey})</div>
        <span style={muted}>{selected.length} selected</span>
        <button
          type="button"
          onClick={onUnselectAll}
          disabled={selected.length === 0}
          style={{ padding: '2px 8px', minHeight: '2rem', fontSize: '12px', border: '1px solid #d1d5db', borderRadius: '4px', background: '#fff', cursor: 'pointer' }}
        >
          Unselect all
        </button>
        <input
          aria-label="Filter components"
          placeholder="Filter"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ marginLeft: 'auto', padding: '4px 8px', fontSize: '14px', width: '180px', border: '1px solid #d1d5db', borderRadius: '4px' }}
        />
      </div>
      {feature.error && <div style={warn}>{feature.error}</div>}
      {!feature.error && components.length === 0 && (
        <div style={warn}>This project has no components.</div>
      )}
      {components.length > 0 && shown.length === 0 && (
        <div style={muted}>No components match.</div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', columnGap: '16px' }}>
        {shown.map((c) => (
          <label key={c.name} style={{ display: 'block', padding: '4px 0', fontSize: '14px' }}>
            <input
              type="checkbox"
              checked={selected.includes(c.name)}
              onChange={() => onToggleComponent(c.name)}
              style={{ marginRight: '6px' }}
            />
            <strong>{c.name}</strong>
            {c.count != null && <span style={muted}> ({c.count} tickets)</span>}
            {c.primaryComponents?.length > 0 && (
              <div style={{ marginLeft: '22px' }}>
                {c.primaryComponents.map((pc) => <span key={pc} style={chip}>{pc}</span>)}
              </div>
            )}
          </label>
        ))}
      </div>
    </div>
  );
}

function DetectedConfig({ detected, selection, calendarLoading, onSelectProject, onSelectBoard, onManualCalendar, onToggleComponent, onUnselectAll }) {
  if (!detected) return null;
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '12px' }}>
      <ProjectSection detected={detected} projectKey={selection.projectKey} onSelectProject={onSelectProject} />
      <div style={section}>
        <div style={label}>Sprint scope (base filter without the Done exclusion)</div>
        <code style={code}>{detected.sprintScope}</code>
      </div>
      <VersionsSection versions={detected.versions} projectKey={detected.projectKey} />
      <BoardSection
        key={selection.projectKey || detected.projectKey}
        board={detected.board}
        boardId={selection.boardId}
        sprintCalendar={selection.sprintCalendar}
        calendarError={selection.calendarError}
        calendarManual={selection.calendarManual}
        calendarLoading={calendarLoading}
        onSelectBoard={onSelectBoard}
        onManualCalendar={onManualCalendar}
      />
      <ComponentsSection
        key={detected.feature?.projectKey || selection.projectKey}
        feature={detected.feature}
        selected={selection.components}
        onToggleComponent={onToggleComponent}
        onUnselectAll={onUnselectAll}
      />
    </div>
  );
}

export default DetectedConfig;
