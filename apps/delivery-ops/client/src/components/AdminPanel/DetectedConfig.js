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

function ProjectSection({ detected, projectKey, onSelectProject }) {
  return (
    <div style={section}>
      <div style={label}>JIRA project</div>
      <select
        aria-label="JIRA project"
        value={projectKey || ''}
        onChange={(e) => onSelectProject(e.target.value)}
        style={{ padding: '4px 8px', fontSize: '14px' }}
      >
        {detected.projects.map((p) => (
          <option key={p.key} value={p.key}>{`${p.key} — ${p.name} (${p.share}%)`}</option>
        ))}
      </select>
      <div style={{ ...muted, marginTop: '6px' }}>
        {detected.issueCount} tickets match the base filter; project share is from the first {detected.sampledCount}.
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

function BoardSection({ board, boardId, sprintCalendar, calendarError, calendarManual, calendarLoading, onSelectBoard, onManualCalendar }) {
  const [showOther, setShowOther] = React.useState(false);
  const matched = board.boards || [];
  const otherBoards = board.otherBoards || [];
  const boards = showOther ? [...matched, ...otherBoards] : matched;
  const needsManual = !calendarLoading && (calendarManual || !sprintCalendar);
  return (
    <div style={section}>
      <div style={label}>Sprint board and calendar</div>
      {boards.length > 0 ? (
        <select
          aria-label="Sprint board"
          value={boardId || ''}
          onChange={(e) => onSelectBoard(e.target.value)}
          style={{ padding: '4px 8px', fontSize: '14px', maxWidth: '100%' }}
        >
          {boards.map((b) => <option key={b.id} value={b.id}>{`${b.name} (#${b.id})`}</option>)}
        </select>
      ) : (
        <input
          aria-label="Sprint board ID"
          type="number"
          min="1"
          placeholder="Board ID"
          defaultValue={boardId || ''}
          onBlur={(e) => e.target.value && onSelectBoard(e.target.value)}
          style={{ padding: '4px 8px', fontSize: '14px', width: '140px' }}
        />
      )}
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

function ComponentsSection({ feature, selected, onToggleComponent }) {
  const components = feature.components || [];
  return (
    <div style={{ ...section, gridColumn: '1 / -1' }}>
      <div style={label}>Components ({feature.projectKey})</div>
      {feature.error && <div style={warn}>{feature.error}</div>}
      {!feature.error && components.length === 0 && (
        <div style={warn}>
          No {feature.projectKey} tickets match this base filter, so no components were found.
        </div>
      )}
      {components.map((c) => (
        <label key={c.name} style={{ display: 'block', padding: '4px 0', fontSize: '14px' }}>
          <input
            type="checkbox"
            checked={selected.includes(c.name)}
            onChange={() => onToggleComponent(c.name)}
            style={{ marginRight: '6px' }}
          />
          <strong>{c.name}</strong> <span style={muted}>({c.count} tickets)</span>
          <div style={{ marginLeft: '22px' }}>
            {c.primaryComponents.length
              ? c.primaryComponents.map((pc) => <span key={pc} style={chip}>{pc}</span>)
              : <span style={muted}>No primary components</span>}
          </div>
        </label>
      ))}
    </div>
  );
}

function DetectedConfig({ detected, selection, calendarLoading, onSelectProject, onSelectBoard, onManualCalendar, onToggleComponent }) {
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
      <ComponentsSection feature={detected.feature} selected={selection.components} onToggleComponent={onToggleComponent} />
    </div>
  );
}

export default DetectedConfig;
