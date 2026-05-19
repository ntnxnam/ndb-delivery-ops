/**
 * TaskBreakdownCell Component
 * Displays task breakdown data in a compact table cell format
 */

import React, { useState, useCallback } from 'react';
import { getBreakdownSummary } from '../services/taskBreakdownService';
import { fetchJiraBaseUrl } from '../utils/jiraConfig';
import { buildTaskBreakdownJQL } from '../utils/jiraQueryUtils';

/**
 * Format breakdown data for detailed display: "Tasks: Done - 2, In Progress - 15, ..."
 */
function formatDetailedBreakdown(breakdownData) {
  if (!breakdownData || !breakdownData.breakdown || breakdownData.breakdown.length === 0) {
    return 'No sub-tasks found';
  }

  const parts = [];
  
  // Sort breakdown by total count (descending) and take top issue types
  const sortedBreakdown = breakdownData.breakdown
    .sort((a, b) => b.total - a.total)
    .slice(0, 3); // Show top 3 issue types
  
  for (const item of sortedBreakdown) {
    const statusParts = [];
    
    // Order status categories for display
    const statusOrder = ['Done', 'To Be Verified', 'In Progress', 'To Do', 'Blocked', 'Other'];
    
    for (const category of statusOrder) {
      const categoryData = item.statusCategories[category];
      if (categoryData) {
        const count = Object.values(categoryData).reduce((sum, val) => sum + val, 0);
        if (count > 0) {
          // Use short names for compact display
          const shortName = category === 'To Be Verified' ? 'TBV' : 
                           category === 'In Progress' ? 'InProg' : 
                           category === 'To Do' ? 'ToDo' : category;
          statusParts.push(`${shortName} - ${count}`);
        }
      }
    }
    
    if (statusParts.length > 0) {
      parts.push(`${item.type}: ${statusParts.join(', ')}`);
    }
  }

  // Show ellipsis if there are more issue types
  if (breakdownData.breakdown.length > 3) {
    parts.push('...');
  }

  return parts.length > 0 ? parts : ['No breakdown available'];
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
  
  // Component is now properly memoized to prevent unnecessary re-renders
  
  // Debug logging removed for performance
  
  const handleOutstandingClick = useCallback(async (e) => {
    e.preventDefault();
    setIsGeneratingUrl(true);
    
    try {
      const url = await createOutstandingTicketsUrl(jiraKey, breakdownData);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      console.error('Failed to generate JIRA URL:', error);
      // Fallback to basic JIRA search if URL generation fails
      const fallbackUrl = `https://jira.nutanix.com/browse/${jiraKey}`;
      window.open(fallbackUrl, '_blank', 'noopener,noreferrer');
    } finally {
      setIsGeneratingUrl(false);
    }
  }, [jiraKey, breakdownData]);
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

  // Get summary and detailed breakdown from API response
  const summary = getBreakdownSummary(breakdownData);
  const detailedBreakdown = formatDetailedBreakdown(breakdownData);

  // Compact view (default for table cells)
  if (compact) {
    return (
      <div 
        style={{
          fontSize: '11px',
          lineHeight: '1.4',
          padding: '4px',
          color: '#212529',
          fontFamily: 'system-ui, -apple-system, sans-serif'
        }}
        title={`Total: ${summary.total} | Done: ${summary.done} | To Be Verified: ${summary.toBeVerified} | In Progress: ${summary.inProgress} | Remaining: ${summary.remaining} | Completion: ${summary.completionRate}%`}
      >
        {/* Summary line with hyperlinked outstanding count */}
        <div style={{ 
          marginBottom: '2px', 
          fontWeight: 500, 
          color: '#495057'
        }}>
          <button
            type="button"
            onClick={handleOutstandingClick}
            style={{
              color: '#0065ff',
              background: 'none',
              border: 'none',
              padding: 0,
              font: 'inherit',
              textDecoration: 'underline',
              cursor: isGeneratingUrl ? 'wait' : 'pointer'
            }}
            title={`Click to view ${summary.remaining} outstanding tickets in JIRA`}
          >
            {summary.remaining}
          </button>
          {' remaining out of '}
          {summary.total}
          {' total ('}
          {summary.completionRate}
          {'% complete)'}
        </div>
        
        {/* Detailed breakdown by issue type and status */}
        <div style={{ 
          color: '#6c757d',
          fontSize: '10px'
        }}>
          {Array.isArray(detailedBreakdown) ? (
            detailedBreakdown.map((line, index) => (
              <div key={index} style={{ marginBottom: '1px' }}>
                {line}
              </div>
            ))
          ) : (
            detailedBreakdown
          )}
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
        {breakdownData.breakdown.slice(0, 3).map((item, _index) => (
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
        {breakdownData.breakdown.length > 3 && (
          <div style={{ fontSize: '10px', color: '#6c757d', fontStyle: 'italic' }}>
            +{breakdownData.breakdown.length - 3} more types
          </div>
        )}
      </div>
    </div>
  );
});

export default TaskBreakdownCell;