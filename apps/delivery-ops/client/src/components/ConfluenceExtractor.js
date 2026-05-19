import React, { useState } from 'react';
import './ConfluenceExtractor.css';
import {
  populateJiraData as apiPopulateJiraData,
  populateConfluencePage,
  extractConfluencePage,
} from '../services/confluenceService';

function ConfluenceExtractor({ token, jiraCredentials, onContentExtracted, onSessionError }) {
  const [confluenceUrl, setConfluenceUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [extractedContent, setExtractedContent] = useState(null);
  const [jiraQueries, setJiraQueries] = useState([]);
  const [populatingData, setPopulatingData] = useState(false);
  const [jiraData, setJiraData] = useState(null);
  
  const populateJiraData = async (queries, contentToPopulate) => {
    if (!jiraCredentials || !jiraCredentials.email || !jiraCredentials.token || queries.length === 0) {
      return contentToPopulate;
    }

    setPopulatingData(true);
    try {
      const jiraData = await apiPopulateJiraData({
        queries,
        jiraEmail: jiraCredentials.email,
        jiraToken: jiraCredentials.token,
      });
      setJiraData(jiraData);

      const content = contentToPopulate || extractedContent;
      if (jiraData && content) {
        const populated = await populateConfluencePage({ content, jiraData });
        if (populated?.populatedContent) return populated.populatedContent;
      }
      return content;
    } catch (err) {
      console.error('Error populating JIRA data:', err);
      setError('Failed to fetch JIRA data. Content extracted but not populated.');
      return contentToPopulate;
    } finally {
      setPopulatingData(false);
    }
  };

  const handleExtract = async () => {
    if (!confluenceUrl.trim()) {
      setError('Please enter a Confluence URL');
      return;
    }

    if (!token) {
      setError('Token missing. Please authenticate again.');
      if (onSessionError) {
        onSessionError();
      }
      return;
    }

    setError('');
    setLoading(true);

    try {
      const data = await extractConfluencePage({ confluenceUrl, confluenceToken: token });

      let contentForPopulation = data.formattedContent;

      if (data.jiraQueries && data.jiraQueries.length > 0) {
        setJiraQueries(data.jiraQueries);

        if (jiraCredentials && jiraCredentials.email && jiraCredentials.token) {
          const populatedContent = await populateJiraData(data.jiraQueries, contentForPopulation);
          setExtractedContent(populatedContent || data.structuredContent);
        } else {
          setExtractedContent(data.structuredContent);
          setError('JIRA credentials not found. Please log in with JIRA credentials to populate data.');
        }
      } else {
        setExtractedContent(data.structuredContent);
      }

      onContentExtracted(data.content, data.title);
    } catch (err) {
      const errorMessage = err.message || 'Failed to extract content. Please check the URL and your credentials.';
      setError(errorMessage);
      setExtractedContent(null);

      if (err.message?.includes('401') && onSessionError) {
        setTimeout(onSessionError, 2000);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="confluence-extractor">
      <div className="card">
        <h2>Extract Confluence Content</h2>
        
        <div className="form-group">
          <label htmlFor="confluence-url">Confluence Page URL</label>
          <input
            type="url"
            id="confluence-url"
            value={confluenceUrl}
            onChange={(e) => setConfluenceUrl(e.target.value)}
            placeholder="https://your-confluence.com/pages/viewpage.action?pageId=123456"
            className="url-input"
          />
        </div>

        {error && <div className="error-message">{error}</div>}

        <button 
          onClick={handleExtract} 
          className="btn-extract"
          disabled={loading || !confluenceUrl.trim()}
        >
          {loading ? 'Extracting...' : 'Extract Content'}
        </button>

        {extractedContent && (
          <div className="extracted-content">
            <h3>Extracted Content Preview</h3>
            
            {jiraQueries.length > 0 && (
              <div className="jira-data-populate" style={{ marginBottom: '1rem', padding: '1rem', backgroundColor: jiraCredentials ? '#e8f5e9' : '#fff3cd', borderRadius: '6px', borderLeft: '4px solid ' + (jiraCredentials ? '#4caf50' : '#ffc107') }}>
                {populatingData ? (
                  <p><strong>🔄 Executing {jiraQueries.length} JIRA queries and populating content...</strong></p>
                ) : jiraData ? (
                  <p><strong>✅ JIRA data fetched and content populated with {jiraQueries.length} query results.</strong></p>
                ) : jiraCredentials ? (
                  <p><strong>Found {jiraQueries.length} JIRA queries. Data will be fetched automatically.</strong></p>
                ) : (
                  <p><strong>⚠️ Found {jiraQueries.length} JIRA queries but JIRA credentials are missing. Please log in with JIRA credentials.</strong></p>
                )}
              </div>
            )}
            
            <div className="content-preview">
              {/* Render HTML directly - structuredContent contains HTML with color spans */}
              <div 
                dangerouslySetInnerHTML={{ __html: extractedContent }}
                style={{ 
                  lineHeight: '1.6',
                  padding: '1rem',
                  backgroundColor: '#f9f9f9',
                  borderRadius: '4px'
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default ConfluenceExtractor;

