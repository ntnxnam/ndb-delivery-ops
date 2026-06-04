import React, { useMemo } from 'react';
import { 
  renderNotSet, 
  formatDate, 
  isDateOlderThan, 
  formatJiraWikiMarkup, 
  hasCodeCompleteExtensionLabel,
  getExtensionColor,
  normalizeDateForComparison
} from '../utils/releaseVersionUtils';
import { formatDateWithHistory } from '../utils/dateHistoryDisplay';
import TaskBreakdownCell from './TaskBreakdownCell';
import ExecSummaryCell from './ExecSummaryCell';

function getStatusDisplayValue(item) {
  const raw = item?.status;
  if (raw == null) return '';
  return typeof raw === 'string' ? raw : (raw?.name || raw?.value || '');
}

/** Match item's JIRA status against config list (case-insensitive). Config lists exact JIRA status names. */
function isJiraStatusWithTick(statusStr, statusesWithTick) {
  if (!statusStr || typeof statusStr !== 'string' || !Array.isArray(statusesWithTick) || statusesWithTick.length === 0) return false;
  const normalized = statusStr.trim().toLowerCase();
  return statusesWithTick.some(s => String(s).trim().toLowerCase() === normalized);
}

function StatusWithTick({ statusValue, statusesWithTick }) {
  if (!statusValue) return null;
  const showTick = isJiraStatusWithTick(statusValue, statusesWithTick);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
      {showTick && (
        <span style={{ color: '#28a745', fontWeight: 'bold', fontSize: '14px' }} title="JIRA status met">✓</span>
      )}
      <span>{statusValue}</span>
    </span>
  );
}

/**
 * Render all checkpoint dates in a single column
 * @param {object} item - JIRA item object
 * @param {string} selectedVersion - Selected release version
 * @param {object} checkpointHistory - Checkpoint history data
 * @returns {JSX.Element} Checkpoint dates display
 */
