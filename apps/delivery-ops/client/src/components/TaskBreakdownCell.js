/**
 * TaskBreakdownCell Component
 * Displays task breakdown data in a compact table cell format
 */

import React, { useState, useCallback } from 'react';
import { getBreakdownSummary } from '../services/taskBreakdownService';
import { fetchJiraBaseUrl } from '../utils/jiraConfig';
import { buildTaskBreakdownJQL } from '../utils/jiraQueryUtils';

const STATUS_ORDER = ['Done', 'To Be Verified', 'In Progress', 'To Do', 'Blocked', 'Other'];
const STATUS_SHORT = {
  'To Be Verified': 'TBV',
  'In Progress': 'InProg',
  'To Do': 'ToDo',
};

/**
 * Build all issue types with their status counts — no truncation.
 */
function buildBreakdownLines(breakdownData) {
  if (!breakdownData?.breakdown?.length) return [];
  return [...breakdownData.breakdown]
    .sort((a, b) => b.total - a.total)
    .map((item) => {
      const statusParts = [];
      for (const category of STATUS_ORDER) {
        const categoryData = item.statusCategories?.[category];
        if (categoryData) {
          const count = Object.values(categoryData).reduce((sum, v) => sum + v, 0);
          if (count > 0) {
            statusParts.push(`${STATUS_SHORT[category] || category} - ${count}`);
          }
        }
      }
      return { type: item.type, label: statusParts.join(', ') };
    })
    .filter((l) => l.label);
}

/**
 * Generate JIRA URL for outstanding tickets 
 * Now uses the URL provided by the API response for consistency
 */
async function createOutstandingTicketsUrl(jiraKey, breakdownData) {
  // If API provides the outstanding URL, use it directly
  if (breakdownData?.outstandingUrl) {
    return breakdownData.outstandingUrl;
  }
  
  // If API provides the general URL, use it (for backward compatibility)
  if (breakdownData?.jiraSearchUrl) {
    return breakdownData.jiraSearchUrl;
  }
  
  // Fallback: generate URL client-side
  const baseUrl = await fetchJiraBaseUrl();
  const jqlQuery = buildTaskBreakdownJQL(jiraKey);
  const encodedJql = encodeURIComponent(jqlQuery);
  return `${baseUrl}/issues/?jql=${encodedJql}`;
}

/**
 * TaskBreakdownCell Component
 * 
 * @param {Object} props
 * @param {string} props.jiraKey - JIRA key for the item
 * @param {Object|null} props.breakdownData - Breakdown data from API
 * @param {boolean} props.loading - Whether data is still loading
 * @param {boolean} props.compact - Whether to show compact or detailed view
 */
