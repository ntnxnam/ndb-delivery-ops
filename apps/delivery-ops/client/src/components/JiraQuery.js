import React, { useState } from 'react';
import './JiraQuery.css';
import { runJqlQuery } from '../services/jiraQueryService';

function JiraQuery({ jiraCredentials }) {
  const [jiraEmail, setJiraEmail] = useState(() => {
    return localStorage.getItem('jiraEmail') || '';
  });
  const [jiraToken, setJiraToken] = useState(() => {
    return localStorage.getItem('jiraToken') || '';
  });
  
  // Update from props if available, or load from localStorage on mount
  React.useEffect(() => {
    // Always check localStorage first
    const storedEmail = localStorage.getItem('jiraEmail') || '';
    const storedToken = localStorage.getItem('jiraToken') || '';
    
    if (jiraCredentials && jiraCredentials.email && jiraCredentials.token) {
      // Props take precedence
      setJiraEmail(jiraCredentials.email);
      setJiraToken(jiraCredentials.token);
      // Also ensure localStorage is updated
      localStorage.setItem('jiraEmail', jiraCredentials.email);
      localStorage.setItem('jiraToken', jiraCredentials.token);
    } else if (storedEmail || storedToken) {
      // Use stored values if props not available
      if (storedEmail && !jiraEmail) {
        setJiraEmail(storedEmail);
      }
      if (storedToken && !jiraToken) {
        setJiraToken(storedToken);
      }
    }
  }, [jiraCredentials]);
  const [jiraQuery, setJiraQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!jiraQuery.trim()) {
      setError('Please enter a JIRA query');
      return;
    }
    
    if (!jiraToken || !jiraEmail) {
      setError('Please enter JIRA email and token');
      return;
    }

    setError('');
    setLoading(true);
    setResults(null);

    try {
      const data = await runJqlQuery({ jql: jiraQuery, jiraToken, jiraEmail });
      setResults(data);
      localStorage.setItem('jiraEmail', jiraEmail);
      localStorage.setItem('jiraToken', jiraToken);
    } catch (err) {
      setError(err.message || 'Failed to execute JIRA query. Please check your credentials and query.');
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const formatResults = () => {
    if (!results) return null;

    return (
      <div className="jira-results">
        <div className="results-summary">
          <h3>Query Results</h3>
          <div className="summary-stats">
            <div className="stat">
              <span className="stat-label">Total:</span>
              <span className="stat-value">{results.total}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Returned:</span>
              <span className="stat-value">{results.count}</span>
            </div>
            {results.summary && (
              <>
                <div className="stat">
                  <span className="stat-label">Epics:</span>
                  <span className="stat-value">{results.summary.byEpic}</span>
                </div>
              </>
            )}
          </div>
        </div>

        {results.summary && (
          <div className="results-breakdown">
            <h4>Breakdown by Type</h4>
            <ul>
              {Object.entries(results.summary.byType).map(([type, count]) => (
                <li key={type}>
                  <strong>{type}:</strong> {count}
                </li>
              ))}
            </ul>

            <h4>Breakdown by Status</h4>
            <ul>
              {Object.entries(results.summary.byStatus).map(([status, count]) => (
                <li key={status}>
                  <strong>{status}:</strong> {count}
                </li>
              ))}
            </ul>
          </div>
        )}

        {results.epics && results.epics.length > 0 && (
          <div className="epics-list">
            <h4>Epics ({results.epics.length})</h4>
            {results.epics.map((epic, index) => (
              <div key={epic.key} className="epic-item">
                <div className="epic-header">
                  <strong>{epic.key}</strong>: {epic.summary}
                  <span className="epic-count">({epic.issues.length} issues)</span>
                </div>
                {epic.issues.length > 0 && (
                  <ul className="epic-issues">
                    {epic.issues.slice(0, 10).map(issue => (
                      <li key={issue.key}>
                        {issue.key}: {issue.summary} - {issue.status}
                      </li>
                    ))}
                    {epic.issues.length > 10 && (
                      <li className="more-items">... and {epic.issues.length - 10} more</li>
                    )}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}

        {results.issues && results.issues.length > 0 && results.issues.length <= 50 && (
          <div className="issues-list">
            <h4>Issues ({results.issues.length})</h4>
            <ul>
              {results.issues.map(issue => (
                <li key={issue.key}>
                  <strong>{issue.key}</strong>: {issue.summary} 
                  <span className="issue-meta"> [{issue.type}] - {issue.status}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {results.issues && results.issues.length > 50 && (
          <div className="issues-note">
            <p>Showing summary only. {results.issues.length} issues returned. Use JIRA to view full list.</p>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="jira-query">
      <div className="card">
        <h2>JIRA Query</h2>
        
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="jira-email">JIRA Email</label>
            <input
              type="email"
              id="jira-email"
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
              placeholder="your.email@nutanix.com"
              required
            />
          </div>

          <div className="form-group">
            <label id="jira-token-label">
              JIRA API Token 
              {jiraToken && <span style={{ color: '#28a745', marginLeft: '0.5rem', fontWeight: 'bold' }}>✓ Saved</span>}
            </label>
            {jiraToken ? (
              <div 
                id="jira-token"
                role="textbox"
                aria-labelledby="jira-token-label"
                aria-readonly="true"
                style={{ 
                  padding: '0.75rem', 
                  backgroundColor: '#e8f5e9', 
                  border: '1px solid #4caf50', 
                  borderRadius: '6px',
                  marginBottom: '0.5rem',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center'
                }}
              >
                <span style={{ color: '#2e7d32', fontWeight: '500' }}>✓ Token is saved and ready to use</span>
                <button
                  type="button"
                  onClick={() => setJiraToken('')}
                  style={{
                    padding: '0.25rem 0.75rem',
                    background: 'transparent',
                    border: '1px solid #4caf50',
                    borderRadius: '4px',
                    color: '#2e7d32',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: '500'
                  }}
                >
                  Change Token
                </button>
              </div>
            ) : (
              <input
                type="password"
                id="jira-token"
                aria-labelledby="jira-token-label"
                value={jiraToken}
                onChange={(e) => setJiraToken(e.target.value)}
                placeholder="Enter your JIRA API token"
                required
              />
            )}
            <small className="help-text">
              Generate an API token from JIRA: Account Settings → Security → API tokens
            </small>
          </div>

          <div className="form-group">
            <label htmlFor="jira-query">JIRA Query (JQL)</label>
            <textarea
              id="jira-query"
              value={jiraQuery}
              onChange={(e) => setJiraQuery(e.target.value)}
              placeholder='project = NDB AND status = "In Progress"'
              rows="4"
              className="query-input"
              required
            />
            <small className="help-text">
              Enter a JIRA Query Language (JQL) query
            </small>
          </div>

          {error && <div className="error-message">{error}</div>}

          <button 
            type="submit" 
            className="btn-query"
            disabled={loading || !jiraQuery.trim() || !jiraToken || !jiraEmail}
          >
            {loading ? 'Executing Query...' : 'Execute Query'}
          </button>
        </form>

        {results && formatResults()}
      </div>
    </div>
  );
}

export default JiraQuery;

