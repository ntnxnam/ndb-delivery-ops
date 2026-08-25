import React, { useState, useEffect, useCallback } from 'react';
import { authenticatedGet } from '../../utils/api';
import { useTeam } from '../../contexts/TeamContext';
import TeamOnboardingWizard from './TeamOnboardingWizard';
import TeamList from './TeamList';
import './AdminPanel.css';

function pickerTeam(team) {
  if (!team) return team;
  const { userConfig: _userConfig, kpiCount: _kpiCount, ...rest } = team;
  return rest;
}

function AdminPanel() {
  const { replaceTeams, upsertTeam, updateTeam, changeTeam } = useTeam();
  const [activeView, setActiveView] = useState('teams');
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editingTeam, setEditingTeam] = useState(null);
  const [syncNotice, setSyncNotice] = useState('');

  const loadTeams = useCallback(async () => {
    setLoading(true);
    setError('');

    try {
      const response = await authenticatedGet('/api/admin/teams', {
        jiraToken: localStorage.getItem('jiraToken'),
        username: localStorage.getItem('username') || ''
      });

      if (response.data.success) {
        const list = response.data.teams || [];
        setTeams(list);
        replaceTeams(list.map(pickerTeam));
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load teams');
    }

    setLoading(false);
  }, [replaceTeams]);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  useEffect(() => {
    if (!syncNotice) return undefined;
    const id = setTimeout(() => setSyncNotice(''), 6000);
    return () => clearTimeout(id);
  }, [syncNotice]);

  const handleTeamCreated = (newTeam) => {
    setTeams(prev => [...prev, { ...newTeam, userConfig: null, kpiCount: 0 }]);
    upsertTeam(pickerTeam(newTeam));
    if (newTeam?.id) changeTeam(newTeam.id);
    setSyncNotice(`${newTeam?.name || 'New team'} is now in the Team dropdown.`);
    setActiveView('teams');
    setEditingTeam(null);
  };

  const handleTeamUpdated = (updatedTeam) => {
    setTeams(prev => prev.map(team =>
      team.id === updatedTeam.id ? { ...updatedTeam, userConfig: team.userConfig, kpiCount: team.kpiCount } : team
    ));
    updateTeam(updatedTeam.id, pickerTeam(updatedTeam));
    setSyncNotice(`${updatedTeam?.name || 'Team'} was updated in the Team dropdown.`);
    setActiveView('teams');
    setEditingTeam(null);
  };

  const handleEditTeam = (team) => {
    setEditingTeam(team);
    setActiveView('edit');
  };

  if (loading && teams.length === 0) {
    return (
      <div style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '256px'
      }}>
        <div style={{ color: '#6b7280' }}>Loading admin panel...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        backgroundColor: '#fef2f2',
        border: '1px solid #fca5a5',
        borderRadius: '6px',
        padding: '16px'
      }}>
        <h3 style={{ fontWeight: '500', color: '#991b1b', margin: 0 }}>Access Denied</h3>
        <p style={{ color: '#dc2626', fontSize: '14px', marginTop: '4px' }}>{error}</p>
        <p style={{ color: '#dc2626', fontSize: '14px', marginTop: '8px' }}>
          Only super administrators can access team management features.
        </p>
      </div>
    );
  }

  return (
    <div style={{ 
      maxWidth: '1280px', 
      margin: '0 auto', 
      padding: '24px' 
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px'
      }}>
        <div>
          <h1 style={{ 
            fontSize: '30px', 
            fontWeight: 'bold',
            margin: 0 
          }}>
            Team Administration
          </h1>
          <p style={{ 
            color: '#6b7280', 
            marginTop: '4px',
            margin: 0
          }}>
            Manage teams, users, and permissions
          </p>
        </div>
        
        {activeView === 'teams' && (
          <button
            onClick={() => setActiveView('create')}
            style={{
              padding: '8px 16px',
              backgroundColor: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              fontSize: '14px'
            }}
          >
            <span>+</span>
            Create New Team
          </button>
        )}
        
        {(activeView === 'create' || activeView === 'edit') && (
          <button
            onClick={() => {setActiveView('teams'); setEditingTeam(null);}}
            style={{
              padding: '8px 16px',
              backgroundColor: '#6b7280',
              color: 'white',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontSize: '14px'
            }}
          >
            Back to Teams
          </button>
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

      {/* Navigation Tabs & Quick Actions */}
      {activeView === 'teams' && (
        <div style={{
          borderBottom: '1px solid #e5e7eb',
          marginBottom: '24px'
        }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <nav style={{ marginBottom: '-1px', display: 'flex', gap: '32px' }}>
              <button
                onClick={() => setActiveView('teams')}
                style={{
                  padding: '8px 4px',
                  borderBottom: '2px solid #3b82f6',
                  color: '#2563eb',
                  fontWeight: '500',
                  fontSize: '14px',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                Teams ({teams.length})
              </button>
            </nav>
            
            <div style={{ display: 'flex', gap: '8px', paddingBottom: '8px' }}>
              <button
                onClick={loadTeams}
                style={{
                  padding: '4px 12px',
                  fontSize: '14px',
                  backgroundColor: '#f3f4f6',
                  color: '#374151',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                🔄 Refresh
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {activeView === 'teams' && (
        <TeamList 
          teams={teams} 
          onTeamUpdate={loadTeams}
          onCreateTeam={() => setActiveView('create')}
          onEditTeam={handleEditTeam}
        />
      )}

      {activeView === 'create' && (
        <TeamOnboardingWizard
          onComplete={handleTeamCreated}
          onCancel={() => {setActiveView('teams'); setEditingTeam(null);}}
        />
      )}

      {activeView === 'edit' && editingTeam && (
        <TeamOnboardingWizard
          editMode={true}
          initialData={editingTeam}
          onComplete={handleTeamUpdated}
          onCancel={() => {setActiveView('teams'); setEditingTeam(null);}}
        />
      )}
    </div>
  );
}

export default AdminPanel;