const TaskBreakdownCell = React.memo(function TaskBreakdownCell({ jiraKey, breakdownData, loading, compact = true }) {
  const [isGeneratingUrl, setIsGeneratingUrl] = useState(false);

  const handleOutstandingClick = useCallback(async (e) => {
    e.preventDefault();
    setIsGeneratingUrl(true);
    try {
      const url = await createOutstandingTicketsUrl(jiraKey, breakdownData);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to generate JIRA URL:', error);
      window.open(`https://jira.nutanix.com/browse/${jiraKey}`, '_blank', 'noopener,noreferrer');
    } finally {
      setIsGeneratingUrl(false);
    }
  }, [jiraKey, breakdownData]);

  const handleTypeClick = useCallback(async (e, issueType) => {
    e.preventDefault();
    try {
      const baseUrl = await fetchJiraBaseUrl();
      const baseJql = buildTaskBreakdownJQL(jiraKey);
      const jql = `(${baseJql}) AND issuetype = "${issueType}"`;
      window.open(`${baseUrl}/issues/?jql=${encodeURIComponent(jql)}`, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to generate type URL:', error);
      window.open(`https://jira.nutanix.com/browse/${jiraKey}`, '_blank', 'noopener,noreferrer');
    }
  }, [jiraKey]);
  // Loading state
  if (loading) {
    return (
      <div style={{
        fontSize: '11px',
        color: '#6c757d',
        fontStyle: 'italic',
        padding: '4px'
      }}>
        Loading...
      </div>
    );
  }

  // No data or failed to load
  if (!breakdownData) {
    return (
      <div style={{
        fontSize: '11px',
        color: '#6c757d',
        fontStyle: 'italic',
        padding: '4px'
      }}>
        No data
      </div>
    );
  }

  // Check if breakdown data exists and has content
  if (!breakdownData.breakdown || breakdownData.breakdown.length === 0) {
    return (
      <div style={{
        fontSize: '11px',
        color: '#6c757d',
        padding: '4px'
      }}>
        No sub-tasks
      </div>
    );
  }

  const summary = getBreakdownSummary(breakdownData);
  const breakdownLines = buildBreakdownLines(breakdownData);

  const linkStyle = {
    color: '#0065ff',
    background: 'none',
    border: 'none',
    padding: 0,
    font: 'inherit',
    textDecoration: 'underline',
    cursor: 'pointer',
  };

  // Compact view (default for table cells)
  if (compact) {
    return (
      <div style={{ fontSize: '11px', lineHeight: '1.4', padding: '4px', color: '#212529' }}>
        {/* Summary line */}
        <div style={{ marginBottom: '3px', fontWeight: 500, color: '#495057' }}>
          <button type="button" onClick={handleOutstandingClick}
            style={{ ...linkStyle, cursor: isGeneratingUrl ? 'wait' : 'pointer' }}
            title={`View ${summary.remaining} outstanding tickets in JIRA`}>
            {summary.remaining}
          </button>
          {' remaining out of '}
          {summary.total}
          {' total ('}
          {summary.completionRate}
          {'% complete)'}
        </div>

        {/* Per-type breakdown — all types, each type label is a JIRA link */}
        <div style={{ color: '#6c757d', fontSize: '10px' }}>
          {breakdownLines.map(({ type, label }) => (
            <div key={type} style={{ marginBottom: '1px' }}>
              <button type="button" onClick={(e) => handleTypeClick(e, type)}
                style={{ ...linkStyle, fontSize: '10px' }}
                title={`View all ${type} tickets under ${jiraKey} in JIRA`}>
                {type}
              </button>
              {': '}
              {label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Detailed view (for expanded displays)
  return (
    <div style={{
      fontSize: '12px',
      lineHeight: '1.5',
      padding: '8px',
      border: '1px solid #dee2e6',
      borderRadius: '4px',
      backgroundColor: '#f8f9fa'
    }}>
      {/* Header with total count */}
      <div style={{
        fontWeight: 600,
        marginBottom: '8px',
        color: '#495057',
        borderBottom: '1px solid #dee2e6',
        paddingBottom: '4px'
      }}>
        Task Breakdown ({summary.total} total)
      </div>

      {/* Completion summary */}
      <div style={{ marginBottom: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
          <span>Completion Rate:</span>
          <span style={{ fontWeight: 500 }}>{summary.completionRate}%</span>
        </div>
        
        {/* Progress bar */}
        <div style={{
          height: '6px',
          backgroundColor: '#e9ecef',
          borderRadius: '3px',
          overflow: 'hidden'
        }}>
          <div style={{
            height: '100%',
            width: `${summary.completionRate}%`,
            backgroundColor: summary.completionRate >= 80 ? '#28a745' : 
                           summary.completionRate >= 50 ? '#ffc107' : '#dc3545',
            transition: 'width 0.3s ease'
          }} />
        </div>
      </div>

      {/* Status breakdown */}
      <div style={{ fontSize: '11px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '4px', alignItems: 'center' }}>
          {summary.done > 0 && (
            <>
              <div style={{ color: '#28a745', fontWeight: 500 }}>Done:</div>
              <div></div>
              <div>{summary.done}</div>
            </>
          )}
          {summary.toBeVerified > 0 && (
            <>
              <div style={{ color: '#fd7e14', fontWeight: 500 }}>To Be Verified:</div>
              <div></div>
              <div>{summary.toBeVerified}</div>
            </>
          )}
          {summary.inProgress > 0 && (
            <>
              <div style={{ color: '#007bff', fontWeight: 500 }}>In Progress:</div>
              <div></div>
              <div>{summary.inProgress}</div>
            </>
          )}
          {summary.remaining > 0 && (
            <>
              <div style={{ color: '#6c757d', fontWeight: 500 }}>Remaining:</div>
              <div></div>
              <div>{summary.remaining}</div>
            </>
          )}
        </div>
      </div>

      {/* Issue type breakdown */}
      <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #dee2e6' }}>
        <div style={{ fontWeight: 500, marginBottom: '4px', fontSize: '10px', color: '#6c757d' }}>
          BY TYPE:
        </div>
        {breakdownData.breakdown.map((item, _index) => (
          <div key={item.type} style={{ 
            display: 'flex', 
            justifyContent: 'space-between', 
            fontSize: '10px',
            marginBottom: '2px',
            color: '#495057'
          }}>
            <span>{item.type}:</span>
            <span>{item.total}</span>
          </div>
        ))}
      </div>
    </div>
  );
});

export default TaskBreakdownCell;