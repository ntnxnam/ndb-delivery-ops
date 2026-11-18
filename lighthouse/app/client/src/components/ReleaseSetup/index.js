import React, { useState } from 'react';
import CreateRelease from './CreateRelease';
import RenameRelease from './RenameRelease';
import CleanupFilters from './CleanupFilters';

const TABS = [
  { id: 'create', label: 'Create Release' },
  { id: 'rename', label: 'Rename Release' },
  { id: 'cleanup', label: 'Cleanup Filters' },
];

function ReleaseSetup() {
  const [tab, setTab] = useState('create');

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '16px' }}>
      <h2 style={{ marginBottom: 4 }}>Release Setup</h2>
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid #ddd', marginBottom: 16 }}>
        {TABS.map(t => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: '8px 16px',
                border: 'none',
                borderBottom: active ? '2px solid #007bff' : '2px solid transparent',
                background: 'transparent',
                color: active ? '#007bff' : '#555',
                fontWeight: active ? 600 : 500,
                fontSize: '0.88rem',
                cursor: 'pointer',
                marginBottom: -1,
              }}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'create' && <CreateRelease />}
      {tab === 'rename' && <RenameRelease />}
      {tab === 'cleanup' && <CleanupFilters />}
    </div>
  );
}

export default ReleaseSetup;
