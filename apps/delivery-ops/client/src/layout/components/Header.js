import React, { useState } from 'react';
import { useAuth } from '../../auth/hooks/useAuth';
import { useTeam } from '../../contexts/TeamContext';
import { LogoutButton } from '../../auth/components/LogoutButton';
import { useNotifications } from '../../shared/services/notificationService';
import { useSelectedRelease } from '../../contexts/SelectedReleaseContext';

export const Header = () => {
  const { user, testConnectionAndRefreshPermissions } = useAuth();
  const { 
    teams, 
    selectedTeamId, 
    changeTeam, 
    showTeamSelector, 
    isTransitioning,
    loading: teamsLoading
  } = useTeam();
  const { refreshVersionsAndResetDefault } = useSelectedRelease();

  // Debug logging
  console.log('[Header] Team selector debug:', {
    teamsCount: teams.length,
    selectedTeamId,
    showTeamSelector,
    teamsLoading,
    teams: teams.map(t => ({ id: t.id, name: t.name }))
  });
  const { success: showSuccess, error: showError } = useNotifications();
  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);

  // Test JIRA connection — on success, also re-fetches versions and re-picks
  // the default release using the GA-date logic (clears stale localStorage).
  const testConnection = async () => {
    setTestingConnection(true);
    setConnectionStatus(null);

    try {
      const result = await testConnectionAndRefreshPermissions();
      
      if (result.success) {
        setConnectionStatus({
          success: true,
          message: result.message + (result.permissionsRefreshed ? ' • Permissions refreshed' : '')
        });
        showSuccess(result.permissionsRefreshed ? 'JIRA connection successful • Permissions updated' : 'JIRA connection successful');
        // Re-fetch versions and reset the default release to the nearest GA date.
        refreshVersionsAndResetDefault().catch(() => {});
      } else {
        throw new Error(result.message || 'Connection test failed');
      }
    } catch (error) {
      const errorMessage = error.message || 'Connection test failed';
      setConnectionStatus({
        success: false,
        message: errorMessage
      });
      showError(errorMessage);
    } finally {
      setTestingConnection(false);
      
      // Clear status after 5 seconds
      setTimeout(() => setConnectionStatus(null), 5000);
    }
  };

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="header-left">
          <h1 className="app-title">NDB Status Update Sender</h1>
        </div>

        <div className="header-center">
          {showTeamSelector && teams.length > 0 && (
            <div className="team-selector">
              <label htmlFor="team-select">
                Team:
              </label>
              <select
                id="team-select"
                value={selectedTeamId}
                onChange={(e) => changeTeam(e.target.value)}
                className={`team-select ${isTransitioning ? 'transitioning' : ''}`}
                disabled={teamsLoading || isTransitioning}
              >
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
              {isTransitioning && (
                <span className="transition-indicator">
                  ⏳
                </span>
              )}
            </div>
          )}
          {teamsLoading && (
            <div className="teams-loading">
              Loading teams...
            </div>
          )}
        </div>

        <div className="header-right">
          {user && (
            <div className="user-info">
              <span className="user-label">Logged in as:</span>
              <strong className="username">{user.username}</strong>
            </div>
          )}

          <div className="header-actions">
            <button
              type="button"
              onClick={testConnection}
              disabled={testingConnection}
              className="test-connection-button"
              title="Test JIRA connection and token validity"
            >
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </button>

            {connectionStatus && (
              <div className={`connection-status ${connectionStatus.success ? 'success' : 'error'}`}>
                {connectionStatus.message}
              </div>
            )}

            <LogoutButton className="logout-button" />
          </div>
        </div>
      </div>

      <style>{`
        .app-header {
          background: #343a40;
          color: white;
          padding: 16px 24px;
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
        }

        .header-content {
          display: flex;
          align-items: center;
          justify-content: space-between;
          max-width: 1200px;
          margin: 0 auto;
          gap: 24px;
        }

        .header-left {
          flex-shrink: 0;
        }

        .app-title {
          margin: 0;
          font-size: 20px;
          font-weight: 600;
          color: white;
        }

        .header-center {
          flex: 1;
          display: flex;
          justify-content: center;
        }

        .team-selector {
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .team-selector label {
          color: #ccc;
          font-size: 14px;
          white-space: nowrap;
        }

        .team-select {
          padding: 4px 8px;
          border-radius: 4px;
          border: 1px solid #6c757d;
          background: white;
          color: #333;
          font-size: 14px;
          min-width: 120px;
        }

        .team-select:focus {
          outline: none;
          border-color: #007bff;
          box-shadow: 0 0 0 2px rgba(0, 123, 255, 0.25);
        }

        .team-select:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .team-select.transitioning {
          background-color: #f8f9fa;
        }

        .transition-indicator {
          margin-left: 8px;
          font-size: 12px;
          animation: pulse 1.5s ease-in-out infinite;
        }

        .teams-loading {
          color: #ccc;
          font-size: 14px;
          font-style: italic;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 16px;
          flex-shrink: 0;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 14px;
        }

        .user-label {
          color: #ccc;
        }

        .username {
          color: white;
        }

        .header-actions {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .test-connection-button {
          background: #007bff;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          white-space: nowrap;
          transition: background-color 0.2s;
        }

        .test-connection-button:hover:not(:disabled) {
          background: #0056b3;
        }

        .test-connection-button:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .connection-status {
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 11px;
          font-weight: 500;
          white-space: nowrap;
          max-width: 200px;
          overflow: hidden;
          text-overflow: ellipsis;
        }

        .connection-status.success {
          background: #d4edda;
          color: #155724;
        }

        .connection-status.error {
          background: #f8d7da;
          color: #721c24;
        }

        .logout-button {
          background: #dc3545;
          color: white;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 12px;
          font-weight: 500;
          transition: background-color 0.2s;
        }

        .logout-button:hover {
          background: #c82333;
        }

        @media (max-width: 768px) {
          .header-content {
            flex-direction: column;
            gap: 12px;
            align-items: stretch;
          }

          .header-center {
            order: 3;
          }

          .header-right {
            justify-content: space-between;
          }

          .user-info {
            flex: 1;
          }
        }

        @media (max-width: 576px) {
          .app-header {
            padding: 12px 16px;
          }

          .app-title {
            font-size: 18px;
          }

          .header-actions {
            flex-direction: column;
            align-items: stretch;
            gap: 8px;
          }

          .test-connection-button,
          .logout-button {
            width: 100%;
          }

          .connection-status {
            max-width: none;
          }
        }
      `}</style>
    </header>
  );
};