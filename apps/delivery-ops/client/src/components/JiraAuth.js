import React, { useState, useEffect } from 'react';
import './JiraAuth.css';

function JiraAuth({ jiraCredentials, onJiraAuth }) {
  const [jiraEmail, setJiraEmail] = useState(() => {
    return localStorage.getItem('jiraEmail') || '';
  });
  const [jiraToken, setJiraToken] = useState(() => {
    return localStorage.getItem('jiraToken') || '';
  });
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    if (jiraCredentials && jiraCredentials.email && jiraCredentials.token) {
      setJiraEmail(jiraCredentials.email);
      setJiraToken(jiraCredentials.token);
    }
  }, [jiraCredentials]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!jiraEmail || !jiraToken) {
      setError('Please enter both JIRA email and token');
      return;
    }

    try {
      // Store JIRA credentials in localStorage
      localStorage.setItem('jiraEmail', jiraEmail);
      localStorage.setItem('jiraToken', jiraToken);
      
      // Notify parent component
      if (onJiraAuth) {
        onJiraAuth({ email: jiraEmail, token: jiraToken });
      }
      
      setSuccess('JIRA credentials saved successfully!');
      setTimeout(() => setSuccess(''), 3000);
    } catch (err) {
      setError('Failed to save JIRA credentials');
    }
  };

  const handleClear = () => {
    localStorage.removeItem('jiraEmail');
    localStorage.removeItem('jiraToken');
    setJiraEmail('');
    setJiraToken('');
    setError('');
    setSuccess('');
    if (onJiraAuth) {
      onJiraAuth(null);
    }
  };

  return (
    <div className="jira-auth">
      <div className="card">
        <h2>JIRA Authentication</h2>
        <p className="auth-description">
          Optionally authenticate with JIRA to automatically fetch data from JIRA queries in Confluence pages.
          <br />
          <small>Your credentials are stored locally and will persist across refreshes.</small>
        </p>
        
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
            <small className="help-text">
              Your JIRA email address
            </small>
          </div>

          <div className="form-group">
            <label id="jira-token-label">JIRA API Token</label>
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
                <span style={{ color: '#2e7d32', fontWeight: '500' }}>✓ Token is saved</span>
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
              Generate an API token from JIRA:
              <br />
              Account Settings → Security → API tokens → Create API token
            </small>
          </div>

          {error && <div className="error-message">{error}</div>}
          {success && <div className="success-message">{success}</div>}

          <div style={{ display: 'flex', gap: '1rem' }}>
            <button type="submit" className="btn-primary" disabled={!jiraEmail || !jiraToken}>
              {jiraEmail && jiraToken ? 'Update JIRA Credentials' : 'Authenticate JIRA'}
            </button>
            {jiraEmail && jiraToken && (
              <button type="button" onClick={handleClear} className="btn-secondary">
                Clear JIRA Credentials
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

export default JiraAuth;

