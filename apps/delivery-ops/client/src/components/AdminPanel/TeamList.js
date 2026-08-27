import React, { useState } from 'react';
import { authenticatedPost } from '../../utils/api';

function TeamList({ teams, onTeamUpdate: _onTeamUpdate, onCreateTeam, onEditTeam }) {
  const [testingTeam, setTestingTeam] = useState(null);
  const [testResults, setTestResults] = useState({});

  const testTeamConfig = async (team) => {
    setTestingTeam(team.id);
    setTestResults(prev => ({ ...prev, [team.id]: null }));

    try {
      const response = await authenticatedPost('/api/admin/test-team-config',
        { teamId: team.id },
        {
          jiraToken: localStorage.getItem('jiraToken'),
          username: localStorage.getItem('username') || ''
        }
      );

      setTestResults(prev => ({
        ...prev,
        [team.id]: response.data
      }));
    } catch (error) {
      setTestResults(prev => ({
        ...prev,
        [team.id]: {
          success: false,
          error: error.response?.data?.message || 'Test failed'
        }
      }));
    }

    setTestingTeam(null);
  };

  const getProjectTypeLabel = (team) => {
    if (!team.projectType || team.projectType === 'dedicated') {
      return 'Dedicated';
    }
    return 'Parent Project';
  };

  if (teams.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '64px 16px' }}>
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: '64px', marginBottom: '16px' }}>🏢</div>
          <h3 style={{ 
            fontSize: '20px', 
            fontWeight: '600', 
            color: '#111827', 
            marginBottom: '8px' 
          }}>
            No Teams Configured
          </h3>
          <p style={{ 
            color: '#6b7280', 
            maxWidth: '400px', 
            margin: '0 auto',
            lineHeight: '1.5' 
          }}>
            Get started by creating your first team. Teams help organize projects, users, and permissions.
          </p>
        </div>
        <button
          onClick={onCreateTeam}
          style={{
            padding: '12px 24px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '16px',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <span>+</span>
          Create First Team
        </button>
      </div>
    );
  }

  const totalKpis = teams.reduce((sum, team) => sum + team.kpiCount, 0);
  const dedicatedProjects = teams.filter(team => team.projectType === 'dedicated').length;
  const parentProjects = teams.filter(team => team.projectType === 'parent').length;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Summary Cards */}
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
        gap: '16px' 
      }}>
        <div style={{
          backgroundColor: '#eff6ff',
          border: '1px solid #dbeafe',
          borderRadius: '8px',
          padding: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '24px' }}>🏢</div>
            <div>
              <p style={{ fontSize: '14px', color: '#2563eb', fontWeight: '500', margin: 0 }}>Total Teams</p>
              <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#1e3a8a', margin: 0 }}>{teams.length}</p>
            </div>
          </div>
        </div>
        
        <div style={{
          backgroundColor: '#f0fdf4',
          border: '1px solid #bbf7d0',
          borderRadius: '8px',
          padding: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '24px' }}>📊</div>
            <div>
              <p style={{ fontSize: '14px', color: '#16a34a', fontWeight: '500', margin: 0 }}>Total KPIs</p>
              <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#14532d', margin: 0 }}>{totalKpis}</p>
            </div>
          </div>
        </div>
        
        <div style={{
          backgroundColor: '#faf5ff',
          border: '1px solid #e9d5ff',
          borderRadius: '8px',
          padding: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '24px' }}>🔗</div>
            <div>
              <p style={{ fontSize: '14px', color: '#9333ea', fontWeight: '500', margin: 0 }}>Dedicated</p>
              <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#581c87', margin: 0 }}>{dedicatedProjects}</p>
            </div>
          </div>
        </div>
        
        <div style={{
          backgroundColor: '#fff7ed',
          border: '1px solid #fed7aa',
          borderRadius: '8px',
          padding: '16px'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ fontSize: '24px' }}>🌐</div>
            <div>
              <p style={{ fontSize: '14px', color: '#ea580c', fontWeight: '500', margin: 0 }}>Parent</p>
              <p style={{ fontSize: '24px', fontWeight: 'bold', color: '#9a3412', margin: 0 }}>{parentProjects}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Teams List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {teams.map((team) => (
          <div key={team.id} style={{
            backgroundColor: 'white',
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
            transition: 'box-shadow 0.2s'
          }}>
            <div style={{ padding: '24px' }}>
              <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'flex-start', 
                marginBottom: '16px' 
              }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
                    <h3 style={{ fontSize: '20px', fontWeight: '600', margin: 0 }}>{team.name}</h3>
                    <span style={{
                      padding: '4px 8px',
                      borderRadius: '12px',
                      fontSize: '12px',
                      fontWeight: '500',
                      backgroundColor: team.projectType === 'dedicated' ? '#dbeafe' : '#e9d5ff',
                      color: team.projectType === 'dedicated' ? '#1e40af' : '#7c3aed'
                    }}>
                      {getProjectTypeLabel(team)}
                    </span>
                  </div>
                  <div style={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: '16px', 
                    fontSize: '14px', 
                    color: '#6b7280' 
                  }}>
                    <span>ID: <code style={{
                      backgroundColor: '#f3f4f6',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>{team.id}</code></span>
                    <span>Project: <strong>{team.projectKey}</strong></span>
                    <span>KPIs: <strong>{team.kpiCount}</strong></span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => onEditTeam(team)}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: '#dbeafe',
                      color: '#1d4ed8',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '14px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    ✏️ Edit
                  </button>
                  <button
                    onClick={() => testTeamConfig(team)}
                    disabled={testingTeam === team.id}
                    style={{
                      padding: '6px 12px',
                      backgroundColor: testingTeam === team.id ? '#f9fafb' : '#f3f4f6',
                      color: '#374151',
                      border: 'none',
                      borderRadius: '4px',
                      fontSize: '14px',
                      cursor: testingTeam === team.id ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    {testingTeam === team.id ? '⏳ Testing...' : '🔍 Test'}
                  </button>
                </div>
              </div>

              {/* Details */}
              <div style={{ 
                borderTop: '1px solid #e5e7eb', 
                paddingTop: '16px', 
                marginTop: '16px' 
              }}>
                <div style={{ 
                  display: 'grid', 
                  gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', 
                  gap: '24px', 
                  fontSize: '14px' 
                }}>
                  <div>
                    <h4 style={{ 
                      fontWeight: '600', 
                      color: '#111827', 
                      marginBottom: '12px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px' 
                    }}>
                      🏗️ Project Details
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {team.boardId && (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#6b7280' }}>Board ID:</span>
                          <span style={{ fontWeight: '500' }}>{team.boardId}</span>
                        </div>
                      )}
                      {team.sprintCalendar?.s1StartIso ? (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#6b7280' }}>Sprint calendar:</span>
                          <span style={{ fontWeight: '500' }}>
                            S1 {team.sprintCalendar.s1StartIso} · {team.sprintCalendar.sprintDays}d
                          </span>
                        </div>
                      ) : (
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#6b7280' }}>Sprint calendar:</span>
                          <span style={{ fontWeight: '500', color: '#b45309' }}>
                            Missing — Edit team and detect from the sprint board
                          </span>
                        </div>
                      )}
                      {team.versionPatterns && (
                        <div>
                          <span style={{ color: '#6b7280', display: 'block', marginBottom: '4px' }}>Version Patterns:</span>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {team.versionPatterns.map((pattern, index) => (
                              <code key={index} style={{
                                display: 'block',
                                backgroundColor: '#f3f4f6',
                                padding: '4px 8px',
                                borderRadius: '4px',
                                fontSize: '12px',
                                fontFamily: 'monospace'
                              }}>
                                {pattern}
                              </code>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 style={{ 
                      fontWeight: '600', 
                      color: '#111827', 
                      marginBottom: '12px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px' 
                    }}>
                      ⚙️ Filters
                    </h4>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      {team.baseFilter ? (
                        <div>
                          <span style={{ color: '#6b7280', display: 'block' }}>Base Filter:</span>
                          <code style={{
                            display: 'block',
                            backgroundColor: '#f3f4f6',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontFamily: 'monospace',
                            wordBreak: 'break-all'
                          }}>
                            {team.baseFilter}
                          </code>
                        </div>
                      ) : (
                        <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No base filter</span>
                      )}
                      {team.sprintBaseFilter ? (
                        <div>
                          <span style={{ color: '#6b7280', display: 'block' }}>Sprint Filter:</span>
                          <code style={{
                            display: 'block',
                            backgroundColor: '#f3f4f6',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            fontSize: '12px',
                            fontFamily: 'monospace',
                            wordBreak: 'break-all'
                          }}>
                            {team.sprintBaseFilter}
                          </code>
                        </div>
                      ) : (
                        <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No sprint filter</span>
                      )}
                    </div>
                  </div>

                  <div>
                    <h4 style={{ 
                      fontWeight: '600', 
                      color: '#111827', 
                      marginBottom: '12px', 
                      display: 'flex', 
                      alignItems: 'center', 
                      gap: '8px' 
                    }}>
                      👥 User Access
                    </h4>
                    {team.userConfig ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#6b7280' }}>Admins:</span>
                          <span style={{ fontWeight: '500' }}>{team.userConfig.admins?.length || 0}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#6b7280' }}>Users:</span>
                          <span style={{ fontWeight: '500' }}>{team.userConfig.allowedUsers?.length || 0}</span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                          <span style={{ color: '#6b7280' }}>Email Senders:</span>
                          <span style={{ fontWeight: '500' }}>{team.userConfig.emailSenders?.length || 0}</span>
                        </div>
                      </div>
                    ) : (
                      <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>No user configuration</span>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Test Results */}
            {testResults[team.id] && (
              <div style={{
                borderTop: '1px solid #e5e7eb',
                paddingTop: '16px',
                marginTop: '16px'
              }}>
                <h4 style={{ fontWeight: '500', marginBottom: '8px' }}>Configuration Test Results</h4>
                {testResults[team.id].success ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', fontSize: '14px' }}>
                      <span style={{
                        width: '12px',
                        height: '12px',
                        backgroundColor: '#10b981',
                        borderRadius: '50%',
                        marginRight: '8px'
                      }}></span>
                      <span>Overall Status: Valid</span>
                    </div>
                    
                    <div style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                      gap: '16px',
                      fontSize: '14px'
                    }}>
                      <div>
                        <p style={{ fontWeight: '500' }}>Project Access</p>
                        <p style={{
                          color: testResults[team.id].results.projectAccess.valid ? '#059669' : '#dc2626'
                        }}>
                          {testResults[team.id].results.projectAccess.valid ? '✓ Accessible' : '✗ Failed'}
                        </p>
                        {testResults[team.id].results.projectAccess.projectName && (
                          <p style={{ color: '#6b7280' }}>{testResults[team.id].results.projectAccess.projectName}</p>
                        )}
                      </div>

                      <div>
                        <p style={{ fontWeight: '500' }}>Version Access</p>
                        <p style={{
                          color: testResults[team.id].results.versionAccess.valid ? '#059669' : '#dc2626'
                        }}>
                          {testResults[team.id].results.versionAccess.valid ? '✓ Accessible' : '✗ Failed'}
                        </p>
                        {testResults[team.id].results.versionAccess.valid && (
                          <p style={{ color: '#6b7280' }}>
                            {testResults[team.id].results.versionAccess.filteredVersions || testResults[team.id].results.versionAccess.totalVersions} versions
                          </p>
                        )}
                      </div>

                      <div>
                        <p style={{ fontWeight: '500' }}>Filter Tests</p>
                        <p style={{
                          color: testResults[team.id].results.filterTests.valid ? '#059669' : '#dc2626'
                        }}>
                          {testResults[team.id].results.filterTests.valid ? '✓ Valid' : '✗ Issues'}
                        </p>
                        {testResults[team.id].results.filterTests.results?.map((result, index) => (
                          <p key={index} style={{
                            fontSize: '12px',
                            color: result.valid ? '#059669' : '#dc2626'
                          }}>
                            {result.name}: {result.valid ? `${result.issueCount} issues` : 'Error'}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    fontSize: '14px',
                    color: '#dc2626'
                  }}>
                    <span style={{
                      width: '12px',
                      height: '12px',
                      backgroundColor: '#ef4444',
                      borderRadius: '50%',
                      marginRight: '8px'
                    }}></span>
                    <span>{testResults[team.id].error || 'Configuration test failed'}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default TeamList;