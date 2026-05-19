import React, { useState, useEffect, useCallback } from 'react';
import { authenticatedGet, authenticatedDelete } from '../utils/api';

function EmailHistoryTab() {
  const [history, setHistory] = useState([]);
  const [statistics, setStatistics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedEmails, setSelectedEmails] = useState(new Set());
  const [filters, setFilters] = useState({
    username: '',
    jiraKey: '',
    releaseVersion: ''
  });

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.username) params.append('username', filters.username);
      if (filters.jiraKey) params.append('jiraKey', filters.jiraKey);
      if (filters.releaseVersion) params.append('releaseVersion', filters.releaseVersion);
      
      const response = await authenticatedGet(`/api/email/history?${params.toString()}`);
      if (response.data.success) {
        setHistory(response.data.history);
        setStatistics(response.data.statistics);
      }
    } catch (error) {
      console.error('Failed to fetch email history:', error);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  const deleteEmails = async (deleteFilters = {}) => {
    const confirmMessage = deleteFilters.testOnly 
      ? 'Are you sure you want to delete ALL test emails? This cannot be undone.'
      : `Are you sure you want to delete ${Object.keys(deleteFilters).length > 0 ? 'filtered' : 'selected'} emails? This cannot be undone.`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }
    
    try {
      const response = await authenticatedDelete('/api/email/history', deleteFilters);
      if (response.data.success) {
        alert(`Deleted ${response.data.deletedCount} email record(s)`);
        fetchHistory(); // Refresh the list
        setSelectedEmails(new Set());
        setDeleteMode(false);
      }
    } catch (error) {
      console.error('Failed to delete emails:', error);
      alert('Failed to delete emails');
    }
  };

  const deleteAllTestEmails = async () => {
    if (!window.confirm('Are you sure you want to delete ALL test emails? This cannot be undone.')) {
      return;
    }
    
    try {
      const response = await authenticatedDelete('/api/email/history/test/all');
      if (response.data.success) {
        alert(`Deleted ${response.data.deletedCount} test email record(s)`);
        fetchHistory();
      }
    } catch (error) {
      console.error('Failed to delete test emails:', error);
      alert('Failed to delete test emails');
    }
  };

  const deleteSingleEmail = async (id) => {
    if (!window.confirm('Are you sure you want to delete this email record?')) {
      return;
    }
    
    try {
      const response = await authenticatedDelete(`/api/email/history/${id}`);
      if (response.data.success) {
        alert('Email record deleted');
        fetchHistory();
      }
    } catch (error) {
      console.error('Failed to delete email:', error);
      alert('Failed to delete email record');
    }
  };

  const formatDate = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };

  const toggleEmailSelection = (id) => {
    const newSelected = new Set(selectedEmails);
    if (newSelected.has(id)) {
      newSelected.delete(id);
    } else {
      newSelected.add(id);
    }
    setSelectedEmails(newSelected);
  };

  const selectAll = () => {
    if (selectedEmails.size === history.length) {
      setSelectedEmails(new Set());
    } else {
      setSelectedEmails(new Set(history.map(e => e.id)));
    }
  };

  return (
    <div style={{ padding: '10px' }}>
      <h2 style={{ marginTop: '0', marginBottom: '10px', fontSize: '1.3rem' }}>Email History</h2>
      
      {statistics && (
        <div style={{ marginBottom: '10px', padding: '8px', backgroundColor: '#f5f5f5', borderRadius: '3px' }}>
          <h3 style={{ marginTop: '0', marginBottom: '5px', fontSize: '1rem' }}>Statistics</h3>
          <p><strong>Total Emails Sent:</strong> {statistics.total}</p>
          <p><strong>By Type:</strong> JIRA: {statistics.byType.jira}, Release Versions: {statistics.byType['release-versions']}, General: {statistics.byType.general || 0}, Generic Reminder: {statistics.byType['generic-reminder'] || 0}</p>
          {statistics.lastSent && <p><strong>Last Sent:</strong> {formatDate(statistics.lastSent)}</p>}
        </div>
      )}

      <div style={{ marginBottom: '10px' }}>
        <h3 style={{ marginTop: '0', marginBottom: '5px', fontSize: '1rem' }}>Filters</h3>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
          <input
            type="text"
            placeholder="Filter by username/email"
            value={filters.username}
            onChange={(e) => setFilters({ ...filters, username: e.target.value })}
            style={{ padding: '4px 6px', borderRadius: '3px', border: '1px solid #ccc', fontSize: '0.85rem' }}
          />
          <input
            type="text"
            placeholder="Filter by JIRA key"
            value={filters.jiraKey}
            onChange={(e) => setFilters({ ...filters, jiraKey: e.target.value })}
            style={{ padding: '4px 6px', borderRadius: '3px', border: '1px solid #ccc', fontSize: '0.85rem' }}
          />
          <input
            type="text"
            placeholder="Filter by release version"
            value={filters.releaseVersion}
            onChange={(e) => setFilters({ ...filters, releaseVersion: e.target.value })}
            style={{ padding: '4px 6px', borderRadius: '3px', border: '1px solid #ccc', fontSize: '0.85rem' }}
          />
        </div>
        
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <button 
            onClick={() => setDeleteMode(!deleteMode)}
            style={{ 
              padding: '5px 10px',
              fontSize: '0.85rem', 
              backgroundColor: deleteMode ? '#dc3545' : '#6c757d', 
              color: 'white', 
              border: 'none', 
              borderRadius: '3px', 
              cursor: 'pointer' 
            }}
          >
            {deleteMode ? 'Cancel Delete' : 'Delete Mode'}
          </button>
          
          {deleteMode && (
            <>
              <button 
                onClick={deleteAllTestEmails}
                style={{ 
                  padding: '5px 10px',
              fontSize: '0.85rem', 
                  backgroundColor: '#ffc107', 
                  color: 'black', 
                  border: 'none', 
                  borderRadius: '3px', 
                  cursor: 'pointer' 
                }}
              >
                Delete All Test Emails
              </button>
              <button 
                onClick={() => deleteEmails({ 
                  username: filters.username || undefined,
                  jiraKey: filters.jiraKey || undefined,
                  releaseVersion: filters.releaseVersion || undefined
                })}
                style={{ 
                  padding: '5px 10px',
              fontSize: '0.85rem', 
                  backgroundColor: '#dc3545', 
                  color: 'white', 
                  border: 'none', 
                  borderRadius: '3px', 
                  cursor: 'pointer' 
                }}
              >
                Delete Filtered Emails
              </button>
              {selectedEmails.size > 0 && (
                <button 
                  onClick={() => {
                    // Delete selected emails one by one (or implement bulk delete by IDs)
                    selectedEmails.forEach(id => deleteSingleEmail(id));
                  }}
                  style={{ 
                    padding: '5px 10px',
              fontSize: '0.85rem', 
                    backgroundColor: '#dc3545', 
                    color: 'white', 
                    border: 'none', 
                    borderRadius: '3px', 
                    cursor: 'pointer' 
                  }}
                >
                  Delete Selected ({selectedEmails.size})
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '10px' }}>
            <thead>
              <tr style={{ backgroundColor: '#f0f0f0' }}>
                {deleteMode && (
                  <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>
                    <input 
                      type="checkbox" 
                      checked={selectedEmails.size === history.length && history.length > 0}
                      onChange={selectAll}
                    />
                  </th>
                )}
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>Timestamp</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>Sent By</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>Subject</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>To</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>CC</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>Type</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>JIRA/Version</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>Test</th>
                <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>Message ID</th>
                {deleteMode && (
                  <th style={{ padding: '6px 8px', textAlign: 'left', border: '1px solid #ddd', fontSize: '0.85rem' }}>Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {history.length === 0 ? (
                <tr>
                  <td colSpan={deleteMode ? 11 : 10} style={{ padding: '15px', textAlign: 'center' }}>
                    No email history found
                  </td>
                </tr>
              ) : (
                history.map((email) => (
                  <tr key={email.id} style={{ borderBottom: '1px solid #ddd' }}>
                    {deleteMode && (
                      <td style={{ padding: '6px 8px', border: '1px solid #ddd', fontSize: '0.85rem' }}>
                        <input 
                          type="checkbox" 
                          checked={selectedEmails.has(email.id)}
                          onChange={() => toggleEmailSelection(email.id)}
                        />
                      </td>
                    )}
                    <td style={{ padding: '6px 8px', border: '1px solid #ddd', fontSize: '0.85rem' }}>{formatDate(email.timestamp)}</td>
                    <td style={{ padding: '6px 8px', border: '1px solid #ddd', fontSize: '0.85rem' }}>
                      {email.username}<br />
                      <small style={{ color: '#666' }}>{email.userEmail}</small>
                    </td>
                    <td style={{ padding: '6px 8px', border: '1px solid #ddd', fontSize: '0.85rem' }}>{email.subject}</td>
                    <td style={{ padding: '6px 8px', border: '1px solid #ddd', fontSize: '0.85rem' }}>
                      {Array.isArray(email.to) ? email.to.join(', ') : email.to}
                    </td>
                    <td style={{ padding: '6px 8px', border: '1px solid #ddd', fontSize: '0.85rem' }}>
                      {Array.isArray(email.cc) && email.cc.length > 0 ? email.cc.join(', ') : '-'}
                    </td>
                    <td style={{ padding: '6px 8px', border: '1px solid #ddd', fontSize: '0.85rem' }}>{email.type}</td>
                    <td style={{ padding: '6px 8px', border: '1px solid #ddd', fontSize: '0.85rem' }}>
                      {email.type === 'generic-reminder'
                        ? (email.metadata?.issueCount != null || email.metadata?.columnCount != null
                            ? `${email.metadata.issueCount ?? '-'} issues, ${email.metadata.columnCount ?? '-'} cols`
                            : 'Generic reminder')
                        : (email.jiraKey || (email.releaseVersions ? email.releaseVersions.join(', ') : '-'))}
                    </td>
                    <td style={{ padding: '10px', border: '1px solid #ddd', textAlign: 'center' }}>
                      {email.metadata?.isTest ? '✓' : '-'}
                    </td>
                    <td style={{ padding: '10px', border: '1px solid #ddd', fontSize: '12px' }}>
                      {email.messageId || '-'}
                    </td>
                    {deleteMode && (
                      <td style={{ padding: '6px 8px', border: '1px solid #ddd', fontSize: '0.85rem' }}>
                        <button
                          onClick={() => deleteSingleEmail(email.id)}
                          style={{
                            padding: '3px 6px',
                            fontSize: '0.75rem',
                            backgroundColor: '#dc3545',
                            color: 'white',
                            border: 'none',
                            borderRadius: '3px',
                            cursor: 'pointer'
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    )}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default EmailHistoryTab;