export function renderAllCheckpointDates(item, selectedVersion, checkpointHistory) {
  const dates = [
    { label: 'FS/DS Done Date', field: 'fsdsDone', value: item.customfield_13861 },
    { label: 'Test Plan Date', field: 'testPlan', value: item.customfield_11068 },
    { label: 'Code Complete Date', field: 'codeComplete', value: item.customfield_11067 },
    { label: 'Commit Gate Ready Estimation Date', field: 'commitGate', value: item.customfield_35863 },
    { label: 'Promotion Gate Ready Estimation Date', field: 'promotionGate', value: item.customfield_35864 }
  ];
  
  // Check if item has extension label
  const hasExtension = hasCodeCompleteExtensionLabel(item);

  // Normalize and compare FS/DS Done Date and Test Plan Date
  const fsdsDate = normalizeDateForComparison(item.customfield_13861);
  const testPlanDate = normalizeDateForComparison(item.customfield_11068);
  
  // Determine highlighting conditions
  let fsdsHighlight = null; // null, 'yellow', or 'red'
  let testPlanHighlight = null;
  
  if (fsdsDate instanceof Date && testPlanDate instanceof Date) {
    // Compare dates by normalizing to YYYY-MM-DD for accurate comparison
    const fsdsYear = fsdsDate.getFullYear();
    const fsdsMonth = fsdsDate.getMonth();
    const fsdsDay = fsdsDate.getDate();
    
    const testPlanYear = testPlanDate.getFullYear();
    const testPlanMonth = testPlanDate.getMonth();
    const testPlanDay = testPlanDate.getDate();
    
    // Check if dates are the same (same year, month, day)
    if (fsdsYear === testPlanYear && fsdsMonth === testPlanMonth && fsdsDay === testPlanDay) {
      // Dates are the same - highlight both with yellow
      fsdsHighlight = 'yellow';
      testPlanHighlight = 'yellow';
    } 
    // Check if FS/DS Done Date is after Test Plan Date
    else if (fsdsDate.getTime() > testPlanDate.getTime()) {
      // FS/DS Done Date is after Test Plan Date - highlight both with red
      fsdsHighlight = 'red';
      testPlanHighlight = 'red';
    }
    // If Test Plan > FS/DS, no highlighting (normal flow)
  }

  return (
    <div style={{ lineHeight: '1.8', fontSize: '11px' }}>
      {dates.map((date, index) => {
        // Determine if this date should be highlighted
        let highlightStyle = null;
        if (date.field === 'fsdsDone' && fsdsHighlight) {
          highlightStyle = fsdsHighlight === 'red' 
            ? { border: '2px solid #de350b', borderRadius: '4px', padding: '4px', backgroundColor: '#ffeaea' }
            : { border: '2px solid #ffc107', borderRadius: '4px', padding: '4px', backgroundColor: '#fffbf0' };
        } else if (date.field === 'testPlan' && testPlanHighlight) {
          highlightStyle = testPlanHighlight === 'red'
            ? { border: '2px solid #de350b', borderRadius: '4px', padding: '4px', backgroundColor: '#ffeaea' }
            : { border: '2px solid #ffc107', borderRadius: '4px', padding: '4px', backgroundColor: '#fffbf0' };
        }
        
        // Add extension label highlighting for Code Complete Date - just background color, no border
        let extensionHighlightStyle = null;
        if (date.field === 'codeComplete' && hasExtension) {
          const extensionColor = getExtensionColor(); // Single color for all
          extensionHighlightStyle = {
            backgroundColor: extensionColor.backgroundColor
            // No border, no padding, just background color
          };
        } else if (date.field === 'codeComplete') {
        }
        
        // For Code Complete with extension, use extension style only
        let finalStyle = {};
        if (date.field === 'codeComplete' && extensionHighlightStyle) {
          finalStyle = {
            backgroundColor: extensionHighlightStyle.backgroundColor,
            marginBottom: index < dates.length - 1 ? '8px' : '0'
          };
        } else {
          // Other dates - merge highlight styles
          finalStyle = {
            marginBottom: index < dates.length - 1 ? '8px' : '0',
            ...(highlightStyle || {}),
            ...(extensionHighlightStyle || {})
          };
        }
        
        return (
          <div 
            key={date.field} 
            style={finalStyle}
          >
            <div style={{ fontWeight: 600, color: '#495057', marginBottom: '2px', fontSize: '10px' }}>
              {date.label}:
            </div>
            <div style={{ paddingLeft: '4px' }}>
              {formatDateWithHistory(item.key, date.field, date.value, checkpointHistory)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * Render team contacts in a single column (similar to checkpoint dates)
 * @param {object} item - JIRA item object
 * @returns {JSX.Element} Team contacts display
 */
export function renderTeamContacts(item) {
  const contacts = [
    { label: 'Assignee', value: item.assignee },
    { label: 'QA Contact', value: item.customfield_10860 },
    { label: 'PM Owner', value: item.customfield_11260 },
    { label: 'Program Mgr', value: item.customfield_27764 }
  ];

  // Helper to format user value
  const formatUserValue = (userValue) => {
    if (!userValue) return null;
    if (typeof userValue === 'string') return userValue;
    if (userValue.displayName) return userValue.displayName;
    if (userValue.name) return userValue.name;
    if (userValue.emailAddress) return userValue.emailAddress;
    return null;
  };

  return (
    <div style={{ lineHeight: '1.8', fontSize: '11px' }}>
      {contacts.map((contact, index) => {
        const userValue = formatUserValue(contact.value);
        return (
          <div 
            key={contact.label} 
            style={{ marginBottom: index < contacts.length - 1 ? '8px' : '0' }}
          >
            <div style={{ fontWeight: 600, color: '#495057', marginBottom: '2px', fontSize: '10px' }}>
              {contact.label}:
            </div>
            <div style={{ paddingLeft: '4px' }}>
              {userValue ? (
                <span>{userValue}</span>
              ) : (
                <span style={{ color: '#999', fontStyle: 'italic' }}>Not Set</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * ReleaseVersionTableCell Component
 * 
 * Renders a single table cell based on column type
 * 
 * @param {Object} props
 * @param {Object} props.item - JIRA item object
 * @param {string} props.columnKey - Column key identifier
 * @param {Object} props.columnsConfig - Column configuration object
 * @param {string} props.selectedVersion - Selected release version
 * @param {Object} props.checkpointHistory - Checkpoint history data
 * @param {string} props.jiraBaseUrl - JIRA base URL for links
 */
const ReleaseVersionTableCell = React.memo(function ReleaseVersionTableCell({
  item,
  columnKey,
  columnsConfig,
  selectedVersion,
  checkpointHistory,
  jiraBaseUrl,
  itemExecutiveSummary,
  ganttConfig = null,
  breakdownDataMap,
  loadingBreakdowns
}) {
  // Memoize breakdown data calculations at the top level
  const breakdownData = useMemo(() => breakdownDataMap?.get(item.key) || null, [breakdownDataMap, item.key]);
  const isBreakdownLoading = useMemo(() => loadingBreakdowns && !breakdownData, [loadingBreakdowns, breakdownData]);
  
  const col = columnsConfig?.columns?.[columnKey];
  
  // Don't render if column is not included in UI
  if (!col || col.includeInUI === false) {
    return null;
  }
  
  // Risk Indicator styling
  if (columnKey === 'riskIndicator') {
    const riskIndicator = item.customfield_23560;
    const riskValue = riskIndicator?.value || riskIndicator || 'Not Set';
    const riskColor = riskIndicator?.color || 'transparent';
    const isNotSet = !riskValue || riskValue === 'Not Set' || riskValue === 'N/A' || String(riskValue).trim() === '';
    
    let riskBgColor = 'transparent';
    let riskTextColor = 'inherit';
    if (isNotSet) {
      riskBgColor = '#fff3cd';
      riskTextColor = 'inherit';
    } else if (riskColor && riskColor !== 'transparent') {
      riskBgColor = riskColor;
      riskTextColor = '#ffffff';
    } else if (typeof riskValue === 'string') {
      const colorMatch = riskValue.match(/^(Green|Yellow|Red|Blue|Orange)/i);
      if (colorMatch) {
        const colorName = colorMatch[1].toLowerCase();
        const colorMap = {
          'green': '#00875a',
          'yellow': '#ff8b00',
          'red': '#de350b',
          'blue': '#0052cc',
          'orange': '#ff8b00'
        };
        if (colorMap[colorName]) {
          riskBgColor = colorMap[colorName];
          riskTextColor = '#ffffff';
        }
      }
    }
    
    return (
      <td key={columnKey} style={{ 
        padding: '6px', 
        border: '1px solid #dee2e6',
        backgroundColor: riskBgColor,
        color: riskTextColor,
        fontWeight: isNotSet ? 600 : (riskBgColor !== 'transparent' ? 600 : 'normal'),
        textAlign: 'left',
        verticalAlign: 'top',
        wordWrap: 'break-word'
      }}>
        {isNotSet ? renderNotSet() : riskValue}
      </td>
    );
  }
  
  // Status Update Date
  if (columnKey === 'statusUpdateDate') {
    let dateValue = item.customfield_45660;
    if (dateValue && typeof dateValue === 'object' && !(dateValue instanceof Date)) {
      dateValue = dateValue.value || dateValue.date || dateValue;
    }
    const isOld = dateValue ? isDateOlderThan(dateValue, 10) : false;
    const formattedDate = dateValue ? formatDate(dateValue) : renderNotSet();
    
    return (
      <td key={columnKey} style={{ padding: '6px', border: '1px solid #dee2e6', wordWrap: 'break-word', textAlign: 'left', verticalAlign: 'top' }}>
        {isOld && dateValue ? (
          <span style={{
            backgroundColor: '#fff3cd',
            color: '#856404',
            padding: '4px 8px',
            borderRadius: '4px',
            fontWeight: 600,
            border: '1px solid #ffc107',
            display: 'inline-block'
          }}>
            {formattedDate}
          </span>
        ) : formattedDate}
      </td>
    );
  }
  
  // Status Update - Show from JIRA (customfield_23073) - render as rich text HTML
  if (columnKey === 'statusUpdate') {
    const statusUpdateValue = item.customfield_23073;
    let displayHtml = '';
    
    if (statusUpdateValue) {
      if (typeof statusUpdateValue === 'string') {
        const trimmed = statusUpdateValue.trim();
        if (trimmed.startsWith('<')) {
          displayHtml = trimmed;
        } else {
          displayHtml = formatJiraWikiMarkup(trimmed);
        }
      } else if (typeof statusUpdateValue === 'object' && statusUpdateValue.value) {
        const val = String(statusUpdateValue.value).trim();
        displayHtml = val.startsWith('<') ? val : formatJiraWikiMarkup(val);
      }
    }
    
    return (
      <td key={columnKey} style={{ 
        padding: '8px', 
        border: '1px solid #dee2e6', 
        wordWrap: 'break-word',
        textAlign: 'left',
        verticalAlign: 'top',
        fontSize: '12px',
        lineHeight: '1.4',
        maxHeight: '200px',
        overflow: 'auto'
      }}>
        {displayHtml ? (
          <div 
            style={{ 
              margin: 0,
              padding: 0,
              lineHeight: '1.4',
              wordBreak: 'break-word'
            }}
            dangerouslySetInnerHTML={{ __html: displayHtml }}
          />
        ) : renderNotSet()}
      </td>
    );
  }
  
  // Executive Summary - Show either generated or from JIRA based on config mode
  if (columnKey === 'executiveSummary') {
    const execSummaryConfig = columnsConfig?.columns?.executiveSummary;
    const mode = execSummaryConfig?.mode || 'generated'; // Default to generated
    
    // Get generated summary (already passed as prop)
    const generatedSummary = itemExecutiveSummary || '';
    
    // Get JIRA summary
    const jiraSummaryValue = item.customfield_38460;
    let jiraSummary = '';
    let jiraSummaryIsHtml = false;
    if (jiraSummaryValue) {
      if (typeof jiraSummaryValue === 'string') {
        const trimmed = jiraSummaryValue.trim();
        if (trimmed.startsWith('<')) {
          jiraSummary = trimmed;
          jiraSummaryIsHtml = true;
        } else {
          jiraSummary = formatJiraWikiMarkup(trimmed);
          jiraSummaryIsHtml = true;
        }
      } else if (typeof jiraSummaryValue === 'object' && jiraSummaryValue.value) {
        const val = String(jiraSummaryValue.value).trim();
        jiraSummary = val.startsWith('<') ? val : formatJiraWikiMarkup(val);
        jiraSummaryIsHtml = true;
      }
    }
    
    let displayContent = null;
    
    if (mode === 'generated') {
      // Show generated summary
      displayContent = generatedSummary ? (
        <div style={{ 
          margin: 0,
          padding: 0,
          lineHeight: '1.4',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          fontSize: '12px'
        }}>
          {generatedSummary}
        </div>
      ) : renderNotSet();
    } else if (mode === 'jira') {
      // Show JIRA summary
      displayContent = jiraSummary ? (
        jiraSummaryIsHtml ? (
          <div style={{ 
            margin: 0,
            padding: 0,
            lineHeight: '1.4',
            wordBreak: 'break-word',
            fontSize: '12px'
          }}
          dangerouslySetInnerHTML={{ __html: jiraSummary }}
          />
        ) : (
          <div style={{ 
            margin: 0,
            padding: 0,
            lineHeight: '1.4',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            fontSize: '12px'
          }}>
            {jiraSummary}
          </div>
        )
      ) : renderNotSet();
    } else if (mode === 'both') {
      // Show both side by side
      displayContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          <div>
            <strong style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '4px' }}>Generated:</strong>
            <div style={{ 
              margin: 0,
              padding: 0,
              fontSize: '12px', 
              lineHeight: '1.4',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}>
              {generatedSummary || renderNotSet()}
            </div>
          </div>
          <div>
            <strong style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '4px' }}>JIRA:</strong>
            {jiraSummary && jiraSummaryIsHtml ? (
              <div style={{ 
                margin: 0,
                padding: 0,
                fontSize: '12px', 
                lineHeight: '1.4',
                wordBreak: 'break-word'
              }}
              dangerouslySetInnerHTML={{ __html: jiraSummary }}
              />
            ) : (
              <div style={{ 
                margin: 0,
                padding: 0,
                fontSize: '12px', 
                lineHeight: '1.4',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                {jiraSummary || renderNotSet()}
              </div>
            )}
          </div>
        </div>
      );
    }
    
    return (
      <td key={columnKey} style={{ 
        padding: '8px', 
        border: '1px solid #dee2e6', 
        wordWrap: 'break-word',
        textAlign: 'left',
        verticalAlign: 'top',
        fontSize: '12px',
        lineHeight: '1.4',
        maxHeight: '200px',
        overflow: 'auto'
      }}>
        {displayContent}
      </td>
    );
  }
  
  // Custom Field 38460 (Executive Summary with buttons) - HIDDEN
  if (columnKey === 'customfield38460') {
    return null;
  }
  
  // Executive Update - Show from JIRA (customfield_38460) as read-only
  if (columnKey === 'executiveUpdate') {
    const executiveUpdateValue = item.customfield_38460;
    let displayValue = '';
    
    if (executiveUpdateValue) {
      if (typeof executiveUpdateValue === 'string') {
        displayValue = executiveUpdateValue.trim();
      } else if (typeof executiveUpdateValue === 'object' && executiveUpdateValue.value) {
        displayValue = String(executiveUpdateValue.value).trim();
      } else if (typeof executiveUpdateValue === 'object' && executiveUpdateValue.content) {
        displayValue = String(executiveUpdateValue.content).trim();
      }
    }
    
    return (
      <td key={columnKey} style={{ 
        padding: '8px', 
        border: '1px solid #dee2e6', 
        wordWrap: 'break-word',
        textAlign: 'left',
        verticalAlign: 'top',
        fontSize: '12px',
        lineHeight: '1.4',
        maxHeight: '200px',
        overflow: 'auto'
      }}>
        {displayValue ? (
          <div 
            style={{ 
              margin: 0,
              padding: 0,
              lineHeight: '1.4',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {displayValue}
          </div>
        ) : renderNotSet()}
      </td>
    );
  }
  
  // Team Contacts
  if (columnKey === 'teamContacts') {
    return (
      <td key={columnKey} style={{ padding: '6px', border: '1px solid #dee2e6', wordWrap: 'break-word', textAlign: 'left', verticalAlign: 'top' }}>
        {renderTeamContacts(item)}
      </td>
    );
  }
  
  // Task Breakdown
  if (columnKey === 'taskBreakdown') {
    return (
      <td key={columnKey} style={{ padding: '6px', border: '1px solid #dee2e6', wordWrap: 'break-word', textAlign: 'left', verticalAlign: 'top' }}>
        <TaskBreakdownCell
          jiraKey={item.key}
          breakdownData={breakdownData}
          loading={isBreakdownLoading}
          compact={true}
        />
      </td>
    );
  }

  // Executive Summary (AI-generated, push to customfield_38460)
  if (columnKey === 'execSummary') {
    return (
      <td key={columnKey} style={{ padding: '6px', border: '1px solid #dee2e6', wordWrap: 'break-word', textAlign: 'left', verticalAlign: 'top', minWidth: '220px', maxWidth: '280px' }}>
        <ExecSummaryCell
          item={item}
          selectedVersion={selectedVersion}
          ganttConfig={ganttConfig}
          breakdownData={breakdownData}
        />
      </td>
    );
  }

  // Checkpoint Dates
  if (columnKey === 'checkpointDates') {
    return (
      <td key={columnKey} style={{ padding: '6px', border: '1px solid #dee2e6', wordWrap: 'break-word', textAlign: 'left', verticalAlign: 'top' }}>
        {renderAllCheckpointDates(item, selectedVersion, checkpointHistory)}
      </td>
    );
  }
  
  // Default cell rendering
  let cellContent = 'N/A';
  let cellStyle = { 
    padding: '6px', 
    border: '1px solid #dee2e6', 
    wordWrap: 'break-word',
    textAlign: 'left',
    verticalAlign: 'top'
  };

  // Shared QI renderers — used in the summary cell
  const renderQIRow = (data, label) => {
    if (!data) return null;
    const qiVal = data.qi;
    const qiColor = qiVal == null ? '#aaa' : qiVal >= 80 ? '#28a745' : qiVal >= 60 ? '#fd7e14' : '#dc3545';
    return (
      <div style={{ fontSize: '9px', lineHeight: '1.5' }}>
        <span style={{ color: '#666', fontWeight: 600 }}>{label}: </span>
        {qiVal != null
          ? <span style={{ color: qiColor, fontWeight: 600 }}>QI {Math.round(qiVal)}%</span>
          : <span style={{ color: '#aaa' }}>QI N/A</span>
        }
        {data.total != null && (
          <span style={{ color: '#aaa' }}> · {data.passed ?? '?'}/{data.total} runs</span>
        )}
      </div>
    );
  };

  const renderComponents = (components) => {
    if (!components || components.length === 0) return null;
    return (
      <div style={{ marginTop: '2px' }}>
        {components.map((c, i) => {
          const cColor = c.qi == null ? '#aaa' : c.qi >= 80 ? '#28a745' : c.qi >= 60 ? '#fd7e14' : '#dc3545';
          return (
            <div key={i} style={{ fontSize: '8px', color: '#666', lineHeight: '1.4' }}>
              <span style={{ color: '#888' }}>{c.name}: </span>
              {c.qi != null
                ? <span style={{ color: cColor, fontWeight: 600 }}>{Math.round(c.qi)}%</span>
                : <span style={{ color: '#aaa' }}>N/A</span>
              }
              {c.total != null && <span style={{ color: '#bbb' }}> ({c.passed ?? '?'}/{c.total})</span>}
            </div>
          );
        })}
      </div>
    );
  };

  if (columnKey === 'key') {
    // Manual TCMS link from Jira ticket field
    const tcmsRaw = item.customfield_31460;
    const manualTcmsUrl = tcmsRaw?.value?.url
      || (typeof tcmsRaw === 'string' && /^https?:\/\//i.test(tcmsRaw) ? tcmsRaw : null);

    // Constructed TCMS query URL — built client-side from item.key + selectedVersion
    const tcmsVersion = (selectedVersion || '').replace(/^NDB-/i, '');
    const tcmsSearch = encodeURIComponent(JSON.stringify([
      { field: 'Requirements', op: '$eq', value: [item.key] }
    ]));
    const constructedTcmsUrl = tcmsVersion
      ? `https://tcms.eng.nutanix.com/#/testcases/NDB/${tcmsVersion}/qcow2?search=${tcmsSearch}&tab=package_type&type=All`
      : null;

    // Warning: advanced status but no manual TCMS link set
    const statusStr = (typeof item.status === 'string' ? item.status : item.status?.name || '').toLowerCase().trim();
    const isAdvancedStatus = ['code complete met', 'commit gate met', 'promotion gate met', 'closed'].includes(statusStr);
    const shouldWarnTcms = isAdvancedStatus && !manualTcmsUrl;

    if (shouldWarnTcms) {
      cellStyle.borderLeft = '3px solid #fd7e14';
      cellStyle.backgroundColor = '#fff8f0';
    }
    cellStyle.verticalAlign = 'top';

    cellContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
        {/* Jira key link */}
        <a href={`${jiraBaseUrl}/browse/${item.key}`} target="_blank" rel="noopener noreferrer"
           style={{ color: '#0065ff', textDecoration: 'none', fontWeight: 600 }}>
          {item.key}
        </a>

        {/* TCMS links */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {constructedTcmsUrl && (
            <a href={constructedTcmsUrl} target="_blank" rel="noopener noreferrer"
               style={{ color: '#0052cc', textDecoration: 'none', fontSize: '10px' }}
               title="View test cases linked to this feature in TCMS">
              🔍 TCMS Tests
            </a>
          )}
          {manualTcmsUrl ? (
            <a href={manualTcmsUrl} target="_blank" rel="noopener noreferrer"
               style={{ color: '#5a6776', textDecoration: 'none', fontSize: '10px' }}
               title="TCMS link set on Jira ticket">
              🔗 TCMS Suite
            </a>
          ) : (
            shouldWarnTcms && (
              <span style={{ fontSize: '10px', color: '#fd7e14', fontWeight: 600 }}>⚠ TCMS not set</span>
            )
          )}
        </div>
      </div>
    );
    cellStyle.fontWeight = 500;
  } else if (columnKey === 'summary') {
    const statusValue = getStatusDisplayValue(item);
    const summaryText = item.summary || 'N/A';
    const statusesWithTick = columnsConfig?.statusesWithTick || [];
    const qi = item.tcmsQI;
    cellContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {statusValue ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              alignSelf: 'flex-start',
              gap: '6px',
              fontSize: '11px',
              fontWeight: 600,
              color: '#495057',
              backgroundColor: '#e9ecef',
              padding: '2px 8px',
              borderRadius: '4px',
              border: '1px solid #dee2e6'
            }}
          >
            {isJiraStatusWithTick(statusValue, statusesWithTick) && (
              <span style={{ color: '#28a745', fontWeight: 'bold', fontSize: '12px' }} title="JIRA status met">✓</span>
            )}
            {statusValue}
          </span>
        ) : null}
        <span>{summaryText}</span>

        {/* QI + components — shown after background TCMS fetch completes */}
        {qi && (
          <div style={{ marginTop: '2px', borderTop: '1px dashed #e0e0e0', paddingTop: '4px' }}>
            {renderQIRow(qi.master, 'master')}
            {qi.branch && renderQIRow(qi.branch, selectedVersion)}
            {renderComponents((qi.master?.components || qi.branch?.components || []).slice(0, 5))}
          </div>
        )}
      </div>
    );
  } else if (columnKey === 'status') {
    const statusValue = getStatusDisplayValue(item);
    const statusesWithTick = columnsConfig?.statusesWithTick || [];
    cellContent = statusValue ? <StatusWithTick statusValue={statusValue} statusesWithTick={statusesWithTick} /> : 'N/A';
  } else if (columnKey === 'priority') {
    cellContent = item.priority || 'N/A';
  } else if (columnKey === 'fixVersion') {
    cellContent = item.fixVersions || 'N/A';
  } else if (columnKey === 'assignee') {
    // Defensive: ensure it's a string, not an object
    const assignee = item.assignee;
    cellContent = (typeof assignee === 'string' ? assignee : (assignee?.displayName || assignee?.name || assignee?.emailAddress || 'N/A'));
  } else if (columnKey === 'uxOwner') {
    // Defensive: ensure it's a string, not an object
    const uxOwner = item.customfield_15968;
    cellContent = (typeof uxOwner === 'string' ? uxOwner : (uxOwner?.displayName || uxOwner?.name || uxOwner?.emailAddress || 'N/A'));
  } else if (columnKey === 'qaContact') {
    // Show QA Contact and Test Lead side by side
    const qaContact = item.customfield_10860;
    const testLead = item.customfield_11065;
    const qaContactDisplay = qaContact ? (typeof qaContact === 'string' ? qaContact : (qaContact?.displayName || qaContact?.name || qaContact?.emailAddress || 'N/A')) : null;
    const testLeadDisplay = testLead ? (typeof testLead === 'string' ? testLead : (testLead?.displayName || testLead?.name || testLead?.emailAddress || 'N/A')) : null;
    
    if (qaContactDisplay || testLeadDisplay) {
      cellContent = (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          {qaContactDisplay && (
            <div style={{ fontSize: '11px' }}>
              <span style={{ fontWeight: 500, color: '#666' }}>QA:</span> {qaContactDisplay}
            </div>
          )}
          {testLeadDisplay && (
            <div style={{ fontSize: '11px' }}>
              <span style={{ fontWeight: 500, color: '#666' }}>TL:</span> {testLeadDisplay}
            </div>
          )}
        </div>
      );
    } else {
      cellContent = 'N/A';
    }
  } else if (columnKey === 'guiLead') {
    // Defensive: ensure it's a string, not an object
    const guiLead = item.customfield_11861;
    cellContent = (typeof guiLead === 'string' ? guiLead : (guiLead?.displayName || guiLead?.name || guiLead?.emailAddress || 'N/A'));
  } else if (columnKey === 'tpmOwner') {
    // Defensive: ensure it's a string, not an object
    const tpmOwner = item.customfield_27764;
    cellContent = (typeof tpmOwner === 'string' ? tpmOwner : (tpmOwner?.displayName || tpmOwner?.name || tpmOwner?.emailAddress || 'N/A'));
  } else if (columnKey === 'teamMembers') {
    // Handle array of team members
    const teamMembers = item.customfield_51460;
    if (!teamMembers) {
      cellContent = 'N/A';
    } else if (Array.isArray(teamMembers)) {
      // Array of user objects
      cellContent = teamMembers.map((member, index) => {
        const name = typeof member === 'string' 
          ? member 
          : (member?.displayName || member?.name || member?.emailAddress || 'N/A');
        return <div key={index} style={{ marginBottom: index < teamMembers.length - 1 ? '2px' : 0 }}>{name}</div>;
      });
    } else if (typeof teamMembers === 'string') {
      // Single string value
      cellContent = teamMembers;
    } else {
      // Single object
      cellContent = (teamMembers?.displayName || teamMembers?.name || teamMembers?.emailAddress || 'N/A');
    }
  }
  
  return <td key={columnKey} style={cellStyle}>{cellContent}</td>;
});

export default ReleaseVersionTableCell;

