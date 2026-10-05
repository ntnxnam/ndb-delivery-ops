import React, { useState, useEffect, useCallback } from 'react';
import { useTeam } from '../../contexts/TeamContext';
import { useTeamAdmin } from '../../hooks/useTeamAdmin';
import TeamForm from './TeamForm';
import TeamList from './TeamList';
import './AdminPanel.css';

function pickerTeam(team) {
  if (!team) return team;
  const { kpiCount: _kpiCount, sprintScope: _sprintScope, ...rest } = team;
  return rest;
}

const headerButton = (bg, color = 'white') => ({
  padding: '8px 16px',
  backgroundColor: bg,
  color,
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  fontSize: '14px',
});

function AdminPanel() {
  const { replaceTeams, upsertTeam, updateTeam } = useTeam();
  const { teams, loading, error, loadTeams, saveTeam, testTeam } = useTeamAdmin();
  const [activeView, setActiveView] = useState('teams');
  const [editingTeam, setEditingTeam] = useState(null);
  const [syncNotice, setSyncNotice] = useState('');

  const refresh = useCallback(async () => {
    const list = await loadTeams();
    if (list) replaceTeams(list.map(pickerTeam));
  }, [loadTeams, replaceTeams]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    if (!syncNotice) return undefined;
    const id = setTimeout(() => setSyncNotice(''), 6000);
    return () => clearTimeout(id);
  }, [syncNotice]);

  const closeForm = () => {
    setActiveView('teams');
    setEditingTeam(null);
  };

  const handleSave = async (payload, editId) => {
    const team = await saveTeam(payload, editId);
    if (editId) {
      updateTeam(team.id, pickerTeam(team));
      setSyncNotice(`${team.name || 'Team'} was updated in the Team dropdown.`);
    } else {
      upsertTeam(pickerTeam(team));
      setSyncNotice(`${team.name || 'New team'} is now in the Team dropdown. Click Fetch to load it.`);
    }
    closeForm();
  };

  if (loading && teams.length === 0) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '256px' }}>
        <div style={{ color: '#6b7280' }}>Loading teams...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', padding: '16px' }}>
        <h3 style={{ fontWeight: '500', color: '#991b1b', margin: 0 }}>Access Denied</h3>
        <p style={{ color: '#dc2626', fontSize: '14px', marginTop: '4px' }}>{error}</p>
        <p style={{ color: '#dc2626', fontSize: '14px', marginTop: '8px' }}>
          Only super administrators can access team management features.
        </p>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h1 style={{ fontSize: '26px', fontWeight: 'bold', margin: 0 }}>Team Management</h1>
          <p style={{ color: '#6b7280', margin: 0 }}>Add and edit teams</p>
        </div>
        {activeView === 'teams' ? (
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={refresh} style={headerButton('#f3f4f6', '#374151')}>🔄 Refresh</button>
            <button onClick={() => setActiveView('create')} style={headerButton('#3b82f6')}>+ Add team</button>
          </div>
        ) : (
          <button onClick={closeForm} style={headerButton('#6b7280')}>Back to Teams</button>
        )}
      </div>

      {syncNotice && (
        <div
          role="status"
          style={{
            marginBottom: '16px',
            padding: '10px 14px',
            backgroundColor: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: '6px',
            color: '#065f46',
            fontSize: '14px',
          }}
        >
          {syncNotice}
        </div>
      )}

      {activeView === 'teams' && (
        <TeamList
          teams={teams}
          onTest={testTeam}
          onCreateTeam={() => setActiveView('create')}
          onEditTeam={(team) => { setEditingTeam(team); setActiveView('edit'); }}
        />
      )}

      {activeView === 'create' && <TeamForm onSave={handleSave} onCancel={closeForm} />}

      {activeView === 'edit' && editingTeam && (
        <TeamForm key={editingTeam.id} initialTeam={editingTeam} onSave={handleSave} onCancel={closeForm} />
      )}
    </div>
  );
}

export default AdminPanel;
