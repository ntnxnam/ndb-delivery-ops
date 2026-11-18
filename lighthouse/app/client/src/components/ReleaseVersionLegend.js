import React from 'react';
import { getUIColumnOrder } from '../utils/releaseVersionUtils';

/**
 * ReleaseVersionLegend Component
 * 
 * Displays legend and rules for the Release Version table
 * Dynamically shows visible/hidden columns based on configuration
 * 
 * @param {Object} props
 * @param {Object} props.columnsConfig - Column configuration object
 */
function ReleaseVersionLegend({ columnsConfig }) {
  // Get visible columns from config
  const visibleColumns = columnsConfig ? getUIColumnOrder(columnsConfig) : [];
  
  // Helper to check if a column is visible
  const isColumnVisible = (columnKey) => {
    return visibleColumns.includes(columnKey);
  };
  
  // Check executive summary mode (showExecutiveSummary, showExecutiveUpdate, showPriority reserved for future use)
  const execSummaryMode = columnsConfig?.columns?.executiveSummary?.mode || 'generated';
  void (isColumnVisible('executiveSummary') && execSummaryMode);
  void (isColumnVisible('executiveUpdate') && execSummaryMode === 'jira');
  void isColumnVisible('priority');
  const sectionTitleStyle = {
    margin: '0 0 0.5rem 0',
    fontSize: '0.95rem',
    fontWeight: 700,
    color: '#1a1a1a',
    borderBottom: '2px solid #adb5bd',
    paddingBottom: '0.35rem'
  };

  return (
    <div style={{ 
      marginBottom: '0.75rem', 
      padding: '0.75rem', 
      backgroundColor: '#e9ecef',
      fontSize: '0.8rem'
    }}>
      <h3 style={{ 
        margin: '0 0 0.75rem 0', 
        fontSize: '1.1rem', 
        fontWeight: 700, 
        color: '#1a1a1a',
        borderBottom: '2px solid #495057',
        paddingBottom: '0.5rem'
      }}>
        Executive Summary & Table Legend
      </h3>
      
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '0.75rem' }}>
        {/* Highlighting (checkpoint dates + row) */}
        <div>
          <h4 style={sectionTitleStyle}>Highlighting</h4>
          <div style={{ marginLeft: '0', lineHeight: '1.6' }}>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ 
                display: 'inline-block', 
                width: '20px', 
                height: '20px', 
                border: '2px solid #ffc107', 
                borderRadius: '4px', 
                backgroundColor: '#fffbf0',
                marginRight: '6px',
                verticalAlign: 'middle'
              }}></span>
              <span>Yellow border: FS/DS Done Date = Test Plan Date</span>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ 
                display: 'inline-block', 
                width: '20px', 
                height: '20px', 
                border: '2px solid #de350b', 
                borderRadius: '4px', 
                backgroundColor: '#ffeaea',
                marginRight: '6px',
                verticalAlign: 'middle'
              }}></span>
              <span>Red border: FS/DS Done Date &gt; Test Plan Date</span>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ 
                display: 'inline-block', 
                width: '20px', 
                height: '20px', 
                border: '2px solid #de350b', 
                marginRight: '6px',
                verticalAlign: 'middle'
              }}></span>
              <span>Red border around row: Status Update Date is empty or &gt; 10 days old</span>
            </div>
          </div>
        </div>

        {/* Risk Indicator Colors */}
        <div>
          <h4 style={sectionTitleStyle}>Risk Indicator Colors</h4>
          <div style={{ marginLeft: '10px', lineHeight: '1.6' }}>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ 
                display: 'inline-block', 
                width: '20px', 
                height: '20px', 
                backgroundColor: '#de350b', 
                marginRight: '6px',
                verticalAlign: 'middle',
                borderRadius: '2px'
              }}></span>
              <span>Red: High Risk</span>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ 
                display: 'inline-block', 
                width: '20px', 
                height: '20px', 
                backgroundColor: '#ffc400', 
                marginRight: '6px',
                verticalAlign: 'middle',
                borderRadius: '2px'
              }}></span>
              <span>Yellow: Medium Risk</span>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ 
                display: 'inline-block', 
                width: '20px', 
                height: '20px', 
                backgroundColor: '#00875a', 
                marginRight: '6px',
                verticalAlign: 'middle',
                borderRadius: '2px'
              }}></span>
              <span>Green: Low Risk</span>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ 
                display: 'inline-block', 
                width: '20px', 
                height: '20px', 
                backgroundColor: '#fff3cd', 
                marginRight: '6px',
                verticalAlign: 'middle',
                borderRadius: '2px',
                border: '1px solid #dee2e6'
              }}></span>
              <span>Yellow (bold): Not Set</span>
            </div>
          </div>
        </div>

        {/* Date Display */}
        <div>
          <h4 style={sectionTitleStyle}>Date Display</h4>
          <div style={{ marginLeft: '10px', lineHeight: '1.6' }}>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ color: '#28a745', fontWeight: 600 }}>Green date</span>
              <span>: Current date (on time)</span>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ color: '#de350b', fontWeight: 600 }}>Red date</span>
              <span>: Current date (delayed)</span>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span style={{ textDecoration: 'line-through', color: '#999', fontSize: '11px' }}>Strikethrough date</span>
              <span>: Historical date (old value)</span>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span>Format: </span>
              <code style={{ backgroundColor: '#f1f3f5', padding: '2px 4px', borderRadius: '2px' }}>dd/MMM/yyyy</code>
              <span> (e.g., 29/Jan/2026)</span>
            </div>
            <div style={{ marginBottom: '4px' }}>
              <span>Historical dates shown as: </span>
              <div style={{ marginLeft: '10px', marginTop: '2px', lineHeight: 1.35 }}>
                <div><span style={{ color: '#de350b', fontWeight: 600 }}>11/Sep/2026</span></div>
                <div>
                  <span style={{ marginRight: '4px', color: '#666' }}>←</span>
                  <span style={{ textDecoration: 'line-through', color: '#999', fontSize: '11px' }}>13/Jul/2026</span>
                </div>
                <div>
                  <span style={{ marginRight: '4px', color: '#666' }}>←</span>
                  <span style={{ textDecoration: 'line-through', color: '#999', fontSize: '11px' }}>30/Jun/2026</span>
                  <span style={{ marginLeft: '4px', color: '#de350b', fontSize: '10px' }}>(+10.5 weeks)</span>
                </div>
              </div>
            </div>
            <div style={{ marginBottom: '4px', fontSize: '10px', color: '#666', marginLeft: '10px' }}>
              Current date first, then each earlier unique date on a new line. Net delay is on the oldest date.
            </div>
          </div>
        </div>

        {/* Checkpoint Dates Column */}
        <div>
          <h4 style={sectionTitleStyle}>Checkpoint Dates Column</h4>
          <div style={{ marginLeft: '10px', lineHeight: '1.6', fontSize: '11px' }}>
            <div>Shows all 5 checkpoint dates in order:</div>
            <ol style={{ margin: '4px 0', paddingLeft: '20px' }}>
              <li>FS/DS Done Date</li>
              <li>Test Plan Date</li>
              <li>Code Complete Date</li>
              <li>Commit Gate Ready Estimation Date</li>
              <li>Promotion Gate Ready Estimation Date</li>
            </ol>
            <div style={{ marginTop: '8px', padding: '6px', backgroundColor: '#ffe0b2', border: '2px solid #ff9800', borderRadius: '4px' }}>
              <strong>Code Complete Date with Colored Background:</strong> Feature has extension label ending with <code>code-complete-extension-recieved</code> (e.g., <code>ndb-2.11-28feb2026-code-complete-extension-recieved</code>). The Code Complete date cell will have an orange background to indicate an extension was granted.
            </div>
          </div>
        </div>


      </div>
    </div>
  );
}

export default ReleaseVersionLegend;

