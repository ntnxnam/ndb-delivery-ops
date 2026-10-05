import React, { useState } from 'react';

const card = {
  backgroundColor: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: '8px',
  boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
  padding: '16px',
};
const heading = { fontWeight: 600, color: '#111827', fontSize: '14px', margin: '0 0 8px' };
const muted = { color: '#6b7280' };
const codeBlock = {
  display: 'block',
  backgroundColor: '#f3f4f6',
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
const smallButton = (bg, color) => ({
  padding: '6px 12px',
  backgroundColor: bg,
  color,
  border: 'none',
  borderRadius: '4px',
  fontSize: '14px',
  cursor: 'pointer',
});

const TEST_ROWS = [
  ['projectAccess', 'Project access', (r) => r.projectName],
  ['versionAccess', 'Release versions', (r) => `${r.totalVersions} unreleased`],
  ['baseFilter', 'Base filter', (r) => `${r.issueCount} tickets`],
  ['sprintScope', 'Sprint scope', (r) => `${r.issueCount} tickets`],
];

function TestResults({ result }) {
  if (result.error && !result.results) {
    return <div style={{ color: '#dc2626', fontSize: '14px' }}>{result.error}</div>;
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '12px', fontSize: '14px' }}>
      {TEST_ROWS.map(([key, label, detail]) => {
        const row = result.results?.[key];
        if (!row) return null;
        return (
          <div key={key}>
            <div style={{ fontWeight: 500 }}>{label}</div>
            <div style={{ color: row.valid ? '#059669' : '#dc2626' }}>
              {row.valid ? `✓ ${detail(row) || 'OK'}` : `✗ ${row.error || 'Failed'}`}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TeamCard({ team, testing, testResult, onEdit, onTest }) {
  const components = Object.entries(team.featureComponents || {});
  const cal = team.sprintCalendar;
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
        <div>
          <h3 style={{ fontSize: '18px', fontWeight: 600, margin: '0 0 4px' }}>{team.name}</h3>
          <div style={{ display: 'flex', gap: '16px', fontSize: '14px', ...muted }}>
            <span>Code: <code style={{ backgroundColor: '#f3f4f6', padding: '1px 6px', borderRadius: '4px' }}>{team.id}</code></span>
            <span>Project: <strong>{team.projectKey}</strong></span>
            <span>KPIs: <strong>{team.kpiCount ?? 0}</strong></span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={() => onEdit(team)} style={smallButton('#dbeafe', '#1d4ed8')}>✏️ Edit</button>
          <button onClick={() => onTest(team)} disabled={testing} style={smallButton('#f3f4f6', '#374151')}>
            {testing ? '⏳ Testing...' : '🔍 Test'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px', fontSize: '14px', borderTop: '1px solid #e5e7eb', paddingTop: '12px' }}>
        <div>
          <h4 style={heading}>Sprints</h4>
          <div>Board: <strong>{team.boardId || '—'}</strong></div>
          {cal?.s1StartIso
            ? <div>S1 {cal.s1StartIso} · {cal.sprintDays}-day sprints</div>
            : <div style={{ color: '#b45309' }}>Missing — edit the team and run Detect</div>}
        </div>
        <div>
          <h4 style={heading}>Filters</h4>
          <span style={muted}>Base filter</span>
          <code style={codeBlock}>{team.baseFilter || '—'}</code>
          <span style={muted}>Sprint scope</span>
          <code style={codeBlock}>{team.sprintScope || '—'}</code>
        </div>
        <div>
          <h4 style={heading}>Components</h4>
          {components.length === 0 && <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>None detected</span>}
          {components.map(([name, children]) => (
            <div key={name} style={{ marginBottom: '4px' }}>
              <strong>{name}</strong>
              <div>{children.map((c) => <span key={c} style={chip}>{c}</span>)}</div>
            </div>
          ))}
        </div>
      </div>

      {testResult && (
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '12px', marginTop: '12px' }}>
          <h4 style={heading}>Configuration test</h4>
          <TestResults result={testResult} />
        </div>
      )}
    </div>
  );
}

function TeamList({ teams, onTest, onCreateTeam, onEditTeam }) {
  const [testingTeam, setTestingTeam] = useState(null);
  const [testResults, setTestResults] = useState({});

  const runTest = async (team) => {
    setTestingTeam(team.id);
    setTestResults((prev) => ({ ...prev, [team.id]: null }));
    const result = await onTest(team.id);
    setTestResults((prev) => ({ ...prev, [team.id]: result }));
    setTestingTeam(null);
  };

  if (teams.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 16px' }}>
        <h3 style={{ fontSize: '20px', fontWeight: 600, color: '#111827', marginBottom: '8px' }}>No Teams Configured</h3>
        <p style={{ ...muted, maxWidth: '400px', margin: '0 auto 16px' }}>
          Add a team by entering its name and JIRA base filter; everything else is detected.
        </p>
        <button onClick={onCreateTeam} style={smallButton('#3b82f6', 'white')}>+ Add team</button>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div style={{ fontSize: '14px', ...muted }}>
        {teams.length} teams · {teams.reduce((sum, t) => sum + (t.kpiCount || 0), 0)} KPIs
      </div>
      {teams.map((team) => (
        <TeamCard
          key={team.id}
          team={team}
          testing={testingTeam === team.id}
          testResult={testResults[team.id]}
          onEdit={onEditTeam}
          onTest={runTest}
        />
      ))}
    </div>
  );
}

export default TeamList;
